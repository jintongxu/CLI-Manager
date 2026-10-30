export type TerminalExitNotificationState =
  | "none"
  | "running"
  | "attention"
  | "done"
  | "failed";

export interface TerminalExitTaskCandidate {
  kind?: string | null;
  isAgentSession?: boolean;
  cliTool?: string | null;
  processStatus?: string | null;
  mergedStatus?: TerminalExitNotificationState | null;
  hookStatus?: TerminalExitNotificationState | null;
}

export interface DaemonExitTaskCandidate {
  alive: boolean;
  taskStatus?: string | null;
}

export function shouldIncludeTerminalExitTask(
  candidate: TerminalExitTaskCandidate,
  includeFinished = false
): boolean {
  const isPiAgent = candidate.kind === "ephemeral-pi"
    || (candidate.isAgentSession === true && candidate.cliTool?.trim().toLowerCase() === "pi");
  if (candidate.kind && candidate.kind !== "pty" && candidate.kind !== "ephemeral-pi") return false;

  // Pi is an agent PTY without hook status; its live process is the exit task.
  if (isPiAgent && candidate.processStatus === "running") return true;
  if (candidate.processStatus === "running" && candidate.mergedStatus === "running") {
    return true;
  }

  if (!includeFinished) return false;

  return candidate.hookStatus === "done" || candidate.hookStatus === "failed";
}

export function shouldIncludeDaemonExitTask(
  candidate: DaemonExitTaskCandidate,
  includeFinished = false
): boolean {
  const taskStatus = candidate.taskStatus?.trim().toLowerCase();
  const finished = taskStatus === "done" || taskStatus === "failed" || taskStatus === "completed";
  if (finished) return includeFinished;
  return candidate.alive;
}
