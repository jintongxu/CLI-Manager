import { useEffect, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, MessageSquare, Pin, Plus, X } from "lucide-react";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { Select } from "../../../shared/ui/select";
import type { ReasoningEffort } from "../api/chatReasoning";
import { normalizeReasoningFor } from "../lib/reasoningCapabilities";
import { ChatReasoningPill } from "./ChatReasoningPill";
import type { ChatPanelController } from "../lib/panelController";
import { defaultCatalogModel, type ChatProvider } from "../lib/chatProviderCatalog";
import { panelTitle } from "../lib/chatPanelActions";
import { diagnoseChatError } from "../lib/chatErrors";
import { ChatPanelComposer } from "./ChatPanelComposer";
import { ChatPanelMessages } from "./ChatPanelMessages";
import { ChatPanelModelPicker } from "./ChatPanelModelPicker";
import { AttachmentDraftOwner } from "../lib/chatImageAttachments";
import { ChatBranchNavigation } from "./ChatBranchNavigation";

export interface ChatPanelSurfaceProps {
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
  controller: ChatPanelController;
  catalog: readonly ChatProvider[];
  /** The main-window owner initializes defaults; remote projections must not compete. */
  defaultBindingManaged?: boolean;
  catalogReady?: boolean;
  pinControl?: { pinned: boolean; toggle: () => void };
}

/** Narrow companion surface; conversation data is owned by the shared chat controller. */
export function ChatPanelSurface({
  mode, attachedSelection, onModeChange, onAttachSelectionChange, onExpand, onClose,
  reasoningEffort, onReasoningEffortChange,
  dragging = false, dragHandleProps, controller, catalog, pinControl, defaultBindingManaged = false, catalogReady = true,
}: ChatPanelSurfaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { t } = useI18n();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, refreshAttachments] = useState(0);
  const [attachmentOwner] = useState(() => new AttachmentDraftOwner({
    stage: bytes => controller.stageAttachment(bytes), releaseAssets: ids => controller.releaseAssets(ids),
  }, undefined, undefined, error => controller.report(error)));

  const selected = state.selected;
  const detail = selected ? state.details[selected] : undefined;
  const conversation = detail?.conversation;
  const running = !!selected && state.running.includes(selected);
  const busy = !!selected && state.busy.includes(selected);

  useEffect(() => {
    void controller.start();
  }, [controller]);

  // No implicit creation: the owner decides when a conversation exists. An empty
  // selection is surfaced as an explicit hint instead of silently creating one.

  useEffect(() => {
    if (defaultBindingManaged || !conversation || conversation.model || !catalog.length) return;
    const fallback = defaultCatalogModel(catalog);
    if (!fallback) return;
    void controller
      .update(conversation.id, { appType: "chat", providerId: fallback.providerId, model: fallback.model })
      .catch((error) => controller.report(error));
  }, [catalog, controller, conversation, defaultBindingManaged]);

  useEffect(() => {
    setCopiedId(null);
    attachmentOwner.switchConversation();
    refreshAttachments(value => value + 1);
  }, [selected]);
  useEffect(() => () => attachmentOwner.dispose(), [attachmentOwner]);

  const report = (error: unknown) => controller.report(error);

  // The upstream protocol decides which levels exist (enum vs token budget) and the
  // model decides which enum values it accepts, so the control follows the selection.
  const activeProvider = conversation
    ? catalog.find((provider) => provider.id === conversation.providerId)
    : undefined;
  const reasoningProtocol = activeProvider?.protocol ?? null;
  const reasoningModel = conversation?.model ?? null;
  const effectiveReasoning = normalizeReasoningFor(reasoningProtocol, reasoningModel, reasoningEffort);

  const reasoningControl = (
    <ChatReasoningPill
      value={effectiveReasoning}
      protocol={reasoningProtocol}
      modelId={reasoningModel}
      onChange={onReasoningEffortChange}
    />
  );

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
          onClick={() => act(() => controller.create("sidebar"))}>
          <Plus size={12} />
        </button>
        <button type="button" aria-label={t("chat.panel.expand")} title={t("chat.panel.expand")} onClick={onExpand}>
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          aria-label={pinControl ? t("chat.quick.pin") : mode === "dock" ? t("chat.panel.float") : t("chat.panel.dock")}
          title={pinControl ? t("chat.quick.pin") : mode === "dock" ? t("chat.panel.float") : t("chat.panel.dock")}
          aria-pressed={pinControl ? pinControl.pinned : mode === "float"}
          onClick={() => pinControl ? pinControl.toggle() : onModeChange(mode === "dock" ? "float" : "dock")}
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
      {state.ready && catalogReady && <ChatPanelModelPicker
        providers={catalog}
        providerId={conversation?.providerId ?? ""}
        model={conversation?.model ?? ""}
        disabled={!conversation || running || busy || state.suspended}
        onSelect={(providerId, model) => {
          if (!conversation) return;
          act(() => controller.update(conversation.id, { appType: "chat", providerId, model }));
        }}
      />}
    </div>

    {state.ready && !selected && <p className="chat-panel-hint" role="status">{t("chat.panel.noSelection")}</p>}
    {detail && <ChatBranchNavigation lineage={detail.lineage}
      parentAvailable={detail.lineage.current?.parentConversationId !== null}
      labels={{ navigation: t("chat.branchNavigation"), parent: t("chat.branchParent"), parentDeleted: t("chat.branchParentDeleted"),
        children: t("chat.branchChildren"), child: (_branch, index) => t("chat.branchChild", { index: index + 1 }) }}
      onSelectConversation={id => controller.select(id)} disabled={busy || running} />}

    <ChatPanelMessages
      messages={detail?.messages ?? []}
      conversationId={selected}
      copiedId={copiedId}
      onCopied={setCopiedId}
      onRetry={() => { if (selected) act(() => controller.generate(selected, true, effectiveReasoning)); }}
      report={report}
      controller={controller}
      settled={!running && !busy && !state.suspended && !state.unsaved?.[selected ?? ""]}
      reasoning={effectiveReasoning}
    />

    {state.error && (() => {
      const diagnosis = diagnoseChatError(state.error);
      const onAction = () => {
        switch (diagnosis.action) {
          case "reconnect":
            act(() => controller.start());
            break;
          case "create":
            act(() => controller.create("sidebar"));
            break;
          case "retry_save":
            if (selected) {
              controller.setDraft(selected, state.drafts[selected] ?? "");
            } else {
              act(() => controller.start());
            }
            break;
          case "switch_model":
            break;
          case "wait":
            if (selected) {
              act(() => controller.generate(selected, true, effectiveReasoning));
            }
            break;
        }
      };
      return <div className="chat-panel-error-banner" role="alert">
        <p className="chat-panel-error">
          {t(diagnosis.messageKey as TranslationKey, undefined) || t("chat.quick.commandFailed")}
        </p>
        <button
          type="button"
          className="chat-panel-error-action"
          onClick={onAction}
        >
          {t(diagnosis.actionKey as TranslationKey)}
        </button>
      </div>;
    })()}

    <ChatPanelComposer
      controller={controller}
      conversationId={selected}
      draft={selected ? state.drafts[selected] ?? conversation?.draft ?? "" : ""}
      attachedSelection={attachedSelection}
      busy={busy}
      running={running}
      suspended={state.suspended}
      reasoningControl={reasoningControl}
      reasoningEffort={effectiveReasoning}
      attachments={attachmentOwner.value}
      onStageImages={async files => {
        const pending = files.map(file => attachmentOwner.stage(file, file.name).catch(error => { report(error); }));
        refreshAttachments(value => value + 1);
        await Promise.all(pending);
        refreshAttachments(value => value + 1);
      }}
      onRemoveImage={id => { attachmentOwner.remove(id); refreshAttachments(value => value + 1); }}
      onRetryImage={async id => { try { await attachmentOwner.retry(id); } finally { refreshAttachments(value => value + 1); } }}
      onImagesConsumed={stageIds => { attachmentOwner.consumed(stageIds); refreshAttachments(value => value + 1); }}
      onAttachSelection={onAttachSelectionChange}
      onDetachSelection={() => onAttachSelectionChange("")}
      report={report}
    />
  </section>;
}
