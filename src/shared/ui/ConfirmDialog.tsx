import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog";
import { Button } from "./button";
import { cn } from "../lib/utils";
import { LoaderCircle } from "./icons";

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  zIndex?: number;
  confirmAutoFocus?: boolean;
  contentClassName?: string;
  /**
   * Keep the dialog open until one of its explicit action buttons is clicked.
   * Useful for prompts where an accidental outside click must not discard the
   * user's decision opportunity.
   */
  explicitCloseOnly?: boolean;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  loadingText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
  zIndex,
  confirmAutoFocus = false,
  contentClassName,
  explicitCloseOnly = false,
  confirmDisabled = false,
  confirmLoading = false,
  loadingText = confirmText,
  onConfirm,
  onClose,
}: Props) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [clicked, setClicked] = useState(false);
  const previousConfirmLoading = useRef(confirmLoading);
  const loading = confirmLoading || clicked;
  useEffect(() => {
    if (!open || (previousConfirmLoading.current && !confirmLoading)) setClicked(false);
    previousConfirmLoading.current = confirmLoading;
  }, [open, confirmLoading]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={cn("max-w-[360px]", contentClassName)}
        showCloseButton={false}
        style={zIndex !== undefined ? { zIndex } : undefined}
        overlayStyle={zIndex !== undefined ? { zIndex } : undefined}
        onInteractOutside={
          explicitCloseOnly
            ? (event) => {
                event.preventDefault();
              }
            : undefined
        }
        onEscapeKeyDown={
          explicitCloseOnly
            ? (event) => {
                event.preventDefault();
              }
            : undefined
        }
        onOpenAutoFocus={
          confirmAutoFocus
            ? (event) => {
                event.preventDefault();
                confirmButtonRef.current?.focus();
              }
            : undefined
        }
      >
        <DialogTitle>{title}</DialogTitle>
        {message && (
          <DialogDescription className="mt-2 mb-2">{message}</DialogDescription>
        )}
        {loading && (
          <div role="status" className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant">
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
            <span>{loadingText}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={danger ? "destructive" : "default"}
            onClick={() => {
              if (confirmDisabled || confirmLoading || clicked) return;
              setClicked(true);
              onConfirm();
            }}
            disabled={confirmDisabled || confirmLoading}
            aria-busy={loading}
          >
            {loading && <LoaderCircle size={14} className="mr-1 animate-spin" aria-hidden="true" />}
            {loading ? loadingText : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
