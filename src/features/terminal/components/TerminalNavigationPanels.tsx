import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/popover";
import type { TerminalNavigationEntry } from "../lib/terminalNavigationModel";
import { filterNavigationGroups, navigationResultIndex, selectedNavigationMembers, type TerminalNavigationGroups } from "./terminalNavigationUiModel";

/** Radix portals leave terminal CSS inheritance; sample only the owning theme on open. */
function useNavigationPopupTheme() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const syncTheme = (open: boolean) => {
    if (!open || !trigger.current) return;
    const computed = getComputedStyle(trigger.current);
    setStyle(Object.fromEntries(["background", "foreground", "accent"].map((token) => {
      const name = `--terminal-theme-${token}`;
      return [name, computed.getPropertyValue(name)];
    })) as CSSProperties);
  };
  return { trigger, style, syncTheme };
}

export interface TerminalNavigationActions {
  onActivate: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
  onAddToCurrentWork: (sessionId: string) => void;
  /** Render existing per-session menu trigger/content; must be keyboard/touch accessible. */
  renderSessionActions: (entry: TerminalNavigationEntry) => ReactNode;
  /** Accessible status icon, not an active-tab background. */
  renderStatus?: (entry: TerminalNavigationEntry) => ReactNode;
}
export type TerminalNavigationSide = "top" | "bottom";

export function TerminalNavigationSwitcher({ groups, side, picker = false, total, ...actions }: TerminalNavigationActions & {
  groups: TerminalNavigationGroups; side: TerminalNavigationSide; picker?: boolean; total?: number;
}) {
  const { t } = useI18n();
  const theme = useNavigationPopupTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const filtered = filterNavigationGroups(groups, query);
  const entries = Object.values(filtered).flat();
  const active = entries[Math.min(index, entries.length - 1)];
  const activate = (entry: TerminalNavigationEntry) => { if (picker) actions.onAddToCurrentWork(entry.id); else actions.onActivate(entry.id); setOpen(false); };
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); theme.syncTheme(value); if (value) { setQuery(""); setIndex(0); } }}>
    <PopoverTrigger asChild><Button ref={theme.trigger} size="sm" variant="ghost" className="ui-terminal-navigation-search" title={t(picker ? "terminal.navigation.addTerminal" : "terminal.navigation.find")}>{t(picker ? "terminal.navigation.addTerminal" : "terminal.navigation.find")}{!picker && total !== undefined && total > 0 && <span className="ui-terminal-navigation-count">{total}</span>}</Button></PopoverTrigger>
    <PopoverContent side={side} className="ui-terminal-navigation-popup" style={theme.style} aria-label={t(picker ? "terminal.navigation.addTerminal" : "terminal.navigation.find")}
      onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
      <Input ref={input} value={query} placeholder={t("terminal.navigation.search")} aria-label={t("terminal.navigation.search")}
        role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={active ? `${id}-${active.id}` : undefined}
        onChange={(event) => { setQuery(event.target.value); setIndex(0); }} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next = navigationResultIndex(index, event.key, entries.length);
            setIndex(next);
            list.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: "nearest" });
          } else if (event.key === "Enter" && active) { event.preventDefault(); activate(active); }
        }} />
      <div ref={list} id={id} role="listbox" aria-label={t("terminal.navigation.all")} className="ui-terminal-navigation-results">
        {(Object.keys(filtered) as (keyof TerminalNavigationGroups)[]).map((group) => filtered[group].length > 0 &&
          <div role="group" aria-label={t(`terminal.navigation.${group}`)} key={group}>
            <h3>{t(`terminal.navigation.${group}`)}</h3>
            {filtered[group].map((entry) => <div key={entry.id} id={`${id}-${entry.id}`} role="option"
              aria-selected={active?.id === entry.id} className="ui-terminal-navigation-result"
              onMouseEnter={() => setIndex(entries.findIndex((item) => item.id === entry.id))}
              onClick={() => activate(entry)}>
              <span className="ui-terminal-navigation-status">{actions.renderStatus?.(entry)}</span>
              <span className="ui-terminal-navigation-result-copy"><strong>{entry.session.title}</strong>
                <small>{[entry.project?.name, entry.worktree?.branch, entry.session.cwd].filter(Boolean).join(" · ")}</small></span>
              {entry.session.tabHidden && <small>{t("terminal.currentWork.hidden")}</small>}
            </div>)}
          </div>)}
      </div>
      {!entries.length && <p role="status">{t("terminal.navigation.empty")}</p>}
      {active && !picker && <div className="ui-terminal-navigation-actions" aria-label={active.session.title}>
        <Button size="sm" aria-pressed={active.pinned} onClick={() => actions.onTogglePin(active.id)}>{t(active.pinned ? "terminal.navigation.unpin" : "terminal.navigation.pin")}</Button>
        {!active.inCurrentWork && <Button size="sm" onClick={() => actions.onAddToCurrentWork(active.id)}>{t("terminal.currentWork.add")}</Button>}
        {actions.renderSessionActions(active)}
      </div>}
    </PopoverContent>
  </Popover>;
}

export interface TerminalNavigationManagementProps extends TerminalNavigationActions {
  /** All manageable entries, not the five quick chips. Include unavailable members if removal is needed. */
  entries: readonly TerminalNavigationEntry[];
  selectedIds: readonly string[];
  onToggleSelection: (sessionId: string) => void;
  onRemoveFromCurrentWork: (sessionId: string) => void;
  onRemoveSelected: (sessionIds: string[]) => void;
  /** Adapter owns confirmation and scope-safe lifecycle behavior. */
  onCloseOthers: () => void;
  /** Separate ordering mode only: reuse existing sortable wrappers/IDs/contexts. */
  renderOrderingSurface: () => ReactNode;
  side: TerminalNavigationSide;
}

export function TerminalNavigationManagement(props: TerminalNavigationManagementProps) {
  const { t } = useI18n();
  const theme = useNavigationPopupTheme();
  const [mode, setMode] = useState<"normal" | "select" | "order">("normal");
  const selected = selectedNavigationMembers(props.entries, props.selectedIds);
  const renderRow = (entry: TerminalNavigationEntry) => <div key={entry.id} className="ui-terminal-navigation-management-row">
    {mode === "select" && entry.inCurrentWork && <input type="checkbox" aria-label={entry.session.title}
      checked={selected.includes(entry.id)} onChange={() => props.onToggleSelection(entry.id)} />}
    <button className="ui-terminal-navigation-result-copy" onClick={() => props.onActivate(entry.id)}>
      <strong>{entry.session.title}</strong>
      <small>{[entry.project?.name, entry.worktree?.branch, entry.session.remotePath || entry.session.cwd].filter(Boolean).join(" · ")}</small>
    </button>
    {props.renderStatus?.(entry)}
    <Button size="sm" onClick={() => entry.inCurrentWork ? props.onRemoveFromCurrentWork(entry.id) : props.onAddToCurrentWork(entry.id)}>
      {t(entry.inCurrentWork ? entry.session.kind === "ephemeral-pi" ? "terminal.navigation.removeAndClose" : "terminal.currentWork.remove" : "terminal.currentWork.add")}</Button>
    {props.renderSessionActions(entry)}
  </div>;
  return <Popover onOpenChange={(open) => { theme.syncTheme(open); if (open) setMode("normal"); }}><PopoverTrigger asChild><Button ref={theme.trigger} size="sm" variant="ghost">{t("terminal.navigation.manage")}</Button></PopoverTrigger>
    <PopoverContent side={props.side} className="ui-terminal-navigation-popup" style={theme.style} aria-label={t("terminal.navigation.manage")}>
      <h3>{t("terminal.navigation.manage")}</h3>
      <div className="ui-terminal-navigation-actions">
        <Button size="sm" aria-pressed={mode === "select"} onClick={() => setMode(mode === "select" ? "normal" : "select")}>{t("terminal.navigation.multiSelect")}</Button>
        <Button size="sm" aria-pressed={mode === "order"} onClick={() => setMode(mode === "order" ? "normal" : "order")}>{t("terminal.navigation.order")}</Button>
      </div>
      {mode === "select" && <div className="ui-terminal-navigation-actions">
        <span>{t("terminal.currentWork.selected", { count: selected.length })}</span>
        <Button size="sm" disabled={!selected.length} onClick={() => { if (selected.length) props.onRemoveSelected(selected); }}>{t("terminal.navigation.removeSelected")}</Button>
      </div>}
      <div className="ui-terminal-navigation-results">
        {mode === "order" ? props.renderOrderingSurface() : props.entries.map(renderRow)}
      </div>
      {mode !== "order" && !props.entries.length && <p role="status">{t("terminal.navigation.empty")}</p>}
      <div className="ui-terminal-navigation-actions">
        <Button size="sm" onClick={props.onCloseOthers}>{t("terminal.currentWork.closeOtherTerminals")}</Button>
      </div>
    </PopoverContent></Popover>;
}

export function TerminalNavigationContext({ entry, side, renderStatus }: {
  entry?: TerminalNavigationEntry; side: TerminalNavigationSide; renderStatus?: TerminalNavigationActions["renderStatus"];
}) {
  const { t } = useI18n();
  const theme = useNavigationPopupTheme();
  return <Popover onOpenChange={theme.syncTheme}><PopoverTrigger asChild><Button ref={theme.trigger} size="sm" variant="ghost" disabled={!entry}>{t("terminal.navigation.context")}</Button></PopoverTrigger>
    <PopoverContent side={side} className="ui-terminal-navigation-popup" style={theme.style} aria-label={t("terminal.context.current")}>
      {entry && <dl className="ui-terminal-navigation-context">
        <dt>{t("termStats.session")}</dt><dd>{entry.session.title} · {entry.id}</dd>
        <dt>{t("termStats.project")}</dt><dd>{entry.project ? `${entry.project.name} · ${entry.project.path} · ${entry.project.id}` : t("terminal.context.unboundProject")}</dd>
        <dt>{t("terminal.context.worktree")}</dt><dd>{entry.worktree ? `${entry.worktree.display_name || entry.worktree.name} · ${entry.worktree.path}` : entry.session.worktreeId ? t("terminal.context.worktreeMissing") : t("terminal.context.rootDirectory")}</dd>
        <dt>{t("termStats.branch")}</dt><dd>{entry.worktree?.branch || "—"}</dd>
        <dt>{t("termStats.path")}</dt><dd>{entry.session.remotePath || entry.session.cwd}</dd>
        <dt>{t("terminal.navigation.state")}</dt><dd>{renderStatus?.(entry) ?? t("terminal.status.running")}{entry.session.tabHidden && ` · ${t("terminal.currentWork.hidden")}`}</dd>
      </dl>}
    </PopoverContent></Popover>;
}
