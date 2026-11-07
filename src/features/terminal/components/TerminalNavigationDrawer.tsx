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
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: () => void;
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
  open, pinned, anchor, contentProps, projectGroups, totalCount,
  onActivate, onClose, onCloseOthers, onTogglePin, renderStatus, renderSessionActions,
  onOpenChange,
}: TerminalNavigationDrawerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
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
          <strong>{t("terminal.navigation.drawerTitle")}</strong>
          <span className="ui-terminal-navigation-count">{totalCount}</span>
          <span className="ui-terminal-navigation-drawer-mode">{pinned ? t("terminal.navigation.pinned") : t("terminal.navigation.hoverOpen")}</span>
        </div>
        <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown}
          placeholder={t("terminal.navigation.search")} aria-label={t("terminal.navigation.search")} role="searchbox" />
        <div id={listId} className="ui-terminal-navigation-drawer-list" role="listbox" aria-label={t("terminal.navigation.drawerTitle")}>
          {groups.map((group) => (
            <section key={group.key} className="ui-terminal-navigation-drawer-group" aria-label={group.label}>
              <header><strong>{group.label}</strong><span>{group.entries.length}</span></header>
              {group.entries.map((entry) => {
                return <div key={entry.id} className="ui-terminal-navigation-drawer-row" role="option" aria-selected={entry.current}>
                  <button type="button" className="ui-terminal-navigation-drawer-main" onClick={() => onActivate(entry.id)}>
                    <span className="ui-terminal-navigation-status">{renderStatus?.(entry)}</span>
                    <span className="ui-terminal-navigation-result-copy"><strong>{entry.session.title}</strong>
                      <small>{[entry.project?.name, entry.worktree?.branch, entry.session.remotePath || entry.session.cwd].filter(Boolean).join(" · ")}</small></span>

                  </button>
                  {onTogglePin && <Button size="sm" aria-pressed={entry.pinned} onClick={() => onTogglePin(entry.id)}>{t(entry.pinned ? "terminal.navigation.unpin" : "terminal.navigation.pin")}</Button>}
                  <Button size="sm" aria-label={t("terminal.tab.close", { title: entry.session.title })} onClick={() => onClose(entry.id)}>×</Button>
                  {renderSessionActions?.(entry)}
                </div>;
              })}
            </section>
          ))}
          {!visible.length && <p role="status">{t("terminal.navigation.empty")}</p>}
        </div>
        <div className="ui-terminal-navigation-drawer-actions">
          <Button size="sm" onClick={onCloseOthers}>{t("terminal.tab.closeOthers")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
