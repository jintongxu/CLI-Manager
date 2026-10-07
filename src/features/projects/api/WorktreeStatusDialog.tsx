import { useEffect, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../shared/i18n/index';
import type { Project, WorktreeRecord } from '../../../shared/types/index';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import { finishRequest, FinishGeneration, type FinishState } from './worktreeFinish';
import { getWorktreeDisplayName } from './worktreeMetadata';
import { inspectWorktreeStatus, worktreeStatusGuidance, worktreeStatusSummary } from './worktreeStatus';

export function WorktreeStatusDialog({ open, project, worktree, onClose }: {
  open: boolean;
  project: Project | null;
  worktree: WorktreeRecord | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<{ identity: string; state: FinishState | null; error: string | null; loading: boolean } | null>(null);
  const generation = useRef(new FinishGeneration());
  const latest = useRef({ open, project, worktree });
  latest.current = { open, project, worktree };
  const identity = project && worktree ? JSON.stringify([
    project.id, project.path, worktree.id, worktree.path, worktree.branch, worktree.base_branch,
  ]) : '';

  const refresh = async () => {
    const target = latest.current;
    if (!target.open || !target.project || !target.worktree) return;
    const token = generation.current.begin();
    const req = finishRequest(target.worktree, target.project.path);
    setSnapshot({ identity, state: null, error: null, loading: true });
    try {
      const state = await inspectWorktreeStatus(req);
      if (generation.current.current(token)) setSnapshot({ identity, state, error: null, loading: false });
    } catch (error) {
      if (generation.current.current(token)) setSnapshot({ identity, state: null, error: String(error), loading: false });
    }
  };
  useEffect(() => {
    generation.current.cancel();
    setSnapshot(null);
    if (open && identity) void refresh();
    return () => generation.current.cancel();
    // Only stable request identity/open cycles initiate inspection, not language/object refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity]);

  const close = () => {
    generation.current.cancel();
    setSnapshot(null);
    onClose();
  };
  // Hooks must stay above the guard, including closed/absent target renders.
  if (!open || !project || !worktree) return null;
  const current = snapshot?.identity === identity ? snapshot : null;
  const state = current?.state;
  const loading = !current || current.loading;
  const raw = current?.error ?? state?.blocker;
  const summaryKey: TranslationKey = loading ? 'worktree.statusView.loading'
    : current?.error ? 'worktree.statusView.error'
    : state ? `worktree.statusView.summary.${worktreeStatusSummary(state)}` : 'worktree.statusView.summary.unknown';
  const yesNo = (value: boolean) => t(value ? 'worktree.statusView.yes' : 'worktree.statusView.no');
  const field = (key: Extract<TranslationKey, `worktree.statusView.${string}`>, value: string) => <div>
    <dt className="text-text-muted">{t(key)}</dt><dd className="whitespace-pre-wrap break-all">{value}</dd>
  </div>;
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
    <DialogContent className="max-w-[560px]" showCloseButton={false}>
      <DialogTitle>{t('worktree.statusView.title', { name: getWorktreeDisplayName(worktree) })}</DialogTitle>
      <DialogDescription className="mt-2">{t('worktree.statusView.description')}</DialogDescription>
      <div className="max-h-[60vh] overflow-y-auto" aria-busy={loading}>
        <dl className="mt-3 space-y-2 text-sm">
          {field('worktree.statusView.name', getWorktreeDisplayName(worktree))}
          {field('worktree.statusView.projectPath', project.path)}
          {field('worktree.statusView.worktreePath', worktree.path)}
          {field('worktree.statusView.recordBranch', worktree.branch)}
          {field('worktree.statusView.recordBase', worktree.base_branch || t('worktree.statusView.notRecorded'))}
          {field('worktree.statusView.recordStatus', t(`worktree.statusView.record.${worktree.status}`))}
        </dl>
        <p className="mt-3 text-sm" role="status" aria-live="polite">{t(summaryKey)}</p>
        {state && <dl className="mt-3 space-y-2 text-sm">
          {field('worktree.statusView.sourceOid', state.sourceOid ?? t('worktree.statusView.notConfirmed'))}
          {field('worktree.statusView.checkoutValid', yesNo(state.checkoutValid))}
          {field('worktree.statusView.outcome', t(`worktree.statusView.outcome.${
            state.unknown ? 'notConfirmed' : state.outcome === 'no_diff' ? 'noDiff' : state.merged && state.outcome === 'merged' ? 'merged' : 'notConfirmed'
          }`))}
          {field('worktree.statusView.cleanupPending', yesNo(state.cleanupPending))}
          {field('worktree.statusView.cleanupReady', yesNo(state.cleanupReady))}
          {field('worktree.statusView.done', yesNo(state.done))}
          {field('worktree.statusView.stash', state.stashReference ?? t('worktree.statusView.notRecorded'))}
        </dl>}
        {raw && <div className="mt-3 text-sm" role="alert">
          <p>{t(`worktree.statusView.guidance.${worktreeStatusGuidance(raw)}`)}</p>
          <p className="mt-2 text-text-muted">{t('worktree.statusView.raw')}</p>
          <pre className="whitespace-pre-wrap break-all select-text">{raw}</pre>
        </div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>{t('common.close')}</Button>
        <Button onClick={() => void refresh()} disabled={loading}>{t('worktree.statusView.refresh')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
