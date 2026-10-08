import { describeWorkspanTabGroup, formatWorkspanGroupTitle } from "./terminalProjectTabsModel";
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

/** Only supplied, scope-bounded members contribute. Tokens never derive from display names. */
function buildBadges(models: readonly ProjectWorkspanTabModel[], labels: WorktreeBadgeLabels, showProject: boolean) {
  const descriptors = models.map((model) => describeWorkspanTabGroup(model.members.map((member) => ({
    ...member, worktreeName: member.worktreeLabel || member.worktreeId,
  }))));
  const universe = descriptors.flatMap((group) => group.contexts);
  const result = new Map<string, TerminalWorktreeBadge>();
  models.forEach((model, index) => {
    const group = descriptors[index];
    // Identity remains independent of alias, locale, status and project selection.
    const contexts = [...new Set(model.members.map((member) => JSON.stringify([member.projectKey, member.worktreeId ?? null])))].sort();
    const identity = JSON.stringify(contexts);
    result.set(model.workspan.id, {
      label: formatWorkspanGroupTitle(group, universe, { ...labels, cross: "", mixed: "" },
        showProject || group.contexts.length > 1).split("\n").join(" + "),
      identity, color: worktreeIdentityColor(identity),
    });
  });
  // Flattening to the fixed purpose row can collide with literal separators in
  // project names. Reserve all bases before adding stable identity suffixes.
  const bases = [...result.values()];
  const reserved = new Set(bases.map((badge) => badge.label.toLocaleLowerCase()));
  const resolved = new Map<string, string>();
  for (const badge of [...bases].sort((a, b) => a.identity.localeCompare(b.identity))) {
    if (resolved.has(badge.identity)) continue;
    let label = badge.label;
    if (bases.some((other) => other.identity !== badge.identity && other.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      label = `${badge.label} · ${badge.identity}`;
      while (reserved.has(label.toLocaleLowerCase())) label += ` · ${badge.identity}`;
    }
    reserved.add(label.toLocaleLowerCase());
    resolved.set(badge.identity, label);
  }
  for (const badge of result.values()) badge.label = resolved.get(badge.identity)!;
  return result;
}

/** All deduplicated member contexts remain visible, including mixed-project splits.
 * Supply the unfiltered project models so status/overflow cannot alter disambiguation.
 */
export function buildWorktreeBadges(
  models: readonly ProjectWorkspanTabModel[], projectKey: string | null, labels: WorktreeBadgeLabels,
): Map<string, TerminalWorktreeBadge> {
  return buildBadges(models.filter((model) => model.projectMemberships.some((item) => item.projectKey === projectKey)), labels, false);
}

/** Global and Pane labels always include project name and the complete persistent token. */
export function buildGlobalWorktreeBadges(models: readonly ProjectWorkspanTabModel[], labels: WorktreeBadgeLabels) {
  return buildBadges(models, labels, true);
}
