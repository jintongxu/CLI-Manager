import { useEffect, useState } from "react";
import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Check, Pencil, Pin, X } from "../../../shared/ui/icons";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import type { BtwSideQuestionController } from "../hooks/useBtwSideQuestion";
import { btwThreadText } from "../lib/btwThreadModel";
import { BtwContextDetails } from "./BtwContextDetails";
import "./btwThreadDialog.css";

/** Compact independent cards; opening one never submits or expands other threads. */
export function BtwSideQuestionPanel({ controller }: { controller: BtwSideQuestionController }) {
  const { t } = useI18n();
  const { state, model } = controller;
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  useEffect(() => { void model.loadHistory(query, showArchived); }, [model, query, showArchived]);
  const entries = state.entries.filter((entry) => showArchived || !entry.archived)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-[12px]" data-btw-panel="true">
    <div className="flex items-center justify-between gap-2"><strong>{t("terminal.btw.title")}</strong>
      <Button size="sm" variant="ghost" onClick={() => controller.stageFromTerminal("")}>{t("terminal.btw.newQuestion")}</Button>
      <Button size="sm" variant="ghost" onClick={model.clear}>{t("terminal.btw.clear")}</Button></div>
    <p className="opacity-70">{t("terminal.btw.sideQuestionHint")}</p>
    <label className="flex flex-col gap-1"><span>{t("terminal.btw.questionLabel")}</span>
      <textarea className="min-h-[72px] w-full resize-y rounded-md border px-2 py-1" value={state.question} onChange={(e) => model.setQuestion(e.target.value)} /></label>
    {state.quote && <details data-btw-quote="true"><summary>{t("terminal.btw.quoteLabel")}</summary><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{state.quote}</pre></details>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={state.inherit} disabled={!!state.source.reason || !state.source.sessionId} onChange={(e) => model.setInherit(e.target.checked)} />{t("terminal.btw.inherit")}</label>
    <BtwContextDetails source={state.source} context={state.context} loading={state.contextLoading} />
    <Button size="sm" disabled={!state.question.trim() || (state.inherit && state.contextLoading)} onClick={model.submit}>{t("terminal.btw.ask")}</Button>
    <div className="flex items-center gap-2"><input className="min-w-0 flex-1 rounded border px-2 py-1" aria-label={t("terminal.btw.search")} placeholder={t("terminal.btw.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="flex shrink-0 items-center gap-1"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{t("terminal.btw.showArchived")}</label></div>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" data-btw-history="true">
      {!entries.length && <p className="opacity-70">{query ? t("terminal.btw.noResults") : t("terminal.btw.empty")}</p>}
      {entries.map((entry) => {
        const isRenaming = renamingId === entry.id;
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
          </div> : <div className="btw-history-title">{entry.title}</div>}
          <div className="btw-history-card-badges">
            {entry.pinned && <span className="btw-history-pinned-badge"><Pin size={11} aria-hidden="true" />{t("terminal.btw.pinned")}</span>}
            {entry.archived && <span className="btw-history-archived-badge" aria-label={t("terminal.btw.archived")}>▣</span>}
          </div>
        </div>
        <div className="text-[11px] opacity-75">{t(entry.inherit ? "terminal.btw.modeInherited" : "terminal.btw.modeIndependent")}</div>
        <span data-btw-status={entry.status}>{t(entry.contextLoading ? "terminal.btw.contextLoading" : `terminal.btw.${entry.status}`)}</span>
        <div className="line-clamp-2 whitespace-pre-wrap opacity-80" data-btw-preview="true">{entry.answer || entry.error}</div>
        <div className="btw-history-card-actions"><Button size="sm" variant="ghost" onClick={() => model.open(entry.id)}>{t("terminal.btw.open")}</Button>
          <Button size="sm" variant="ghost" data-action="rename" onClick={() => { setRenamingId(entry.id); setRenameValue(entry.title); }}><Pencil size={13} aria-hidden="true" />{t("terminal.btw.rename")}</Button>
          <Button size="sm" variant="ghost" data-action="pin" aria-pressed={entry.pinned} onClick={() => model.pin(entry.id, !entry.pinned)}><Pin size={13} aria-hidden="true" />{t(entry.pinned ? "terminal.btw.unpin" : "terminal.btw.pin")}</Button>
          <Button size="sm" variant="ghost" onClick={() => model.archive(entry.id, !entry.archived)}>{t(entry.archived ? "terminal.btw.restore" : "terminal.btw.archive")}</Button>
          {(entry.status === "failed" || entry.status === "stopped") && <Button size="sm" variant="ghost" onClick={() => model.send(entry.id, true)}>{t("terminal.btw.retry")}</Button>}
          <Button size="sm" variant="ghost" disabled={!entry.messages.length} onClick={() => void copyTextToClipboard(btwThreadText(entry))}>{t("terminal.btw.copyThread")}</Button>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("terminal.btw.confirmDelete"))) model.remove(entry.id); }}>{t("terminal.btw.delete")}</Button>
        </div></article>);})}
    </div>
  </div>;
}
