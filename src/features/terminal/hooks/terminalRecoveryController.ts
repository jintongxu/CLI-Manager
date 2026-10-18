import { toast } from "sonner";
import type { TerminalSession } from "../../../shared/types/index";
import type { TranslationKey } from "../../../shared/i18n/index";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
type Confirm = (options: { title: string; message: string; confirmText: string; danger: boolean }) => Promise<boolean>;
type Action<T = void> = (sessionId: string) => Promise<T>;

export function createTerminalRecoveryHandlers(input: {
  t: Translate;
  confirm: Confirm;
  sessions: TerminalSession[];
  setActive: (sessionId: string) => void;
  probeSession: Action<{ attached: boolean; alive: boolean; cwd?: string | null }>;
  interruptSession: Action;
  openEmergencyTerminal: Action<string>;
  rebuildSession: Action<string>;
  hardKillSession: Action;
}) {
  const { t, confirm, sessions, setActive } = input;
  const errorText = (error: unknown) => {
    const code = String(error).match(/terminal_recovery_[a-z_]+/)?.[0];
    if (code === "terminal_recovery_unsupported_remote") return t("terminal.recovery.unsupported");
    if (code === "terminal_recovery_session_missing") return t("terminal.recovery.sessionMissing");
    return t("terminal.recovery.failed");
  };
  const find = (id: string) => sessions.find((session) => session.id === id);
  return {
    probe: (id: string) => void input.probeSession(id).then((result) => toast.info(t("terminal.recovery.status"), {
      description: result.attached
        ? `${result.alive ? t("terminal.status.running") : t("terminal.status.done")} · ${result.cwd ?? t("terminal.context.defaultShell")}`
        : t("terminal.recovery.sessionMissing"),
    })).catch((error) => toast.error(errorText(error))),
    interrupt: (id: string) => void input.interruptSession(id).then(() => toast.success(t("terminal.recovery.interrupted"))).catch((error) => toast.error(errorText(error))),
    emergency: (id: string) => void input.openEmergencyTerminal(id).then(setActive).catch((error) => toast.error(errorText(error))),
    rebuild: (id: string) => {
      const session = find(id);
      if (!session) return;
      void confirm({
        title: t("terminal.recovery.confirmRebuildTitle"),
        message: t("terminal.recovery.confirmRebuild", { title: session.title, path: session.cwd ?? t("terminal.context.defaultShell") }),
        confirmText: t("terminal.recovery.rebuild"), danger: true,
      }).then((confirmed) => confirmed && void input.rebuildSession(id).then(setActive).catch((error) => toast.error(errorText(error))));
    },
    hardKill: (id: string) => {
      const session = find(id);
      if (!session) return;
      void confirm({
        title: t("terminal.recovery.confirmHardKillTitle"),
        message: t("terminal.recovery.confirmHardKill", { title: session.title, path: session.cwd ?? t("terminal.context.defaultShell") }),
        confirmText: t("terminal.recovery.hardKill"), danger: true,
      }).then((confirmed) => confirmed && void input.hardKillSession(id).catch((error) => toast.error(errorText(error))));
    },
  };
}
