import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/popover";
import type { TerminalNavigationEntry } from "../lib/terminalNavigationModel";

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
  /** Render existing per-session menu trigger/content; must be keyboard/touch accessible. */
  renderSessionActions: (entry: TerminalNavigationEntry) => ReactNode;
  /** Accessible status icon, not an active-tab background. */
  renderStatus?: (entry: TerminalNavigationEntry) => ReactNode;
}
export type TerminalNavigationSide = "top" | "bottom";

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
        <dt>{t("terminal.navigation.state")}</dt><dd>{renderStatus?.(entry) ?? t("terminal.status.running")}</dd>
      </dl>}
    </PopoverContent></Popover>;
}
