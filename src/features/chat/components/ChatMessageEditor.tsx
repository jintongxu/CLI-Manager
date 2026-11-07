import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { AttachmentDraft } from "../lib/chatImageAttachments";
import { MAX_CHAT_IMAGES, filterAcceptedImages, readClipboardImages } from "../lib/chatImageAttachments";
import type { Message } from "../lib/types";

export type ChatMessageImageEdit =
  | { mode: "preserve"; stageIds: readonly [] }
  | { mode: "replace"; stageIds: readonly string[] };

export interface ChatMessageEditSubmission {
  text: string | null;
  images: ChatMessageImageEdit;
}

export interface ChatMessageEditorLabels {
  edit: string;
  text: string;
  preserveImages: string;
  replaceImages: string;
  addImages: string;
  removeImage: (name: string | null, index: number) => string;
  staging: string;
  stageFailed: string;
  retry: string;
  cancel: string;
  submit: string;
}

export interface ChatMessageEditorProps {
  message: Pick<Message, "id" | "role" | "status" | "content" | "assets">;
  staged: readonly AttachmentDraft[];
  labels: ChatMessageEditorLabels;
  onStageImages: (files: readonly File[]) => void | Promise<void>;
  onRemoveStaged: (localId: string) => void;
  onRetryStaged?: (localId: string) => void | Promise<void>;
  onSubmit: (submission: ChatMessageEditSubmission) => void | Promise<void>;
  onCancel: () => void;
  disabled?: boolean;
  className?: string;
  onRejected?: (reason: "limit" | "too_large") => void;
}

/**
 * Controlled historical-user-message editor. Empty stageIds always mean
 * "preserve committed images"; replacement is emitted only with a fully staged,
 * ordered list, matching ChatController.editAndRegenerate exactly.
 */
export function ChatMessageEditor({
  message, staged, labels, onStageImages, onRemoveStaged, onRetryStaged,
  onSubmit, onCancel, disabled = false, className, onRejected,
}: ChatMessageEditorProps) {
  const [text, setText] = useState(message.content);
  const [imageMode, setImageMode] = useState<"preserve" | "replace">("preserve");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const settledUser = message.role === "user" && message.status === "completed";

  useEffect(() => {
    setText(message.content);
    setImageMode("preserve");
  }, [message.content, message.id]);

  useEffect(() => {
    if (staged.length === 0 && message.assets.length === 0) setImageMode("preserve");
  }, [message.assets.length, staged.length]);

  const stagedIds = staged.flatMap((draft) => draft.status === "staged" && draft.descriptor
    ? [draft.descriptor.stageId]
    : []);
  const allStaged = staged.length > 0 && stagedIds.length === staged.length;
  const imageSelectionReady = imageMode === "preserve" || allStaged;
  const hasEditedContent = text.trim().length > 0
    || (imageMode === "preserve" ? message.assets.length > 0 : allStaged);
  const canSubmit = settledUser && !disabled && !submitting && imageSelectionReady && hasEditedContent;

  const acceptFiles = (files: readonly File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const { accepted, rejection } = filterAcceptedImages(images, staged.length, MAX_CHAT_IMAGES);
    if (rejection) onRejected?.(rejection);
    if (accepted.length) {
      setImageMode("replace");
      void onStageImages(accepted);
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = readClipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    acceptFiles(files);
  };
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    acceptFiles(files);
  };

  return <form
    className={className ?? "chat-message-editor"}
    aria-label={labels.edit}
    onDragOver={(event) => {
      if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/"))) event.preventDefault();
    }}
    onDrop={onDrop}
    onSubmit={(event) => {
      event.preventDefault();
      if (!canSubmit) return;
      const images: ChatMessageImageEdit = imageMode === "replace"
        ? { mode: "replace", stageIds: stagedIds }
        : { mode: "preserve", stageIds: [] };
      setSubmitting(true);
      void Promise.resolve(onSubmit({ text: text.trim() ? text : null, images }))
        .catch(() => { /* Parent reports; keep the controlled draft for retry. */ })
        .finally(() => setSubmitting(false));
    }}
  >
    <textarea
      value={text}
      aria-label={labels.text}
      disabled={!settledUser || disabled || submitting}
      onChange={(event) => setText(event.currentTarget.value)}
      onPaste={onPaste}
    />
    <fieldset className="chat-message-editor-image-options">
      <legend>{labels.addImages}</legend>
      <div className="chat-message-editor-image-modes">
        {message.assets.length > 0 && <label>
          <input
            type="radio"
            name={`chat-edit-images-${message.id}`}
            checked={imageMode === "preserve"}
            disabled={disabled || submitting}
            onChange={() => setImageMode("preserve")}
          />
          <span>{labels.preserveImages}</span>
        </label>}
        <label>
          <input
            type="radio"
            name={`chat-edit-images-${message.id}`}
            checked={imageMode === "replace"}
            disabled={disabled || submitting || staged.length === 0}
            onChange={() => setImageMode("replace")}
          />
          <span>{labels.replaceImages}</span>
        </label>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(event) => {
          acceptFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <button className="chat-message-editor-add-image" type="button" disabled={disabled || submitting || staged.length >= MAX_CHAT_IMAGES} onClick={() => fileRef.current?.click()}>
        {labels.addImages}
      </button>
    </fieldset>
    {staged.length > 0 && <ol className="chat-message-editor-images">
      {staged.map((draft, index) => <li key={draft.localId}>
        <span className="chat-message-editor-thumbnail">
          <img src={draft.previewUrl} alt={draft.name ?? labels.addImages} />
        </span>
        <span className="chat-message-editor-image-details">
          <span className="chat-message-editor-image-name" title={draft.name ?? undefined}>{draft.name ?? labels.addImages}</span>
          {draft.status !== "staged" && <span className="chat-message-editor-image-status">
            {draft.status === "staging" ? labels.staging : labels.stageFailed}
          </span>}
        </span>
        <span className="chat-message-editor-image-actions">
          {draft.status === "failed" && onRetryStaged && <button type="button" onClick={() => void onRetryStaged(draft.localId)}>{labels.retry}</button>}
          <button className="chat-message-editor-remove-image" type="button" aria-label={labels.removeImage(draft.name, index)} title={labels.removeImage(draft.name, index)} onClick={() => onRemoveStaged(draft.localId)}>
            ×
          </button>
        </span>
      </li>)}
    </ol>}
    <div className="chat-message-editor-actions">
      <button type="button" disabled={submitting} onClick={onCancel}>{labels.cancel}</button>
      <button type="submit" disabled={!canSubmit}>{labels.submit}</button>
    </div>
  </form>;
}
