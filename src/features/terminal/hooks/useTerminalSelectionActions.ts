import type { RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { captureTerminalInputPermission } from "../../../shared/lib/terminalContinuation";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { logError } from "../../../shared/platform/logger";
import { serializeBufferPlainText } from "../lib/xTermDiagnostics";

interface Options {
  sessionId: string;
  terminalRef: RefObject<Terminal | null>;
  contextMenuSelectionRef: RefObject<string>;
  menuState: { selection?: string } | null;
  closeContextMenu: () => void;
  focusTerminalWithCodexCursorPolicy: (terminal: Terminal) => void;
  readClipboardPasteText: () => Promise<string>;
  pasteText: (terminal: Terminal, text: string) => void;
  onAskBtw?: (quote: string, sourceTerminalId: string) => void;
}

/** Shared captured-selection order for Copy and BTW; preserve right-click/blur selection. */
export function useTerminalSelectionActions({ sessionId, terminalRef, contextMenuSelectionRef, menuState,
  closeContextMenu, focusTerminalWithCodexCursorPolicy, readClipboardPasteText, pasteText, onAskBtw }: Options) {
  const getCapturedSelection = (terminal: Terminal | null): string => {
    const fromRef = contextMenuSelectionRef.current;
    if (fromRef && fromRef.trim().length > 0) return fromRef;
    const fromMenu = menuState?.selection;
    if (fromMenu && fromMenu.trim().length > 0) return fromMenu;
    const termText = terminal?.getSelection();
    if (termText && termText.trim().length > 0) return termText;
    const domSel = typeof window !== "undefined" ? window.getSelection() : null;
    return (domSel && !domSel.isCollapsed ? domSel.toString() : "").trim();
  };

  const handleMenuCopy = () => {
    const terminal = terminalRef.current;
    const selection = getCapturedSelection(terminal);
    contextMenuSelectionRef.current = "";
    closeContextMenu();
    if (!selection) return;
    void copyTextToClipboard(selection);
    if (terminal) {
      terminal.clearSelection();
      focusTerminalWithCodexCursorPolicy(terminal);
    }
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  };

  const handleMenuPaste = () => {
    const terminal = terminalRef.current;
    closeContextMenu();
    if (!terminal) return;
    const permission = captureTerminalInputPermission(terminal);
    if (!permission()) return;
    readClipboardPasteText().then((text) => {
      if (text && permission()) pasteText(terminal, text);
      focusTerminalWithCodexCursorPolicy(terminal);
    }).catch((err) => {
      logError("Failed to read clipboard text", { sessionId, err });
    });
  };

  const handleMenuSelectAll = () => {
    const terminal = terminalRef.current;
    closeContextMenu();
    if (!terminal) return;
    terminal.selectAll();
    focusTerminalWithCodexCursorPolicy(terminal);
  };

  const handleMenuCopyAll = () => {
    const terminal = terminalRef.current;
    closeContextMenu();
    if (!terminal) return;
    void copyTextToClipboard(serializeBufferPlainText(terminal));
    focusTerminalWithCodexCursorPolicy(terminal);
  };

  const handleMenuAskBtw = (menuSelection?: string) => {
    const terminal = terminalRef.current;
    const selection = menuSelection?.trim() || getCapturedSelection(terminal);
    contextMenuSelectionRef.current = "";
    closeContextMenu();
    if (!selection) {
      onAskBtw?.("", sessionId);
      return;
    }
    if (terminal) {
      terminal.clearSelection();
      focusTerminalWithCodexCursorPolicy(terminal);
    }
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
    onAskBtw?.(selection, sessionId);
  };

  return { handleMenuCopy, handleMenuPaste, handleMenuSelectAll, handleMenuCopyAll, handleMenuAskBtw };
}
