import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Sparkles } from "lucide-react";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { activateChatLink, chatTime, copyChatText, isFollowing } from "../lib/interactions";
import type { Message, ReasoningEffort } from "../lib/types";
import type { ChatPanelController } from "../lib/panelController";
import { AttachmentDraftOwner } from "../lib/chatImageAttachments";
import { ChatMessageAttachments } from "./ChatMessageAttachments";
import { ChatMessageEditor } from "./ChatMessageEditor";

interface ChatPanelMessagesProps {
  messages: readonly Message[];
  conversationId: string | null;
  copiedId: string | null;
  onCopied: (id: string | null) => void;
  onRetry: () => void;
  report: (error: unknown) => void;
  controller: ChatPanelController;
  settled: boolean;
  reasoning: ReasoningEffort;
}

export function ChatPanelMessages({
  messages, conversationId, copiedId, onCopied, onRetry, report, controller, settled, reasoning,
}: ChatPanelMessagesProps) {
  const { t, language } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [, refreshEditImages] = useState(0);
  const editOwner = useRef<AttachmentDraftOwner | null>(null);
  if (!editOwner.current) editOwner.current = new AttachmentDraftOwner({
    stage: bytes => controller.stageAttachment(bytes), releaseAssets: ids => controller.releaseAssets(ids),
  }, undefined, undefined, report);
  const followRef = useRef(true);

  useEffect(() => () => editOwner.current?.dispose(), []);
  useEffect(() => {
    editOwner.current?.switchConversation(); setEditing(null); refreshEditImages(value => value + 1);
  }, [conversationId]);
  useEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const errorLabel = (code: string | null) => {
    const key = `chat.error.${code}` as TranslationKey;
    const text = t(key);
    return text && text !== key ? text : t("chat.error.chat_storage");
  };

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const retryable = !!lastAssistant && ["failed", "stopped", "interrupted"].includes(lastAssistant.status);

  return <div
    className="chat-panel-thread"
    ref={scrollRef}
    role="log"
    aria-live="polite"
    onScroll={(event) => {
      followRef.current = isFollowing(event.currentTarget);
    }}
  >
    {messages.length === 0 && <p className="chat-panel-empty">{t("chat.panel.emptyThread")}</p>}
    {messages.map((message) => {
      const assistant = message.role === "assistant";
      const showStatus = assistant && message.status !== "completed";
      return <article
        key={message.id}
        className={`chat-panel-message is-${message.role}`}
        aria-label={t(assistant ? "chat.assistant" : "chat.user")}
      >
        {assistant && <span className="chat-panel-avatar" aria-hidden="true"><Sparkles size={10} /></span>}
        <div className="chat-panel-message-body">
          <div className="chat-panel-bubble">
            {assistant
              ? <MarkdownContent
                content={message.content}
                variant="default"
                linkBehavior="preview"
                onLinkActivate={(href) => {
                  void activateChatLink(href, openUrl).catch(report);
                }}
              />
              : editing === message.id
                ? <ChatMessageEditor message={message} staged={editOwner.current!.value}
                  labels={{ edit: t("chat.edit"), text: t("chat.editText"), preserveImages: t("chat.preserveImages"),
                    replaceImages: t("chat.replaceImages"), addImages: t("chat.panel.attachImage"),
                    removeImage: () => t("chat.panel.removeImage"), staging: t("chat.imageStaging"),
                    stageFailed: t("chat.imageStageFailed"), retry: t("chat.retry"), cancel: t("chat.cancel"), submit: t("chat.editSubmit") }}
                  onStageImages={async files => { const pending = files.map(file => editOwner.current!.stage(file, file.name).catch(error => report(error))); refreshEditImages(value => value + 1); await Promise.all(pending); refreshEditImages(value => value + 1); }}
                  onRemoveStaged={id => { editOwner.current?.remove(id); refreshEditImages(value => value + 1); }}
                  onRetryStaged={async id => { await editOwner.current?.retry(id); refreshEditImages(value => value + 1); }}
                  onCancel={() => { editOwner.current?.switchConversation(); setEditing(null); refreshEditImages(value => value + 1); }}
                  onSubmit={async submission => {
                    try {
                      const receipt = await controller.editAndRegenerate(message.conversationId, message.id, submission.text, reasoning, submission.images.stageIds) as { childConversationId?: string } | void;
                      editOwner.current?.consumed(submission.images.stageIds); setEditing(null); refreshEditImages(value => value + 1);
                      if (receipt?.childConversationId) await controller.select(receipt.childConversationId);
                    } catch (error) { report(error); throw error; }
                  }} />
                : <><p className="chat-panel-user-text">{message.content}</p>
                  <ChatMessageAttachments message={message} readAsset={controller.readAsset}
                    labels={{ list: t("chat.imageAttachments"), open: () => t("chat.imagePreview"), preview: () => t("chat.imagePreview"),
                      close: t("chat.panel.close"), loading: t("chat.imageLoading"), failed: t("chat.imageReadFailed") }} onReadError={report} /></>}
          </div>
          <div className="chat-panel-message-meta">
            <time dateTime={new Date(message.createdAt).toISOString()}>{chatTime(message.createdAt, language)}</time>
            <button
              type="button"
              className="chat-panel-copy"
              aria-label={t("chat.panel.copy")}
              onClick={() => {
                void copyChatText(message.content, writeText)
                  .then(() => onCopied(message.id))
                  .catch(report);
              }}
            >
              {t(copiedId === message.id ? "chat.panel.copied" : "chat.panel.copy")}
            </button>
            {!assistant && settled && message.status === "completed" && editing !== message.id && <button type="button"
              className="chat-panel-copy" onClick={() => setEditing(message.id)}>{t("chat.edit")}</button>}
            {showStatus && <span className="chat-panel-status" data-status={message.status}>
              {t(`chat.${message.status}` as TranslationKey)}
            </span>}
          </div>
          {assistant && message.errorCode && <p className="chat-panel-error" role="alert">
            {errorLabel(message.errorCode)}
          </p>}
        </div>
      </article>;
    })}
    {retryable && conversationId && <button type="button" className="chat-panel-retry" onClick={onRetry}>
      {t("chat.panel.retry")}
    </button>}
  </div>;
}
