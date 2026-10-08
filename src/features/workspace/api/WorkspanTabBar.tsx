import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import type { CliToolIconKey } from "../../../shared/lib/cliTools";
import { WORKSPAN_DRAG_PREFIX } from "./dragInteraction";
import type { WorkspanTabBarPosition } from "../../../shared/lib/workspaceLayout";
import type { TerminalSession } from "../../../shared/types/index";

export type WorkspanContextOption = {
  key: string;
  project: string;
  worktree: string;
  count: number;
  running?: number;
  done?: number;
  failed?: number;
};
import type { ProjectWorkspanTabModel } from "../../terminal/api/terminalProjectSelection";
import { selectProjectTabGroups, resolveStatusWorkspanTarget, countVisibleTabStatuses } from "../../terminal/api/terminalProjectSelection";
import { displayedProjectTerminalIds } from "../../terminal/api/terminalProjectHide";
import { buildWorktreeBadges, buildGlobalWorktreeBadges, type TerminalWorktreeBadge } from "../../terminal/api/terminalWorktreeBadge";
import type { TerminalProjectOption, WorkspanTabGroupDescriptor } from "../../terminal/api/terminalProjectTabsModel";
import { describeWorkspanTabGroup, formatWorkspanGroupTitle } from "../../terminal/api/terminalProjectTabsModel";
import type { TabNotificationState } from "../../terminal/state";
import type { TerminalWorkspan } from "../../terminal/api/terminalWorkspan";
import { useI18n } from "../../../shared/i18n/index";
import { PULSING_TAB_STATES, TAB_NOTIFICATION_COLORS } from "../../terminal/api/terminalTabVisuals";
import { ChevronDown, Terminal, X } from "../../../shared/ui/icons";
import { VendorIcon, type VendorKey } from "../../../shared/ui/VendorIcon";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/popover";

export const WORKSPAN_TABBAR_END_DROP_ID = "workspan-tabbar:end";

export interface WorkspanTabModel {
  workspan: TerminalWorkspan;
  sessionIds: string[];
  closeSessionIds: string[];
  singleSession: TerminalSession | null;
  title: string;
  notification: TabNotificationState;
  vendor: VendorKey | null;
  cliToolIcon: CliToolIconKey | null;
  contextKey: string | null;
}

export interface WorkspanTabOverflowState {
  isOverflowing: boolean;
  hiddenIds: string[];
}

export interface WorkspanTabCloseTargets {
  leftSessionIds: string[];
  rightSessionIds: string[];
  otherSessionIds: string[];
}

interface WorkspanTabBarProps {
  position: WorkspanTabBarPosition;
  models: readonly ProjectWorkspanTabModel[];
  overflow: WorkspanTabOverflowState;
  listOpen: boolean;
  activeWorkspanId: string | null;
  hasScopedTerminalFilter: boolean;
  menuStyle: CSSProperties;
  tabBarRef: RefObject<HTMLDivElement | null>;
  tabScrollRef: RefObject<HTMLDivElement | null>;
  detachPreview: { left: number; visible: boolean };
  onToggleList: (open: boolean) => void;
  onActivate: (workspanId: string, sessionId?: string) => void;
  notifications: Record<string, TabNotificationState>;
  onClose: (model: WorkspanTabModel, anchor?: DOMRect) => void;
  onHideProjectTerminals: (ids: string[]) => void;
  contextOptions?: readonly TerminalProjectOption[];
  selectedProjectKey: string | null;
  onActivateProject: (key: string) => void;
  onRowChange: (signature: string) => void;
  renderTab: (model: ProjectWorkspanTabModel, closeTargets: WorkspanTabCloseTargets, badge: TerminalWorktreeBadge, activate: () => void) => ReactNode;
}

function WorkspanTabbarEndDropTarget({ disabled }: { disabled: boolean }) {
  const { setNodeRef } = useDroppable({ id: WORKSPAN_TABBAR_END_DROP_ID, disabled });
  return <div ref={setNodeRef} className="ui-workspan-end-drop min-w-0 flex-1" aria-hidden="true" />;
}

export function WorkspanTabBar({
  position,
  models,
  overflow,
  listOpen,
  activeWorkspanId,
  hasScopedTerminalFilter,
  menuStyle,
  tabBarRef,
  tabScrollRef,
  detachPreview,
  onToggleList,
  onActivate,
  notifications,
  onClose,
  onHideProjectTerminals,
  contextOptions = [],
  renderTab,
  selectedProjectKey, onActivateProject, onRowChange,
}: WorkspanTabBarProps) {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState<TabNotificationState | "all">("all");
  const labels = {
    root: t("terminal.context.badgeMain"), missing: t("terminal.context.badgeMissing"),
    cross: t("terminal.context.badgeCross"), mixed: t("terminal.context.badgeMixed"),
  };
  const badges = statusFilter === "all" ? buildWorktreeBadges(models, selectedProjectKey, labels)
    : buildGlobalWorktreeBadges(models, labels);
  const activateResult = (model: ProjectWorkspanTabModel) => {
    if (statusFilter === "all") onActivate(model.workspan.id);
    else {
      const target = resolveStatusWorkspanTarget(model, statusFilter, notifications);
      if (target) onActivate(target.workspanId, target.sessionId);
    }
  };
  const groups = selectProjectTabGroups(models, selectedProjectKey, statusFilter, notifications);
  const visibleModels = groups.flatMap((group) => group.models);
  const hiddenIds = new Set(overflow.hiddenIds);
  const hiddenGroups = groups.map(({ group, models: items }) => ({ group,
    models: items.filter(({ workspan }) => hiddenIds.has(workspan.id)) })).filter(({ models: items }) => items.length);
  const selectedOption = contextOptions.find((option) => option.key === selectedProjectKey);
  const statusSummary = statusFilter === "all" ? selectedOption ?? { running: 0, done: 0, failed: 0 }
    : countVisibleTabStatuses(models, notifications);
  const universe = models.flatMap((model) => describeWorkspanTabGroup(model.members).contexts);
  const groupLabel = (group: WorkspanTabGroupDescriptor) => formatWorkspanGroupTitle(group, universe, {
    root: t("terminal.context.rootDirectory"), missing: t("terminal.context.worktreeMissing"),
    cross: t("terminal.context.crossWorktree"), mixed: t("terminal.context.mixedWorkspan"),
  }, statusFilter !== "all");
  const rowSignature = JSON.stringify([selectedProjectKey, statusFilter, activeWorkspanId, statusSummary,
    groups.map(({ group, models: items }) => [group.key, groupLabel(group), items.map((model) => [model.workspan.id, model.title, model.vendor, model.cliToolIcon, model.notification, model.members.map((member) => [member.sessionId, notifications[member.sessionId] ?? "none"]), badges.get(model.workspan.id)?.label])])]);
  useEffect(() => onRowChange(rowSignature), [onRowChange, rowSignature]);

  return (
    <div
      ref={tabBarRef}
      className="ui-terminal-pane-chrome ui-workspan-tabbar relative flex min-h-16 shrink-0 flex-col px-1 py-0.5"
      data-workspan-tabbar-position={position}
    >
      <div
        className="ui-workspan-detach-insertion"
        data-visible={detachPreview.visible ? "true" : "false"}
        style={{ transform: `translate3d(${detachPreview.left}px, 0, 0)` }}
        aria-hidden="true"
      />
      <div className="ui-workspan-context-row flex h-7 min-h-7 min-w-0 items-center gap-1 overflow-x-auto px-1" role="tablist" aria-label={t("terminal.context.switcher")}>
        <div className="ui-workspan-status-filter inline-flex shrink-0 items-center gap-0.5">
          {(["all", "running", "done", "failed"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className="ui-workspan-status-filter-button"
              data-selected={statusFilter === filter ? "true" : "false"}
              aria-pressed={statusFilter === filter}
              aria-label={filter === "all" ? t("terminal.status.all") : t(`terminal.status.${filter}` as never)}
              onClick={() => setStatusFilter(filter)}
              title={filter === "all" ? t("terminal.status.all") : t(`terminal.status.${filter}` as never)}
            >
              {filter === "all" ? t("terminal.status.all") : filter === "running" ? "●" : filter === "done" ? "✓" : "!"}
            </button>
          ))}
        </div>
        {contextOptions.map((option) => {
          const projectLabel = contextOptions.some((other) => other.key !== option.key
            && other.project.toLocaleLowerCase() === option.project.toLocaleLowerCase())
            ? `${option.project} · ${option.projectId ?? option.key}` : option.project;
          const hideIds = displayedProjectTerminalIds(models, option.key, statusFilter, notifications);
          const hideLabel = t("terminal.context.hideDisplayedProjectTerminals", { project: option.project });
          return (
            <div key={option.key} className="ui-workspan-project-chip inline-flex h-6 max-w-[286px] shrink-0 items-center rounded-md" data-selected={option.key === selectedProjectKey ? "true" : "false"}>
              <button
                type="button"
                className="ui-workspan-context-button inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium"
                data-selected={option.key === selectedProjectKey ? "true" : "false"}
                role="tab"
                aria-selected={option.key === selectedProjectKey}
                aria-label={`${projectLabel}; ${t("terminal.status.running")}: ${option.running}; ${t("terminal.status.done")}: ${option.done}; ${t("terminal.status.failed")}: ${option.failed}; ${t("terminal.status.attention")}: ${option.attention}`}
                title={projectLabel}
                onClick={() => { setStatusFilter("all"); onActivateProject(option.key); }}
              >
                <span className="truncate">{projectLabel}</span>
                <span className="ui-workspan-context-status inline-flex shrink-0 items-center gap-0.5" title={t("terminal.status.summary")}>
                  {option.running ? <span className="ui-workspan-status-running">●</span> : null}
                  {option.done ? <span className="ui-workspan-status-done">✓</span> : null}
                  {option.failed ? <span className="ui-workspan-status-failed">!</span> : null}
                  {option.attention ? <span className="ui-workspan-status-attention">◉</span> : null}
                </span>
              </button>
              <button
                type="button"
                className="ui-focus-ring ui-workspan-project-hide inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                disabled={hideIds.length === 0}
                onClick={(event) => { event.stopPropagation(); onHideProjectTerminals(hideIds); }}
                aria-label={hideLabel}
                title={hideLabel}
              >
                <X size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="ui-workspan-groups-row">
        <div
          ref={tabScrollRef}
          className="ui-workspan-tab-scroll flex min-h-9 min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1"
          role="tablist"
          aria-label={t("terminal.workspan.tabList")}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.currentTarget.scrollLeft += event.deltaY;
            event.preventDefault();
          }}
        >
          {groups.map(({ group, models: items }) => (
            <div key={group.key} className="ui-workspan-project-group" role="group" aria-label={groupLabel(group)}>
              <div className="ui-workspan-group-tabs">
                <SortableContext items={items.map(({ workspan }) => `${WORKSPAN_DRAG_PREFIX}${workspan.id}`)} strategy={horizontalListSortingStrategy}>
                  {items.map((model) => {
                    // Menu targets follow this exact displayed project/global-status row.
                    // Keep each model's close scope, including mixed/scoped Workspans.
                    const index = visibleModels.indexOf(model);
                    return renderTab(model, {
                      leftSessionIds: visibleModels.slice(0, index).flatMap((item) => item.closeSessionIds),
                      rightSessionIds: visibleModels.slice(index + 1).flatMap((item) => item.closeSessionIds),
                      otherSessionIds: visibleModels.filter((item) => item !== model).flatMap((item) => item.closeSessionIds),
                    }, badges.get(model.workspan.id)!, () => activateResult(model));
                  })}
                </SortableContext>
              </div>
            </div>
          ))}
          {(statusSummary.running > 0 || statusSummary.done > 0 || statusSummary.failed > 0) && (
            <span className="ui-workspan-status-summary inline-flex shrink-0 items-center gap-2 px-2 text-[10px] font-medium" title={t("terminal.status.summary")}>
              {statusSummary.running > 0 && <span className="ui-workspan-status-count ui-workspan-status-running">◉ {statusSummary.running}</span>}
              {statusSummary.done > 0 && <span className="ui-workspan-status-count ui-workspan-status-done">✓ {statusSummary.done}</span>}
              {statusSummary.failed > 0 && <span className="ui-workspan-status-count ui-workspan-status-failed">! {statusSummary.failed}</span>}
            </span>
          )}
          <WorkspanTabbarEndDropTarget disabled={hasScopedTerminalFilter} />
        </div>
        <div className="ui-workspan-overflow-control">
          {overflow.isOverflowing && (
            <Popover open={listOpen} onOpenChange={onToggleList}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="ui-terminal-tab-list-button"
                  aria-label={t("terminal.workspan.openList")}
                  aria-expanded={listOpen}
                  title={t("terminal.workspan.list")}
                >
                  <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side={position === "bottom" ? "top" : "bottom"}
                align="end"
                collisionPadding={8}
                className="terminal-skin ui-terminal-tab-list-popover w-72 p-1.5"
                style={menuStyle}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <div className="ui-terminal-tab-list-title px-2 py-1 text-[11px] font-semibold">
                  {t("terminal.workspan.tabs")}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {hiddenGroups.map(({ group, models: items }) => (
                    <div key={group.key} className="ui-workspan-overflow-group">
                      {items.map((model) => (
                    <div
                      key={model.workspan.id}
                      className="ui-interactive ui-terminal-tab-list-item flex w-full items-center gap-1 rounded-lg px-1 py-1 text-xs text-on-surface-variant"
                      data-selected={model.workspan.id === activeWorkspanId ? "true" : "false"}
                    >
                      <button
                        type="button"
                        className="ui-focus-ring ui-workspan-overflow-target flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left"
                        style={{ "--worktree-identity-color": badges.get(model.workspan.id)?.color } as CSSProperties}
                        onClick={() => {
                          activateResult(model);
                          onToggleList(false);
                        }}
                        title={[model.title, badges.get(model.workspan.id)?.label, ...model.members.map((member) =>
                          [member.project, member.worktreeName ?? t("terminal.context.rootDirectory"), member.branch,
                            member.worktreePath, member.environmentType, member.sshHostId].filter(Boolean).join(" / ")),
                          model.mixedProject ? t("terminal.context.mixedCloseHint") : null].filter(Boolean).join("\n")}
                      >
                        <span
                          className="ui-tab-runtime-dot h-2 w-2 shrink-0 rounded-full"
                          data-pulsing={PULSING_TAB_STATES.has(model.notification) ? "true" : "false"}
                          style={{ backgroundColor: TAB_NOTIFICATION_COLORS[model.notification], color: TAB_NOTIFICATION_COLORS[model.notification] }}
                          aria-hidden="true"
                        />
                        {model.vendor ? (
                          <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                            <VendorIcon vendor={model.vendor} size={14} />
                          </span>
                        ) : (
                          <Terminal size={14} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
                        )}
                        <span className="ui-workspan-overflow-text flex min-w-0 flex-1 flex-col items-start">
                          <span className="ui-workspan-worktree-badge">{badges.get(model.workspan.id)?.label}</span>
                          <span className="w-full truncate">{model.title}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="ui-focus-ring ui-terminal-tab-close inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleList(false);
                          onClose(model, event.currentTarget.getBoundingClientRect());
                        }}
                        aria-label={t("terminal.workspan.close", { title: model.title })}
                        title={t("terminal.workspan.close", { title: model.title })}
                      >
                        <X size={13} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                      ))}
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}
