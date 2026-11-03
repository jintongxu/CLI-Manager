import { toast } from "sonner";
import type { TerminalSession } from "../../../shared/types/index";
import type { TranslationKey } from "../../../shared/i18n/index";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
type Confirm = (options: { title: string; message: string; confirmText: string; danger: boolean }) => Promise<boolean>;
type Action<T = void> = (sessionId: string) => Promise<T>;

const errorKeys: Record<string, TranslationKey> = {
  unsupported_remote: "terminal.recovery.unsupported",
  session_missing: "terminal.recovery.sessionMissing",
  session_changed: "terminal.recovery.sessionChanged",
  cwd_missing: "terminal.recovery.cwdMissing",
  worktree_missing: "terminal.recovery.worktreeMissing",
  wsl_environment_missing: "terminal.recovery.wslMissing",
  close_failed: "terminal.recovery.closeFailed",
  create_failed: "terminal.recovery.createFailed",
  cleanup_failed: "terminal.recovery.cleanupFailed",
  candidate_not_ready: "terminal.recovery.candidateNotReady",
  candidate_died_after_close: "terminal.recovery.candidateDiedAfterClose",
  persistence_failed: "terminal.recovery.persistenceFailed",
};
export function recoveryErrorMessage(t: Translate, error: unknown, fallback: TranslationKey = "terminal.recovery.failed") {
  const code = String(error).match(/terminal_recovery_([a-z_]+)/)?.[1];
  const details = error as { sessionId?: string; committedSessionId?: string } | null;
  return t((code && errorKeys[code]) || fallback, {
    sessionId: details?.sessionId ?? details?.committedSessionId ?? "?",
  });
}

export function createTerminalRecoveryHandlers(input: {
  t: Translate;
  confirm: Confirm;
  sessions: TerminalSession[];
  setActive: (sessionId: string) => void;
  getSession?: (sessionId: string) => TerminalSession | undefined;
  resolveContext?: (session: TerminalSession) => { cwd: string; environment: string; signature?: string } | Promise<{ cwd: string; environment: string; signature?: string }>;
  isBusy?: (sessionId: string) => boolean;
  setBusy?: (sessionId: string, busy: boolean) => void;
  probeSession: Action<{ attached: boolean; alive: boolean; cwd?: string | null }>;
  interruptSession: Action;
  openEmergencyTerminal: Action<string>;
  rebuildSession: Action<string>;
  hardKillSession: Action;
}) {
  const { t, confirm } = input;
  const pending = new Set<string>();
  const run = async (id: string, operation: "probe" | "interrupt" | "emergency" | "rebuild" | "hardKill") => {
    if (pending.has(id) || input.isBusy?.(id)) { toast.info(t("terminal.recovery.busy")); return; }
    pending.add(id);
    input.setBusy?.(id, true);
    let progress: string | number | undefined;
    try {
      const session = input.getSession ? input.getSession(id) : input.sessions.find(item => item.id === id);
      if (!session) throw new Error("terminal_recovery_session_missing");
      if ((session.kind ?? "pty") !== "pty" || session.remoteHandoff) { toast.error(t("terminal.recovery.nonPty")); return; }
      if (session.environmentType === "ssh" || session.sshHostId) throw new Error("terminal_recovery_unsupported_remote");
      if (operation === "emergency" || operation === "rebuild" || operation === "hardKill") {
        // Force end needs only the existing source, not a reconstructible launch environment.
        const fallbackContext = { cwd: session.cwd ?? t("terminal.context.defaultShell"), environment: session.environmentType ?? "local" };
        const context = operation === "hardKill"
          ? await Promise.resolve().then(() => input.resolveContext?.(session)).catch(() => undefined) ?? fallbackContext
          : await input.resolveContext?.(session) ?? fallbackContext;
        const key = operation === "emergency" ? "Emergency" : operation === "rebuild" ? "Rebuild" : "HardKill";
        const confirmed = await confirm({
          title: t(`terminal.recovery.confirm${key}Title`),
          message: t(`terminal.recovery.confirm${key}`, { title: session.title, path: context.cwd, environment: context.environment }),
          confirmText: t(`terminal.recovery.${operation}`), danger: operation !== "emergency",
        });
        if (!confirmed) return;
        const latest = input.getSession?.(id);
        if (input.getSession && (!latest || latest.createdAtMs !== session.createdAtMs)) throw new Error("terminal_recovery_session_changed");
        if (latest && ((latest.kind ?? "pty") !== "pty" || latest.remoteHandoff || latest.environmentType === "ssh" || latest.sshHostId)) throw new Error("terminal_recovery_unsupported_remote");
        if (operation !== "hardKill" && latest && input.resolveContext && JSON.stringify(await input.resolveContext(latest)) !== JSON.stringify(context)) throw new Error("terminal_recovery_session_changed");
      }
      progress = toast.loading(t("terminal.recovery.busy"));
      if (operation === "probe") {
        const result = await input.probeSession(id);
        toast.info(t("terminal.recovery.status"), { description: result.attached
          ? `${result.alive ? t("terminal.status.running") : t("terminal.status.done")} · ${result.cwd ?? t("terminal.context.defaultShell")}`
          : t("terminal.recovery.sessionMissing") });
      } else if (operation === "interrupt") {
        await input.interruptSession(id); toast.success(t("terminal.recovery.interrupted"));
      } else if (operation === "emergency") {
        await input.openEmergencyTerminal(id); toast.success(t("terminal.recovery.emergencyOpened"));
      } else if (operation === "rebuild") {
        await input.rebuildSession(id); toast.success(t("terminal.recovery.rebuilt"));
      } else {
        await input.hardKillSession(id); toast.success(t("terminal.recovery.ended"));
      }
    } catch (error) {
      const fallback = operation === "hardKill" ? "terminal.recovery.closeFailed" : operation === "rebuild" || operation === "emergency" ? "terminal.recovery.createFailed" : "terminal.recovery.failed";
      toast.error(recoveryErrorMessage(t, error, fallback));
    } finally {
      if (progress !== undefined) toast.dismiss(progress);
      pending.delete(id); input.setBusy?.(id, false);
    }
  };
  return {
    probe: (id: string) => run(id, "probe"),
    interrupt: (id: string) => run(id, "interrupt"),
    emergency: (id: string) => run(id, "emergency"),
    rebuild: (id: string) => run(id, "rebuild"),
    hardKill: (id: string) => run(id, "hardKill"),
  };
}
