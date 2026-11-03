import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "sonner";
import { ChatPanelSurface } from "../components/ChatPanelSurface";
import { QuickChatRemote } from "../lib/quickChatRemote";
import type { ReasoningEffort } from "./chatReasoning";
import { useSettingsStore, type LanguagePreference } from "../../../shared/preferences/settingsStore";
import { useI18n } from "../../../shared/i18n/index";
import "../../../App.css";
import "../components/quickChat.css";

const remote = new QuickChatRemote();
export default function QuickChatWindowApp() {
  const { t } = useI18n();
  const state = useSyncExternalStore(remote.subscribe, remote.getSnapshot, remote.getSnapshot);
  const [reasoning, setReasoning] = useState<ReasoningEffort>("medium");
  const [pinned, setPinned] = useState(false);
  const hide = () => { void invoke("quick_chat_window", { action: "hide" }).catch(remote.report); };
  useEffect(() => {
    document.documentElement.dataset.window = "quick-chat";
    const focus = () => {
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".chat-panel textarea")?.focus());
      void remote.start().then(() => remote.command({ op: "hello" })).catch(remote.report);
    };
    void remote.start();
    const stops = [listen("quick-chat:focus", focus), getCurrentWindow().onFocusChanged(({ payload }) => { if (payload) focus(); })];
    focus();
    return () => { stops.forEach(p => { void p.then(stop => stop()); }); };
  }, []);
  useEffect(() => {
    const presentation = remote.presentation;
    if (!presentation) return;
    useSettingsStore.setState({ language: presentation.language as LanguagePreference,
      resolvedTheme: presentation.theme as "dark" | "light" });
    document.documentElement.lang = presentation.language;
    const root = document.documentElement;
    root.dataset.theme = presentation.theme;
    root.dataset.lightPalette = presentation.lightPalette;
    root.dataset.darkPalette = presentation.darkPalette;
    if (state.ready && !document.activeElement?.closest("input,textarea,button,[role=combobox]")) {
      document.querySelector<HTMLTextAreaElement>(".chat-panel textarea")?.focus();
    }
  }, [state]);
  return <main className="quick-chat-shell" onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented) hide();
  }}>
    <Toaster />
    {(!state.ready || state.error) && <div role="status" className="quick-chat-status">
      {t(state.ready ? "chat.quick.commandFailed" : "chat.quick.notReady")}
      <button onClick={() => { void remote.start().then(() => remote.command({ op: "hello" })).catch(remote.report); }}>{t("chat.quick.reconnect")}</button>
      <button onClick={hide}>{t("chat.panel.close")}</button>
    </div>}
    <ChatPanelSurface mode="float" attachedSelection="" onAttachSelectionChange={() => {}}
      controller={remote} catalog={remote.catalog} defaultBindingManaged onModeChange={() => {}} onClose={hide}
      onExpand={() => {
        void remote.continueInMain().then(() => invoke("quick_chat_window", { action: "main" })).catch(remote.report);
      }}
      pinControl={{ pinned, toggle: () => {
        void invoke("quick_chat_window", { action: "pin", pinned: !pinned }).then(() => setPinned(!pinned)).catch(remote.report);
      } }}
      reasoningEffort={reasoning} onReasoningEffortChange={setReasoning}
      dragHandleProps={{
        onPointerDown: event => {
          if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,select,[role=combobox]")) return;
          void invoke("quick_chat_window", { action: "drag" }).catch(remote.report);
        },
        onPointerMove: () => {}, onPointerUp: () => {}, onPointerCancel: () => {}, onKeyDown: () => {},
      }} />
  </main>;
}
