import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent as ReactWheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n, type AppLanguage } from "../../../shared/i18n/index";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { unwrapFencedMarkdown } from "../../../shared/lib/markdownSource";
import { normalizeFontFamilyStack } from "../../../shared/platform/systemFonts";
import type { HistoryMessage, HistorySessionDetail, HistorySource, Project, TerminalSession } from "../../../shared/types/index";
import { resolveCliToolHistorySourceId } from "../../../shared/lib/cliTools";
import { formatTime } from "../../history/api/historyViewUtils";
import { conversationText } from "../../history/index";
import { useTerminalPreviewTheme } from "../api/useTerminalPreviewTheme";
import { resolveTerminalProjectPath } from "../lib/terminalOscPath";
import { buildSshAgentHistoryContext, type SshAgentHistoryContext } from "../../remote/api/sshAgentHistory";
import { useProjectStore } from "../../projects/api/projectStore";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import {
  fetchLatestProjectSessionDetail,
  fetchRemoteLatestProjectSessionDetail,
  summarySessionKey,
  useMessageStarStore,
  type MessageStarRow,
} from "../../history/index";
import { useTerminalStore } from "../state";
import { useWorktreeStore } from "../../projects/api/worktreeStore";
import { ArrowDown, ArrowDownToLine } from "lucide-react";
import { Check, Copy, FileText, RefreshCw, X } from "../../../shared/ui/icons";
import { SessionTranscriptContent } from "../../history/api/SessionTranscriptContent";
import { TerminalMarkdownPreviewQuestions, type MarkdownPreviewQuestion } from "./TerminalMarkdownPreviewQuestions";
import { FontSizeControl, useFontSizeControlVisibility } from "../../../shared/ui/FontSizeControl";
import { MarkdownPreviewAnswerSelect, type MarkdownPreviewMessage } from "./MarkdownPreviewAnswerSelect";
import { resolveStarredMessageIndexes } from "../lib/markdownPreviewStars";
import { useMarkdownPreviewScroll } from "../hooks/useMarkdownPreviewScroll";

const LOCAL_RETRY_DELAYS_MS = [0, 180, 420];
type PreviewError = "noSession" | "loadFailed";

/** 星标写入需要的历史会话身份：会话键用于读表，来源与会话 ID 作为诊断列一并落库。 */
interface PreviewAnswerIdentity {
  sessionKey: string;
  source: HistorySource;
  sessionId: string;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function inferSourceFromText(value: string): HistorySource | null {
  const normalized = value.toLowerCase();
  if (/\bclaude\b/u.test(normalized)) return "claude";
  if (/\bcodex\b/u.test(normalized)) return "codex";
  return null;
}

export function resolveTerminalMarkdownSource(
  session: TerminalSession | null | undefined,
  project: Project | null | undefined,
): HistorySource | null {
  if (!session && !project) return null;
  const explicitSource = [session?.cliTool, project?.cli_tool]
    .map((value) => resolveCliToolHistorySourceId(value))
    .find((value): value is HistorySource => value !== null);
  if (explicitSource) return explicitSource;

  const inferredSource = inferSourceFromText(
    `${session?.startupCmd ?? ""} ${session?.title ?? ""} ${project?.cli_tool ?? ""}`,
  );
  return inferredSource;
}

export function isTerminalMarkdownPreviewSupported(
  session: TerminalSession | null | undefined,
  project: Project | null | undefined,
): boolean {
  return resolveTerminalMarkdownSource(session, project) !== null;
}

function selectAssistantMarkdownMessages(detail: HistorySessionDetail): MarkdownPreviewMessage[] {
  const messages: MarkdownPreviewMessage[] = [];
  for (let messageIndex = 0; messageIndex < detail.messages.length; messageIndex += 1) {
    const message: HistoryMessage | undefined = detail.messages[messageIndex];
    if (message?.role.toLowerCase() !== "assistant") continue;
    // 只渲染 text 分块；thinking/reasoning 仅用于统计和历史结构展示，不进入 Markdown 预览。
    const content = message ? conversationText(message) : "";
    if (content.length === 0 || isProgressUpdateContent(content)) continue;
    messages.push({
      messageIndex,
      order: messages.length + 1,
      content,
      timestamp: message.timestamp ?? null,
    });
  }
  return messages;
}

const QuestionsComponent = typeof TerminalMarkdownPreviewQuestions === "undefined"
  ? (() => null)
  : TerminalMarkdownPreviewQuestions;

function selectUserQuestions(detail: HistorySessionDetail): MarkdownPreviewQuestion[] {
  return detail.messages.flatMap((message, messageIndex) => {
    if (message.role.toLowerCase() !== "user") return [];
    const content = conversationText(message).trim();
    return content.length > 0
      ? [{ messageIndex, content, timestamp: message.timestamp ?? null }]
      : [];
  });
}

const MARKDOWN_PREVIEW_FONT_SIZE_MIN = 8;
const MARKDOWN_PREVIEW_FONT_SIZE_MAX = 32;

const PROGRESS_UPDATE_LEAD_PATTERN = /^(?:我(?:会|将|先|正在|现在|确认)|接下来|下一步|当前(?:进度|状态)|进度(?:更新)?|正在|已完成|完成后|本轮|i(?:'m| am| will|['’]ll)\b|next\b|currently\b|progress update\b|working on\b|completed\b)/iu;
const PROGRESS_UPDATE_BODY_PATTERN = /(?:阶段|任务|步骤|记录|验证|检查|测试|实现|修复|更新|构建|计划|进度|状态|phase|task|step|record|verif(?:y|ication)?|check|test|implement|fix|update|build|plan|progress|status)/iu;
const PROGRESS_UPDATE_PLAN_PATTERN = /(?:将(?:直接)?(?:创建|实现|完成|修改|添加|构建)|(?:包含|支持).{0,80}(?:功能|运算|键盘|测试|验证|文件|页面))/iu;

function isProgressUpdateContent(content: string): boolean {
  const normalized = content.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0 || !PROGRESS_UPDATE_LEAD_PATTERN.test(normalized)) return false;
  // 过程播报通常是无 Markdown 结构的短状态句；带标题、代码或列表的最终回答不应被误删。
  const hasMarkdownStructure = /(?:^|\s)(?:#{1,6}\s|```|[-*+]\s|\d+[.)、]\s)/mu.test(normalized);
  const isStatusUpdate = PROGRESS_UPDATE_BODY_PATTERN.test(normalized)
    || PROGRESS_UPDATE_PLAN_PATTERN.test(normalized);
  return !hasMarkdownStructure && normalized.length <= 600 && isStatusUpdate;
}

function formatPreviewMessageTime(timestamp: string | null, language: AppLanguage): string {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? formatTime(parsed, language) : "—";
}

interface TerminalMarkdownPreviewProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

export function TerminalMarkdownPreview({ sessionId, open, onClose }: TerminalMarkdownPreviewProps) {
  const { language, t } = useI18n();
  const { tone: terminalCodeTheme, panelStyle: terminalPreviewStyle } = useTerminalPreviewTheme();
  const uiFontFamily = useSettingsStore((state) => state.uiFontFamily);
  const uiFontSize = useSettingsStore((state) => state.uiFontSize);
  const effectiveUiFontFamily = normalizeFontFamilyStack(uiFontFamily);
  const session = useTerminalStore((state) => state.sessions.find((item) => item.id === sessionId) ?? null);
  const hookStatus = useTerminalStore((state) => state.tabStatuses[sessionId]?.hook ?? "none");
  const hookUpdatedAt = useTerminalStore((state) => state.tabStatuses[sessionId]?.hookUpdatedAt ?? null);
  const projects = useProjectStore((state) => state.projects);
  const worktrees = useWorktreeStore((state) => state.worktrees);
  const project = useMemo(
    () => (session?.projectId ? projects.find((item) => item.id === session.projectId) ?? null : null),
    [projects, session?.projectId],
  );
  const worktree = useMemo(
    () => (session?.worktreeId ? worktrees.find((item) => item.id === session.worktreeId) ?? null : null),
    [session?.worktreeId, worktrees],
  );
  const source = resolveTerminalMarkdownSource(session, project);
  const cliSessionId = session?.cliSessionId?.trim() || null;
  const isSshProject = project?.environment_type === "ssh" || session?.environmentType === "ssh";
  const lookupProjectPath = useMemo(() => {
    if (worktree && worktree.status !== "active") return project?.path ?? "";
    if (worktree?.path?.trim()) return worktree.path.trim();
    return resolveTerminalProjectPath(
      session?.cwd,
      isSshProject ? project?.remote_path : project?.path,
      "unknown",
    ) ?? "";
  }, [isSshProject, project?.path, project?.remote_path, session?.cwd, worktree?.path, worktree?.status]);

  const [previewMessages, setPreviewMessages] = useState<MarkdownPreviewMessage[]>([]);
  const [questions, setQuestions] = useState<MarkdownPreviewQuestion[]>([]);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [answerIdentity, setAnswerIdentity] = useState<PreviewAnswerIdentity | null>(null);
  const [fontSize, setFontSize] = useState(uiFontSize);
  const { fontSizeControlVisible, showFontSizeControl } = useFontSizeControlVisibility();
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [error, setError] = useState<PreviewError | null>(null);
  const remoteContextRef = useRef<SshAgentHistoryContext | null>(null);
  const requestSeqRef = useRef(0);
  const loadedTriggerRef = useRef<string | null>(null);
  const previousOpenRef = useRef(false);
  const ensureStarsLoaded = useMessageStarStore((state) => state.ensureLoaded);
  const setAnswerStar = useMessageStarStore((state) => state.setStar);
  const starRows = useMessageStarStore((state) => (
    answerIdentity ? state.bySession[answerIdentity.sessionKey] : undefined
  ));
  const starFailure = useMessageStarStore((state) => state.failure);
  const previewSessionKey = JSON.stringify([sessionId, cliSessionId, source, lookupProjectPath, isSshProject]);
  const previewLoadTrigger = `${cliSessionId ?? ""}:${source ?? ""}:${lookupProjectPath}:${hookStatus}:${hookUpdatedAt ?? ""}`;
  const selectedMessage = useMemo(
    () => previewMessages.find((message) => message.messageIndex === selectedMessageIndex) ?? null,
    [previewMessages, selectedMessageIndex],
  );
  // 星标行按源消息下标解析回当前列表；对话被回退重写时按时间戳跟随，回答已消失则星标失效。
  const starredRowsByIndex = useMemo(
    () => resolveStarredMessageIndexes(previewMessages, starRows),
    [previewMessages, starRows],
  );
  const starredMessageIndexes = useMemo(
    () => new Set(starredRowsByIndex.keys()),
    [starredRowsByIndex],
  );
  const content = selectedMessage ? unwrapFencedMarkdown(selectedMessage.content) : null;
  const previewScroll = useMarkdownPreviewScroll({ open, sessionKey: previewSessionKey, selectedMessageIndex, content });
  useEffect(() => setFontSize(uiFontSize), [uiFontSize]);

  const handlePreviewWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
    event.preventDefault();
    showFontSizeControl();
    const direction = event.deltaY < 0 ? 1 : -1;
    setFontSize((current) => Math.min(
      MARKDOWN_PREVIEW_FONT_SIZE_MAX,
      Math.max(MARKDOWN_PREVIEW_FONT_SIZE_MIN, current + direction),
    ));
  }, [showFontSizeControl]);

  const closeRemoteContext = useCallback((context: SshAgentHistoryContext | null) => {
    if (!context) return;
    void invoke("history_remote_close", {
      hostId: context.hostId,
      consumerId: context.consumerId,
    }).catch(() => undefined);
  }, []);

  // 会话身份切换或卸载时废弃旧请求；新会话不能继承旧回答、滚动意图和远程 consumer。
  useEffect(() => {
    loadedTriggerRef.current = null;
    setPreviewMessages([]);
    setQuestions([]);
    setQuestionsOpen(false);
    setSelectedMessageIndex(null);
    setAnswerIdentity(null);
    setLoading(false);
    setError(null);
    return () => {
      requestSeqRef.current += 1;
      closeRemoteContext(remoteContextRef.current);
      remoteContextRef.current = null;
    };
  }, [closeRemoteContext, previewSessionKey]);

  // 星标按会话缓存；同一会话的多个预览面板共用一份已加载结果。
  useEffect(() => {
    if (answerIdentity) ensureStarsLoaded(answerIdentity.sessionKey);
  }, [answerIdentity, ensureStarsLoaded]);

  // 只提交仍属于当前绑定会话的结果；迟到的远程上下文必须关闭，不能覆盖新 consumer。
  const loadLatest = useCallback(async (trigger: string, selectLatest = false) => {
    const requestSeq = ++requestSeqRef.current;
    if (!source) return;
    if (!cliSessionId) {
      setError("noSession");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let detail: HistorySessionDetail | null = null;
      for (let attempt = 0; attempt < LOCAL_RETRY_DELAYS_MS.length; attempt += 1) {
        if (LOCAL_RETRY_DELAYS_MS[attempt] > 0) await wait(LOCAL_RETRY_DELAYS_MS[attempt]);
        if (requestSeq !== requestSeqRef.current) return;

        if (isSshProject && project) {
          if (remoteContextRef.current?.launch.projectId !== project.id) {
            closeRemoteContext(remoteContextRef.current);
            const context = await buildSshAgentHistoryContext(project);
            if (requestSeq !== requestSeqRef.current) {
              closeRemoteContext(context);
              return;
            }
            remoteContextRef.current = context;
          }
          const remote = await fetchRemoteLatestProjectSessionDetail(
            remoteContextRef.current,
            undefined,
            cliSessionId,
            session?.remoteTranscriptRef,
          );
          if (requestSeq !== requestSeqRef.current) return;
          remoteContextRef.current = remote.context;
          detail = remote.result === "unchanged" ? null : remote.result;
        } else if (lookupProjectPath) {
          if (remoteContextRef.current) {
            closeRemoteContext(remoteContextRef.current);
            remoteContextRef.current = null;
          }
          const waitForCatalogRefresh = attempt === 0;
          const local = await fetchLatestProjectSessionDetail(
            lookupProjectPath,
            undefined,
            source,
            cliSessionId,
            { forceCatalogRefresh: true, freshDetail: true, waitForCatalogRefresh },
          );
          detail = local === "unchanged" ? null : local;
        }

        if (detail) break;
      }

      if (requestSeq !== requestSeqRef.current) return;
      if (detail) {
        loadedTriggerRef.current = trigger;
        const nextMessages = selectAssistantMarkdownMessages(detail);
        setPreviewMessages(nextMessages);
        setQuestions(selectUserQuestions(detail));
        setAnswerIdentity({
          sessionKey: summarySessionKey(detail),
          source: detail.source,
          sessionId: detail.session_id,
        });
        setSelectedMessageIndex((current) => {
          if (!selectLatest && current !== null && nextMessages.some((message) => message.messageIndex === current)) return current;
          return nextMessages[nextMessages.length - 1]?.messageIndex ?? null;
        });
        setError(null);
      } else if (selectLatest && previewMessages.length > 0) {
        // 远程历史内容未变化时复用现有列表，但打开动作仍需回到最新回答。
        setSelectedMessageIndex(previewMessages[previewMessages.length - 1].messageIndex);
        setError(null);
      } else {
        setError("loadFailed");
      }
    } catch {
      if (requestSeq === requestSeqRef.current) setError("loadFailed");
    } finally {
      if (requestSeq === requestSeqRef.current) setLoading(false);
    }
  }, [cliSessionId, closeRemoteContext, isSshProject, lookupProjectPath, previewMessages, project, session?.remoteTranscriptRef, source]);

  useEffect(() => {
    const opened = open && !previousOpenRef.current;
    previousOpenRef.current = open;
    if (!source) return;
    const completed = hookStatus === "done" || hookStatus === "failed";
    if (!open && !completed) return;
    if (!opened && loadedTriggerRef.current === previewLoadTrigger) return;
    // 每次从关闭状态打开都重新读取，避免复用旧回答并确保定位到最新回答。
    void loadLatest(previewLoadTrigger, opened);
  }, [hookStatus, loadLatest, open, previewLoadTrigger, source]);

  // 手动选择取消尚未提交的跳转；最新回答使用源消息坐标，不把列表序号当 messageIndex。
  const selectAnswer = (messageIndex: number) => {
    previewScroll.cancelScrollIntent();
    setSelectedMessageIndex(messageIndex);
  };
  const jumpToLatestAnswer = () => {
    const latest = previewMessages[previewMessages.length - 1];
    if (!latest) return;
    previewScroll.requestScrollToBottom(latest.messageIndex);
    setSelectedMessageIndex(latest.messageIndex);
  };
  const copyCurrentAnswer = async () => {
    if (!content) return;
    try {
      await copyTextToClipboard(content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);
  // 取消星标必须按已解析到的真实行删除：星标可能因对话回退已跟随到新的回答下标。
  const toggleAnswerStar = (message: MarkdownPreviewMessage, star: boolean) => {
    if (!answerIdentity) return;
    const existing: MessageStarRow | null = starredRowsByIndex.get(message.messageIndex) ?? null;
    void setAnswerStar(
      {
        sessionKey: answerIdentity.sessionKey,
        messageIndex: message.messageIndex,
        timestamp: message.timestamp,
        source: answerIdentity.source,
        sessionId: answerIdentity.sessionId,
      },
      star,
      existing,
    );
  };

  if (!open) return null;

  return (
    <aside
      className="subagent-transcript-shell ai-replay-transcript terminal-markdown-preview flex h-full w-full min-w-0 flex-col overflow-hidden border-l text-[var(--term-panel-fg)] shadow-[-12px_0_30px_rgb(0_0_0/0.12)]"
      style={terminalPreviewStyle}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--border)_58%,transparent)] px-3">
        <FileText size={14} className="shrink-0 text-[var(--primary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{t("terminal.markdownPreview.title")}</span>
        {previewMessages.length > 0 && (
          <MarkdownPreviewAnswerSelect
            key={previewSessionKey}
            messages={previewMessages}
            starredMessageIndexes={starredMessageIndexes}
            starLabels={{
              starAnswer: t("terminal.markdownPreview.starAnswer"),
              unstarAnswer: t("terminal.markdownPreview.unstarAnswer"),
              starredOnly: t("terminal.markdownPreview.starredOnly"),
              showAllAnswers: t("terminal.markdownPreview.showAllAnswers"),
              starredFilterActive: t("terminal.markdownPreview.starredFilterActive"),
              noStarredAnswers: t("terminal.markdownPreview.noStarredAnswers"),
            }}
            onToggleStar={toggleAnswerStar}
            selectedMessageIndex={selectedMessageIndex}
            onSelect={selectAnswer}
            formatOption={(message) => t("terminal.markdownPreview.answerOption", {
              index: message.order,
              time: formatPreviewMessageTime(message.timestamp, language),
            })}
            ariaLabel={t("terminal.markdownPreview.selectAnswer")}
            title={t("terminal.markdownPreview.selectAnswer")}
            jumpToEndLabel={t("terminal.markdownPreview.jumpToListEnd")}
            terminalPreviewStyle={terminalPreviewStyle}
          />
        )}
        <button
          type="button"
          onClick={jumpToLatestAnswer}
          disabled={previewMessages.length === 0}
          className="ui-focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--text-primary)] disabled:opacity-40"
          aria-label={t("terminal.markdownPreview.latestAnswer")}
          title={t("terminal.markdownPreview.latestAnswer")}
        >
          <ArrowDownToLine size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void copyCurrentAnswer()}
          disabled={!content}
          className="ui-focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={copyState === "copied"
            ? t("terminal.markdownPreview.copied")
            : copyState === "failed"
              ? t("terminal.markdownPreview.copyFailed")
              : t("terminal.markdownPreview.copy")}
          title={copyState === "copied"
            ? t("terminal.markdownPreview.copied")
            : copyState === "failed"
              ? t("terminal.markdownPreview.copyFailed")
              : t("terminal.markdownPreview.copy")}
        >
          {copyState === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => void loadLatest(previewLoadTrigger)}
          disabled={loading}
          className="ui-focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-50"
          aria-label={t("terminal.markdownPreview.refresh")}
          title={t("terminal.markdownPreview.refresh")}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : undefined} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ui-focus-ring inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--text-primary)]"
          aria-label={t("terminal.markdownPreview.close")}
          title={t("terminal.markdownPreview.close")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 星标写库失败只在日志里，用户看到的是“点了没反应”；这里把失败态摆到正文上方。 */}
        {starFailure && answerIdentity && (
          <div
            className="terminal-markdown-preview-star-error shrink-0 px-3 py-1.5 text-[10px] leading-4"
            role="status"
            aria-live="polite"
          >
            {t("terminal.markdownPreview.starUnavailable")}
          </div>
        )}
        <div
          ref={previewScroll.scrollRef}
          className="ui-scrollbar ui-focus-ring min-h-0 flex-1 overflow-auto px-4 py-3"
          role="region"
          aria-label={t("terminal.markdownPreview.title")}
          tabIndex={content ? 0 : -1}
          onWheel={handlePreviewWheel}
          style={{
            "--markdown-preview-font-size": `${fontSize}px`,
            fontFamily: effectiveUiFontFamily,
          } as CSSProperties}
        >
          {loading && !content ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
              {t("terminal.markdownPreview.loading")}
            </div>
          ) : content ? (
            <div ref={previewScroll.contentRef}>
              <SessionTranscriptContent
                content={content}
                variant="terminal"
                terminalCodeTheme={terminalCodeTheme}
                markdownClassName="subagent-transcript-markdown"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-5 text-center text-xs leading-5 text-[var(--text-muted)]">
              {error === "noSession"
                ? t("terminal.markdownPreview.noSession")
                : error === "loadFailed"
                  ? t("terminal.markdownPreview.loadFailed")
                  : t("terminal.markdownPreview.empty")}
            </div>
          )}
        </div>
        {(previewScroll.showScrollToBottom || fontSizeControlVisible) && (
          <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
            {previewScroll.showScrollToBottom && (
              <button
                type="button"
                onClick={previewScroll.scrollToBottom}
                className="terminal-markdown-preview-scroll-to-bottom ui-focus-ring inline-flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md transition hover:brightness-110"
                style={{ backgroundColor: "var(--term-panel-card)", borderColor: "var(--term-panel-border)", color: "var(--term-panel-fg)" }}
                title={t("terminal.markdownPreview.scrollToBottom")}
                aria-label={t("terminal.markdownPreview.scrollToBottom")}
              >
                <ArrowDown size={14} aria-hidden="true" />
              </button>
            )}
            {fontSizeControlVisible && (
              <FontSizeControl
                fontSize={fontSize}
                defaultFontSize={uiFontSize}
                min={MARKDOWN_PREVIEW_FONT_SIZE_MIN}
                max={MARKDOWN_PREVIEW_FONT_SIZE_MAX}
                onChange={(next) => {
                  showFontSizeControl();
                  setFontSize(next);
                }}
                style={{
                  backgroundColor: "var(--term-panel-card)",
                  borderColor: "var(--term-panel-border)",
                  color: "var(--term-panel-fg)",
                }}
                variant="terminal"
              />
            )}
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center border-t border-[color-mix(in_srgb,var(--border)_58%,transparent)] px-3 py-2">
        <button
          type="button"
          onClick={() => setQuestionsOpen(true)}
          disabled={loading}
          className="ui-focus-ring inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
          aria-label={t("terminal.markdownPreview.questionsButton")}
          title={questions.length === 0
            ? t("terminal.markdownPreview.questionsEmpty")
            : t("terminal.markdownPreview.questionsButton")}
        >
          <FileText size={13} aria-hidden="true" />
          <span>{t("terminal.markdownPreview.questionsButton")}</span>
          <span className="text-[var(--text-muted)]">({questions.length})</span>
        </button>
      </footer>
      <QuestionsComponent
        open={questionsOpen}
        onOpenChange={setQuestionsOpen}
        questions={questions}
        formatTime={(timestamp) => formatPreviewMessageTime(timestamp, language)}
      />
    </aside>
  );
}
