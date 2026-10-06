import { useState, type CSSProperties, type ReactNode, type RefObject } from "react";
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
import type { TabNotificationState } from "../../terminal/state";
import type { TerminalWorkspan } from "../../terminal/api/terminalWorkspan";
import { useI18n } from "../../../shared/i18n/index";
import { PULSING_TAB_STATES, TAB_NOTIFICATION_COLORS } from "../../terminal/api/terminalTabVisuals";
import { ChevronDown, Plus, Terminal, X } from "../../../shared/ui/icons";
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

interface WorkspanTabBarProps {
  position: WorkspanTabBarPosition;
  models: readonly WorkspanTabModel[];
  overflow: WorkspanTabOverflowState;
  listOpen: boolean;
  activeWorkspanId: string | null;
  hasScopedTerminalFilter: boolean;
  menuStyle: CSSProperties;
  tabBarRef: RefObject<HTMLDivElement | null>;
  tabScrollRef: RefObject<HTMLDivElement | null>;
  detachPreview: { left: number; visible: boolean };
  onToggleList: (open: boolean) => void;
  onActivate: (workspanId: string) => void;
  onNewTab: (sessionId?: string) => void;
  notifications: Record<string, TabNotificationState>;
  onClose: (model: WorkspanTabModel, anchor?: DOMRect) => void;
  contextOptions?: readonly WorkspanContextOption[];
  renderTab: (model: WorkspanTabModel, index: number) => ReactNode;
}

function WorkspanTabbarEndDropTarget({ disabled }: { disabled: boolean }) {
  const { setNodeRef } = useDroppable({ id: WORKSPAN_TABBAR_END_DROP_ID, disabled });
  return <div ref={setNodeRef} className="h-full min-w-0 flex-1" aria-hidden="true" />;
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
  onNewTab,
  notifications,
  onClose,
  contextOptions = [],
  renderTab,
}: WorkspanTabBarProps) {
  const { t } = useI18n();
  const activeModel = models.find((model) => model.workspan.id === activeWorkspanId);
  const activeContextKey = activeModel?.contextKey ?? contextOptions[0]?.key ?? null;
  const [statusFilter, setStatusFilter] = useState<TabNotificationState | "all">("all");
  const contextModels = activeContextKey ? models.filter((model) => model.contextKey === activeContextKey) : models;
  const visibleModels = statusFilter === "all"
    ? contextModels
    : contextModels.filter((model) => model.sessionIds.some((sessionId) => (notifications[sessionId] ?? "none") === statusFilter));
  const hiddenIds = new Set(overflow.hiddenIds);
  const hiddenModels = visibleModels.filter(({ workspan }) => hiddenIds.has(workspan.id));
  const statusSummary = visibleModels.reduce((summary, model) => {
    for (const sessionId of model.sessionIds) {
      const status = notifications[sessionId] ?? "none";
      if (status === "running") summary.running += 1;
      if (status === "done") summary.done += 1;
      if (status === "failed") summary.failed += 1;
    }
    return summary;
  }, { running: 0, done: 0, failed: 0 });

  return (
    <div
      ref={tabBarRef}
      className="ui-terminal-pane-chrome ui-workspan-tabbar relative flex min-h-16 shrink-0 flex-col px-1 py-0.5"
      data-workspan-tabbar-position={position}
    >
      <div
        className="ui-workspan-detach-insertion"
        data-visible={detachPreview.visible ? "true" : "false"}
        style={{ transform: `translate3d(${detachPreview.left}px, -50%, 0)` }}
        aria-hidden="true"
      />
      <div className="ui-workspan-context-row flex h-7 min-h-7 min-w-0 items-center gap-1 overflow-x-auto px-1" role="tablist" aria-label={t("terminal.context.switcher")}>
        {contextOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className="ui-workspan-context-button inline-flex h-6 max-w-[260px] shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium"
            data-selected={option.key === activeContextKey ? "true" : "false"}
            title={`${option.project} / ${option.worktree}`}
            onClick={() => {
              const target = models.find((model) => model.contextKey === option.key);
              if (target) onActivate(target.workspan.id);
            }}
          >
            <span className="truncate">{option.project} / {option.worktree}</span>
            <span className="ui-workspan-context-status inline-flex shrink-0 items-center gap-0.5" title={t("terminal.status.summary")}>
              {option.running ? <span className="ui-workspan-status-running">●</span> : null}
              {option.done ? <span className="ui-workspan-status-done">✓</span> : null}
              {option.failed ? <span className="ui-workspan-status-failed">!</span> : null}
            </span>
          </button>
        ))}
      </div>
      <div
        ref={tabScrollRef}
        className="ui-workspan-tab-scroll flex h-9 min-h-9 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1"
        role="tablist"
        aria-label={t("terminal.workspan.tabList")}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.currentTarget.scrollLeft += event.deltaY;
          event.preventDefault();
        }}
      >
        <div className="ui-workspan-status-filter inline-flex shrink-0 items-center gap-0.5">
          {(["all", "running", "done", "failed"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className="ui-workspan-status-filter-button"
              data-selected={statusFilter === filter ? "true" : "false"}
              onClick={() => setStatusFilter(filter)}
              title={filter === "all" ? t("terminal.status.all") : t(`terminal.status.${filter}` as never)}
            >
              {filter === "all" ? "All" : filter === "running" ? "●" : filter === "done" ? "✓" : "!"}
            </button>
          ))}
        </div>
        <SortableContext
          items={visibleModels.map(({ workspan }) => `${WORKSPAN_DRAG_PREFIX}${workspan.id}`)}
          strategy={horizontalListSortingStrategy}
        >
          {visibleModels.map((model, index) => renderTab(model, index))}
        </SortableContext>
        <button
          type="button"
          className="ui-workspan-new-tab-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          onClick={() => onNewTab(visibleModels[visibleModels.length - 1]?.singleSession?.id)}
          aria-label={t("terminal.toolbar.newTerminal")}
          title={t("terminal.toolbar.newTerminal")}
        >
          <Plus size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        {(statusSummary.running > 0 || statusSummary.done > 0 || statusSummary.failed > 0) && (
          <span className="ui-workspan-status-summary inline-flex shrink-0 items-center gap-2 px-2 text-[10px] font-medium" title={t("terminal.status.summary")}>
            {statusSummary.running > 0 && <span className="ui-workspan-status-count ui-workspan-status-running">◉ {statusSummary.running}</span>}
            {statusSummary.done > 0 && <span className="ui-workspan-status-count ui-workspan-status-done">✓ {statusSummary.done}</span>}
            {statusSummary.failed > 0 && <span className="ui-workspan-status-count ui-workspan-status-failed">! {statusSummary.failed}</span>}
          </span>
        )}
        <WorkspanTabbarEndDropTarget disabled={hasScopedTerminalFilter} />
      </div>
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
              {hiddenModels.map((model) => (
                <div
                  key={model.workspan.id}
                  className="ui-interactive ui-terminal-tab-list-item flex w-full items-center gap-1 rounded-lg px-1 py-1 text-xs text-on-surface-variant"
                  data-selected={model.workspan.id === activeWorkspanId ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="ui-focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left"
                    onClick={() => {
                      onActivate(model.workspan.id);
                      onToggleList(false);
                    }}
                    title={model.title}
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
                    <span className="min-w-0 flex-1 truncate">{model.title}</span>
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
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
