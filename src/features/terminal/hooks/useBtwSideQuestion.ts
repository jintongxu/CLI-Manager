import { useBtwNativeWindow } from "./useBtwNativeWindow";
import { useTerminalStore } from "../state";
import { resolveBtwSource } from "../lib/btwSource";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { BtwThreadModel, type BtwAsk, type BtwContext, type BtwContextRequest, type BtwProgress } from "../lib/btwThreadModel";
// Repository is loaded defensively so isolated model/IPC harnesses can run without SQL.
let threadRepository: { listBtwThreads: typeof import("../lib/btwThreadRepository").listBtwThreads; saveBtwThread: typeof import("../lib/btwThreadRepository").saveBtwThread; deleteBtwThread: typeof import("../lib/btwThreadRepository").deleteBtwThread; updateBtwThread: typeof import("../lib/btwThreadRepository").updateBtwThread } | null = null;
try { threadRepository = require("../lib/btwThreadRepository"); } catch { /* test/native-lite environments */ }

/** One main-controller lifetime: the native child never instantiates this model. */
export function useBtwSideQuestion() {
  const model = useMemo(() => new BtwThreadModel({
    context: (request: BtwContextRequest) => invoke<BtwContext>("side_question_context", { request }),
    ask: (request: BtwAsk) => invoke<string>("side_question_ask", { request }),
    cancel: (requestId: string) => invoke("side_question_cancel", { requestId }),
    listen: (callback) => listen<BtwProgress>("side-question-progress", (event) => callback(event.payload)),
  }, threadRepository ? { list: (options) => threadRepository!.listBtwThreads(options), save: threadRepository!.saveBtwThread, remove: threadRepository!.deleteBtwThread, patch: threadRepository!.updateBtwThread } : undefined), []);
  useBtwNativeWindow(model);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  // Defer disposal one microtask so React StrictMode's effect probe can reattach.
  const lifecycle = useRef(0);
  useEffect(() => {
    const generation = ++lifecycle.current;
    void model.start();
    return () => { queueMicrotask(() => { if (lifecycle.current === generation) model.dispose(); }); };
  }, [model]);
  const stageFromTerminal = (quote: string, terminalId?: string) => {
    const source = useTerminalStore.getState();
    model.stage(quote, resolveBtwSource(terminalId ?? source.activeSessionId, source.sessions, source.tabStatuses));
  };
  return { state, model, stageFromTerminal, setQuestion: model.setQuestion, submit: model.submit, clear: model.clear };
}
export type BtwSideQuestionController = ReturnType<typeof useBtwSideQuestion>;
