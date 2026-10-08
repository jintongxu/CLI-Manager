import { getCompactWorktreeLabel } from "../../projects/api/worktreeMetadata";
import type { WorkspanProjectGroup } from "./terminalProjectTabsModel";
import type { ProjectWorkspanTabModel } from "./terminalProjectSelection";

export interface WorktreeBadgeLabels {
  root: string;
  missing: string;
  cross: string;
  mixed: string;
}
export interface TerminalWorktreeBadge {
  label: string;
  identity: string;
  color: string;
}

/** Identity color is supplementary, never notification/selection state. */
export function worktreeIdentityColor(identity: string): string {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 46% 52%)`;
}

/** Resolve against the entire supplied project, before status filtering/overflow.
 * Reserved root/missing/split labels also participate in collision resolution.
 */
export function buildWorktreeBadges(
  models: readonly ProjectWorkspanTabModel[],
  projectKey: string | null,
  labels: WorktreeBadgeLabels,
): Map<string, TerminalWorktreeBadge> {
  const groups = new Map<string, WorkspanProjectGroup>();
  for (const model of models) {
    const group = model.projectMemberships.find((item) => item.projectKey === projectKey)?.group;
    if (group) groups.set(group.key, group);
  }
  const rows = [...groups.values()].filter((group) => group.kind === "worktree")
    .map((group) => ({ id: group.worktreeId ?? group.key, name: group.worktreeName ?? labels.missing }));
  const used = new Set([labels.root, labels.missing, labels.cross, labels.mixed].map((label) => label.toLowerCase()));
  const groupLabels = new Map<string, string>();
  // Stable key order means rendered/drag order cannot change collision fallbacks.
  for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    let label = group.kind === "root" ? labels.root : group.kind === "cross-worktree" ? labels.cross
      : group.kind === "mixed-project" ? labels.mixed : labels.missing;
    if (group.kind === "worktree" || group.kind === "missing-worktree") {
      const id = group.worktreeId ?? group.key;
      const base = group.kind === "worktree" ? getCompactWorktreeLabel({ id, name: group.worktreeName ?? labels.missing }, rows) : labels.missing;
      label = base;
      const soleMissing = group.kind === "missing-worktree"
        && [...groups.values()].filter((item) => item.kind === "missing-worktree").length === 1;
      if (!soleMissing) {
        if (used.has(label.toLowerCase())) label = `${base} · ${id}`;
        let ordinal = 2;
        while (used.has(label.toLowerCase())) label = `${base} · ${id} · ${ordinal++}`;
      }
      used.add(label.toLowerCase());
    }
    groupLabels.set(group.key, label);
  }
  const result = new Map<string, TerminalWorktreeBadge>();
  for (const model of models) {
    const group = model.projectMemberships.find((item) => item.projectKey === projectKey)?.group;
    if (!group) continue;
    // Include all split members, not title, group label, status or selected project.
    const contexts = [...new Set(model.members.map((member) => JSON.stringify([member.projectKey, member.worktreeId ?? null])))].sort();
    const identity = JSON.stringify(contexts);
    result.set(model.workspan.id, { label: groupLabels.get(group.key)!, identity, color: worktreeIdentityColor(identity) });
  }
  return result;
}


/** Global results identify all contexts before filtering/overflow. Resolve both
 * individual contexts and complete mixed labels: literal names may contain the
 * same separators/ID suffixes as generated labels. Allocation is identity-ordered.
 */
export function buildGlobalWorktreeBadges(models: readonly ProjectWorkspanTabModel[], labels: WorktreeBadgeLabels) {
  const projectNames = new Map<string, string>();
  const worktrees = new Map<string, Array<{ id: string; name: string }>>();
  for (const model of models) for (const member of model.members) {
    projectNames.set(member.projectKey, member.project);
    if (member.worktreeId && member.worktreeKind === "worktree") {
      const rows = worktrees.get(member.projectKey) ?? [];
      if (!rows.some((row) => row.id === member.worktreeId)) rows.push({ id: member.worktreeId, name: member.worktreeName ?? labels.missing });
      worktrees.set(member.projectKey, rows);
    }
  }
  const allocate = (bases: Map<string, string>) => {
    const resolved = new Map<string, string>();
    const used = new Set<string>();
    for (const identity of [...bases.keys()].sort()) {
      const base = bases.get(identity)!;
      let label = base;
      if (used.has(label.toLowerCase())) label = `${base} · ${identity}`;
      let ordinal = 2;
      while (used.has(label.toLowerCase())) label = `${base} · ${identity} · ${ordinal++}`;
      used.add(label.toLowerCase());
      resolved.set(identity, label);
    }
    return resolved;
  };
  const contextBases = new Map<string, string>();
  const modelContexts = new Map<string, string[]>();
  for (const model of models) {
    const contexts = new Set<string>();
    for (const member of model.members) {
      const sameName = [...projectNames.values()].filter((name) => name.toLowerCase() === member.project.toLowerCase()).length > 1;
      const project = sameName ? `${member.project} · ${member.projectKey}` : member.project;
      let tree = !member.worktreeId ? labels.root : member.worktreeKind === "worktree"
        ? getCompactWorktreeLabel({ id: member.worktreeId, name: member.worktreeName ?? labels.missing }, worktrees.get(member.projectKey) ?? [])
        : `${labels.missing} · ${member.worktreeId}`;
      if (member.worktreeId && member.worktreeKind === "worktree"
        && [labels.root, labels.missing, labels.cross, labels.mixed].some((label) => label.toLowerCase() === tree.toLowerCase())) {
        tree = `${tree} · ${member.worktreeId}`;
      }
      const key = JSON.stringify([member.projectKey, member.worktreeId ?? null]);
      contexts.add(key);
      contextBases.set(key, `${project} / ${tree}`);
    }
    modelContexts.set(model.workspan.id, [...contexts].sort());
  }
  const contextLabels = allocate(contextBases);
  const badgeBases = new Map<string, string>();
  for (const keys of modelContexts.values()) {
    badgeBases.set(JSON.stringify(keys), keys.map((key) => contextLabels.get(key)).join(" + "));
  }
  const badgeLabels = allocate(badgeBases);
  const result = new Map<string, TerminalWorktreeBadge>();
  for (const [id, keys] of modelContexts) {
    const identity = JSON.stringify(keys);
    result.set(id, { label: badgeLabels.get(identity)!, identity, color: worktreeIdentityColor(identity) });
  }
  return result;
}
