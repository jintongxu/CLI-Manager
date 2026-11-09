import { useEffect, useState } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Check, ExternalLink, Pencil, Pin, X } from "../../../shared/ui/icons";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import type { BtwSideQuestionController } from "../hooks/useBtwSideQuestion";
import { btwContentText } from "../lib/btwThreadModel";
import { btwThreadText } from "../lib/btwThreadModel";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/popover";
import { useTerminalStore } from "../state";
import "./btwThreadDialog.css";
import { BtwPersistenceStatus } from "./BtwPersistenceStatus";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";

/** History is a display projection; filtering never removes owner-model threads. */
export function BtwSideQuestionPanel({ controller, onOpenReader }: {
  controller: BtwSideQuestionController;
  onOpenReader: () => void;
}) {
  const { t } = useI18n();
  const { state, model } = controller;
  const [query, setQuery] = useState("");
  const [allHistory, setAllHistory] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const terminalId = useTerminalStore((store) => store.activeSessionId);
  useEffect(() => {
    setHistoryOffset(0);
    if (allHistory || terminalId) {
      setHistoryLoading(true);
      void model.loadHistory(query, showArchived, allHistory ? undefined : terminalId ?? undefined)
        .finally(() => setHistoryLoading(false));
    }
  }, [model, query, showArchived, terminalId, allHistory]);
  const needle = query.trim().toLocaleLowerCase();
  const entries = state.entries.filter((entry) => (allHistory || (!!terminalId && entry.source.terminalId === terminalId))
    && (showArchived || !entry.archived)
    && (!needle || [entry.title, entry.quote, entry.draft, entry.answer, ...entry.messages.map((message) => btwContentText(message.content))]
      .some((text) => text.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return <div className="btw-history-panel" data-btw-panel="true">
    <div className="btw-history-panel-header"><div><strong className="btw-history-panel-title">{t("terminal.panel.btw")}</strong></div>
      <Button size="sm" variant="ghost" disabled={!terminalId} data-action="new-question" onClick={() => {
        controller.stageFromTerminal("", terminalId ?? undefined);
        onOpenReader();
      }}>{t("terminal.btw.newQuestion")}</Button></div>
    <BtwPersistenceStatus controller={controller} />
    <div className="btw-history-filters">
      <label className="btw-history-toggle"><input type="checkbox" checked={allHistory} onChange={(event) => setAllHistory(event.target.checked)} /><span>{t("terminal.btw.allHistory")}</span></label>
      <label className="btw-history-toggle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /><span>{t("terminal.btw.showArchived")}</span></label>
    </div>
    <p className="btw-history-hint">{t(allHistory ? "terminal.btw.allHistoryHint" : "terminal.btw.currentTerminalHistory")}</p>
    <div className="btw-history-search"><input aria-label={t("terminal.btw.search")} placeholder={t("terminal.btw.search")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" data-btw-history="true">
      {!entries.length && <p className="opacity-70">{query ? t("terminal.btw.noResults") : t("terminal.btw.empty")}</p>}
      {entries.map((entry) => {
        const isRenaming = renamingId === entry.id;
        const openEmbedded = () => { model.selectEmbedded(entry.id); onOpenReader(); };
        const commitRename = () => {
          const value = renameValue.trim();
          if (value) model.rename(entry.id, value);
          setRenamingId(null);
        };
        return (<article key={entry.id} className="btw-history-card" data-btw-entry={entry.id} data-pinned={entry.pinned ? "true" : "false"}>
        <div className="btw-history-card-header">
          {isRenaming ? <div className="btw-history-rename">
            <input autoFocus value={renameValue} aria-label={t("terminal.btw.renameInput")} onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitRename(); } if (event.key === "Escape") setRenamingId(null); }} />
            <Button size="sm" variant="ghost" aria-label={t("terminal.btw.renameSave")} onClick={commitRename}><Check size={14} /></Button>
            <Button size="sm" variant="ghost" aria-label={t("terminal.btw.renameCancel")} onClick={() => setRenamingId(null)}><X size={14} /></Button>
          </div> : <button className="btw-history-title text-left ui-focus-ring" data-action="open-embedded"
            aria-pressed={state.embeddedId === entry.id} onClick={openEmbedded}>
            {entry.title}
          </button>}
          <div className="btw-history-card-badges">
            {entry.pinned && <span className="btw-history-pinned-badge"><Pin size={11} aria-hidden="true" />{t("terminal.btw.pinned")}</span>}
            {entry.archived && <span className="btw-history-archived-badge" aria-label={t("terminal.btw.archived")}>▣</span>}
          </div>
        </div>
        <div className="btw-history-card-meta">
          {entry.createdAt ? <time dateTime={new Date(entry.createdAt).toISOString()}>
            {new Date(entry.createdAt).toLocaleString()}
          </time> : null}
          <span className="btw-history-status" data-btw-status={entry.status}>{t(entry.contextLoading ? "terminal.btw.contextLoading" : `terminal.btw.${entry.status}`)}</span>
        </div>
        <div className="btw-history-preview line-clamp-2 whitespace-pre-wrap" data-btw-preview="true">{entry.answer || entry.error}</div>
        <div className="btw-history-card-actions">
          <Button size="sm" variant="default" data-action="open-side-question" onClick={openEmbedded}><ExternalLink size={13} aria-hidden="true" />{t("terminal.btw.openEmbedded")}</Button>
          <Popover><PopoverTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={t("terminal.btw.more")}>{t("terminal.btw.more")}</Button>
        </PopoverTrigger><PopoverContent className="flex max-w-72 flex-col gap-1 p-2" align="end">
          <Button size="sm" variant="ghost" data-action="rename" onClick={() => { setRenamingId(entry.id); setRenameValue(entry.title); }}><Pencil size={13} aria-hidden="true" />{t("terminal.btw.rename")}</Button>
          <Button size="sm" variant="ghost" data-action="pin" aria-pressed={entry.pinned} onClick={() => model.pin(entry.id, !entry.pinned)}><Pin size={13} aria-hidden="true" />{t(entry.pinned ? "terminal.btw.unpin" : "terminal.btw.pin")}</Button>
          <Button size="sm" variant="ghost" onClick={() => model.archive(entry.id, !entry.archived)}>{t(entry.archived ? "terminal.btw.restore" : "terminal.btw.archive")}</Button>
          {(entry.status === "failed" || entry.status === "stopped") && <Button size="sm" variant="ghost" onClick={() => model.send(entry.id, true)}>{t("terminal.btw.retry")}</Button>}
          <Button size="sm" variant="ghost" disabled={!entry.messages.length} onClick={() => void copyTextToClipboard(btwThreadText(entry))}>{t("terminal.btw.copyThread")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleteEntryId(entry.id)}>{t("terminal.btw.delete")}</Button>
        </PopoverContent></Popover>
        </div></article>);})}
    </div>
    <ConfirmDialog
      open={deleteEntryId !== null}
      title={t("terminal.btw.confirmDelete")}
      message={t("terminal.btw.confirmDeleteMessage")}
      confirmText={t("terminal.btw.delete")}
      cancelText={t("common.cancel")}
      danger
      confirmAutoFocus
      contentClassName="btw-delete-confirm-dialog"
      onClose={() => setDeleteEntryId(null)}
      onConfirm={() => {
        if (deleteEntryId) model.remove(deleteEntryId);
        setDeleteEntryId(null);
      }}
    />
    <Button size="sm" variant="ghost" disabled={historyLoading} aria-busy={historyLoading} onClick={() => {
      const offset = historyOffset + 100;
      setHistoryOffset(offset);
      setHistoryLoading(true);
      void model.loadHistory(query, showArchived, allHistory ? undefined : terminalId ?? undefined, offset)
        .finally(() => setHistoryLoading(false));
    }}>{historyLoading ? t("terminal.btw.pending") : t("terminal.btw.loadMoreHistory")}</Button>
  </div>;
}
