import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { GitFileChange, Project, WorktreeRecord } from "../../../shared/types/index";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { useWorktreeStore, type GitWorktreeMergeResult } from "./worktreeStore";
import { useTerminalStore } from "../../terminal/state";
import { canReviewFinish, assertCleanupReady, FinishGeneration, readFinishReview, withFinishLock, type FinishState } from "./worktreeFinish";
import { getWorktreeDisplayName } from "./worktreeMetadata";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../shared/ui/dialog";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";

interface WorktreeFinishDialogProps {
  project: Project | null;
  worktree: WorktreeRecord | null;
  open: boolean;
  onClose: () => void;
}

type Step = "review" | "merge" | "cleanup" | "done";
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface FinishErrorInfo {
  code?: string;
  title: string;
  description: string;
  details?: string[];
  raw?: string;
}

function formatChangeSummary(changes: GitFileChange[]): string {
  if (changes.length === 0) return "";
  return changes.map((change) => `${change.status} ${change.path}`).join("\n");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createMergeConflictError(
  conflictFiles: string[],
  t: Translate,
  stashCreated = false
): FinishErrorInfo {
  return {
    code: "merge_conflict",
    title: t("worktree.finish.error.conflictTitle"),
    description: t("worktree.finish.error.conflictDescription"),
    details: [
      ...(conflictFiles.length > 0 ? conflictFiles : [t("worktree.finish.error.noConflictFiles")]),
      ...(stashCreated ? [t("worktree.finish.error.forceMergeStashRetained")] : []),
    ],
  };
}

function createStashRestoreError(result: GitWorktreeMergeResult, t: Translate): FinishErrorInfo {
  const mergeWasAborted = !result.merged;
  return {
    code: "force_merge_restore_conflict",
    title: t(
      mergeWasAborted
        ? "worktree.finish.error.forceConflictRestoreTitle"
        : "worktree.finish.error.forceRestoreConflictTitle"
    ),
    description: t(
      mergeWasAborted
        ? "worktree.finish.error.forceConflictRestoreDescription"
        : "worktree.finish.error.forceRestoreConflictDescription"
    ),
    details: [
      ...(mergeWasAborted && result.conflictFiles.length > 0
        ? [t("worktree.finish.error.forceMergeConflictFiles"), ...result.conflictFiles]
        : []),
      ...(result.stashRestoreConflictFiles.length > 0
        ? result.stashRestoreConflictFiles
        : [t("worktree.finish.error.noConflictFiles")]),
      ...(result.stashReference
        ? [t("worktree.finish.error.forceRestoreStashReference", { reference: result.stashReference })]
        : []),
      t("worktree.finish.error.forceMergeStashRetained"),
    ],
    raw: result.output,
  };
}

function formatFinishError(err: unknown, t: Translate, projectPath?: string): FinishErrorInfo {
  const raw = errorText(err).trim();
  if (raw.includes("finish_database_failed")) return { code: "database", title: t("worktree.finish.databasePending"), description: t("worktree.finish.databaseFailed"), raw };
  if (raw.includes("finish_sessions_changed")) return { code: "sessions", title: t("worktree.finish.sessionsTitle"), description: t("worktree.finish.sessionsChanged"), raw };
  if (raw.includes("finish_unknown")) return { code: "unknown", title: t("worktree.finish.unknownTitle"), description: t("worktree.finish.unknownMessage"), raw };
  if (raw.includes("finish_legacy_residual_manual_review")) return { code: "legacy", title: t("worktree.finish.blockedTitle"), description: t("worktree.finish.legacyResidualMessage", { path: projectPath ?? "" }), raw };
  if (raw.includes("merge_conflict")) return { ...createMergeConflictError([], t), raw };
  if (raw.includes("finish_")) return { code: "blocked", title: t("worktree.finish.blockedTitle"), description: t("worktree.finish.blockedMessage"), raw };
  if (raw.includes("stage_all_failed") || raw.includes("stage_all_update_failed")) {
    return {
      code: "stage_all_failed",
      title: t("worktree.finish.error.stageAllFailedTitle"),
      description: t("worktree.finish.error.stageAllFailedDescription", { path: projectPath ?? "" }),
      raw,
    };
  }

  if (raw.includes("dirty_main_worktree")) {
    return {
      code: "dirty_main_worktree",
      title: t("worktree.finish.error.dirtyMainTitle"),
      description: t("worktree.finish.error.dirtyMainDescription"),
      details: [
        ...(projectPath ? [t("worktree.finish.error.mainPath", { path: projectPath })] : []),
        t("worktree.finish.error.dirtyMainAction"),
        t("worktree.finish.error.dirtyMainSafe"),
      ],
    };
  }

  if (raw.includes("force_merge_stash_failed") || raw.includes("force_merge_stash_reference_failed") || raw.includes("force_merge_stash_incomplete")) {
    return {
      code: "force_merge_stash_failed",
      title: t("worktree.finish.error.forceStashTitle"),
      description: t("worktree.finish.error.forceStashDescription"),
      raw,
    };
  }

  if (raw.includes("force_merge_restore_failed")) {
    return {
      code: "force_merge_restore_failed",
      title: t("worktree.finish.error.forceRestoreTitle"),
      description: t("worktree.finish.error.forceRestoreDescription"),
      raw,
    };
  }

  if (raw.includes("force_merge_checkout_failed")) {
    return {
      code: "force_merge_checkout_failed",
      title: t("worktree.finish.error.forceCheckoutTitle"),
      description: t("worktree.finish.error.forceCheckoutDescription"),
      raw,
    };
  }

  if (raw.includes("force_merge_abort_failed")) {
    return {
      code: "force_merge_abort_failed",
      title: t("worktree.finish.error.forceAbortTitle"),
      description: t("worktree.finish.error.forceAbortDescription"),
      raw,
    };
  }

  if (raw.includes("worktree_branch_not_found") || raw.includes("branch_not_found")) {
    return {
      code: "branch_not_found",
      title: t("worktree.finish.error.branchMissingTitle"),
      description: t("worktree.finish.error.branchMissingDescription"),
      raw,
    };
  }

  if (raw.includes("merge_failed")) {
    return {
      code: "merge_failed",
      title: t("worktree.finish.error.mergeFailedTitle"),
      description: t("worktree.finish.error.mergeFailedDescription"),
      raw,
    };
  }

  return {
    code: "generic",
    title: t("worktree.finish.error.genericTitle"),
    description: t("worktree.finish.error.genericDescription"),
    raw,
  };
}

export function WorktreeFinishDialog({ project, worktree, open, onClose }: WorktreeFinishDialogProps) {
  const { t } = useI18n();
  const inspectFinish = useWorktreeStore(state => state.inspectFinish);
  const finishMerge = useWorktreeStore(state => state.finishMerge);
  const finishCleanup = useWorktreeStore(state => state.finishCleanup);
  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [step, setStep] = useState<Step>("review");
  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(new FinishGeneration());
  const [authority, setAuthority] = useState<FinishState | null>(null);
  const [output, setOutput] = useState("");
  const [failureStage, setFailureStage] = useState<"operation" | "cleanup">("operation");
  const [failure, setFailure] = useState<unknown>(null);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [cleanupConfirmation, setCleanupConfirmation] = useState<string[] | null>(null);
  const currentProps = useRef({ project, worktree });
  currentProps.current = { project, worktree };
  const identity = project && worktree ? `${project.path}\0${worktree.id}\0${worktree.path}\0${worktree.branch}\0${worktree.base_branch}` : "";

  // 仅当前打开周期可发布结果；重新检查前先由 Rust 判定路径是否可读。
  const refresh = async (token: number, target: WorktreeRecord) => {
    const review = await readFinishReview(() => inspectFinish(target), () => generation.current.current(token)
      ? invoke<GitFileChange[]>("git_get_changes", { projectPath: target.path }) : Promise.resolve([]));
    if (!generation.current.current(token)) return;
    setAuthority(review.state);
    setChanges(review.changes);
    setStep(review.step);
    setOutput(review.state.mergeResult?.output ?? "");
  };
  useEffect(() => {
    const token = generation.current.begin();
    setChanges([]);
    setAuthority(null);
    setFailure(null);
    setOutput("");
    setStep("review");
    setForceConfirmOpen(false);
    setCleanupConfirmation(null);
    const target = currentProps.current.worktree;
    if (!open || !target) return () => generation.current.cancel();
    setFailureStage("operation");
    setCommitMessage(getWorktreeDisplayName(target));
    setLoadingChanges(true);
    void refresh(token, target).catch(err => {
      if (generation.current.current(token)) setFailure(err);
    }).finally(() => {
      if (generation.current.current(token)) setLoadingChanges(false);
    });
    return () => generation.current.cancel();
    // Object and language refreshes are not new open cycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity]);

  const changeSummary = useMemo(() => formatChangeSummary(changes), [changes]);
  const error: FinishErrorInfo | null = failure ? failureStage === "cleanup" && !errorText(failure).includes("finish_database_failed") && !errorText(failure).includes("finish_sessions_changed")
    ? { title: t("worktree.finish.cleanupFailedTitle"), description: t("worktree.finish.cleanupFailedMessage"), raw: errorText(failure) }
    : formatFinishError(failure, t, worktree?.path) : authority?.blocker && !canReviewFinish(authority)
    ? authority.mergeResult?.stashCreated && !authority.mergeResult.stashRestored
      ? createStashRestoreError(authority.mergeResult, t)
      : formatFinishError(authority.blocker, t, worktree?.path)
    : authority?.unknown ? formatFinishError("finish_unknown", t) : null;
  const canCommit = !!authority && canReviewFinish(authority) && changes.length > 0 && commitMessage.trim().length > 0 && !busy && !loadingChanges && !failure;
  const mergeBlockedByRestore = !authority || !canReviewFinish(authority) || loadingChanges;

  if (!project || !worktree) return null;

  // 操作失败先恢复后端实际阶段，再显示本次错误，不用异常回退历史合并进度。
  const run = async (action: (token: number) => Promise<void>) => {
    if (busyRef.current || loadingChanges) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    setFailureStage("operation");
    const token = generation.current.begin();
    try { await action(token); }
    catch (err) {
      if (generation.current.current(token)) {
        setChanges([]);
        setAuthority(null);
        try { await refresh(token, worktree); } catch { /* Keep original stage error. */ }
        if (generation.current.current(token)) setFailure(err);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // 暂存及提交前分别复核有效 checkout；共享锁阻止同 Worktree 的并发丢弃。
  const handleCommit = () => {
    if (!canCommit) return;
    void run(async token => {
      await withFinishLock(worktree.id, async () => {
        const checked = await inspectFinish(worktree);
        if (!generation.current.current(token)) return;
        if (!canReviewFinish(checked)) throw new Error(checked.blocker || "finish_invalid_checkout");
        await invoke("git_stage_all", { projectPath: worktree.path });
        const beforeCommit = await inspectFinish(worktree);
        if (!generation.current.current(token)) return;
        if (!canReviewFinish(beforeCommit)) throw new Error(beforeCommit.blocker || "finish_invalid_checkout");
        await invoke("git_commit", { projectPath: worktree.path, message: commitMessage.trim() });
      });
      await refresh(token, worktree);
    });
  };
  const merge = (force: boolean) => {
    if (mergeBlockedByRestore || changes.length) return;
    setForceConfirmOpen(false);
    void run(async token => {
      const review = await readFinishReview(() => inspectFinish(worktree), () => invoke<GitFileChange[]>("git_get_changes", { projectPath: worktree.path }));
      if (!generation.current.current(token)) return;
      if (review.changes.length || !canReviewFinish(review.state)) { await refresh(token, worktree); return; }
      const state = await finishMerge(worktree, force);
      await refresh(token, worktree);
      if (generation.current.current(token) && state.mergeResult) setOutput(state.mergeResult.output);
      if (!state.merged && state.outcome !== "no_diff" && state.mergeResult) {
        throw new Error(`merge_conflict: ${state.mergeResult.conflictFiles.join(", ")}\n${state.mergeResult.output}`);
      }
    });
  };
  const handleMerge = () => merge(false);
  const handleForceMerge = () => merge(true);
  // 先验证清理授权，再列出当前关联会话；打开确认框不执行关闭或删除。
  const handleCleanup = () => void run(async token => {
    const checked = await inspectFinish(worktree);
    if (!generation.current.current(token)) return;
    assertCleanupReady(checked);
    if (generation.current.current(token)) {
      setAuthority(checked);
      setCleanupConfirmation(useTerminalStore.getState().sessions.filter(session => session.worktreeId === worktree.id).map(session => session.id));
    }
  });
  const confirmCleanup = () => {
    if (cleanupConfirmation === null) return;
    const confirmed = cleanupConfirmation;
    setCleanupConfirmation(null);
    void run(async token => {
      setFailureStage("cleanup");
      await finishCleanup(worktree, true, confirmed);
      if (generation.current.current(token)) {
        setStep("done");
        toast.success(t("worktree.finish.cleanupDone"));
        onClose();
      }
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next && !busyRef.current && !forceConfirmOpen && cleanupConfirmation === null) onClose(); }}>
      <DialogContent className="max-w-[520px]" showCloseButton={false}>
        <DialogTitle>{t("worktree.finish.title", { name: getWorktreeDisplayName(worktree) })}</DialogTitle>
        <DialogDescription className="mt-2">
          {t("worktree.finish.description", { branch: worktree.branch })}
        </DialogDescription>

        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-bg-secondary/60 p-3">
            <div className="mb-1 text-xs font-semibold text-text-secondary">{t("worktree.finish.changes")}</div>
            {loadingChanges ? (
              <div className="text-xs text-text-muted">{t("common.loading")}</div>
            ) : changes.length === 0 ? (
              <div className="text-xs text-text-muted">{t("worktree.finish.noChanges")}</div>
            ) : (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-text-secondary">{changeSummary}</pre>
            )}
          </div>

          {step === "review" && (
            <div>
              <label className="mb-1 block text-xs text-text-muted">{t("worktree.finish.commitMessage")}</label>
              <Textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.currentTarget.value)}
                className="h-20 resize-none text-sm"
              />
            </div>
          )}

          {authority && changes.length === 0 && (authority.merged || authority.outcome === "no_diff" || authority.done) && (
            <div className="text-xs text-text-secondary">{t(authority.done ? "worktree.finish.databasePending" : authority.outcome === "no_diff" ? "worktree.finish.noDiffToMerge" : "worktree.finish.mergedEvidence")}</div>
          )}
          {authority && !authority.checkoutValid && <div className="text-xs text-text-muted">{t("worktree.finish.invalidCheckout")}</div>}
          {authority?.stashReference && <div className="text-xs text-danger">{t("worktree.finish.error.forceRestoreStashReference", { reference: authority.stashReference })}</div>}
          {output && (
            <pre className="max-h-36 overflow-auto rounded-lg border border-border bg-bg-tertiary p-2 text-[11px] text-text-secondary">{output}</pre>
          )}

          {error && (
            <div className="rounded-lg border border-danger/25 bg-danger/15 px-3 py-2 text-xs text-danger">
              <div className="font-semibold">{error.title}</div>
              <div className="mt-1 leading-relaxed">{error.description}</div>
              {error.details && error.details.length > 0 && (
                <div className="mt-2 rounded-md bg-bg-primary/60 p-2 text-text-secondary">
                  <div className="mb-1 font-semibold text-text-primary">{t("worktree.finish.error.details")}</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {error.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </div>
              )}
              {error.raw && (
                <div className="mt-2 rounded-md bg-bg-primary/60 p-2 text-text-secondary">
                  <div className="mb-1 font-semibold text-text-primary">{t("worktree.finish.error.raw")}</div>
                  <pre className="whitespace-pre-wrap break-words">{error.raw}</pre>
                </div>
              )}
              {error.code === "dirty_main_worktree" && (
                <Button
                  className="mt-3"
                  variant="destructive"
                  onClick={() => setForceConfirmOpen(true)}
                  disabled={busy}
                  aria-label={t("worktree.finish.forceMergeAria")}
                >
                  {t("worktree.finish.forceMerge")}
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => void run(async token => { setChanges([]); await refresh(token, worktree); })} disabled={busy || loadingChanges}>{t("worktree.finish.reinspect")}</Button>
          <Button variant="outline" onClick={() => { if (!busyRef.current && !forceConfirmOpen && cleanupConfirmation === null) onClose(); }} disabled={busy}>{t("common.cancel")}</Button>
          {step === "review" && <Button onClick={handleCommit} disabled={!canCommit}>{busy ? t("common.processing") : t("worktree.finish.commitAll")}</Button>}
          {step === "merge" && <Button onClick={handleMerge} disabled={busy || mergeBlockedByRestore || changes.length > 0}>{busy ? t("common.processing") : t("worktree.finish.merge")}</Button>}
          {step === "cleanup" && <Button onClick={handleCleanup} disabled={busy || loadingChanges || !authority || !!authority.blocker || authority.unknown || (!authority.done && !authority.cleanupReady)}>{busy ? t("common.processing") : t("worktree.finish.cleanup")}</Button>}
        </DialogFooter>
      </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={cleanupConfirmation !== null}
        title={t("worktree.finish.sessionsTitle")}
        message={t("worktree.finish.sessionsMessage", { count: cleanupConfirmation?.length ?? 0 })}
        confirmText={t("worktree.finish.cleanup")}
        cancelText={t("common.cancel")}
        danger
        explicitCloseOnly
        onConfirm={confirmCleanup}
        onClose={() => { if (!busyRef.current) setCleanupConfirmation(null); }}
      />
      <ConfirmDialog
        open={forceConfirmOpen}
        title={t("worktree.finish.forceMergeConfirmTitle")}
        message={t("worktree.finish.forceMergeConfirmMessage")}
        confirmText={t("worktree.finish.forceMergeConfirm")}
        cancelText={t("common.cancel")}
        danger
        explicitCloseOnly
        onConfirm={handleForceMerge}
        onClose={() => { if (!busyRef.current) setForceConfirmOpen(false); }}
      />
    </>
  );
}
