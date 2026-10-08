import { invalidateTerminalFit, markTerminalContinuation, suspendTerminalContinuation } from "../../../shared/lib/terminalContinuation";
import { useRef, type RefObject } from "react";
import { canAnswerTerminalQueryFrame, claimTerminalQueryFrame } from "../../../shared/lib/terminalQueryPolicy";
import { writeTerminalOutput, resetTerminalOutputOrigin } from "../../../shared/lib/terminalHistoricalParser";
import type { IMarker, ITheme, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { refreshTerminalViewport } from "../lib/terminalVisibility";
import {
  clearTerminalLatency,
  noteTerminalFirstFrame,
  noteTerminalFlushStart,
  noteTerminalWriteCommitted,
} from "../lib/terminalLatencyDiagnostics";
import {
  selectScheduledTerminalWrite,
  selectWriteBatchLimit,
  type SchedulableTerminalWrite,
} from "../lib/terminalWriteScheduling";
import { isLightTerminalTheme } from "../../../shared/lib/terminalThemes";
import { logError, logWarn } from "../../../shared/platform/logger";
import { markTerminalSnapshotDirty } from "../api/sessionSnapshotPersistence";
import { TerminalResizeDebouncer } from "../browser/TerminalResizeDebouncer";
import { TerminalResizeRenderBarrier } from "../browser/TerminalResizeRenderBarrier";
import {
  terminalProcessManager,
  type TerminalOutputDelivery,
} from "../api/TerminalProcessManager";
import type { TerminalBinaryFrame } from "../transport/PtyHostSocket";
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  useSettingsStore,
} from "../../../shared/preferences/settingsStore";
import { useTerminalStore } from "../state";

const MIN_TERMINAL_COLS = 40;
const MIN_TERMINAL_ROWS = 8;
const HIDDEN_WEBGL_DISPOSE_DELAY_MS = 10_000;
const PTY_LIVE_WRITE_BATCH_BYTES = 64 * 1024;
// 拥塞缓解上限：队列连续积压时单次写允许放宽到 256KB（仍按完整帧边界），
// 消化积压后回落 64KB。设为与 PTY_LIVE_WRITE_BATCH_BYTES 相等即关闭缓解。
const PTY_LIVE_WRITE_BATCH_BYTES_RELIEF = 256 * 1024;
// 连续多少个 flush 周期队列非空即判定拥塞。
const PTY_LIVE_WRITE_CONGESTED_CYCLES = 3;
const PTY_VISIBLE_WRITE_BURST = 3;
const PTY_WRITE_SCHEDULER_FALLBACK_DELAY_MS = 250;

interface ScheduledTerminalWrite extends SchedulableTerminalWrite {
  flush: () => void;
}

const scheduledTerminalWrites = new Map<symbol, ScheduledTerminalWrite>();
let terminalWriteSchedulerRafId: number | null = null;
let terminalWriteSchedulerTimerId: number | null = null;
let terminalWriteVisibilityListenerAttached = false;
let visibleWriteBurst = 0;

const isDocumentHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

const clearGlobalTerminalWriteScheduler = () => {
  if (terminalWriteSchedulerRafId !== null) {
    cancelAnimationFrame(terminalWriteSchedulerRafId);
    terminalWriteSchedulerRafId = null;
  }
  if (terminalWriteSchedulerTimerId !== null) {
    window.clearTimeout(terminalWriteSchedulerTimerId);
    terminalWriteSchedulerTimerId = null;
  }
};

const runGlobalTerminalWrite = () => {
  if (terminalWriteSchedulerRafId !== null) {
    cancelAnimationFrame(terminalWriteSchedulerRafId);
    terminalWriteSchedulerRafId = null;
  }
  if (terminalWriteSchedulerTimerId !== null) {
    window.clearTimeout(terminalWriteSchedulerTimerId);
    terminalWriteSchedulerTimerId = null;
  }
  const entries = [...scheduledTerminalWrites.values()];
  // 回车后首帧优先：带有效交互标记的可见终端跳过 burst 计数，直接选中。
  // 标记一次性消费，超时自动失效，不饿死隐藏终端。
  const selected = selectScheduledTerminalWrite(
    entries,
    visibleWriteBurst,
    PTY_VISIBLE_WRITE_BURST,
    (sessionId) => terminalProcessManager.hasInteractivePriority(sessionId),
  );
  if (selected && selected.isVisible()) {
    terminalProcessManager.consumeInteractivePriority(selected.sessionId);
  }
  if (!selected) {
    if (scheduledTerminalWrites.size === 0) {
      visibleWriteBurst = 0;
      removeTerminalVisibilityListener();
    }
    return;
  }
  visibleWriteBurst = selected.isVisible() ? visibleWriteBurst + 1 : 0;
  scheduledTerminalWrites.delete(selected.token);
  selected.flush();
  if (scheduledTerminalWrites.size === 0) {
    visibleWriteBurst = 0;
    return;
  }
  scheduleGlobalTerminalWrite();
};

const scheduleGlobalTerminalWrite = () => {
  if (
    terminalWriteSchedulerRafId !== null
    || terminalWriteSchedulerTimerId !== null
    || scheduledTerminalWrites.size === 0
  ) return;
  if (!isDocumentHidden()) {
    terminalWriteSchedulerRafId = requestAnimationFrame(runGlobalTerminalWrite);
  }
  // Background WebViews may stop rAF, and some hosts do not reliably update
  // document.visibilityState on minimize/occlusion. Keep a watchdog so a
  // pending PTY write cannot depend on either signal forever.
  terminalWriteSchedulerTimerId = window.setTimeout(
    runGlobalTerminalWrite,
    PTY_WRITE_SCHEDULER_FALLBACK_DELAY_MS,
  );
};

const onTerminalDocumentVisibilityChange = () => {
  if (scheduledTerminalWrites.size === 0) return;
  clearGlobalTerminalWriteScheduler();
  scheduleGlobalTerminalWrite();
};

const ensureTerminalVisibilityListener = () => {
  if (typeof document === "undefined" || terminalWriteVisibilityListenerAttached) return;
  document.addEventListener("visibilitychange", onTerminalDocumentVisibilityChange);
  terminalWriteVisibilityListenerAttached = true;
};

const removeTerminalVisibilityListener = () => {
  if (typeof document === "undefined" || !terminalWriteVisibilityListenerAttached) return;
  document.removeEventListener("visibilitychange", onTerminalDocumentVisibilityChange);
  terminalWriteVisibilityListenerAttached = false;
};

const requestGlobalTerminalWrite = (entry: ScheduledTerminalWrite) => {
  scheduledTerminalWrites.set(entry.token, entry);
  ensureTerminalVisibilityListener();
  scheduleGlobalTerminalWrite();
};

const cancelGlobalTerminalWrite = (token: symbol) => {
  scheduledTerminalWrites.delete(token);
  if (scheduledTerminalWrites.size === 0) {
    clearGlobalTerminalWriteScheduler();
    removeTerminalVisibilityListener();
    visibleWriteBurst = 0;
  }
};

type NormalizeTerminalOutput = (text: string, options?: { applyOsc52?: boolean }) => string;
type TransformTerminalOutput = (text: string) => string;
type AfterTerminalWrite = (terminal: Terminal) => void;

export interface TerminalOutputDiagnostics {
  onFrame(frame: TerminalBinaryFrame, rawText: string, normalizedText: string): void;
  onWriteCommitted(terminal: Terminal, writtenText: string): void;
  reset(): void;
}

interface PendingTerminalWrite {
  text: string;
  charCount: number;
  byteLength: number;
  commit: ((charCount: number) => void) | null;
  replay: boolean;
  sequence: number;
  replayBatchEnd: boolean;
  cols: number;
  rows: number;
  reset: boolean;
  // 回车后首帧标记：queue 时由 noteTerminalFirstFrame 判定，flush/回调时完成计时。
  latencyFirstFrame: boolean;
}

type PendingViewportRestore =
  | {
    kind: "bottom";
    terminal: Terminal;
  }
  | {
    kind: "marker";
    marker: IMarker;
    terminal: Terminal;
  };

interface UseTerminalDisplayOptions {
  sessionId: string;
  containerRef: RefObject<HTMLDivElement | null>;
  terminalRef: RefObject<Terminal | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  isVisibleRef: RefObject<boolean>;
  isComposingRef: RefObject<boolean>;
  lowMemoryMode: boolean;
  disableHardwareAcceleration: boolean;
  disableWebglForSessionRef: RefObject<boolean>;
  linuxGraphicsDisableWebgl: boolean;
  isTransparentRef: RefObject<boolean>;
  normalizeOutputRef: RefObject<NormalizeTerminalOutput>;
  transformOutputRef: RefObject<TransformTerminalOutput>;
  afterTerminalWriteRef: RefObject<AfterTerminalWrite | null>;
  outputDiagnosticsRef?: RefObject<TerminalOutputDiagnostics | null>;
  resetNormalizerRef?: RefObject<(() => void) | null>;
  onPtyOutputListenError: (err: unknown) => void;
  onViewportRefreshNeeded?: () => void;
}

export interface UseTerminalDisplayResult {
  syncWebglRenderer: (terminal: Terminal, theme: ITheme) => boolean;
  scheduleHiddenWebglDispose: (enabled: boolean) => void;
  clearHiddenWebglDisposeTimer: () => void;
  clearWebglTextureAtlas: () => void;
  disposeWebglRenderer: () => boolean;
  scheduleFit: (immediateResize?: boolean, forceViewportRefresh?: boolean) => void;
  scheduleViewportRefresh: () => void;
  markViewportRefreshNeeded: () => void;
  enqueueActiveWrite: (text: string, onCommitted?: () => void) => void;
  attachPtyOutput: (options?: { waitForReplay?: boolean }) => {
    ready: Promise<void>;
    isCurrent: () => boolean;
    completeReplay: (replay: TerminalBinaryFrame[]) => Promise<boolean>;
    dispose: () => void;
  };
  setHistoricalResize: (historical: boolean) => void;
  reclaimViewportSize: () => void;
  getPtyViewportSize: () => { cols: number; rows: number } | null;
  attachViewport: (terminal: Terminal) => () => void;
  resetOutputState: () => void;
  cancelScheduledFit: () => void;
  resetViewportRefreshState: () => void;
}

export function useTerminalDisplay({
  sessionId,
  containerRef,
  terminalRef,
  fitAddonRef,
  isVisibleRef,
  isComposingRef,
  lowMemoryMode,
  disableHardwareAcceleration,
  disableWebglForSessionRef,
  linuxGraphicsDisableWebgl,
  isTransparentRef,
  normalizeOutputRef,
  transformOutputRef,
  afterTerminalWriteRef,
  outputDiagnosticsRef,
  resetNormalizerRef,
  onPtyOutputListenError,
  onViewportRefreshNeeded,
}: UseTerminalDisplayOptions): UseTerminalDisplayResult {
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const webglDisposeTimerRef = useRef<number | null>(null);
  const webglContextLostRef = useRef(false);
  const fitRafRef = useRef<number | null>(null);
  const needsViewportRefreshRef = useRef(false);
  const ptyPendingChunksRef = useRef<PendingTerminalWrite[]>([]);
  const ptyWriteScheduleTokenRef = useRef(Symbol(sessionId));
  const ptyWriteInProgressRef = useRef(false);
  // 拥塞计数：连续多少个 flush 周期结束时队列仍非空。达阈值则单次写上限
  // 临时放宽到 RELIEF，队列排空即回落 64KB。
  const ptyWriteCongestedCyclesRef = useRef(0);
  const ptyUnlistenRef = useRef<UnlistenFn | null>(null);
  const lastObservedSizeRef = useRef<{ width: number; height: number } | null>(null);
  const resizeDebouncerRef = useRef<TerminalResizeDebouncer | null>(null);
  const resizeRenderBarrierRef = useRef<TerminalResizeRenderBarrier | null>(null);
  const viewportRestoreRafRef = useRef<number | null>(null);
  const pendingViewportRestoreRef = useRef<PendingViewportRestore | null>(null);
  const forwardPtyResizeRef = useRef(true);
  const fittedViewportRef = useRef<Terminal | null>(null);
  const requestedFitRef = useRef<{ cols: number; rows: number } | null>(null);
  const reclaimViewportRef = useRef(false);
  const outputOwnerRef = useRef<symbol | null>(null);
  const disposeOutputRef = useRef<(() => void) | null>(null);
  const finishReplayFitRef = useRef<(() => void) | null>(null);

  const cancelPendingViewportRestore = () => {
    if (viewportRestoreRafRef.current !== null) {
      cancelAnimationFrame(viewportRestoreRafRef.current);
      viewportRestoreRafRef.current = null;
    }
    const pending = pendingViewportRestoreRef.current;
    pendingViewportRestoreRef.current = null;
    if (pending?.kind === "marker" && !pending.marker.isDisposed) pending.marker.dispose();
  };

  const scheduleViewportRestore = (pending: PendingViewportRestore) => {
    pendingViewportRestoreRef.current = pending;
    viewportRestoreRafRef.current = requestAnimationFrame(() => {
      if (pendingViewportRestoreRef.current !== pending) return;
      viewportRestoreRafRef.current = requestAnimationFrame(() => {
        viewportRestoreRafRef.current = null;
        if (pendingViewportRestoreRef.current !== pending) return;
        pendingViewportRestoreRef.current = null;
        try {
          if (terminalRef.current !== pending.terminal) return;
          if (pending.kind === "bottom") {
            pending.terminal.scrollToBottom();
          } else if (!pending.marker.isDisposed) {
            pending.terminal.scrollToLine(pending.marker.line);
          }
        } finally {
          if (pending.kind === "marker" && !pending.marker.isDisposed) pending.marker.dispose();
        }
      });
    });
  };

  const clearHiddenWebglDisposeTimer = () => {
    if (webglDisposeTimerRef.current === null) return;
    window.clearTimeout(webglDisposeTimerRef.current);
    webglDisposeTimerRef.current = null;
  };

  const disposeWebglRenderer = () => {
    if (!webglAddonRef.current) return false;
    webglAddonRef.current.dispose();
    webglAddonRef.current = null;
    return true;
  };

  const canUseWebglRenderer = (theme: ITheme) => (
    !disableHardwareAcceleration
    && !disableWebglForSessionRef.current
    && !linuxGraphicsDisableWebgl
    && !webglContextLostRef.current
    && !isTransparentRef.current
    && !isLightTerminalTheme(theme)
  );

  const createWebglAddon = () => {
    // The live-resize barrier copies the last committed renderer frame before
    // xterm reallocates its canvas. WebKit clears non-preserved WebGL drawing
    // buffers after compositing, which otherwise produces an empty snapshot.
    const addon = new WebglAddon({ preserveDrawingBuffer: true });
    addon.onContextLoss(() => {
      webglContextLostRef.current = true;
      addon.dispose();
      if (webglAddonRef.current === addon) {
        webglAddonRef.current = null;
      }
      logWarn("Terminal WebGL context lost; keeping the default renderer for this session", { sessionId });
    });
    return addon;
  };

  const syncWebglRenderer = (terminal: Terminal, theme: ITheme) => {
    if (!canUseWebglRenderer(theme)) {
      return disposeWebglRenderer();
    }
    if (lowMemoryMode && !isVisibleRef.current) return false;
    if (webglAddonRef.current) return false;
    try {
      const addon = createWebglAddon();
      terminal.loadAddon(addon);
      webglAddonRef.current = addon;
      return true;
    } catch {
      return false;
    }
  };

  const scheduleHiddenWebglDispose = (enabled: boolean) => {
    clearHiddenWebglDisposeTimer();
    if (!enabled || !webglAddonRef.current) return;
    webglDisposeTimerRef.current = window.setTimeout(() => {
      webglDisposeTimerRef.current = null;
      if (isVisibleRef.current) return;
      if (disposeWebglRenderer()) {
        needsViewportRefreshRef.current = true;
        onViewportRefreshNeeded?.();
      }
    }, HIDDEN_WEBGL_DISPOSE_DELAY_MS);
  };

  const clearWebglTextureAtlas = () => {
    webglAddonRef.current?.clearTextureAtlas();
  };

  const handleTerminalWriteCommitted = (terminal: Terminal) => {
    afterTerminalWriteRef.current?.(terminal);
  };

  const enqueueActiveWrite = (text: string, onCommitted?: () => void) => {
    if (!text) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.write(transformOutputRef.current(text), () => {
      if (terminalRef.current !== terminal) return;
      handleTerminalWriteCommitted(terminal);
      onCommitted?.();
    });
  };

  const attachPtyOutput = (options: { waitForReplay?: boolean } = {}) => {
    disposeOutputRef.current?.();
    const owner = Symbol(sessionId);
    outputOwnerRef.current = owner;
    const attachedTerminal = terminalRef.current;
    const ownsOutput = () => !cancelled && outputOwnerRef.current === owner && terminalRef.current === attachedTerminal;
    let recovering = false;
    let resetGeneration = 0;
    const disconnect = terminalProcessManager.subscribeDisconnect(() => {
      if (ownsOutput() && attachedTerminal) { recovering = true; suspendTerminalContinuation(attachedTerminal); }
    });
    let textDecoder = new TextDecoder("utf-8");
    let cancelled = false;
    let waitingForReplay = options.waitForReplay === true;
    const bufferedLivePayloads: TerminalOutputDelivery[] = [];
    let resolveReplay: ((complete: boolean) => void) | null = null;
    let streamedReplayComplete = false;
    let completionStarted = false;
    let resolveCancellation: (() => void) | null = null;
    const cancellation = new Promise<void>((resolve) => { resolveCancellation = resolve; });
    const finishReplayBatch = () => {
      if (!ownsOutput()) return;
      forwardPtyResizeRef.current = true;
      finishReplayFitRef.current = () => {
        if (!ownsOutput()) return;
        finishReplayFitRef.current = null;
        recovering = false;
        if (attachedTerminal) markTerminalContinuation(attachedTerminal, "output");
        streamedReplayComplete = true;
        resolveReplay?.(true);
        resolveReplay = null;
        schedulePendingWrite();
      };
      fitWhenStable(true);
    };
    const schedulePendingWrite = () => {
      if (!ownsOutput() || ptyWriteInProgressRef.current || finishReplayFitRef.current) return;
      // 拥塞记账：每个 flush 周期结束恰更新一次。队列排空则清零回落 64KB；
      // 仍有积压则计数加一，达阈值后下轮单次写上限放宽到 256KB。
      if (ptyPendingChunksRef.current.length === 0) {
        if (!waitingForReplay && !recovering && attachedTerminal) markTerminalContinuation(attachedTerminal, "output");
        ptyWriteCongestedCyclesRef.current = 0;
        return;
      }
      ptyWriteCongestedCyclesRef.current += 1;

      // Enter 后首个可见帧是交互反馈，不再额外等待全局 rAF。
      // 只消费一次优先标记，后续持续输出仍走全局公平调度。
      if (isVisibleRef.current && terminalProcessManager.consumeInteractivePriority(sessionId)) {
        cancelGlobalTerminalWrite(ptyWriteScheduleTokenRef.current);
        queueMicrotask(flushPendingWrites);
        return;
      }

      requestGlobalTerminalWrite({
        token: ptyWriteScheduleTokenRef.current,
        sessionId,
        isVisible: () => isVisibleRef.current,
        flush: flushPendingWrites,
      });
    };
    const flushPendingWrites = () => {
      if (!ownsOutput() || ptyWriteInProgressRef.current || finishReplayFitRef.current) return;
      const terminal = terminalRef.current;
      if (!terminal) return;
      const writeGeneration = resetGeneration;
      const ownsWrite = () => ownsOutput() && resetGeneration === writeGeneration;
      const first = ptyPendingChunksRef.current.shift();
      if (!first) return;
      const pending = [first];
      const answerQueries = canAnswerTerminalQueryFrame(sessionId, first.sequence, first.replay);
      // 拥塞判定在本周期入口做：上轮结束时队列仍有积压则计数加一，排空则清零。
      // 计数达阈值前即使用 relief 上限也不会超 64KB（下轮才生效），避免单轮突增。
      const writeBatchLimit = selectWriteBatchLimit(
        ptyWriteCongestedCyclesRef.current,
        PTY_LIVE_WRITE_CONGESTED_CYCLES,
        PTY_LIVE_WRITE_BATCH_BYTES,
        PTY_LIVE_WRITE_BATCH_BYTES_RELIEF,
      );
      if (!first.replay && !first.reset) {
        let pendingBytes = first.byteLength;
        // Keep each live write bounded at complete PTY frame boundaries so a
        // continuous producer cannot monopolize the WebView main thread.
        while (
          ptyPendingChunksRef.current[0]
          && !ptyPendingChunksRef.current[0].replay
          && !ptyPendingChunksRef.current[0].reset
          && canAnswerTerminalQueryFrame(sessionId, ptyPendingChunksRef.current[0].sequence, false) === answerQueries
        ) {
          const next = ptyPendingChunksRef.current[0];
          if (
            pending.length > 0
            && pendingBytes + next.byteLength > writeBatchLimit
          ) {
            break;
          }
          pending.push(ptyPendingChunksRef.current.shift()!);
          pendingBytes += next.byteLength;
        }
      } else {
        forwardPtyResizeRef.current = false;
        invalidateTerminalFit(terminal);
        fittedViewportRef.current = null;
        if (
          first.cols > 0
          && first.rows > 0
          && (terminal.cols !== first.cols || terminal.rows !== first.rows)
        ) {
          terminal.resize(first.cols, first.rows);
        }
      }
      const combined = pending.map((chunk) => chunk.text).join("");
      const commitPending = () => {
        pending.forEach((chunk) => chunk.commit?.(chunk.charCount));
        if (first.replay && first.replayBatchEnd) finishReplayBatch();
      };
      if (first.reset) {
        resetNormalizerRef?.current?.();
        outputDiagnosticsRef?.current?.reset();
        terminal.reset();
        resetTerminalOutputOrigin(terminal);
        commitPending();
        schedulePendingWrite();
        return;
      }
      if (!combined) {
        commitPending();
        schedulePendingWrite();
        return;
      }
      ptyWriteInProgressRef.current = true;
      let transformed = "";
      // 延迟埋点：本次 flush 若含回车后首帧，记录开始写入与渲染提交时刻。
      const tracksLatency = pending.some((chunk) => chunk.latencyFirstFrame);
      if (tracksLatency) noteTerminalFlushStart(sessionId, performance.now());
      writeTerminalOutput(terminal, combined, answerQueries ? "live" : "history", () => {
        if (!ownsOutput()) return;
        if (!ownsWrite()) {
          ptyWriteInProgressRef.current = false;
          schedulePendingWrite();
          return;
        }
        pending.forEach((chunk) => claimTerminalQueryFrame(sessionId, chunk.sequence, chunk.replay));
        ptyWriteInProgressRef.current = false;
        if (tracksLatency) noteTerminalWriteCommitted(sessionId, performance.now());
        outputDiagnosticsRef?.current?.onWriteCommitted(terminal, transformed);
        handleTerminalWriteCommitted(terminal);
        commitPending();
        schedulePendingWrite();
      }, (part, origin) => {
        const text = transformOutputRef.current(normalizeOutputRef.current(part, { applyOsc52: !first.replay && origin === "live" }));
        transformed += text;
        return text;
      }, ownsWrite);
    };
    const queuePayload = (delivery: TerminalOutputDelivery, markSnapshotDirty: boolean) => {
      if (!ownsOutput()) return;
      const payload = delivery.frame;
      if (payload.kind === "reset") {
        resetGeneration++;
        ptyPendingChunksRef.current = [];
        suspendTerminalContinuation(attachedTerminal!);
        textDecoder = new TextDecoder("utf-8");
      }
      const rawText = textDecoder.decode(payload.data, { stream: true });
      // Normalize at write enqueue, after raw-origin partitioning. Otherwise
      // a buffered historical ESC/OSC/tmux prefix can gain a live suffix origin.
      const text = rawText;
      outputDiagnosticsRef?.current?.onFrame(payload, rawText, text);
      if (markSnapshotDirty) {
        markTerminalSnapshotDirty(sessionId);
        useTerminalStore.getState().recordPtyOutputActivity(sessionId);
      }
      // 延迟埋点：只统计回车后的首个 live 帧，replay/reset 不计。
      const isLive = payload.kind !== "replay" && payload.kind !== "reset";
      const latencyFirstFrame = isLive && noteTerminalFirstFrame(sessionId, performance.now());
      ptyPendingChunksRef.current.push({
        text,
        charCount: rawText.length,
        byteLength: payload.data.byteLength,
        commit: delivery.commit,
        replay: payload.kind === "replay",
        sequence: payload.sequence,
        replayBatchEnd: payload.replayBatchEnd === true,
        cols: payload.cols,
        rows: payload.rows,
        reset: payload.kind === "reset",
        latencyFirstFrame,
      });
      schedulePendingWrite();
    };
    const ready = terminalProcessManager.subscribeOutput(sessionId, (delivery) => {
      if (!ownsOutput()) return;
      if (waitingForReplay) {
        bufferedLivePayloads.push(delivery);
        return;
      }
      queuePayload(delivery, true);
    }).then((fn) => {
      if (!ownsOutput()) {
        fn();
      } else {
        ptyUnlistenRef.current = fn;
        schedulePendingWrite();
      }
    });
    void ready.catch(onPtyOutputListenError);

    const completeReplay = async (replay: TerminalBinaryFrame[]) => {
      if (!ownsOutput() || !waitingForReplay || completionStarted) return false;
      completionStarted = true;
      const terminal = attachedTerminal;
      if (!terminal) return false;
      forwardPtyResizeRef.current = false;
      fittedViewportRef.current = null;
      for (const entry of replay) {
        if (!ownsOutput()) return false;
        if (entry.kind === "reset") {
          textDecoder = new TextDecoder("utf-8");
          resetNormalizerRef?.current?.();
          terminal.reset();
          resetTerminalOutputOrigin(terminal);
        }
        if (entry.cols > 0 && entry.rows > 0 && (terminal.cols !== entry.cols || terminal.rows !== entry.rows)) {
          terminal.resize(entry.cols, entry.rows);
        }
        const rawText = textDecoder.decode(entry.data, { stream: true });
        outputDiagnosticsRef?.current?.onFrame(entry, rawText, rawText);
        const committed = new Promise<void>((resolve) => {
          const answerQueries = canAnswerTerminalQueryFrame(sessionId, entry.sequence, true);
          let transformed = "";
          writeTerminalOutput(terminal, rawText, answerQueries ? "live" : "history", () => {
            if (ownsOutput()) {
              claimTerminalQueryFrame(sessionId, entry.sequence, true);
              outputDiagnosticsRef?.current?.onWriteCommitted(terminal, transformed);
              handleTerminalWriteCommitted(terminal);
              terminalProcessManager.acknowledgeOutput(sessionId, entry.sequence, 0);
            }
            resolve();
          }, (part) => {
            const normalized = transformOutputRef.current(normalizeOutputRef.current(part, { applyOsc52: false }));
            transformed += normalized;
            return normalized;
          }, ownsOutput);
        });
        await Promise.race([committed, cancellation]);
        if (!ownsOutput()) return false;
      }
      // [] attach uses the subscribed reset/replay/end stream, not an empty completion.
      const hasStream = replay.length === 0 || bufferedLivePayloads.some(({ frame }) => frame.kind === "replay" || frame.kind === "reset");
      waitingForReplay = false;
      let streamCompletion: Promise<boolean> | null = null;
      if (hasStream) streamCompletion = new Promise((resolve) => { resolveReplay = resolve; });
      let resetIndex = -1;
      bufferedLivePayloads.forEach(({ frame }, index) => { if (frame.kind === "reset") resetIndex = index; });
      if (resetIndex > 0) bufferedLivePayloads.splice(0, resetIndex);
      bufferedLivePayloads.splice(0).forEach((delivery) => queuePayload(delivery, true));
      if (streamCompletion && !streamedReplayComplete) return streamCompletion;
      if (!ownsOutput()) return false;
      if (!hasStream) {
        const fitted = new Promise<boolean>((resolve) => { resolveReplay = resolve; });
        finishReplayBatch();
        return fitted;
      }
      return true;
    };
    const dispose = () => {
      if (cancelled) return;
      const wasOwner = outputOwnerRef.current === owner;
      cancelled = true;
      disconnect();
      resolveCancellation?.();
      resolveReplay?.(false);
      resolveReplay = null;
      bufferedLivePayloads.length = 0;
      if (!wasOwner) return;
      finishReplayFitRef.current = null;
      outputOwnerRef.current = null;
      disposeOutputRef.current = null;
      forwardPtyResizeRef.current = true;
      cancelGlobalTerminalWrite(ptyWriteScheduleTokenRef.current);
      ptyPendingChunksRef.current = [];
      ptyWriteInProgressRef.current = false;
      ptyUnlistenRef.current?.();
      ptyUnlistenRef.current = null;
    };
    disposeOutputRef.current = dispose;
    return { ready, isCurrent: ownsOutput, completeReplay, dispose };
  };

  const attachViewport = (terminal: Terminal) => {
    const container = containerRef.current;
    if (!container) return () => {};
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      markTerminalSnapshotDirty(sessionId);
      if (!forwardPtyResizeRef.current) return;
      if (!isVisibleRef.current || document.visibilityState === "hidden") return;
      if (cols < MIN_TERMINAL_COLS || rows < MIN_TERMINAL_ROWS) return;
      const pixelWidth = terminal.dimensions?.css.canvas.width;
      const pixelHeight = terminal.dimensions?.css.canvas.height;
      terminalProcessManager.resize(
        sessionId,
        cols,
        rows,
        pixelWidth ? Math.round(pixelWidth) : undefined,
        pixelHeight ? Math.round(pixelHeight) : undefined,
      ).catch((err) => {
        logError("PTY resize failed in terminal display", { sessionId, cols, rows, err });
      });
    });
    const wheelListenerOptions = { passive: false, capture: true } as const;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const current = useSettingsStore.getState().fontSize;
      const next = Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, current + (event.deltaY > 0 ? -1 : 1)),
      );
      if (next !== current) {
        void useSettingsStore.getState().update("fontSize", next);
      }
    };
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      const lastSize = lastObservedSizeRef.current;
      if (lastSize && Math.abs(lastSize.width - width) < 2 && Math.abs(lastSize.height - height) < 2) {
        return;
      }
      lastObservedSizeRef.current = { width, height };
      resizeRenderBarrierRef.current?.noteContainerResize();
      scheduleFit();
    });
    container.addEventListener("wheel", onWheel, wheelListenerOptions);
    resizeObserver.observe(container);
    return () => {
      resizeDisposable.dispose();
      container.removeEventListener("wheel", onWheel, wheelListenerOptions);
      resizeObserver.disconnect();
      resizeDebouncerRef.current?.dispose();
      resizeDebouncerRef.current = null;
      resizeRenderBarrierRef.current?.dispose();
      resizeRenderBarrierRef.current = null;
      cancelPendingViewportRestore();
    };
  };

  const resetOutputState = () => {
    disposeOutputRef.current?.();
    resetNormalizerRef?.current?.();
    cancelPendingViewportRestore();
    cancelGlobalTerminalWrite(ptyWriteScheduleTokenRef.current);
    ptyPendingChunksRef.current = [];
    ptyWriteInProgressRef.current = false;
    ptyWriteCongestedCyclesRef.current = 0;
    clearTerminalLatency(sessionId);
    forwardPtyResizeRef.current = true;
    fittedViewportRef.current = null;
    reclaimViewportRef.current = false;
    outputDiagnosticsRef?.current?.reset();
  };

  const completeViewportFit = (terminal: Terminal) => {
    const requested = requestedFitRef.current;
    if (!forwardPtyResizeRef.current || !requested
      || terminal.cols !== requested.cols || terminal.rows !== requested.rows) return;
    fittedViewportRef.current = terminal;
    markTerminalContinuation(terminal, "fitted");
    finishReplayFitRef.current?.();
  };

  const resizeTerminal = (terminal: Terminal, cols: number, rows: number) => {
    if (terminal.cols === cols && terminal.rows === rows) return;
    cancelPendingViewportRestore();
    const container = containerRef.current;
    const shouldGuardHorizontalShrink = (
      cols < terminal.cols
      && isVisibleRef.current
      && container !== null
    );
    if (shouldGuardHorizontalShrink && container) {
      let barrier = resizeRenderBarrierRef.current;
      if (!barrier) {
        barrier = new TerminalResizeRenderBarrier();
        resizeRenderBarrierRef.current = barrier;
      }
      barrier.begin(terminal, container);
    }
    const buffer = terminal.buffer.active;
    const isHorizontalReflow = cols !== terminal.cols;
    const wasAtLiveBottom = (
      isHorizontalReflow
      && buffer.type === "normal"
      && buffer.viewportY === buffer.baseY
    );
    // Horizontal reflow changes physical row indexes; a marker follows the logical viewport line.
    const viewportMarker = (
      isHorizontalReflow
      && buffer.type === "normal"
      && buffer.viewportY < buffer.baseY
    )
      ? terminal.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY)
      : undefined;
    terminal.resize(cols, rows);
    resizeRenderBarrierRef.current?.noteContainerResize();
    completeViewportFit(terminal);
    if (wasAtLiveBottom) {
      // Reassert xterm's live-follow intent before and after its asynchronous DOM viewport sync.
      terminal.scrollToBottom();
      scheduleViewportRestore({ kind: "bottom", terminal });
    } else if (viewportMarker) {
      scheduleViewportRestore({ kind: "marker", marker: viewportMarker, terminal });
    }
  };

  const getResizeDebouncer = () => {
    let debouncer = resizeDebouncerRef.current;
    if (debouncer) return debouncer;
    debouncer = new TerminalResizeDebouncer(
      () => isVisibleRef.current,
      () => terminalRef.current,
      (cols, rows) => {
        const terminal = terminalRef.current;
        if (terminal) resizeTerminal(terminal, cols, rows);
      },
      (cols) => {
        const terminal = terminalRef.current;
        if (terminal) resizeTerminal(terminal, cols, terminal.rows);
      },
      (rows) => {
        const terminal = terminalRef.current;
        if (terminal) resizeTerminal(terminal, terminal.cols, rows);
      },
    );
    resizeDebouncerRef.current = debouncer;
    return debouncer;
  };

  const fitWhenStable = (immediateResize = false, forceViewportRefresh = immediateResize) => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!container || !fitAddon || !terminal) return;
    if (!forwardPtyResizeRef.current) return;
    if (!immediateResize && (!isVisibleRef.current || isComposingRef.current)) return;
    if (container.offsetWidth <= 0 || container.offsetHeight <= 0) return;

    const dims = fitAddon.proposeDimensions();
    if (!dims || dims.cols < MIN_TERMINAL_COLS || dims.rows < MIN_TERMINAL_ROWS) return;
    requestedFitRef.current = dims;
    getResizeDebouncer().resize(dims.cols, dims.rows, immediateResize);
    if (terminal.cols === dims.cols && terminal.rows === dims.rows) {
      fittedViewportRef.current = terminal;
      if (reclaimViewportRef.current && isVisibleRef.current && document.visibilityState !== "hidden") {
        reclaimViewportRef.current = false;
        void terminalProcessManager.resize(sessionId, terminal.cols, terminal.rows).catch((err) => {
          logError("Failed to reclaim desktop terminal size", { sessionId, err });
        });
      }
    }
    if (forceViewportRefresh || needsViewportRefreshRef.current) {
      refreshTerminalViewport(terminal);
      needsViewportRefreshRef.current = false;
    }
    completeViewportFit(terminal);
  };

  const cancelFitFrame = () => {
    if (fitRafRef.current !== null) {
      cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = null;
    }
  };

  const cancelFitRequest = () => {
    cancelFitFrame();
    resizeDebouncerRef.current?.cancel();
  };

  const cancelScheduledFit = () => {
    requestedFitRef.current = null;
    cancelFitRequest();
    cancelPendingViewportRestore();
    resizeRenderBarrierRef.current?.cancel();
  };

  const scheduleFit = (immediateResize = false, forceViewportRefresh = immediateResize) => {
    // Keep the debouncer's leading/trailing horizontal cadence alive across
    // consecutive ResizeObserver frames; only replace the pending fit frame.
    cancelFitFrame();
    if (terminalRef.current) invalidateTerminalFit(terminalRef.current);
    fittedViewportRef.current = null;
    requestedFitRef.current = null;
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = null;
      fitWhenStable(immediateResize, forceViewportRefresh);
    });
  };

  const scheduleViewportRefresh = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const terminal = terminalRef.current;
        if (!terminal) return;
        refreshTerminalViewport(terminal);
        scheduleFit(true);
      });
    });
  };

  const markViewportRefreshNeeded = () => {
    needsViewportRefreshRef.current = true;
  };

  const resetViewportRefreshState = () => {
    needsViewportRefreshRef.current = false;
  };

  return {
    syncWebglRenderer,
    scheduleHiddenWebglDispose,
    clearHiddenWebglDisposeTimer,
    clearWebglTextureAtlas,
    disposeWebglRenderer,
    scheduleFit,
    scheduleViewportRefresh,
    markViewportRefreshNeeded,
    enqueueActiveWrite,
    attachPtyOutput,
    setHistoricalResize: (historical) => {
      forwardPtyResizeRef.current = !historical;
      fittedViewportRef.current = null;
    },
    reclaimViewportSize: () => { reclaimViewportRef.current = true; scheduleFit(true); },
    getPtyViewportSize: () => {
      const terminal = terminalRef.current;
      return terminal && forwardPtyResizeRef.current && fittedViewportRef.current === terminal
        ? { cols: terminal.cols, rows: terminal.rows } : null;
    },
    attachViewport,
    resetOutputState,
    cancelScheduledFit,
    resetViewportRefreshState,
  };
}
