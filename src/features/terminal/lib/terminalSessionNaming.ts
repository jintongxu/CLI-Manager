import type { TerminalSession } from "../../../shared/types/index";
import { CLI_TOOL_DESCRIPTORS } from "../../../shared/lib/cliTools";
import { normalizeShellKey } from "../../../shared/platform/shell";

export function terminalPurpose(shell?: string | null, startupCmd?: string, environmentType?: string, sshHostName?: string | null): string {
  // Match executable tokens, not arbitrary substrings (e.g. echo claude).
  const tokens = (startupCmd ?? "").trim().split(/\s*(?:&&|;)\s*/);
  for (const command of tokens) {
    const executable = command.match(/^(?:&\s*)?["']?([^\s"']+)["']?(?:\s|$)/)?.[1]
      ?.split(/[\\/]/).pop()?.replace(/\.(?:exe|cmd|ps1)$/i, "").toLowerCase();
    const tool = CLI_TOOL_DESCRIPTORS.find((item) => item.command === executable);
    if (tool) return tool.id === "claude" ? "Claude" : tool.id === "codex" ? "Codex" : tool.id === "pi" ? "Pi" : tool.label;
  }
  if (environmentType === "ssh") return sshHostName?.trim() || "SSH Shell";
  if (environmentType === "wsl") return "WSL";
  const labels = { powershell: "PowerShell", pwsh: "PowerShell 7", cmd: "CMD", wsl: "WSL", gitbash: "Git Bash", bash: "Bash", zsh: "Zsh", fish: "Fish", sh: "sh" };
  const key = normalizeShellKey(shell);
  return key ? labels[key] : shell?.trim().split(/[\\/]/).pop() || "Shell";
}

export function terminalNamingScope(session: TerminalSession): string {
  return JSON.stringify(session.projectId
    ? ["project", session.projectId, session.worktreeId ?? null]
    : ["environment", session.environmentType ?? "local", session.sshHostId ?? null, session.remotePath ?? session.cwd ?? null, session.worktreeId ?? null]);
}

export function validTitleNaming(value: TerminalSession["titleNaming"]): TerminalSession["titleNaming"] {
  if (!value || !["auto", "custom", "task"].includes(value.source)) return undefined;
  const hasOrdinal = value.base !== undefined || value.ordinal !== undefined;
  if ((value.source === "auto" || hasOrdinal) && (!value.base?.trim() || !Number.isSafeInteger(value.ordinal) || value.ordinal! <= 0)) return undefined;
  return value;
}

/** Call after all asynchronous admission checks, immediately before synchronous commit. */
export function assignTerminalTitle(
  session: TerminalSession,
  title: string | undefined,
  purpose: string,
  existing: TerminalSession[],
  projectName?: string,
): void {
  if (title !== undefined) {
    session.title = title;
    session.titleNaming = { source: "task" };
    return;
  }
  // Root project terminals use a stable project label. Linked Worktrees retain
  // their CLI/Shell purpose labels (and their independent naming scope).
  const base = !session.worktreeId && projectName?.trim() ? projectName.trim() : purpose;
  const scope = terminalNamingScope(session);
  let maximum = 0;
  for (const candidate of existing) {
    const naming = validTitleNaming(candidate.titleNaming);
    if (terminalNamingScope(candidate) === scope && naming?.base === base && Number.isSafeInteger(naming.ordinal) && naming.ordinal! > maximum) maximum = naming.ordinal!;
  }
  session.titleNaming = { source: "auto", base, ordinal: maximum + 1 };
  session.title = `${base} · ${maximum + 1}`;
}
