import { useEffect, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, MessageSquare, Pin, Plus, X } from "lucide-react";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { Select } from "../../../shared/ui/select";
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from "./chatReasoning";
import { chatController } from "./lifecycle";
import type { ChatController } from "../lib/chatController";
import { defaultCatalogModel, loadChatProviderCatalog, type ChatProvider } from "../lib/chatProviderCatalog";
import { panelTitle } from "../lib/chatPanelActions";
import { ChatPanelComposer } from "../components/ChatPanelComposer";
import { ChatPanelMessages } from "../components/ChatPanelMessages";
import { ChatPanelModelPicker } from "../components/ChatPanelModelPicker";

export interface ChatPanelProps {
  mode: "dock" | "float";
  attachedSelection: string;
  onModeChange: (mode: "dock" | "float") => void;
  onAttachSelectionChange: (text: string) => void;
  onExpand: () => void;
  onClose: () => void;
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  dragging?: boolean;
  dragHandleProps?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
  controller?: ChatController;
}

/** Narrow companion surface; conversation data is owned by the shared chat controller. */
export function ChatPanel({
  mode, attachedSelection, onModeChange, onAttachSelectionChange, onExpand, onClose,
  reasoningEffort, onReasoningEffortChange,
  dragging = false, dragHandleProps, controller = chatController,
}: ChatPanelProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<readonly ChatProvider[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  const selected = state.selected;
  const detail = selected ? state.details[selected] : undefined;
  const conversation = detail?.conversation;
  const running = !!selected && state.running.includes(selected);
  const busy = !!selected && state.busy.includes(selected);

  useEffect(() => {
    void controller.start();
  }, [controller]);

  useEffect(() => {
    let active = true;
    void loadChatProviderCatalog()
      .then((providers) => { if (active) setCatalog(providers); })
      .catch(() => { if (active) setCatalog([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!state.ready || selected) return;
    void controller.create().catch((error) => controller.report(error));
  }, [controller, selected, state.ready]);

  useEffect(() => {
    if (!conversation || conversation.model || !catalog.length) return;
    const fallback = defaultCatalogModel(catalog);
    if (!fallback) return;
    void controller
      .update(conversation.id, { appType: "chat", providerId: fallback.providerId, model: fallback.model })
      .catch((error) => controller.report(error));
  }, [catalog, controller, conversation]);

  useEffect(() => { setCopiedId(null); setImages([]); }, [selected]);

  const report = (error: unknown) => controller.report(error);

  const reasoningControl = <div className="chat-panel-reasoning">
    <Select
      aria-label={t("chat.panel.reasoning")}
      className="chat-panel-reasoning-select w-auto"
      contentClassName="min-w-[110px] py-1 text-[11px]"
      value={reasoningEffort}
      onChange={(event) => onReasoningEffortChange(event.target.value as ReasoningEffort)}
    >
      {REASONING_EFFORT_OPTIONS.map((option) => <option key={option} value={option}>
        {t(`chat.panel.reasoning${option === "default" ? "Default" : option === "minimal" ? "Minimal" : option === "low" ? "Low" : option === "medium" ? "Medium" : "High"}` as TranslationKey)}
      </option>)}
    </Select>
  </div>;

  const act = (action: () => Promise<unknown>) => {
    void action().catch(report);
  };

  return <section
    className="chat-panel"
    data-chat-panel-mode={mode}
    aria-label={t("chat.panel.title")}
    onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }}
  >
    <header
      className="chat-panel-header"
      data-dragging={dragging ? "true" : undefined}
      {...(mode === "float" && dragHandleProps
        ? { role: "button", tabIndex: 0, "aria-label": t("chat.panel.float"), ...dragHandleProps }
        : {})}
    >
      <span className="chat-panel-title" title={t("chat.panel.title")}>
        <MessageSquare size={12} aria-hidden="true" />
        {panelTitle(conversation, t("chat.panel.title"))}
      </span>
      <div className="chat-panel-actions">
        <button type="button" aria-label={t("chat.panel.new")} title={t("chat.panel.new")}
          onClick={() => act(() => controller.create())}>
          <Plus size={12} />
        </button>
        <button type="button" aria-label={t("chat.panel.expand")} title={t("chat.panel.expand")} onClick={onExpand}>
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          aria-label={mode === "dock" ? t("chat.panel.float") : t("chat.panel.dock")}
          title={mode === "dock" ? t("chat.panel.float") : t("chat.panel.dock")}
          aria-pressed={mode === "float"}
          onClick={() => onModeChange(mode === "dock" ? "float" : "dock")}
        >
          <Pin size={12} />
        </button>
        <button type="button" aria-label={t("chat.panel.close")} title={t("chat.panel.close")} onClick={onClose}>
          <X size={12} />
        </button>
      </div>
    </header>

    <div className="chat-panel-subheader">
      <label className="chat-panel-history">
        <Select
          aria-label={t("chat.panel.history")}
          className="chat-panel-compact-select"
          value={selected ?? ""}
          onChange={(event) => {
            const id = event.target.value;
            if (id) act(() => controller.select(id));
          }}
        >
          {!selected && <option value="">{t("chat.panel.new")}</option>}
          {state.conversations.slice(0, 20).map((item) => <option key={item.id} value={item.id}>
            {item.title || t("chat.untitled")}
          </option>)}
        </Select>
      </label>
      <ChatPanelModelPicker
        providers={catalog}
        providerId={conversation?.providerId ?? ""}
        model={conversation?.model ?? ""}
        disabled={!conversation || running || busy || state.suspended}
        onSelect={(providerId, model) => {
          if (!conversation) return;
          act(() => controller.update(conversation.id, { appType: "chat", providerId, model }));
        }}
      />
    </div>

    <ChatPanelMessages
      messages={detail?.messages ?? []}
      conversationId={selected}
      copiedId={copiedId}
      onCopied={setCopiedId}
      onRetry={() => { if (selected) act(() => controller.generate(selected, true)); }}
      report={report}
    />

    {state.error && <p className="chat-panel-error" role="alert">{t(`chat.error.${state.error}` as TranslationKey, undefined) || state.error}</p>}

    <ChatPanelComposer
      conversationId={selected}
      draft={selected ? state.drafts[selected] ?? conversation?.draft ?? "" : ""}
      attachedSelection={attachedSelection}
      busy={busy}
      running={running}
      suspended={state.suspended}
      reasoningControl={reasoningControl}
      reasoningEffort={reasoningEffort}
      images={images}
      onImagesChange={setImages}
      onAttachSelection={onAttachSelectionChange}
      onDetachSelection={() => onAttachSelectionChange("")}
      report={report}
    />
  </section>;
}
