import { useI18n } from "../../../shared/i18n/index";
import { useTerminalStore } from "../../terminal/state";
import { Terminal } from "../../../shared/ui/icons";
import { sidebarTerminalGlyphs, sidebarTerminalStates, summarizeWorktreeTerminals } from "../lib/sidebarTerminals";

/** Read-only and independent of list mounting/folding; retained hidden PTYs count too. */
export function WorktreeTerminalSummary({ projectId, worktreeId, compact = false }: {
  projectId: string; worktreeId: string; compact?: boolean;
}) {
  const { t } = useI18n();
  const sessions = useTerminalStore((store) => store.sessions);
  const statuses = useTerminalStore((store) => store.sessionStatuses);
  const notifications = useTerminalStore((store) => store.tabNotifications);
  const taskSources = useTerminalStore((store) => store.tabStatuses);
  const { total, counts } = summarizeWorktreeTerminals(sessions, projectId, worktreeId, statuses, notifications, taskSources);
  if (!total) return null;
  const label = [t("sidebar.terminals.summaryTotal", { count: total }),
    ...sidebarTerminalStates.filter((state) => counts[state] > 0).map((state) => `${t(`sidebar.terminals.${state}`)}: ${counts[state]}`),
    t("sidebar.terminals.summaryHiddenIncluded")].join(" · ");
  return <span className="worktree-terminal-summary" data-worktree-summary={worktreeId}
    data-density={compact ? "compact" : "comfortable"} role="img" title={label} aria-label={label}>
    <span className="worktree-terminal-summary-text" aria-hidden="true">
      <span className="worktree-terminal-summary-token" title={t("sidebar.terminals.summaryTotal", { count: total })}>
        <Terminal size={12} aria-hidden="true" /><span>{total}</span>
      </span>
      {sidebarTerminalStates.filter((state) => counts[state] > 0).map((state) =>
        <span key={state} className="worktree-terminal-summary-token" data-status={state}
          title={t(`sidebar.terminals.summary.${state}`, { count: counts[state] })}>
          <span className="worktree-terminal-summary-glyph">{sidebarTerminalGlyphs[state]}</span><span>{counts[state]}</span>
        </span>)}
    </span>
  </span>;
}
