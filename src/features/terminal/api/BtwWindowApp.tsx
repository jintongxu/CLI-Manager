import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { translate, detectPreferredLanguage } from "../../../shared/i18n/index";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { BtwThreadReader, type BtwReaderActions } from "../components/BtwThreadDialog";
import { BTW_SNAPSHOT_EVENT, newerBtwSnapshot, type BtwWindowIntent, type BtwWindowReady, type BtwWindowSnapshot } from "../lib/btwWindowProtocol";
import "../../../App.css";

/** Display-only bootstrap: no App/providers, SQL initialization or inference controller. */
export default function BtwWindowApp() {
  const [snapshot, setSnapshot] = useState<BtwWindowSnapshot | null>(null);
  const [error, setError] = useState(false);
  const current = useRef<BtwWindowSnapshot | null>(null);
  const draft = useRef("");
  const [localDraft, setLocalDraft] = useState("");
  const commandIdentity = useRef({ session: 0, sequence: 0 });
  const commands = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    let buffered: (BtwWindowSnapshot | null)[] = [];
    let ready = false;
    let epoch: string | null = null;
    // Events may arrive before the ready response; use that response as the epoch authority.
    const apply = (value: BtwWindowSnapshot | null) => {
      if (disposed) return;
      if (!value) {
        epoch = null; current.current = null; setSnapshot(null);
        return;
      }
      if (epoch !== value.ownerEpoch) {
        // A replacement owner requires a fresh native handshake, not event-based trust.
        void replay();
        return;
      }
      const next = newerBtwSnapshot(current.current, value, epoch);
      if (next === current.current) return;
      if (next?.thread?.id !== current.current?.thread?.id
        || next?.thread?.generation !== current.current?.thread?.generation) {
        draft.current = next?.thread?.draft ?? "";
        setLocalDraft(draft.current);
      }
      current.current = next;
      setSnapshot(next);
      useSettingsStore.setState({ language: value.language });
      document.documentElement.dataset.lightPalette = value.lightThemePalette;
      document.documentElement.dataset.darkPalette = value.darkThemePalette;
      document.documentElement.dataset.theme = value.dark ? "dark" : "light";
      useSettingsStore.setState({ resolvedTheme: value.dark ? "dark" : "light" });
    };
    let replaying = false;
    let replayAgain = false;
    const replay = async () => {
      if (disposed) return;
      if (replaying) { replayAgain = true; return; }
      replaying = true;
      try {
        const response = await invoke<BtwWindowReady>("btw_window_ready");
        const value = response.snapshot;
        if (disposed) return;
        commandIdentity.current = { session: response.commandSession, sequence: 0 };
        epoch = value?.ownerEpoch ?? null;
        apply(value);
        setError(false);
      } catch { if (!disposed) setError(true); }
      finally {
        replaying = false;
        if (replayAgain) { replayAgain = false; void replay(); }
      }
    };
    void (async () => {
      release = await listen<BtwWindowSnapshot | null>(BTW_SNAPSHOT_EVENT, ({ payload }) => {
        if (!ready) buffered.push(payload); else apply(payload);
      });
      if (disposed) { release(); return; }
      await replay();
      ready = true;
      const events = buffered; buffered = [];
      events.forEach(apply);
    })().catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; release?.(); };
  }, []);

  // Each handshake has a native session and each click a monotonic sequence, with draft carried atomically on send. Errors never auto-retry.
  const intent = (action: BtwWindowIntent["action"], extra: Partial<BtwWindowIntent> = {}) => {
    const value = current.current;
    if (!value?.thread) return;
    const command: BtwWindowIntent = { commandSession: commandIdentity.current.session,
      commandSequence: ++commandIdentity.current.sequence, ownerEpoch: value.ownerEpoch,
      revision: value.revision, selectionRevision: value.selectionRevision, threadId: value.thread.id, generation: value.thread.generation, action, ...extra };
    // Preserve draft ordering and draft/send ordering even when native invokes settle slowly.
    commands.current = commands.current.then(() => invoke("btw_window_intent", { intent: command }))
      .catch(() => setError(true));
  };
  const model: BtwReaderActions = {
    open: () => intent("close"),
    setDraft: (_id, text) => { draft.current = text; setLocalDraft(text); intent("draft", { draft: text }); },
    send: (_id, retry) => intent(retry ? "retry" : "send", { draft: draft.current }),
    stop: () => intent("stop"),
    reset: (_id, inherit) => intent("reset", { inherit }),
  };
  const language = snapshot?.language ?? detectPreferredLanguage();
  if (!snapshot?.thread) return <main role="status" className="p-6">
    <h1>{translate(language, "terminal.btw.windowTitle")}</h1>
    <p>{translate(language, error ? "terminal.btw.windowUnavailable" : "terminal.btw.windowEmpty")}</p>
  </main>;
  return <>
    {error && <p role="alert">{translate(language, "terminal.btw.windowUnavailable")}</p>}
    <BtwThreadReader key={snapshot.thread.id} model={model} thread={{ ...snapshot.thread, draft: localDraft }} />
  </>;
}
