import type { TerminalSession } from "../../../shared/types/index";
import type { TranslationKey } from "../../../shared/i18n";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
const eligible = (session: TerminalSession | undefined): session is TerminalSession => !!session
  && !session.remoteHandoff && (session.kind === undefined || session.kind === "pty" || session.kind === "ephemeral-pi");
// Presentation/status changes are not a new process. Launch identity changes are.
const identity = (s: TerminalSession) => JSON.stringify([
  s.id, s.createdAtMs, s.kind ?? "pty", s.environmentType, s.sshHostId,
  s.wslDistroName, s.shell, s.projectId, s.worktreeId, s.cwd, s.remotePath,
]);

/** Confirmation/race guard only: the store remains the sole owner of closing and removal. */
export function createTerminalResourceDeletion(input: {
  getSession: (id: string) => TerminalSession | undefined;
  closeSession: (id: string, strict: true) => Promise<void>;
  confirm: (options: { title: string; message: string; confirmText: string; danger: boolean }) => Promise<boolean>;
  t: Translate;
  setPending: (id: string | null) => void;
  showError: (message: string) => void;
}) {
  let pending = false;
  return async (target: TerminalSession) => {
    if (pending) return;
    const source = input.getSession(target.id);
    const signature = identity(target);
    if (!eligible(source) || identity(source) !== signature
      || (target.createdAtMs === undefined && source !== target)) {
      input.showError(input.t("terminal.resources.deleteChanged")); return;
    }
    pending = true;
    input.setPending(target.id);
    try {
      if (!await input.confirm({
        title: input.t("terminal.resources.deleteTitle"),
        message: input.t("terminal.resources.deleteConfirm", { title: source.title, id: source.id }),
        confirmText: input.t("terminal.resources.delete"), danger: true,
      })) return;
      const live = input.getSession(target.id);
      if (!eligible(live) || identity(live) !== signature
        || (source.createdAtMs === undefined && live !== source)) {
        input.showError(input.t("terminal.resources.deleteChanged")); return;
      }
      await input.closeSession(target.id, true);
    } catch {
      input.showError(input.t("terminal.resources.deleteFailed"));
    } finally {
      pending = false;
      input.setPending(null);
    }
  };
}
