import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";
import { Button } from "../../../shared/ui/button";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { useI18n } from "../../../shared/i18n";
import type { Project } from "../../../shared/types";
import { useWorktreeStore } from "../api/worktreeStore";
import { useIdeaCopy } from "../hooks/useIdeaCopy";
import { useIdeaUndoDelete } from "../hooks/useIdeaUndoDelete";
import { useProjectIdeaStore, type ProjectIdea } from "../api/projectIdeaStore";
import { IdeaInspector } from "./ideas/IdeaInspector";
import { IdeaList } from "./ideas/IdeaList";
import { WorkspaceFilters } from "./ideas/WorkspaceFilters";
import type { IdeaPriorityFilter, IdeaStatusFilter, IdeaWorkspaceFilter } from "./ideas/types";

interface ProjectIdeasDialogProps {
  project: Project | null;
  projects?: Project[];
  onClose: () => void;
}

const EMPTY: ProjectIdea[] = [];

export function ProjectIdeasDialog({
  project,
  projects = [],
  onClose,
}: ProjectIdeasDialogProps) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState(project?.id ?? "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<IdeaStatusFilter>("open");
  const [workspaceFilter, setWorkspaceFilter] = useState<IdeaWorkspaceFilter>("unarchived");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<IdeaPriorityFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newDraft, setNewDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saveRequested, setSaveRequested] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectIdea | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const selectedProject =
    projects.find((item) => item.id === projectId) ?? project;
  const ideas = useProjectIdeaStore((state) =>
    selectedProject
      ? state.ideasByProject[selectedProject.id] ?? EMPTY
      : EMPTY,
  );
  const loading = useProjectIdeaStore((state) =>
    selectedProject ? state.loadingByProject[selectedProject.id] : false,
  );
  const error = useProjectIdeaStore((state) =>
    selectedProject ? state.errorsByProject[selectedProject.id] : null,
  );
  const load = useProjectIdeaStore((state) => state.loadProjectIdeas);
  const reload = useProjectIdeaStore((state) => state.reloadProjectIdeas);
  const create = useProjectIdeaStore((state) => state.createIdea);
  const update = useProjectIdeaStore((state) => state.updateIdea);
  const updateMetadata = useProjectIdeaStore((state) => state.updateIdeaMetadata);
  const setPinned = useProjectIdeaStore((state) => state.setIdeaPinned);
  const setArchived = useProjectIdeaStore((state) => state.setIdeaArchived);
  const batchPinned = useProjectIdeaStore((state) => state.batchSetPinned);
  const batchArchived = useProjectIdeaStore((state) => state.batchSetArchived);
  const toggle = useProjectIdeaStore((state) => state.toggleIdea);
  const remove = useProjectIdeaStore((state) => state.deleteIdea);
  const restore = useProjectIdeaStore((state) => state.restoreIdea);
  const updateIdeaWorktree = useProjectIdeaStore((state) => state.updateIdeaWorktree);
  const reorderIdeas = useProjectIdeaStore((state) => state.reorderIdeas);
  const worktrees = useWorktreeStore((state) => state.worktrees);
  const loadWorktrees = useWorktreeStore((state) => state.loadWorktrees);
  const projectWorktrees = useMemo(
    () => worktrees.filter((worktree) => worktree.project_id === selectedProject?.id),
    [selectedProject?.id, worktrees],
  );
  useEffect(() => {
    void loadWorktrees().catch(() => undefined);
  }, [loadWorktrees]);

  useEffect(() => {
    setProjectId(project?.id ?? projects[0]?.id ?? "");
  }, [project?.id, projects]);

  useEffect(() => {
    if (project?.id) setStatus("open");
  }, [project?.id]);

  useEffect(() => {
    if (selectedProject) {
      void load(selectedProject.id).catch(() => undefined);
    }
    setSelectedId(null);
    setMutationError(null);
  }, [load, selectedProject?.id]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      ideas.filter((idea) => {
        const searchable = `${idea.title} ${idea.content}`.toLowerCase();
        const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
        const matchesStatus = status === "all" || idea.status === status;
        const matchesWorkspace = workspaceFilter === "all" || (workspaceFilter === "unarchived" && !idea.is_archived) || (workspaceFilter === "archived" && idea.is_archived) || (workspaceFilter === "pinned" && idea.is_pinned);
        const matchesPriority = priority === "all" || idea.priority === priority;
        return matchesQuery && matchesStatus && matchesWorkspace && matchesPriority;
      }),
    [ideas, normalizedQuery, status, workspaceFilter, priority],
  );
  const selected = filtered.find((idea) => idea.id === selectedId) ?? null;
  const canReorder = !normalizedQuery && (workspaceFilter === "all" || workspaceFilter === "unarchived") && status === "all" && priority === "all" && selectedIds.length === 0;
  const selectedWorktree = selected?.worktree_id
    ? projectWorktrees.find((worktree) => worktree.id === selected.worktree_id) ?? null
    : null;
  const { copyFormat, setCopyFormat, copyState, copy } = useIdeaCopy({
    project: selectedProject,
    worktree: selectedWorktree,
  });
  const { undoDelete, scheduleUndo, undo } = useIdeaUndoDelete(restore);

  /** 选中项可能因筛选而离开列表时，先记下相邻项用于接续选中。 */
  const neighborIdOf = (id: string) => {
    const index = filtered.findIndex((idea) => idea.id === id);
    if (index < 0) return null;
    return (filtered[index + 1] ?? filtered[index - 1])?.id ?? null;
  };

  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id);
      setDraft(selected.content);
      setIsEditing(false);
    }
  }, [selected?.id]);

  const save = async () => {
    if (!selected || !selectedProject || busy || !draft.trim()) return;
    setBusy(true);
    try {
      setMutationError(null);
      await update(selected.id, selectedProject.id, undefined, draft.trim());
      setIsEditing(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const requestSave = () => {
    if (isEditing && selected && selectedProject && !busy && draft.trim()) {
      setSaveRequested(true);
    }
  };

  const cancelEditing = () => {
    if (selected) {
      setDraft(selected.content);
    }
    setIsEditing(false);
  };

  const add = async () => {
    if (!selectedProject || busy || !newDraft.trim()) return;
    setBusy(true);
    try {
      setMutationError(null);
      const idea = await create(selectedProject.id, newDraft.trim());
      setNewDraft("");
      setSelectedId(idea.id);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const copySelected = async () => {
    if (!selected) return;
    const result = await copy(selected);
    if (result.ok) {
      onClose();
      return;
    }
    setMutationError(result.error instanceof Error ? result.error.message : String(result.error));
  };

  const requestDeleteSelected = () => {
    if (selected && !busy) setDeleteTarget(selected);
  };

  const confirmDeleteSelected = async () => {
    const target = deleteTarget;
    if (!target) return;
    const neighborId = neighborIdOf(target.id);
    setDeleteTarget(null);
    setBusy(true);
    try {
      setMutationError(null);
      await remove(target);
      scheduleUndo({ id: target.id, projectId: target.project_id });
      setSelectedId(neighborId);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runSelectedMutation = async (mutation: () => Promise<void>, keepSelection: boolean) => {
    if (!selected || busy) return;
    const neighborId = keepSelection ? null : neighborIdOf(selected.id);
    setBusy(true);
    try {
      setMutationError(null);
      await mutation();
      if (neighborId) setSelectedId(neighborId);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = () => {
    if (!selected) return;
    const target = selected;
    void runSelectedMutation(() => toggle(target), status === "all");
  };

  const pinSelected = () => {
    if (!selected) return;
    const target = selected;
    void runSelectedMutation(
      () => setPinned(target.id, target.project_id, !target.is_pinned),
      workspaceFilter !== "pinned",
    );
  };

  const archiveSelected = () => {
    if (!selected) return;
    const target = selected;
    void runSelectedMutation(
      () => setArchived(target.id, target.project_id, !target.is_archived),
      workspaceFilter === "all" || workspaceFilter === "pinned",
    );
  };

  return (
    <>
      <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[min(760px,calc(100vh-32px))] min-h-0 max-w-5xl flex-col gap-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          composerRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>
            {selectedProject
              ? t("projectIdeas.title", { name: selectedProject.name })
              : t("projectIdeas.titleFallback")}
          </DialogTitle>
          <DialogDescription>{t("projectIdeas.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <WorkspaceFilters
            projects={projects}
            project={project}
            projectId={selectedProject?.id ?? ""}
            setProjectId={setProjectId}
            query={query}
            setQuery={setQuery}
            status={status}
            setStatus={setStatus}
            priority={priority}
            setPriority={setPriority}
            workspaceFilter={workspaceFilter}
            setWorkspaceFilter={setWorkspaceFilter}
          />
          {undoDelete && (
            <div className="flex items-center justify-between rounded border border-border bg-bg-secondary px-3 py-2 text-xs">
              <span>{t("projectIdeas.workspace.deleted")}</span>
              <Button size="sm" onClick={() => void undo()}>{t("projectIdeas.workspace.undo")}</Button>
            </div>
          )}
          {(error || mutationError) && (
            <div className="flex items-center justify-between gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              <span className="min-w-0 break-words">
                {error
                  ? t("projectIdeas.workspace.error")
                  : t("projectIdeas.workspace.saveError")}
                {mutationError ? <span className="ml-1 opacity-80">({mutationError})</span> : null}
              </span>
              {error && (
                <Button
                  size="sm"
                  onClick={() => selectedProject && void reload(selectedProject.id)}
                >
                  {t("projectIdeas.workspace.retry")}
                </Button>
              )}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
            <IdeaList
              ideas={filtered}
              totalCount={ideas.length}
              selected={selected}
              loading={loading}
              busy={busy}
              newDraft={newDraft}
              setNewDraft={setNewDraft}
              composerRef={composerRef}
              onAdd={() => void add()}
              onSelect={setSelectedId}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              canReorder={canReorder}
              onReorder={async (orderedIds, previousIds) => {
                if (!selectedProject) return;
                try {
                  const visibleIds = new Set(ideas.filter((idea) => !idea.is_archived).map((idea) => idea.id));
                  let nextVisibleIndex = 0;
                  const mergedOrder = ideas.map((idea) => visibleIds.has(idea.id) ? orderedIds[nextVisibleIndex++] : idea.id);
                  await reorderIdeas(selectedProject.id, mergedOrder);
                } catch (error) {
                  setMutationError(error instanceof Error ? error.message : String(error));
                  // Store updates are transactional; reload ensures the visible list is restored.
                  await reload(selectedProject.id).catch(() => undefined);
                  if (previousIds.length === 0) return;
                }
              }}
              onBulk={async (action) => {
                if (!selectedProject || selectedIds.length === 0) return;
                if (action === "pin") await batchPinned(selectedProject.id, selectedIds, true);
                if (action === "archive") await batchArchived(selectedProject.id, selectedIds, true);
                if (action === "complete") for (const id of selectedIds) await useProjectIdeaStore.getState().updateIdeaStatus(id, selectedProject.id, "done");
                setSelectedIds([]);
              }}
            />
            <IdeaInspector
              selected={selected}
              draft={draft}
              busy={busy}
              setDraft={setDraft}
              onCopy={() => void copySelected()}
              copyFormat={copyFormat}
              setCopyFormat={setCopyFormat}
              copyState={copyState}
              onToggle={toggleSelected}
              onPin={pinSelected}
              onArchive={archiveSelected}
              isEditing={isEditing}
              onEdit={() => setIsEditing(true)}
              onCancelEditing={cancelEditing}
              onDelete={requestDeleteSelected}
              onSave={requestSave}
              worktrees={projectWorktrees}
              selectedWorktree={selectedWorktree}
              onWorktreeChange={(worktreeId) => {
                if (isEditing && selected && selectedProject) {
                  void updateIdeaWorktree(selected.id, selectedProject.id, worktreeId).catch((error) => {
                    setMutationError(error instanceof Error ? error.message : String(error));
                  });
                }
              }}
              onPriorityChange={(value) => {
                if (isEditing && selected) {
                  void updateMetadata(selected.id, selected.project_id, value);
                }
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={saveRequested}
      title={t("projectIdeas.workspace.confirmSaveTitle")}
      message={t("projectIdeas.workspace.confirmSaveMessage")}
      confirmText={t("projectIdeas.workspace.saveConfirm")}
      cancelText={t("projectIdeas.workspace.cancel")}
      onConfirm={() => {
        setSaveRequested(false);
        void save();
      }}
      onClose={() => setSaveRequested(false)}
    />
    <ConfirmDialog
      open={deleteTarget !== null}
      title={t("projectIdeas.workspace.confirmDelete")}
      message={deleteTarget?.title}
      confirmText={t("projectIdeas.workspace.deleteConfirm")}
      cancelText={t("projectIdeas.workspace.cancel")}
      danger
      onConfirm={() => void confirmDeleteSelected()}
      onClose={() => setDeleteTarget(null)}
    />
    </>
  );
}
