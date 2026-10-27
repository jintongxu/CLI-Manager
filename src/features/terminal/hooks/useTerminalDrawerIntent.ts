import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Mirrors the terminal hover-card timing so the drawer feels consistent with tab hover cards. */
export const TERMINAL_DRAWER_OPEN_DELAY_MS = 350;
export const TERMINAL_DRAWER_CLOSE_DELAY_MS = 300;

export interface TerminalDrawerIntentOptions {
  /** When false (tab bar hidden) the drawer force-closes and hover/click cannot open it. */
  enabled: boolean;
  /** Called when the drawer closes via Escape so the host can restore focus to the anchor. */
  onRequestFocusAnchor?: () => void;
}

/**
 * Hover-intent + click-pin open/close state machine for the terminal navigation drawer.
 * Transient hover opens auto-close on pointer leave; a click pins it so leaving keeps it open
 * until Escape, an outside interaction, or another click closes it.
 */
export function useTerminalDrawerIntent({ enabled, onRequestFocusAnchor }: TerminalDrawerIntentOptions) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearOpen = useCallback(() => {
    if (openTimer.current === null) return;
    window.clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const clearClose = useCallback(() => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const closeDrawer = useCallback(() => {
    clearOpen();
    clearClose();
    setPinned(false);
    setOpen(false);
  }, [clearClose, clearOpen]);

  // Disabling the trigger (e.g. hidden tab bar) must collapse any open drawer and block reopen.
  useEffect(() => {
    if (!enabled) closeDrawer();
  }, [closeDrawer, enabled]);

  useEffect(() => () => { clearOpen(); clearClose(); }, [clearClose, clearOpen]);

  const scheduleOpen = useCallback(() => {
    if (!enabled) return;
    clearClose();
    if (open) return;
    clearOpen();
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpen(true);
    }, TERMINAL_DRAWER_OPEN_DELAY_MS);
  }, [clearClose, clearOpen, enabled, open]);

  const keepOpen = useCallback(() => {
    clearClose();
    clearOpen();
  }, [clearClose, clearOpen]);

  const scheduleClose = useCallback(() => {
    clearOpen();
    if (pinned) return; // A pinned drawer ignores pointer leave.
    clearClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, TERMINAL_DRAWER_CLOSE_DELAY_MS);
  }, [clearOpen, clearClose, pinned]);

  const toggle = useCallback(() => {
    if (!enabled) return;
    if (open && pinned) {
      closeDrawer();
    } else {
      clearOpen();
      clearClose();
      setPinned(true);
      setOpen(true);
    }
  }, [clearClose, clearOpen, closeDrawer, enabled, open]);

  const closeAndRefocus = useCallback(() => {
    closeDrawer();
    if (onRequestFocusAnchor) onRequestFocusAnchor();
    else anchorRef.current?.focus();
  }, [closeDrawer, onRequestFocusAnchor]);

  return {
    open,
    pinned,
    setOpen,
    toggle,
    close: closeAndRefocus,
    anchorRef,
    anchorProps: {
      ref: anchorRef,
      "aria-haspopup": "dialog" as const,
      "aria-expanded": open,
      onPointerEnter: scheduleOpen,
      onPointerLeave: scheduleClose,
      onClick: toggle,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (!enabled) return;
        if (["Enter", " ", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          if (!open) {
            clearOpen();
            clearClose();
            setPinned(true);
            setOpen(true);
          }
        }
      },
    },
    contentProps: {
      onPointerEnter: keepOpen,
      onPointerLeave: scheduleClose,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeAndRefocus();
        }
      },
    },
  };
}
