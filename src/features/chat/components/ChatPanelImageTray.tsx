import { X } from "lucide-react";
import { useI18n } from "../../../shared/i18n/index";
import type { AttachmentDraft } from "../lib/chatImageAttachments";
import { ChatImageLightbox } from "./ChatImageLightbox";

interface ChatPanelImageTrayProps {
  images: readonly AttachmentDraft[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (dataUri: string) => void;
}

export function ChatPanelImageTray({ images, onRemove, onRetry, onPreview }: ChatPanelImageTrayProps) {
  const { t } = useI18n();
  if (!images.length) return null;
  return <div className="chat-panel-image-tray" data-chat-panel-images="true">
    {images.map(image => <div className="chat-panel-image-thumb" key={image.localId} data-status={image.status}>
      <button type="button" className="chat-panel-image-open" aria-label={t("chat.panel.imagePreview")}
        onClick={() => onPreview(image.previewUrl)}>
        <img src={image.previewUrl} alt={image.name ?? t("chat.panel.attachImage")} />
      </button>
      {image.status === "failed" && <span role="alert">{t("chat.imageStageFailed")}</span>}
      {image.status === "failed" && <button type="button" onClick={() => onRetry(image.localId)}>{t("chat.retry")}</button>}
      {image.status === "staging" && <span role="status">{t("chat.imageStaging")}</span>}
      <button type="button" className="chat-panel-image-remove" aria-label={t("chat.panel.removeImage")}
        onClick={() => onRemove(image.localId)}><X size={9} /></button>
    </div>)}
  </div>;
}

export function ChatPanelImagePreview({ dataUri, onClose }: { dataUri: string; onClose: () => void }) {
  const { t } = useI18n();
  return <ChatImageLightbox className="chat-panel-image-preview" label={t("chat.panel.imagePreview")}
    closeLabel={t("chat.panel.close")} closeClassName="chat-panel-image-preview-close" closeContent={<X size={14} />}
    onClose={onClose}>
    <img src={dataUri} alt={t("chat.panel.imagePreview")} />
  </ChatImageLightbox>;
}
