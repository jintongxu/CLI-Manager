import { useEffect, useState } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Check, Pencil, Pin, X } from "../../../shared/ui/icons";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import type { BtwSideQuestionController } from "../hooks/useBtwSideQuestion";
import { btwThreadText } from "../lib/btwThreadModel";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/popover";
import { useTerminalStore } from "../state";
import "./btwThreadDialog.css";
import { BtwPersistenceStatus } from "./BtwPersistenceStatus";

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const terminalId = useTerminalStore((store) => store.activeSessionId);
  useEffect(() => {
    setHistoryOffset(0);
    if (allHistory || terminalId) void model.loadHistory(query, showArchived, allHistory ? undefined : terminalId ?? undefined);
  }, [model, query, showArchived, terminalId, allHistory]);
  const needle = query.trim().toLocaleLowerCase();
  const entries = state.entries.filter((entry) => (allHistory || (!!terminalId && entry.source.terminalId === terminalId))
    && (showArchived || !entry.archived)
    && (!needle || [entry.title, entry.quote, entry.draft, entry.answer, ...entry.messages.map((message) => message.content)]
      .some((text) => text.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-[12px]" data-btw-panel="true">
    <div className="flex items-center justify-between gap-2"><strong>{t("terminal.panel.btw")}</strong>
      <Button size="sm" variant="ghost" disabled={!terminalId} data-action="new-question" onClick={() => {
        controller.stageFromTerminal("", terminalId ?? undefined);
        onOpenReader();
      }}>{t("terminal.btw.newQuestion")}</Button></div>
    <BtwPersistenceStatus controller={controller} />
    <label className="flex items-center gap-1"><input type="checkbox" checked={allHistory} onChange={(event) => setAllHistory(event.target.checked)} />{t("terminal.btw.allHistory")}</label>
    <p className="opacity-70">{t(allHistory ? "terminal.btw.allHistoryHint" : "terminal.btw.currentTerminalHistory")}</p>
    <div className="flex items-center gap-2"><input className="min-w-0 flex-1 rounded border px-2 py-1" aria-label={t("terminal.btw.search")} placeholder={t("terminal.btw.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="flex shrink-0 items-center gap-1"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{t("terminal.btw.showArchived")}</label></div>
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
        {entry.createdAt ? <time className="text-[11px] opacity-75" dateTime={new Date(entry.createdAt).toISOString()}>
          {new Date(entry.createdAt).toLocaleString()}
        </time> : null}
        <span data-btw-status={entry.status}>{t(entry.contextLoading ? "terminal.btw.contextLoading" : `terminal.btw.${entry.status}`)}</span>
        <div className="line-clamp-2 whitespace-pre-wrap opacity-80" data-btw-preview="true">{entry.answer || entry.error}</div>
        <Popover><PopoverTrigger asChild>
          <Button size="sm" variant="ghost" aria-label={t("terminal.btw.more")}>{t("terminal.btw.more")}</Button>
        </PopoverTrigger><PopoverContent className="flex max-w-72 flex-col gap-1 p-2" align="end">
          <Button size="sm" variant="ghost" data-action="open-side-question" onClick={openEmbedded}>{t("terminal.btw.openEmbedded")}</Button>
          <Button size="sm" variant="ghost" data-action="rename" onClick={() => { setRenamingId(entry.id); setRenameValue(entry.title); }}><Pencil size={13} aria-hidden="true" />{t("terminal.btw.rename")}</Button>
          <Button size="sm" variant="ghost" data-action="pin" aria-pressed={entry.pinned} onClick={() => model.pin(entry.id, !entry.pinned)}><Pin size={13} aria-hidden="true" />{t(entry.pinned ? "terminal.btw.unpin" : "terminal.btw.pin")}</Button>
          <Button size="sm" variant="ghost" onClick={() => model.archive(entry.id, !entry.archived)}>{t(entry.archived ? "terminal.btw.restore" : "terminal.btw.archive")}</Button>
          {(entry.status === "failed" || entry.status === "stopped") && <Button size="sm" variant="ghost" onClick={() => model.send(entry.id, true)}>{t("terminal.btw.retry")}</Button>}
          <Button size="sm" variant="ghost" disabled={!entry.messages.length} onClick={() => void copyTextToClipboard(btwThreadText(entry))}>{t("terminal.btw.copyThread")}</Button>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("terminal.btw.confirmDelete"))) model.remove(entry.id); }}>{t("terminal.btw.delete")}</Button>
        </PopoverContent></Popover></article>);})}
    </div>
    <Button size="sm" variant="ghost" onClick={() => {
      const offset = historyOffset + 100;
      setHistoryOffset(offset);
      void model.loadHistory(query, showArchived, allHistory ? undefined : terminalId ?? undefined, offset);
    }}>{t("terminal.btw.loadMoreHistory")}</Button>
  </div>;
}
