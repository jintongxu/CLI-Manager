import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../../shared/i18n/index";

interface ChatPanelImageTrayProps {
  images: readonly string[];
  onRemove: (index: number) => void;
  onPreview: (dataUri: string) => void;
}

export function ChatPanelImageTray({ images, onRemove, onPreview }: ChatPanelImageTrayProps) {
  const { t } = useI18n();
  if (!images.length) return null;
  return <div className="chat-panel-image-tray" data-chat-panel-images="true">
    {images.map((dataUri, index) => <div className="chat-panel-image-thumb" key={`${index}-${dataUri.length}`}>
      <button
        type="button"
        className="chat-panel-image-open"
        aria-label={t("chat.panel.imagePreview")}
        onClick={() => onPreview(dataUri)}
      >
        <img src={dataUri} alt={t("chat.panel.attachImage")} />
      </button>
      <button
        type="button"
        className="chat-panel-image-remove"
        aria-label={t("chat.panel.removeImage")}
        onClick={() => onRemove(index)}
      >
        <X size={9} />
      </button>
    </div>)}
  </div>;
}

/** Full-screen preview; Esc is captured so it never also closes the whole panel. */
export function ChatPanelImagePreview({ dataUri, onClose }: { dataUri: string; onClose: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return <div
    className="chat-panel-image-preview"
    role="dialog"
    aria-modal="true"
    aria-label={t("chat.panel.imagePreview")}
    onClick={onClose}
  >
    <img src={dataUri} alt={t("chat.panel.imagePreview")} onClick={(event) => event.stopPropagation()} />
    <button type="button" className="chat-panel-image-preview-close" aria-label={t("chat.panel.close")} onClick={onClose}>
      <X size={14} />
    </button>
  </div>;
}
