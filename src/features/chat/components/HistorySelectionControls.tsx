import { useRef, type ReactNode } from "react";
import { ListChecks, CheckCheck, CircleMinus, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../shared/ui/dialog";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { errorCode } from "../lib/types";
import type { HistorySelection, HistorySelectionSnapshot } from "../lib/historySelection";

export function HistorySelectionControls({ selection, snapshot, scope, visibleIds, disabled, remove, idleAction }: {
  idleAction: ReactNode;
  selection: HistorySelection;
  snapshot: HistorySelectionSnapshot;
  scope: string;
  visibleIds: readonly string[];
  disabled: boolean;
  remove: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const active = snapshot.scope === scope && snapshot.enabled;
  const locked = disabled || snapshot.busy || !!snapshot.confirmation;
  const count = (key: TranslationKey, value: number) => t(key).replace("{count}", String(value));
  return <>
    <div className="chat-history-actions">
      {!active && idleAction}
      <div className="chat-history-selection" role="group" aria-label={t("chat.selectChats")}>
        {active && <>
          <span className="chat-history-selection-count" role="status"
            aria-label={count("chat.selectedCount", snapshot.ids.length)}
            title={count("chat.selectedCount", snapshot.ids.length)}>{snapshot.ids.length}</span>
          <button type="button" title={t("chat.selectLoaded")} aria-label={t("chat.selectLoaded")}
            disabled={locked || !visibleIds.length}
            onClick={() => selection.selectAll(scope, visibleIds)}><CheckCheck size={15} aria-hidden="true" /></button>
          <button type="button" title={t("chat.clearSelection")} aria-label={t("chat.clearSelection")}
            disabled={locked || !snapshot.ids.length}
            onClick={() => selection.clear(scope)}><CircleMinus size={15} aria-hidden="true" /></button>
          <button type="button" className="chat-history-selection-delete"
            title={t("chat.deleteSelected")} aria-label={t("chat.deleteSelected")}
            disabled={locked || !snapshot.ids.length}
            onClick={() => selection.open(scope, visibleIds)}><Trash2 size={15} aria-hidden="true" /></button>
        </>}
        <button ref={trigger} type="button" disabled={locked}
          title={t(active ? "chat.cancelSelection" : "chat.selectChats")}
          aria-label={t(active ? "chat.cancelSelection" : "chat.selectChats")}
          aria-pressed={active}
          onClick={() => active ? selection.cancel() : selection.start(scope)}>
          {active ? <X size={15} aria-hidden="true" /> : <ListChecks size={15} aria-hidden="true" />}
        </button>
      </div>
    </div>
    {snapshot.result && <div className="chat-history-selection-result" role={snapshot.result.failed.length ? "alert" : "status"}>
      {count("chat.deletedCount", snapshot.result.succeeded.length)}{" "}
      {!!snapshot.result.failed.length && <>
        {count("chat.deleteFailedCount", snapshot.result.failed.length)}
        <ul>{snapshot.result.failed.map(({ id, error }) => {
          const key = `chat.error.${errorCode(error)}` as TranslationKey;
          const message = t(key);
          return <li key={id}>{id}: {message === key ? t("chat.error.chat_storage") : message}</li>;
        })}</ul>
      </>}
    </div>}
    <Dialog open={!!snapshot.confirmation} onOpenChange={open => { if (!open) selection.close(); }}>
      <DialogContent showCloseButton={false} aria-busy={snapshot.busy}
        onEscapeKeyDown={event => { if (snapshot.busy) event.preventDefault(); }}
        onPointerDownOutside={event => event.preventDefault()}
        onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogTitle>{t("chat.deleteSelected")}</DialogTitle>
        <DialogDescription>{count("chat.confirmBulkDelete", snapshot.confirmation?.length ?? 0)}</DialogDescription>
        <div className="chat-dialog-actions">
          <button type="button" autoFocus disabled={snapshot.busy} onClick={() => selection.close()}>{t("chat.cancel")}</button>
          <button type="button" disabled={disabled || snapshot.busy}
            onClick={() => { void selection.confirm(scope, remove); }}>
            {t(snapshot.busy ? "chat.deletingSelected" : "chat.confirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
