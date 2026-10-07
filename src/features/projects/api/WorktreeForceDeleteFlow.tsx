import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Project, WorktreeRecord } from "../../../shared/types/index";
import { useI18n } from "../../../shared/i18n/index";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../shared/ui/dialog";
import { Button } from "../../../shared/ui/button";
import { useWorktreeStore } from "./worktreeStore";
import { FinishGeneration } from "./worktreeFinish";
import { WorktreeForceDeleteDialog } from "./WorktreeForceDeleteDialog";
import type { ForceDeleteConfirmation } from "./worktreeForceDelete";

interface WorktreeForceDeleteFlowProps {
  project: Project | null;
  worktree: WorktreeRecord | null;
  open: boolean;
  onClose: () => void;
}

function targetIdentity(project: Project | null, worktree: WorktreeRecord | null): string {
  return project && worktree ? `${project.id}\0${project.path}\0${worktree.project_id}\0${worktree.id}\0${worktree.path}\0${worktree.branch}\0${worktree.base_branch}` : "";
}

/** Read-only preflight and explicit confirmation only; the store owns deletion authority. */
export function WorktreeForceDeleteFlow({ project, worktree, open, onClose }: WorktreeForceDeleteFlowProps) {
  const { t } = useI18n();
  const inspectForceDelete = useWorktreeStore(state => state.inspectForceDelete);
  const forceDelete = useWorktreeStore(state => state.forceDelete);
  const [confirmation, setConfirmation] = useState<(ForceDeleteConfirmation & { generationToken: number }) | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(new FinishGeneration());
  const identity = targetIdentity(project, worktree);
  const currentProps = useRef({ open, identity, worktree });
  currentProps.current = { open, identity, worktree };
  const isCurrent = (token: number) => currentProps.current.open && currentProps.current.identity === identity && generation.current.current(token);

  const inspect = async (token: number, target: WorktreeRecord) => {
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    setConfirmation(null);
    try {
      const checked = await inspectForceDelete(target);
      if (isCurrent(token)) setConfirmation({ ...checked, generationToken: token });
    } catch (err) {
      if (isCurrent(token)) setFailure(err);
    } finally {
      if (isCurrent(token)) { busyRef.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    const token = generation.current.begin();
    busyRef.current = false;
    setBusy(false);
    setConfirmation(null);
    setFailure(null);
    const target = currentProps.current.worktree;
    if (open && target) void inspect(token, target);
    return () => generation.current.cancel();
    // Object/language refresh is not a new authorization cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity]);

  // All hooks run even for a closed or absent target.
  if (!project || !worktree) return null;
  const cancel = () => {
    if (busyRef.current) return;
    generation.current.cancel();
    setConfirmation(null);
    onClose();
  };
  const retry = () => {
    if (!open || busyRef.current || confirmation) return;
    void inspect(generation.current.begin(), worktree);
  };
  const confirm = (typedPath: string) => {
    if (!confirmation || !isCurrent(confirmation.generationToken) || busyRef.current || typedPath !== confirmation.confirmedPath) return;
    const checked = confirmation;
    const token = generation.current.begin();
    busyRef.current = true;
    setBusy(true);
    setConfirmation(null);
    setFailure(null);
    void forceDelete(worktree, checked, typedPath, () => isCurrent(token)).then(() => {
      if (isCurrent(token)) { toast.success(t("worktree.forceDelete.done")); onClose(); }
    }).catch(err => {
      if (isCurrent(token)) setFailure(err);
    }).finally(() => {
      if (isCurrent(token)) { busyRef.current = false; setBusy(false); }
    });
  };

  return <>
    <Dialog open={open && confirmation === null} onOpenChange={next => { if (!next && !confirmation) cancel(); }}>
      <DialogContent className="max-w-[520px]" showCloseButton={false} onInteractOutside={event => { if (busyRef.current) event.preventDefault(); }} onEscapeKeyDown={event => { if (busyRef.current) event.preventDefault(); }}>
        <DialogTitle>{t("worktree.forceDelete.title")}</DialogTitle>
        <DialogDescription className="mt-2 text-danger">{t("worktree.forceDelete.risk")}</DialogDescription>
        <p className="mt-3 break-all text-sm">{worktree.path}</p>
        {busy && <p role="status" className="mt-3 text-sm">{t("common.processing")}</p>}
        {failure != null && <div role="alert" className="mt-3 break-words text-sm text-danger">{t("worktree.forceDelete.failed")}<pre className="whitespace-pre-wrap">{failure instanceof Error ? failure.message : String(failure)}</pre></div>}
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={busy}>{t("common.cancel")}</Button>
          {failure != null && <Button variant="destructive" onClick={retry} disabled={busy}>{t("worktree.forceDelete.retry")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {open && confirmation && <WorktreeForceDeleteDialog key={confirmation.token} confirmation={confirmation} onConfirm={confirm} onClose={cancel} />}
  </>;
}
