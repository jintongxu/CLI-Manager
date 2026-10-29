import { resolveProjectPath } from "../api/groupPath";
import type { Group, Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";

/** Display only: never use these strings for selection, grouping, paths or persistence. */
export function projectDisplayPath(project: Project, groups: Group[] = []): string {
  return project.environment_type === "ssh" ? project.remote_path || resolveProjectPath(project, groups) : resolveProjectPath(project, groups);
}

function pathParts(path: string): string[] {
  // Keep drive/UNC/SSH authority segments; normalize separators, not case or identity.
  return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
}

function shortId(id: string, ids: string[]): string {
  let length = Math.min(6, id.length);
  while (length < id.length && ids.some((other) => other !== id && other.startsWith(id.slice(0, length)))) length++;
  return id.slice(0, length);
}

export function projectDisplayLabels(projects: readonly Project[], groups: Group[] = []): Map<string, string> {
  const unique = [...new Map(projects.map((project) => [project.id, project])).values()];
  const result = new Map<string, string>();
  for (const project of unique) {
    const peers = unique.filter((other) => other.name === project.name);
    if (peers.length === 1) { result.set(project.id, project.name); continue; }
    const parents = (item: Project) => pathParts(projectDisplayPath(item, groups)).slice(0, -1);
    const parts = parents(project);
    let suffix = "";
    for (let length = 1; length <= parts.length; length++) {
      const candidate = parts.slice(-length).join("/");
      if (peers.every((other) => other.id === project.id || parents(other).slice(-length).join("/") !== candidate)) {
        suffix = candidate;
        break;
      }
    }
    // Identical/missing parent paths cannot disambiguate; IDs remain stable across sorting/filtering.
    if (!suffix) suffix = [parts.join("/"), shortId(project.id, peers.map((item) => item.id))].filter(Boolean).join(" · ");
    result.set(project.id, `${project.name} · ${suffix}`);
  }
  return result;
}

export function sessionDisplayLabels(sessions: readonly TerminalSession[], terminalType: string): Map<string, string> {
  const type = (session: TerminalSession) => session.cliTool || terminalType;
  return new Map(sessions.map((session) => {
    const peers = sessions.filter((other) => other.title === session.title);
    if (peers.length === 1) return [session.id, session.title];
    const sameType = peers.filter((other) => type(other) === type(session));
    const suffix = sameType.length > 1 ? ` · ${shortId(session.id, sameType.map((other) => other.id))}` : "";
    return [session.id, `${session.title} · ${type(session)}${suffix}`];
  }));
}

export function projectDisplayTooltip(project: Project, label: string, status: string, groups: Group[] = []): string {
  return [...new Set([label, project.name, projectDisplayPath(project, groups), status].filter(Boolean))].join("\n");
}

export function worktreeDisplayTooltip(worktree: WorktreeRecord, label: string, status: string): string {
  return [...new Set([label, worktree.name, worktree.description, worktree.branch, worktree.path, status].filter(Boolean))].join("\n");
}

export function sessionDisplayTooltip(session: TerminalSession, label: string, status: string): string {
  const path = session.environmentType === "ssh" ? session.remotePath || session.cwd : session.cwd;
  return [...new Set([label, session.title, path, status].filter(Boolean))].join("\n");
}
