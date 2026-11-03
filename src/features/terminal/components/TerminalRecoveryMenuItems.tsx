import type { Project, TerminalSession } from "../../../shared/types/index";
import { useI18n } from "../../../shared/i18n";
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "../../../shared/ui/context-menu";
import { useTerminalStore } from "../state";

export function TerminalRecoveryMenuItems({ session, project, ...actions }: {
  session: TerminalSession;
  project?: Project;
  onProbeSession: (id: string) => void;
  onInterruptSession: (id: string) => void;
  onOpenEmergencyTerminal: (id: string) => void;
  onRebuildSession: (id: string) => void;
  onHardKillSession: (id: string) => void;
}) {
  const { t } = useI18n();
  const busy = useTerminalStore(state => Boolean(state.recoveryBusy?.[session.id]));
  const reason = (session.kind ?? "pty") !== "pty" || session.remoteHandoff ? t("terminal.recovery.nonPty")
    : session.environmentType === "ssh" || session.sshHostId || project?.environment_type === "ssh" || project?.ssh_host_id
      ? t("terminal.recovery.unsupported") : busy ? t("terminal.recovery.busy") : undefined;
  const disabled = Boolean(reason);
  return <>
    <ContextMenuSeparator />
    <ContextMenuLabel>{t("terminal.recovery.diagnosis")}</ContextMenuLabel>
    {reason && <ContextMenuLabel role="status">{reason}</ContextMenuLabel>}
    <ContextMenuItem disabled={disabled} title={reason} onSelect={() => actions.onProbeSession(session.id)}>{t("terminal.recovery.status")}</ContextMenuItem>
    <ContextMenuItem disabled={disabled} title={reason} onSelect={() => actions.onInterruptSession(session.id)}>{t("terminal.recovery.interrupt")}</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuLabel>{t("terminal.recovery.keepOriginal")}</ContextMenuLabel>
    <ContextMenuItem disabled={disabled} title={reason ?? t("terminal.recovery.emergencyHint")} onSelect={() => actions.onOpenEmergencyTerminal(session.id)}>{t("terminal.recovery.emergency")}</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuLabel>{t("terminal.recovery.destructive")}</ContextMenuLabel>
    <ContextMenuItem danger disabled={disabled} title={reason} onSelect={() => actions.onRebuildSession(session.id)}>{t("terminal.recovery.rebuild")}</ContextMenuItem>
    <ContextMenuItem danger disabled={disabled} title={reason} onSelect={() => actions.onHardKillSession(session.id)}>{t("terminal.recovery.hardKill")}</ContextMenuItem>
  </>;
}
