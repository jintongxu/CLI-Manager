import { useEffect, useRef, useState } from "react";
import type { AssetDescriptor, Message } from "../lib/types";
import { chatAssetReadInput, type ChatAssetReader, useChatAssetBlobUrl } from "../hooks/useChatAssetBlobUrl";
import { ChatImageLightbox } from "./ChatImageLightbox";

export interface ChatMessageAttachmentLabels {
  list: string;
  open: (asset: AssetDescriptor, index: number) => string;
  preview: (asset: AssetDescriptor, index: number) => string;
  close: string;
  loading: string;
  failed: string;
}

export interface ChatMessageAttachmentsProps {
  message: Pick<Message, "id" | "conversationId" | "assets">;
  readAsset: ChatAssetReader;
  labels: ChatMessageAttachmentLabels;
  className?: string;
  /** UI safety cap. The persisted protocol already limits a message to four images. */
  maxVisible?: number;
  onReadError?: (error: unknown, asset: AssetDescriptor) => void;
}

interface ThumbnailProps {
  message: Pick<Message, "id" | "conversationId">;
  asset: AssetDescriptor;
  index: number;
  readAsset: ChatAssetReader;
  labels: ChatMessageAttachmentLabels;
  onOpen: () => void;
  onReadError?: (error: unknown, asset: AssetDescriptor) => void;
}

function useReportAssetError(error: unknown, asset: AssetDescriptor, onReadError?: (error: unknown, asset: AssetDescriptor) => void) {
  const callback = useRef(onReadError);
  const reported = useRef<unknown>(null);
  callback.current = onReadError;
  useEffect(() => {
    reported.current = null;
  }, [asset.assetId, asset.ordinal]);
  useEffect(() => {
    if (!error || reported.current === error) return;
    reported.current = error;
    callback.current?.(error, asset);
  }, [asset.assetId, asset.ordinal, error]);
}

function AttachmentThumbnail({ message, asset, index, readAsset, labels, onOpen, onReadError }: ThumbnailProps) {
  const input = chatAssetReadInput(message, asset);
  const { url, loading, error } = useChatAssetBlobUrl(readAsset, input, asset.mediaType);
  useReportAssetError(error, asset, onReadError);

  return <li className="chat-message-attachment">
    <button
      type="button"
      className="chat-message-attachment-open"
      aria-label={labels.open(asset, index)}
      disabled={!url}
      onClick={onOpen}
    >
      {url
        ? <img src={url} alt={labels.preview(asset, index)} width={asset.width} height={asset.height} />
        : <span role={error ? "alert" : "status"}>{error ? labels.failed : loading ? labels.loading : labels.failed}</span>}
    </button>
  </li>;
}

interface PreviewProps {
  message: Pick<Message, "id" | "conversationId">;
  asset: AssetDescriptor;
  index: number;
  readAsset: ChatAssetReader;
  labels: ChatMessageAttachmentLabels;
  onClose: () => void;
  onReadError?: (error: unknown, asset: AssetDescriptor) => void;
}

function AttachmentPreview({ message, asset, index, readAsset, labels, onClose, onReadError }: PreviewProps) {
  const input = chatAssetReadInput(message, asset);
  const { url, loading, error } = useChatAssetBlobUrl(readAsset, input, asset.mediaType);
  useReportAssetError(error, asset, onReadError);

  return <ChatImageLightbox className="chat-message-attachment-lightbox"
    label={labels.preview(asset, index)} closeLabel={labels.close} onClose={onClose}>
    {url
      ? <img src={url} alt={labels.preview(asset, index)} width={asset.width} height={asset.height} />
      : <p role={error ? "alert" : "status"}>{error ? labels.failed : loading ? labels.loading : labels.failed}</p>}
  </ChatImageLightbox>;
}

/** Committed-message image renderer. It never accepts paths, bytes, or data URIs. */
export function ChatMessageAttachments({
  message, readAsset, labels, className, maxVisible = 4, onReadError,
}: ChatMessageAttachmentsProps) {
  const [previewOrdinal, setPreviewOrdinal] = useState<number | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const visible = message.assets.slice(0, Math.max(0, Math.min(maxVisible, 4)));
  const preview = previewOrdinal === null
    ? null
    : visible.find((asset) => asset.ordinal === previewOrdinal) ?? null;

  useEffect(() => {
    if (previewOrdinal !== null && !preview) setPreviewOrdinal(null);
  }, [preview, previewOrdinal]);

  if (!visible.length) return null;
  const closePreview = () => {
    setPreviewOrdinal(null);
    queueMicrotask(() => openerRef.current?.focus());
  };

  return <>
    <ul className={className ?? "chat-message-attachments"} aria-label={labels.list}>
      {visible.map((asset, index) => <AttachmentThumbnail
        key={`${asset.ordinal}:${asset.assetId}`}
        message={message}
        asset={asset}
        index={index}
        readAsset={readAsset}
        labels={labels}
        onReadError={onReadError}
        onOpen={() => {
          openerRef.current = document.activeElement as HTMLElement | null;
          setPreviewOrdinal(asset.ordinal);
        }}
      />)}
    </ul>
    {preview && <AttachmentPreview
      message={message}
      asset={preview}
      index={visible.indexOf(preview)}
      readAsset={readAsset}
      labels={labels}
      onReadError={onReadError}
      onClose={closePreview}
    />}
  </>;
}
