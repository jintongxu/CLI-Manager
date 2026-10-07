import { useState, useRef } from 'react';
import { useI18n } from '../../../shared/i18n/index';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '../../../shared/ui/dialog';
import { Button } from '../../../shared/ui/button';
import type { ForceDeleteConfirmation } from './worktreeForceDelete';

export function WorktreeForceDeleteDialog({ confirmation, onConfirm, onClose }: {
  confirmation: ForceDeleteConfirmation;
  onConfirm: (typedPath: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [typedPath, setTypedPath] = useState('');
  const submitted = useRef(false);
  const label = t('worktree.forceDelete.typePath');
  return <Dialog open onOpenChange={() => { /* Explicit buttons only. */ }}>
    <DialogContent showCloseButton={false} onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
      <DialogTitle>{t('worktree.forceDelete.title')}</DialogTitle>
      <DialogDescription className="mt-2 text-danger">{t('worktree.forceDelete.risk')}</DialogDescription>
      <dl className="mt-3 space-y-2 break-all text-sm">
        <dt>{t('worktree.forceDelete.project')}</dt><dd>{confirmation.req.projectPath}</dd>
        <dt>{t('worktree.forceDelete.target')}</dt><dd>{confirmation.confirmedPath}</dd>
        <dt>{t('worktree.forceDelete.branch')}</dt><dd>{confirmation.branchOid === null ? t('worktree.forceDelete.missingBranch') : confirmation.req.branch}</dd>
      </dl>
      <p className="my-3 text-sm">{t('worktree.forceDelete.sessions', { count: confirmation.sessionIds.length })}</p>
      <label className="block text-sm">{label}
        <input className="mt-2 w-full rounded border border-border bg-bg-primary p-2" aria-label={label} value={typedPath} autoComplete="off" spellCheck={false} onChange={event => setTypedPath(event.currentTarget.value)} />
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={() => { if (!submitted.current) onClose(); }}>{t('common.cancel')}</Button>
        <Button variant="destructive" disabled={typedPath !== confirmation.confirmedPath} onClick={() => {
          if (submitted.current || typedPath !== confirmation.confirmedPath) return;
          submitted.current = true; onConfirm(typedPath);
        }}>{t('worktree.forceDelete.confirm')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
