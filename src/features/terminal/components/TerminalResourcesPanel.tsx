import { useMemo, useRef, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppConfirm } from "../../../shared/ui/useAppConfirm";
import { createTerminalResourceDeletion } from "../hooks/terminalResourceDeletion";
import { useI18n } from "../../../shared/i18n";
import { useProjectStore } from "../../projects/api/projectStore";
import { useWorktreeStore } from "../../projects/api/worktreeStore";
import { TERM_PANEL } from "../../stats/api/termStatsUi";
import { useTerminalStore } from "../state";
import { findWorktreeForSession, resolveProjectForSession } from "../api/terminalProject";
import { useTerminalResources } from "../hooks/useTerminalResources";
import { terminalResourceIdentity, terminalResourcePage, terminalResourceSessions, sortTerminalResourcePage } from "../lib/terminalResourceModel";
import { dispatchTerminalResourceTarget } from "../lib/terminalResourceNavigation";
import type { TerminalResourceReason } from "../api/terminalResources";

const reasonKeys = {
  unsupported_platform: "terminal.resources.reason.unsupported_platform",
  unsupported_remote: "terminal.resources.reason.unsupported_remote",
  session_missing: "terminal.resources.reason.session_missing",
  not_pty: "terminal.resources.reason.not_pty",
  root_changed: "terminal.resources.reason.root_changed",
  member_unavailable: "terminal.resources.reason.member_unavailable",
  membership_changed: "terminal.resources.reason.membership_changed",
  member_limit: "terminal.resources.reason.member_limit",
  enumeration_failed: "terminal.resources.reason.enumeration_failed",
  budget_exhausted: "terminal.resources.reason.budget_exhausted",
  identity_changed: "terminal.resources.reason.identity_changed",
  observation_invalidated: "terminal.resources.reason.observation_invalidated",
} as const satisfies Record<TerminalResourceReason, string>;
const errorKeys = {
  terminal_resources_native_only: "terminal.resources.nativeOnly",
  terminal_resources_unsupported: "terminal.resources.unsupported",
  terminal_resources_owner_rejected: "terminal.resources.ownerRejected",
  terminal_resources_observation_invalidated: "terminal.resources.invalidated",
  terminal_resources_invalid_request: "terminal.resources.unavailable",
  terminal_resources_unavailable: "terminal.resources.unavailable",
} as const;

export function TerminalResourcesPanel({ active }: { active: boolean }) {
  const { t, language } = useI18n();
  const { confirm, confirmDialog } = useAppConfirm();
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  const deletionInput = {
    t, confirm, setPending: setPendingDeletion,
    getSession: (id: string) => useTerminalStore.getState().sessions.find((s) => s.id === id),
    closeSession: (id: string, strict: true) => useTerminalStore.getState().closeSession(id, strict),
    showError: (message: string) => { toast.error(message); },
  };
  const deletionInputRef = useRef(deletionInput);
  deletionInputRef.current = deletionInput;
  // Keep the synchronous duplicate guard across renders, including confirmation renders.
  const [deleteTerminal] = useState(() => createTerminalResourceDeletion({
    ...deletionInput,
    t: (...args) => deletionInputRef.current.t(...args),
    confirm: (options) => deletionInputRef.current.confirm(options),
  }));
  const sessions = useTerminalStore((s) => s.sessions);
  const statuses = useTerminalStore((s) => s.sessionStatuses);
  const tabStatuses = useTerminalStore((s) => s.tabStatuses);
  const projects = useProjectStore((s) => s.projects);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const [requestedPage, setPage] = useState(0);
  const originals = useMemo(() => terminalResourceSessions(sessions), [sessions]);
  const page = terminalResourcePage(originals, requestedPage);
  const ids = page.sessions.map((session) => session.id);
  const identity = JSON.stringify([terminalResourceIdentity(originals), originals.map((s) => statuses[s.id])]);
  const { snapshot, error, loading, refresh } = useTerminalResources(active, ids, identity);
  const ordered = sortTerminalResourcePage(page.sessions, snapshot?.rows ?? []);
  const rows = new Map(snapshot?.rows.map((row) => [row.sessionId, row]) ?? []);
  const sampledAt = snapshot ? new Date(snapshot.sampledAt).toLocaleTimeString(language, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }) : "—";
  if (!active) return confirmDialog;
  const buttonClass = "ui-focus-ring rounded border px-2 py-1 disabled:opacity-40";
  return <section className="ui-thin-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 text-[11px]"
    aria-label={t("terminal.resources.title")} style={{ color: TERM_PANEL.fg }}>
    <div className="flex items-center justify-between gap-2">
      <strong>{t("terminal.resources.title")} · TEMP</strong>
      <button type="button" className={buttonClass} disabled={loading || !ids.length} onClick={() => void refresh()}
        aria-label={t("systemResources.refresh")} title={t("systemResources.refresh")}>
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
    <p style={{ color: TERM_PANEL.dim }}>{t("terminal.resources.explanation")}</p>
    <p style={{ color: TERM_PANEL.dim }}>{t("terminal.resources.pageSort")}</p>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>{t("terminal.resources.sampleTime", { time: sampledAt })}</span>
      {loading && <span role="status">{t("common.loading")}</span>}
    </div>
    {error && <p role="status" style={{ color: TERM_PANEL.yellow }}>
      {t(errorKeys[error as keyof typeof errorKeys] ?? "terminal.resources.unavailable")}
    </p>}
    <div className="flex items-center justify-between gap-2" aria-label={t("terminal.resources.pagination")}>
      <button type="button" className={buttonClass} disabled={page.page === 0} onClick={() => setPage(page.page - 1)}
        aria-label={t("terminal.resources.previous")}>‹</button>
      <span>{t("terminal.resources.page", { page: page.page + 1, pages: page.pages, count: originals.length })}</span>
      <button type="button" className={buttonClass} disabled={page.page + 1 >= page.pages} onClick={() => setPage(page.page + 1)}
        aria-label={t("terminal.resources.next")}>›</button>
    </div>
    {!ordered.length && <p>{t("terminal.resources.empty")}</p>}
    <ul className="flex flex-col gap-2">
      {ordered.map((session) => {
        const row = rows.get(session.id);
        const project = resolveProjectForSession(session, sessions, projects, new Map(projects.map((project) => [project.id, project])));
        const worktree = findWorktreeForSession(session, sessions, worktrees);
        const memory = row?.workingSetSumBytes;
        const exists = sessions.some((live) => live.id === session.id);
        const knownStatus = statuses[session.id];
        const hookState = tabStatuses[session.id]?.hook;
        const hookLabel = hookState && hookState !== "none" ? t(`terminal.status.${hookState}`) : null;
        const stateText = session.connectionState
          ? t(`terminal.ssh.connection.${session.connectionState}`)
          : knownStatus === "running" ? t("terminal.status.running")
            : knownStatus === "exited" ? t("terminal.resources.exited")
              : knownStatus === "error" ? t("terminal.status.failed") : t("terminal.resources.unknown");
        return <li key={session.id} className="rounded-lg border p-2" style={{ borderColor: TERM_PANEL.border, background: TERM_PANEL.card }}>
          <button type="button" className="ui-focus-ring w-full rounded text-left disabled:opacity-40" disabled={!exists}
            onClick={() => dispatchTerminalResourceTarget(session.id)}
            aria-label={t("terminal.resources.locate", { title: session.title })}>
            <strong className="block break-words">{session.title}</strong>
            <span className="block break-words" style={{ color: TERM_PANEL.dim }}>
              {project?.name ?? t(session.projectId ? "terminal.resources.missingProject" : "terminal.context.unboundProject")}
              {worktree ? ` · ${worktree.display_name || worktree.name}` : session.worktreeId ? ` · ${t("terminal.context.worktreeMissing")}` : ""}
            </span>
            <span className="block break-all text-[10px]" style={{ color: TERM_PANEL.dim }}>{session.id}</span>
          </button>
          <button type="button" className={`${buttonClass} mt-1 inline-flex items-center gap-1 text-red-500`}
            disabled={pendingDeletion !== null || !exists}
            onClick={() => void deleteTerminal(session)}
            aria-label={t("terminal.resources.deleteLabel", { title: session.title })}
            aria-busy={pendingDeletion === session.id}>
            <Trash2 size={12} />
            {t(pendingDeletion === session.id ? "terminal.resources.deleting" : "terminal.resources.delete")}
          </button>
          <p className="mt-1">{stateText}{hookLabel ? ` · ${hookLabel}` : ""}{session.tabHidden ? ` · ${t("terminal.session.hidden")}` : ""}</p>
          <p className="mt-2 font-semibold tabular-nums">
            {t("terminal.resources.workingSet")}: {typeof memory === "number" ? `${(memory / 1048576).toFixed(1)} MiB` : "—"}
          </p>
          <p style={{ color: TERM_PANEL.dim }}>{row
            ? `${t(`terminal.resources.${row.status}`)} · ${t("terminal.resources.observed", { observed: row.observedCount, enumerated: row.enumeratedCount })}`
            : t("terminal.resources.notSampled")}</p>
          {row?.reasonCodes.map((reason) => <p key={reason} style={{ color: TERM_PANEL.yellow }}>{t(reasonKeys[reason])}</p>)}
        </li>;
      })}
    </ul>
    {confirmDialog}
  </section>;
}
