import type { LucideIcon } from "lucide-react";
import {
  closestCenter, pointerWithin, type CollisionDetection, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { type SplitTerminalOptions, type TabNotificationState } from "../state";
import { useSshHostStore } from "../../remote/api/sshHostStore";
import { type TranslationKey } from "../../../shared/i18n/index";
import { WORKSPAN_DRAG_PREFIX } from "../../workspace/api/dragInteraction";
import type { TerminalPaneDropEdge, TerminalPaneSplitDirection } from "../api/terminalPaneTree";
import { resolvePaneDropEdgeFromPoint } from "../api/terminalPaneTree";
import { resolveProjectPath } from "../../projects/api/groupPath";
import { resolveProjectStartupCommand } from "../../projects/api/projectStartupCommand";
import { resolveCliToolHistorySourceId, resolveCliToolIconKey, type CliToolIconKey } from "../../../shared/lib/cliTools";
import { parseProjectEnvVars } from "../../providers/api/providerSwitching";
import { inferVendor, type VendorKey } from "../../../shared/ui/VendorIcon";
import type { Group, HistorySourceFilter, Project, TerminalScope, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import { WORKSPAN_TABBAR_END_DROP_ID, type WorkspanContextOption } from "../../workspace/api/WorkspanTabBar";
import { getCompactWorktreeLabel, getWorktreeDisplayName } from "../../projects/api/worktreeMetadata";

// Explicit pure-model exports for the project-row consumer. Legacy context keys
// remain environment/worktree-specific until the UI lane migrates its callers.
export {
  buildTerminalProjectOptions, getTerminalProjectKey, resolveTerminalProjectMembership,
  resolveProjectWorkspanTarget, groupProjectWorkspanModels,
} from "../api/terminalProjectTabsModel";
export type {
  TerminalProjectOption, TerminalProjectMembership, WorkspanProjectMembership,
  WorkspanProjectGroup, ProjectWorkspanTarget,
} from "../api/terminalProjectTabsModel";

export const normalizeTabMenuHex = (value: string | undefined, fallback: string) => (
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
);

export const TERMINAL_PANEL_SEMANTIC_COLORS = {
  dark: {
    fg: "#ECECEC",
    dim: "#9CA0A6",
    green: "#3DD68C",
    yellow: "#E5C453",
    red: "#F25E5E",
    magenta: "#C77DBB",
    cyan: "#5AC8E0",
    blue: "#5B8DEF",
  },
  light: {
    fg: "#1F2937",
    dim: "#64748B",
    green: "#15803D",
    yellow: "#B45309",
    red: "#DC2626",
    magenta: "#9333EA",
    cyan: "#0891B2",
    blue: "#2563EB",
  },
} as const;

export const tabMenuHexToRgba = (value: string | undefined, alpha: number, fallback: string) => {
  const normalized = normalizeTabMenuHex(value, "");
  if (!normalized) return fallback;
  const hex = normalized.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const TAB_NOTIFICATION_LABELS: Record<TabNotificationState, TranslationKey> = {
  none: "terminal.status.none",
  running: "terminal.status.running",
  attention: "terminal.status.attention",
  done: "terminal.status.done",
  failed: "terminal.status.failed",
};

export const PANE_DROP_PREFIX = "pane-drop:";

export const PANE_CENTER_DROP_PREFIX = "pane-center:";

export const PANE_EDGE_DROP_PREFIX = "pane-edge:";

export const WORKSPAN_SPLIT_ACTIVATION_RATIO = 0.08;

export const PANE_DROP_EDGES: TerminalPaneDropEdge[] = ["left", "right", "top", "bottom"];

export const WORKSPAN_NOTIFICATION_PRIORITY: Record<TabNotificationState, number> = {
  none: 0,
  done: 1,
  running: 2,
  failed: 3,
  attention: 4,
};

export const SPLIT_PICKER_OUTSIDE_GUARD_MS = 250;

export type SplitPickerAnchor = DOMRect | { x: number; y: number };

export type SplitPickerAlign = "start" | "end";

export type SplitPickerState = {
  sessionId: string;
  direction: TerminalPaneSplitDirection;
  x: number;
  y: number;
  align: SplitPickerAlign;
} | null;

export type TerminalCloseConfirmState = {
  sessionIds: string[];
  x: number;
  y: number;
  align: SplitPickerAlign;
} | null;

export type PaneDropTarget =
  | { type: "center"; paneId: string }
  | { type: "edge"; paneId: string; edge: TerminalPaneDropEdge };

export type PaneDropPreview = { paneId: string; edge: TerminalPaneDropEdge } | null;

export const TERMINAL_TAB_HOVER_DELAY_MS = 260;

export const TERMINAL_TAB_HOVER_CLOSE_DELAY_MS = 320;

export const TERMINAL_TAB_HOVER_CARD_WIDTH = 320;

export const TERMINAL_TAB_HOVER_CARD_ESTIMATED_HEIGHT = 190;

export const SSH_CONNECTION_STATE_COLORS: Record<NonNullable<TerminalSession["connectionState"]>, string> = {
  connecting: "#60a5fa",
  authenticating: "#f59e0b",
  connected: "#22c55e",
  disconnected: "#94a3b8",
  failed: "#ef4444",
};

export interface TerminalTabContextLabels {
  unboundProject: string;
  missingWorktree: string;
  defaultShell: string;
}

export interface TerminalTabContext {
  project: string;
  projectShort: string;
  worktree?: string;
  worktreeFull?: string;
  branch?: string;
  environment: string;
  projectColor: string;
  unresolvedWorktree: boolean;
}

export interface TerminalTabHoverInfo {
  name: string;
  cli: string;
  cliVendor: VendorKey | null;
  shell: string;
  project: string;
  worktree?: string;
  branch?: string;
  environment: string;
  path: string;
  sessionId: string;
  sshHost?: string;
  connectionState?: TerminalSession["connectionState"];
  disconnectReason?: TerminalSession["disconnectReason"];
}

export interface TerminalTabHoverRow {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  vendor?: VendorKey | null;
  copyValue?: string;
  copyLabel?: string;
}

export function isTerminalPaneDropEdge(value: string): value is TerminalPaneDropEdge {
  return PANE_DROP_EDGES.includes(value as TerminalPaneDropEdge);
}

export function getWorkspanNotification(
  sessionIds: string[],
  notifications: Record<string, TabNotificationState>
): TabNotificationState {
  let resolved: TabNotificationState = "none";
  for (const sessionId of sessionIds) {
    const next = notifications[sessionId] ?? "none";
    if (WORKSPAN_NOTIFICATION_PRIORITY[next] > WORKSPAN_NOTIFICATION_PRIORITY[resolved]) resolved = next;
  }
  return resolved;
}

export function parsePaneDropTarget(id: string): PaneDropTarget | null {
  if (id.startsWith(PANE_CENTER_DROP_PREFIX)) return { type: "center", paneId: id.slice(PANE_CENTER_DROP_PREFIX.length) };
  if (id.startsWith(PANE_DROP_PREFIX)) return { type: "center", paneId: id.slice(PANE_DROP_PREFIX.length) };
  if (!id.startsWith(PANE_EDGE_DROP_PREFIX)) return null;

  const payload = id.slice(PANE_EDGE_DROP_PREFIX.length);
  const [paneId, edge] = payload.split(":");
  if (!paneId || !edge || !isTerminalPaneDropEdge(edge)) return null;
  return { type: "edge", paneId, edge };
}

export function isPaneDropCollisionId(id: string): boolean {
  return id.startsWith(PANE_EDGE_DROP_PREFIX) || id.startsWith(PANE_CENTER_DROP_PREFIX) || id.startsWith(PANE_DROP_PREFIX);
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatCliToolLabel(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "Terminal";

  const normalized = trimmed.toLowerCase();
  if (normalized.includes("claude")) return "Claude";
  if (normalized.includes("codex") || normalized === "code") return "Codex";
  return trimmed;
}

export function formatShellLabel(value: string | null | undefined, fallback = "Default shell"): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  const normalized = trimmed.toLowerCase();
  if (normalized === "powershell" || normalized === "powershell.exe") return "PowerShell";
  if (normalized === "pwsh" || normalized === "pwsh.exe") return "PowerShell 7";
  if (normalized === "cmd") return "CMD";
  if (normalized === "wsl") return "WSL";
  if (normalized === "git-bash" || normalized === "git bash" || normalized === "gitbash") return "Git Bash";
  if (normalized === "bash") return "Bash";
  if (normalized === "zsh") return "Zsh";
  if (normalized === "fish") return "Fish";
  if (normalized === "sh") return "sh";
  return trimmed;
}

export function formatSessionIdPreview(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

export function getTerminalTabScopeKey(session: TerminalSession): string {
  return [session.projectId ?? "unbound", session.worktreeId ?? "project-root", session.environmentType ?? "local", session.sshHostId ?? ""].join(":");
}

export function buildTerminalContextOptions(
  sessionGroups: Array<{ sessionIds: string[] }>,
  sessions: TerminalSession[],
  projectById: Map<string, Project>,
  worktrees: WorktreeRecord[],
  labels: TerminalTabContextLabels,
  notifications: Record<string, TabNotificationState> = {},
): WorkspanContextOption[] {
  const options = new Map<string, WorkspanContextOption>();
  const seenSessionIds = new Set<string>();
  for (const group of sessionGroups) for (const sessionId of group.sessionIds) {
    if (seenSessionIds.has(sessionId)) continue;
    seenSessionIds.add(sessionId);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) continue;
    const key = getTerminalTabScopeKey(session);
    const existing = options.get(key);
    if (existing) {
      existing.count += 1;
      const status = notifications[session.id] ?? "none";
      if (status === "running") existing.running = (existing.running ?? 0) + 1;
      if (status === "done") existing.done = (existing.done ?? 0) + 1;
      if (status === "failed") existing.failed = (existing.failed ?? 0) + 1;
      continue;
    }
    const project = session.projectId ? projectById.get(session.projectId) : undefined;
    const worktree = session.worktreeId ? worktrees.find((item) => item.id === session.worktreeId) : null;
    const context = buildTerminalTabContext(session, project, worktree, labels, session.projectId ? worktrees.filter((item) => item.project_id === session.projectId && item.status === "active") : []);
    const status = notifications[session.id] ?? "none";
    options.set(key, {
      key, project: context.project, worktree: context.worktreeFull ?? labels.missingWorktree, count: 1,
      running: status === "running" ? 1 : 0, done: status === "done" ? 1 : 0, failed: status === "failed" ? 1 : 0,
    });
  }
  return [...options.values()];
}

export function buildTerminalTabDisplayTitle(
  session: TerminalSession,
  _project?: Project,
  _ordinal = 1,
  _siblingCount = 1,
): string {
  return session.title;
}

function resolveProjectColor(projectKey: string): string {
  let hash = 0;
  for (const character of projectKey) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 48%)`;
}

function getProjectShortName(projectName: string): string {
  const words = projectName.split(/[\s_-]+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return projectName.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase() || "?";
}

function getWorktreeName(worktree: WorktreeRecord): string {
  return getWorktreeDisplayName(worktree).trim() || worktree.name.trim() || "Worktree";
}

export { getCompactWorktreeLabel } from "../../projects/api/worktreeMetadata";

export function buildTerminalTabContext(
  session: TerminalSession,
  project?: Project,
  worktree?: WorktreeRecord | null,
  labels: TerminalTabContextLabels = {
    unboundProject: "Unbound project",
    missingWorktree: "Worktree missing",
    defaultShell: "Default shell",
  },
  siblingWorktrees: WorktreeRecord[] = [],
): TerminalTabContext {
  const projectName = project?.name.trim() || labels.unboundProject;
  const activeWorktree = worktree?.status === "active" ? worktree : null;
  const unresolvedWorktree = Boolean(session.worktreeId && !activeWorktree);
  return {
    project: projectName,
    projectShort: getProjectShortName(projectName),
    worktree: activeWorktree ? getCompactWorktreeLabel(activeWorktree, siblingWorktrees) : unresolvedWorktree ? labels.missingWorktree : undefined,
    worktreeFull: activeWorktree ? getWorktreeName(activeWorktree) : undefined,
    branch: activeWorktree?.branch?.trim() || undefined,
    environment: session.environmentType === "ssh"
      ? "SSH"
      : formatShellLabel(session.shell ?? project?.shell, labels.defaultShell),
    projectColor: resolveProjectColor(project?.id || projectName),
    unresolvedWorktree,
  };
}

export function buildTerminalTabHoverInfo(
  session: TerminalSession,
  project?: Project,
  worktree?: WorktreeRecord | null,
  labels?: TerminalTabContextLabels,
): TerminalTabHoverInfo {
  const contextLabels = labels ?? {
    unboundProject: "Unbound project",
    missingWorktree: "Worktree missing",
    defaultShell: "Default shell",
  };
  const context = buildTerminalTabContext(session, project, worktree, contextLabels);
  if (session.kind === "subagent-transcript") {
    return {
      name: session.title.trim() || "Terminal",
      cli: "Subagent",
      cliVendor: null,
      shell: "Transcript",
      project: context.project,
      worktree: context.worktree,
      branch: context.branch,
      environment: context.environment,
      path: session.cwd?.trim() || project?.path.trim() || "-",
      sessionId: session.cliSessionId?.trim() || session.id,
    };
  }
  if (session.kind === "synced-history") {
    return {
      name: session.title.trim() || "同步记录",
      cli: "Synced History",
      cliVendor: null,
      shell: formatShellLabel(session.shell ?? project?.shell, contextLabels.defaultShell),
      project: project?.name.trim() || session.syncedHistory?.title || context.project,
      worktree: context.worktree,
      branch: context.branch,
      environment: context.environment,
      path: session.syncedHistory?.cwd || session.cwd?.trim() || project?.path.trim() || "-",
      sessionId: session.syncedHistory?.key || session.id,
    };
  }
  const sshHost = session.environmentType === "ssh"
    ? useSshHostStore.getState().hosts.find((host) => host.id === session.sshHostId)
    : undefined;
  return {
    name: session.title.trim() || "Terminal",
    cli: formatCliToolLabel(project?.cli_tool),
    cliVendor: inferVendor(project?.cli_tool) ?? inferSessionVendor(session),
    shell: session.environmentType === "ssh" ? "SSH" : formatShellLabel(session.shell ?? project?.shell, contextLabels.defaultShell),
    project: context.project,
    worktree: context.worktree,
    branch: context.branch,
    environment: context.environment,
    path: session.remotePath?.trim() || session.cwd?.trim() || project?.remote_path.trim() || project?.path.trim() || "-",
    sessionId: session.cliSessionId?.trim() || session.id,
    sshHost: sshHost?.name || sshHost?.config_alias || sshHost?.host || session.sshHostId,
    connectionState: session.connectionState,
    disconnectReason: session.disconnectReason,
  };
}

export const terminalTabCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const edgeCollision = pointerCollisions.find((collision) => String(collision.id).startsWith(PANE_EDGE_DROP_PREFIX));
  if (edgeCollision) return [edgeCollision];

  const centerCollision = pointerCollisions.find((collision) => String(collision.id).startsWith(PANE_CENTER_DROP_PREFIX));
  if (centerCollision) return [centerCollision];

  if (String(args.active.id).startsWith(WORKSPAN_DRAG_PREFIX)) {
    const workspanTabCollision = pointerCollisions.find((collision) => String(collision.id).startsWith(WORKSPAN_DRAG_PREFIX));
    return workspanTabCollision ? [workspanTabCollision] : [];
  }

  const workspanTabCollision = pointerCollisions.find((collision) => String(collision.id).startsWith(WORKSPAN_DRAG_PREFIX));
  if (workspanTabCollision) return [workspanTabCollision];

  const workspanTabbarEndCollision = pointerCollisions.find((collision) => collision.id === WORKSPAN_TABBAR_END_DROP_ID);
  if (workspanTabbarEndCollision) return [workspanTabbarEndCollision];

  const closestCollisions = closestCenter(args);
  const tabCollision = closestCollisions.find((collision) => {
    const id = String(collision.id);
    return !isPaneDropCollisionId(id)
      && !id.startsWith(WORKSPAN_DRAG_PREFIX)
      && id !== WORKSPAN_TABBAR_END_DROP_ID;
  });
  if (tabCollision) return [tabCollision];

  const paneBarCollision = pointerCollisions.find((collision) => String(collision.id).startsWith(PANE_DROP_PREFIX));
  return paneBarCollision ? [paneBarCollision] : closestCollisions;
};

export function resolveWorkspanDropEdge(
  event: DragOverEvent | DragEndEvent,
  dropTarget: PaneDropTarget
): TerminalPaneDropEdge | null {
  if (dropTarget.type === "edge") return dropTarget.edge;
  if (!event.over) return null;

  const activatorEvent = event.activatorEvent;
  if (
    !("clientX" in activatorEvent)
    || !("clientY" in activatorEvent)
    || typeof activatorEvent.clientX !== "number"
    || typeof activatorEvent.clientY !== "number"
  ) {
    return null;
  }

  return resolvePaneDropEdgeFromPoint(
    activatorEvent.clientX + event.delta.x,
    activatorEvent.clientY + event.delta.y,
    event.over.rect,
    WORKSPAN_SPLIT_ACTIVATION_RATIO
  );
}

export function resolveHistorySourceFilter(cliTool: string | null | undefined): HistorySourceFilter {
  return resolveCliToolHistorySourceId(cliTool) ?? "all";
}

export function inferSessionVendor(session: TerminalSession): VendorKey | null {
  return inferVendor(`${session.startupCmd ?? ""} ${session.title}`);
}

export function inferSessionCliToolIcon(session: TerminalSession, project?: Project): CliToolIconKey | null {
  return (
    resolveCliToolIconKey(project?.cli_tool)
    ?? resolveCliToolIconKey(session.startupCmd)
    ?? resolveCliToolIconKey(session.title)
  );
}

export function buildProjectSplitOptions(project: Project, groups: Group[]): SplitTerminalOptions {
  const cmd = resolveProjectStartupCommand(project);
  const shell = project.shell && project.shell !== "powershell" ? project.shell : undefined;

  return {
    projectId: project.id,
    cwd: resolveProjectPath(project, groups),
    title: project.name,
    startupCmd: cmd,
    envVars: parseProjectEnvVars(project),
    shell,
  };
}

export interface TerminalTabsProps {
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  projectScopedTerminalViewEnabled?: boolean;
  terminalScope?: TerminalScope;
  onOpenProviderSettings?: () => void;
  onOpenHistorySettings?: () => void;
}
