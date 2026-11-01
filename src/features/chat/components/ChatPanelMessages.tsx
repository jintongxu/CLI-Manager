import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Sparkles } from "lucide-react";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { activateChatLink, chatTime, copyChatText, isFollowing } from "../lib/interactions";
import type { Message } from "../lib/types";

interface ChatPanelMessagesProps {
  messages: readonly Message[];
  conversationId: string | null;
  copiedId: string | null;
  onCopied: (id: string | null) => void;
  onRetry: () => void;
  report: (error: unknown) => void;
}

export function ChatPanelMessages({
  messages, conversationId, copiedId, onCopied, onRetry, report,
}: ChatPanelMessagesProps) {
  const { t, language } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);

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
              : <p className="chat-panel-user-text">{message.content}</p>}
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
