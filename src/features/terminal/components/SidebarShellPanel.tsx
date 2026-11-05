import { ChevronDown, Maximize2, Minimize2, Terminal, X } from "../../../shared/ui/icons";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "../../../shared/i18n/index";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import type { SidebarShellContext } from "../lib/sidebarShellContext";
import { useSidebarShellStore } from "../store/sidebarShellStore";
import { useTerminalStore } from "../store/terminalStore";

/** Controls own no parser or PTY lifetime. The host remains outside this slot. */
export function SidebarShellPanel({ context, error, registerTarget, onOpen, onCollapse, maximized, onToggleMaximize }: {
  context: SidebarShellContext | null;
  error: boolean;
  registerTarget: (node: HTMLDivElement | null) => void;
  onOpen: () => void;
  onCollapse: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
}) {
  const { t } = useI18n();
  const owner = useSidebarShellStore(s => context ? s.owners[context.key] : undefined);
  const status = useTerminalStore(s => owner?.sessionId ? s.sessionStatuses[owner.sessionId] : undefined);
  const exists = useTerminalStore(s => s.sessions.some(item => item.id === owner?.sessionId));
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const busy = owner?.phase === "creating" || owner?.phase === "closing";
  const exited = Boolean(owner?.sessionId) && (!exists || status === "exited" || status === "error");
  // Reopen first obtains strict disposal confirmation; a failure leaves the
  // original owner/parser intact and does not launch a second shell.
  const reopen = async () => {
    if (!context) return;
    try {
      await useSidebarShellStore.getState().close(context.key);
      await useSidebarShellStore.getState().open(context);
    } catch { toast.error(t("terminal.shell.reopenFailed")); }
  };
  const close = async (key: string) => {
    setConfirmKey(null);
    try { await useSidebarShellStore.getState().close(key); }
    catch { toast.error(t("terminal.shell.closeFailed")); }
  };
  return <div className="flex h-full min-h-0 flex-col" data-sidebar-shell-panel>
    <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 pb-1 pt-2 text-xs">
      <Terminal size={13} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate" title={context?.cwd}>
        {context ? `${context.environmentType}${context.sshHostId ? ` · ${context.sshHostId}` : ""} · ${context.cwd}` : t(error ? "terminal.shell.contextError" : "terminal.shell.noContext")}
      </span>
      <button type="button" className="ui-focus-ring rounded p-1" aria-label={t("terminal.shell.collapse")}
        title={t("terminal.shell.collapse")} onClick={onCollapse}><ChevronDown size={14} /></button>
      <button type="button" className="ui-focus-ring rounded p-1" aria-label={t(maximized ? "terminal.shell.restore" : "terminal.shell.maximize")}
        title={t(maximized ? "terminal.shell.restore" : "terminal.shell.maximize")} onClick={onToggleMaximize}>
        {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      <button type="button" className="ui-focus-ring rounded p-1" disabled={!owner || busy}
        aria-label={t(owner?.phase === "closeFailed" ? "terminal.shell.retryClose" : "terminal.shell.close")}
        title={t(owner?.phase === "closeFailed" ? "terminal.shell.retryClose" : "terminal.shell.close")}
        onClick={() => { if (context) setConfirmKey(context.key); }}><X size={14} /></button>
    </div>
    {Boolean(owner?.error) && <div role="alert" className="p-2 text-xs text-red-400">
      {t(owner?.phase === "closeFailed" ? "terminal.shell.closeFailed" : "terminal.shell.createFailed")}
    </div>}
    {busy && <div role="status" className="p-2 text-xs">{t(owner?.phase === "closing" ? "terminal.shell.closing" : "terminal.shell.creating")}</div>}
    {context && !busy && (!owner?.sessionId || exited) && <div className="p-3 text-xs">
      {exited && <p className="mb-2">{t("terminal.shell.exited")}</p>}
      <button type="button" className="ui-focus-ring rounded border border-white/20 px-3 py-2"
        onClick={exited ? () => { void reopen(); } : onOpen}>
        {t(exited ? "terminal.shell.reopen" : "terminal.shell.open")}
      </button>
    </div>}
    <div ref={registerTarget} className="relative min-h-0 flex-1" />
    <ConfirmDialog open={confirmKey !== null} title={t("terminal.shell.closeTitle")}
      message={t("terminal.shell.closeConfirm")} confirmText={t("terminal.shell.close")}
      cancelText={t("common.cancel")} danger explicitCloseOnly
      onConfirm={() => { if (confirmKey) void close(confirmKey); }} onClose={() => setConfirmKey(null)} />
  </div>;
}
