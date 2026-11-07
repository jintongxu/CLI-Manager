import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "../../../shared/i18n/index";
import { clearWorkspaceSelection, readWorkspaceSelection } from "../../../shared/lib/workspaceSelection";
import type { ChatPanelController } from "../lib/panelController";
import { buildSendText, canSubmit } from "../lib/chatPanelActions";
import { shouldSubmit } from "../lib/interactions";
import { filterAcceptedImages, readClipboardImages, type AttachmentDraft } from "../lib/chatImageAttachments";
import type { ReasoningEffort } from "../api/chatReasoning";
import { reasoningPayload } from "../api/chatReasoning";
import { ChatPanelImagePreview, ChatPanelImageTray } from "./ChatPanelImageTray";

const MAX_TEXTAREA_ROWS = 6;

interface ChatPanelComposerProps {
  controller: ChatPanelController;
  conversationId: string | null;
  draft: string;
  attachedSelection: string;
  busy: boolean;
  running: boolean;
  suspended: boolean;
  reasoningControl?: ReactNode;
  reasoningEffort: ReasoningEffort;
  attachments: readonly AttachmentDraft[];
  onStageImages: (files: readonly File[]) => Promise<void>;
  onRemoveImage: (id: string) => void;
  onRetryImage: (id: string) => Promise<void>;
  onImagesConsumed: (stageIds: readonly string[]) => void;
  onAttachSelection: (text: string) => void;
  onDetachSelection: () => void;
  report: (error: unknown) => void;
}

export function ChatPanelComposer({
  controller, conversationId, draft, attachedSelection, busy, running, suspended,
  reasoningControl, reasoningEffort, attachments, onStageImages, onRemoveImage, onRetryImage, onImagesConsumed,
  onAttachSelection, onDetachSelection, report,
}: ChatPanelComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const submitting = useRef(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 18;
    element.style.height = `${Math.min(element.scrollHeight, lineHeight * MAX_TEXTAREA_ROWS + 12)}px`;
  }, [draft]);

  const submit = () => {
    if (!conversationId || submitting.current) return;
    const text = buildSendText(draft, attachedSelection);
    const stageIds = attachments.flatMap(item => item.descriptor ? [item.descriptor.stageId] : []);
    if ((!text && !stageIds.length) || attachments.some(item => item.status !== "staged")) return;
    submitting.current = true;
    setSending(true);
    onDetachSelection();
    clearWorkspaceSelection();
    void (async () => {
      controller.setDraft(conversationId, text);
      await controller.generate(conversationId, false, reasoningPayload(reasoningEffort) ?? "off", stageIds);
      onImagesConsumed(stageIds);
    })().catch(report).finally(() => { submitting.current = false; setSending(false); });
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = readClipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    const { accepted, rejection } = filterAcceptedImages(files, attachments.length);
    if (rejection === "limit") toast.info(t("chat.panel.imageLimit"));
    if (rejection === "too_large") toast.info(t("chat.panel.imageTooLarge"));
    if (!accepted.length) return;
    void onStageImages(accepted).catch(report);
  };

  const handleAttachClick = () => {
    const text = readWorkspaceSelection().text;
    if (text) {
      onAttachSelection(text);
    } else {
      toast.info(t("chat.panel.noSelectionToast"));
    }
  };

  const submitDisabled = running || sending || busy || suspended
    || !conversationId || attachments.some(item => item.status !== "staged")
    || (!attachments.length && !canSubmit(buildSendText(draft, attachedSelection), busy, suspended));

  return <div className="chat-panel-composer">
    <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
      aria-label={t("chat.attachLocalDisclosure")}
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        const { accepted, rejection } = filterAcceptedImages(files, attachments.length);
        if (rejection === "limit") toast.info(t("chat.panel.imageLimit"));
        if (rejection === "too_large") toast.info(t("chat.panel.imageTooLarge"));
        void onStageImages(accepted).catch(report);
      }} />
    <div className="chat-panel-input-card"
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={event => {
        const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        const { accepted, rejection } = filterAcceptedImages(files, attachments.length);
        if (rejection === "limit") toast.info(t("chat.panel.imageLimit"));
        if (rejection === "too_large") toast.info(t("chat.panel.imageTooLarge"));
        void onStageImages(accepted).catch(report);
      }}>
      <ChatPanelImageTray images={attachments} onRemove={onRemoveImage}
        onRetry={id => { void onRetryImage(id).catch(report); }} onPreview={setPreview} />
      {attachedSelection ? (
        <div className="chat-panel-chip is-attached" data-chat-panel-chip="attached">
          <Paperclip size={10} aria-hidden="true" />
          <span>{t("chat.panel.attachSelection", { count: attachedSelection.length })}</span>
          <button type="button" onClick={onDetachSelection} aria-label={t("chat.panel.detachSelection")}>
            <X size={10} />
          </button>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        disabled={suspended}
        placeholder={t("chat.draft")}
        aria-label={t("chat.draft")}
        onChange={(event) => {
          if (!conversationId) return;
          controller.setDraft(conversationId, event.currentTarget.value);
        }}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if (!shouldSubmit(event.nativeEvent, event.nativeEvent.isComposing === true)) return;
          event.preventDefault();
          if (!submitDisabled) submit();
        }}
      />
      <div className="chat-panel-input-actions">
        <div className="chat-panel-input-tools">
          {reasoningControl}
          <button
            type="button"
            className={`chat-panel-tool-button${attachedSelection ? " is-active" : ""}`}
            title={t("chat.panel.attachTooltip")}
            aria-label={t("chat.panel.attachTooltip")}
            onClick={handleAttachClick}
          >
            <Paperclip size={12} />
          </button>
          <button type="button" className="chat-panel-tool-button"
            title={t("chat.attachLocalDisclosure")} aria-label={t("chat.attachLocalDisclosure")}
            onClick={() => imageInputRef.current?.click()}>
            <Paperclip size={12} />
          </button>
        </div>
        {running
          ? <button
            type="button"
            className="chat-panel-send is-stop"
            aria-label={t("chat.panel.stop")}
            title={t("chat.panel.stop")}
            onClick={() => {
              if (!conversationId) return;
              void controller.stop(conversationId).catch(report);
            }}
          >
            <Square size={10} />
          </button>
          : <button
            type="button"
            className="chat-panel-send"
            disabled={submitDisabled}
            aria-label={t("chat.send")}
            title={t("chat.send")}
            onClick={submit}
          >
            <ArrowUp size={12} />
          </button>}
      </div>
    </div>
    {preview && <ChatPanelImagePreview dataUri={preview} onClose={() => setPreview(null)} />}
  </div>;
}
