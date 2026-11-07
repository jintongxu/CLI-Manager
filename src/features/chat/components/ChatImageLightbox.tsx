import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";

interface ChatImageLightboxProps {
  className: string;
  label: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  closeClassName?: string;
  closeContent?: ReactNode;
}

/** Accessible modal contract shared by draft and committed image previews. */
export function ChatImageLightbox({
  className, label, closeLabel, onClose, children, closeClassName, closeContent,
}: ChatImageLightboxProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRefCallback = useRef(onClose);
  closeRefCallback.current = onClose;

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRefCallback.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      queueMicrotask(() => openerRef.current?.focus());
    };
  }, []);

  const dismissBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return <div className={className} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={dismissBackdrop}>
    <span id={titleId} className="sr-only">{label}</span>
    {children}
    <button ref={closeRef} type="button" className={closeClassName} aria-label={closeLabel} onClick={onClose}>
      {closeContent ?? closeLabel}
    </button>
  </div>;
}
