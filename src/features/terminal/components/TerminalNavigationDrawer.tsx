import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../../../shared/ui/popover";
import type { TerminalNavigationEntry, TerminalNavigationGroup } from "../lib/terminalNavigationModel";
import { TERMINAL_NAVIGATION_INDEPENDENT_KEY } from "../lib/terminalNavigationModel";

export interface TerminalNavigationDrawerProps {
  open: boolean;
  pinned: boolean;
  anchor: ReactNode;
  anchorProps: Record<string, unknown>;
  contentProps: Record<string, unknown>;
  projectGroups: readonly TerminalNavigationGroup[];
  totalCount: number;
  currentWorkMode: boolean;
  selectedIds: readonly string[];
  onActivate: (id: string) => void;
  onAddToCurrentWork: (id: string) => void;
  onRemoveFromCurrentWork: (id: string) => void;
  onRemoveSelected: (ids: string[]) => void;
  onClose: (id: string) => void;
  onCloseOthers: () => void;
  onToggleSelection: (id: string) => void;
  onTogglePin?: (id: string) => void;
  renderStatus?: (entry: TerminalNavigationEntry) => ReactNode;
  renderSessionActions?: (entry: TerminalNavigationEntry) => ReactNode;
  onOpenChange: (open: boolean) => void;
  onRequestFocusAnchor?: () => void;
}

function searchable(entry: TerminalNavigationEntry) {
  return [entry.session.title, entry.session.cwd, entry.session.remotePath, entry.project?.name,
    entry.project?.path, entry.worktree?.name, entry.worktree?.display_name, entry.worktree?.branch,
    entry.worktree?.path].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function TerminalNavigationDrawer({
  open, pinned, anchor, contentProps, projectGroups, totalCount, currentWorkMode,
  selectedIds, onActivate, onAddToCurrentWork, onRemoveFromCurrentWork, onRemoveSelected, onClose,
  onCloseOthers, onToggleSelection, onTogglePin, renderStatus, renderSessionActions,
  onOpenChange,
}: TerminalNavigationDrawerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"browse" | "select" | "order">("browse");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const groups = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return projectGroups.map((group) => ({
      ...group,
      label: group.key === TERMINAL_NAVIGATION_INDEPENDENT_KEY ? t("terminal.navigation.independent") : group.label,
      entries: term ? group.entries.filter((entry) => searchable(entry).includes(term)) : group.entries,
    })).filter((group) => group.entries.length > 0);
  }, [projectGroups, query, t]);
  const visible = groups.flatMap((group) => group.entries);
  const selected = selectedIds.filter((id) => visible.some((entry) => entry.id === id));
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); return; }
    if (event.key === "Enter" && visible[0]) { event.preventDefault(); onActivate(visible[0].id); }
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="end"
        className="ui-terminal-navigation-drawer"
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
        {...contentProps}
      >
        <div className="ui-terminal-navigation-drawer-head">
          <strong>{t(currentWorkMode ? "terminal.currentWork.title" : "terminal.navigation.drawerTitle")}</strong>
          <span className="ui-terminal-navigation-count">{totalCount}</span>
          <span className="ui-terminal-navigation-drawer-mode">{pinned ? t("terminal.navigation.pinned") : t("terminal.navigation.hoverOpen")}</span>
        </div>
        <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown}
          placeholder={t("terminal.navigation.search")} aria-label={t("terminal.navigation.search")} role="searchbox" />
        <div id={listId} className="ui-terminal-navigation-drawer-list" role="listbox" aria-label={t("terminal.navigation.drawerTitle")}>
          {mode === "order" ? <p className="ui-terminal-navigation-order-hint" role="status">{t("terminal.navigation.orderHint")}</p> : groups.map((group) => (
            <section key={group.key} className="ui-terminal-navigation-drawer-group" aria-label={group.label}>
              <header><strong>{group.label}</strong><span>{group.entries.length}</span></header>
              {group.entries.map((entry) => {
                const isSelected = selectedIds.includes(entry.id);
                const actionKey = entry.inCurrentWork
                  ? entry.session.kind === "ephemeral-pi" ? "terminal.navigation.removeAndClose" : "terminal.currentWork.remove"
                  : "terminal.currentWork.add";
                return <div key={entry.id} className="ui-terminal-navigation-drawer-row" role="option" aria-selected={isSelected}>
                  {mode === "select" && entry.inCurrentWork && <input type="checkbox" checked={isSelected} aria-label={entry.session.title}
                    onChange={() => onToggleSelection(entry.id)} />}
                  <button type="button" className="ui-terminal-navigation-drawer-main" onClick={() => group.key === "add" ? onAddToCurrentWork(entry.id) : onActivate(entry.id)}>
                    <span className="ui-terminal-navigation-status">{renderStatus?.(entry)}</span>
                    <span className="ui-terminal-navigation-result-copy"><strong>{entry.session.title}</strong>
                      <small>{[entry.project?.name, entry.worktree?.branch, entry.session.remotePath || entry.session.cwd].filter(Boolean).join(" · ")}</small></span>
                    {entry.session.tabHidden && <small>{t("terminal.currentWork.hidden")}</small>}
                  </button>
                  {group.key !== "add" && (!entry.inCurrentWork || currentWorkMode) && <Button size="sm" onClick={() => entry.inCurrentWork ? onRemoveFromCurrentWork(entry.id) : onAddToCurrentWork(entry.id)}>{t(actionKey)}</Button>}
                  {group.key !== "add" && onTogglePin && <Button size="sm" aria-pressed={entry.pinned} onClick={() => onTogglePin(entry.id)}>{t(entry.pinned ? "terminal.navigation.unpin" : "terminal.navigation.pin")}</Button>}
                  {group.key !== "add" && <Button size="sm" aria-label={t(currentWorkMode ? entry.session.kind === "ephemeral-pi" ? "terminal.navigation.removeAndClose" : "terminal.currentWork.remove" : "terminal.tab.close", { title: entry.session.title })}
                    onClick={() => currentWorkMode ? onRemoveFromCurrentWork(entry.id) : onClose(entry.id)}>×</Button>}
                  {group.key !== "add" && renderSessionActions?.(entry)}
                </div>;
              })}
            </section>
          ))}
          {!visible.length && <p role="status">{t("terminal.navigation.empty")}</p>}
        </div>
        <div className="ui-terminal-navigation-drawer-actions">
          {currentWorkMode && <Button size="sm" aria-pressed={mode === "select"} onClick={() => setMode(mode === "select" ? "browse" : "select")}>{t("terminal.navigation.multiSelect")}</Button>}
          {currentWorkMode && <Button size="sm" aria-pressed={mode === "order"} onClick={() => setMode(mode === "order" ? "browse" : "order")}>{t("terminal.navigation.order")}</Button>}
          {currentWorkMode && mode === "select" && <Button size="sm" disabled={!selected.length} onClick={() => selected.length > 0 && onRemoveSelected(selected)}>{t("terminal.navigation.removeSelected")} ({selected.length})</Button>}
          <Button size="sm" onClick={onCloseOthers}>{t("terminal.currentWork.closeOtherTerminals")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
