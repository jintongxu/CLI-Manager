import { useEffect, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSwappingStrategy, useSortable, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";
import { Button } from "../../../shared/ui/button";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { useI18n, type TranslationKey } from "../../../shared/i18n";
import type { Project, WorktreeRecord } from "../../../shared/types";
import { getWorktreeDisplayName } from "../api/worktreeMetadata";
import { useWorktreeStore } from "../api/worktreeStore";
import { Folder, Check, Copy, Pencil, Plus, Star, Trash2, GripVertical, X } from "../../../shared/ui/icons";
import { formatProjectIdea } from "../lib/projectIdeaFormatter";
import {
  useProjectIdeaStore,
  type ProjectIdea,
  type ProjectIdeaPriority,
} from "../api/projectIdeaStore";

interface ProjectIdeasDialogProps {
  project: Project | null;
  projects?: Project[];
  onClose: () => void;
}

const EMPTY: ProjectIdea[] = [];

type IdeaStatusFilter = "all" | "open" | "done";
type IdeaWorkspaceFilter = "all" | "unarchived" | "archived" | "pinned";
type IdeaPriorityFilter = "all" | ProjectIdeaPriority;

export function ProjectIdeasDialog({
  project,
  projects = [],
  onClose,
}: ProjectIdeasDialogProps) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState(project?.id ?? "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<IdeaStatusFilter>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<IdeaWorkspaceFilter>("unarchived");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<IdeaPriorityFilter>("all");
  const [tag, setTag] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [organized, setOrganized] = useState("");
  const [tags, setTags] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDraft, setNewDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [copyFormat, setCopyFormat] = useState<"plain" | "markdown" | "prompt" | "context">("plain");
  const [copyState, setCopyState] = useState<"idle" | "success" | "failure">("idle");
  const [acceptanceText, setAcceptanceText] = useState("");
  const [saveRequested, setSaveRequested] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectIdea | null>(null);
  const [checklist, setChecklist] = useState<import("../api/projectIdeaStore").ProjectIdeaChecklistItem[]>([]);
  const [checklistText, setChecklistText] = useState("");
  const [undoDelete, setUndoDelete] = useState<{ id: string; projectId: string } | null>(null);

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
  const updateOrganized = useProjectIdeaStore(
    (state) => state.updateOrganizedContent,
  );
  const updateMetadata = useProjectIdeaStore(
    (state) => state.updateIdeaMetadata,
  );
  const setPinned = useProjectIdeaStore((state) => state.setIdeaPinned);
  const setArchived = useProjectIdeaStore((state) => state.setIdeaArchived);
  const batchPinned = useProjectIdeaStore((state) => state.batchSetPinned);
  const batchArchived = useProjectIdeaStore((state) => state.batchSetArchived);
  const toggle = useProjectIdeaStore((state) => state.toggleIdea);
  const remove = useProjectIdeaStore((state) => state.deleteIdea);
  const restore = useProjectIdeaStore((state) => state.restoreIdea);
  const listChecklist = useProjectIdeaStore((state) => state.listChecklistItems);
  const addChecklist = useProjectIdeaStore((state) => state.addChecklistItem);
  const updateChecklist = useProjectIdeaStore((state) => state.updateChecklistItem);
  const deleteChecklist = useProjectIdeaStore((state) => state.deleteChecklistItem);
  const updateAcceptance = useProjectIdeaStore((state) => state.updateAcceptanceCriteria);
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
        const searchable = `${idea.title} ${idea.content} ${idea.organized_content} ${idea.tags.join(" ")}`.toLowerCase();
        const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
        const matchesStatus = status === "all" || idea.status === status;
        const matchesWorkspace = workspaceFilter === "all" || (workspaceFilter === "unarchived" && !idea.is_archived) || (workspaceFilter === "archived" && idea.is_archived) || (workspaceFilter === "pinned" && idea.is_pinned);
        const matchesPriority = priority === "all" || idea.priority === priority;
        const matchesTag = tag === "all" || idea.tags.includes(tag);
        return matchesQuery && matchesStatus && matchesWorkspace && matchesPriority && matchesTag;
      }),
    [ideas, normalizedQuery, status, workspaceFilter, priority, tag],
  );
  const selected =
    filtered.find((idea) => idea.id === selectedId) ?? filtered[0] ?? null;
  const canReorder = !normalizedQuery && (workspaceFilter === "all" || workspaceFilter === "unarchived") && status === "all" && priority === "all" && tag === "all" && selectedIds.length === 0;
  const selectedWorktree = selected?.worktree_id
    ? projectWorktrees.find((worktree) => worktree.id === selected.worktree_id) ?? null
    : null;

  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id);
      setTitle(selected.title);
      setDraft(selected.content);
      setOrganized(selected.organized_content);
      setTags(selected.tags.join(", "));
      setAcceptanceText(selected.acceptance_criteria.join("\n"));
      setIsEditing(false);
      if (selectedProject) void listChecklist(selected.id, selectedProject.id).then(setChecklist).catch(() => setChecklist([]));
    }
  }, [selected?.id, selectedProject?.id, listChecklist]);

  const allTags = Array.from(new Set(ideas.flatMap((idea) => idea.tags))).sort();
  const parseTags = () =>
    tags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const save = async () => {
    if (!selected || !selectedProject || busy || !title.trim() || !draft.trim()) return;
    setBusy(true);
    try {
      setMutationError(null);
      await update(selected.id, selectedProject.id, title, draft);
      await updateOrganized(selected.id, selectedProject.id, organized);
      await updateMetadata(
        selected.id,
        selectedProject.id,
        selected.priority,
        parseTags(),
      );
      await updateAcceptance(selected.id, selectedProject.id, acceptanceText.split("\n"));
      setIsEditing(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const requestSave = () => {
    if (isEditing && selected && selectedProject && !busy && title.trim() && draft.trim()) {
      setSaveRequested(true);
    }
  };

  const cancelEditing = () => {
    if (selected) {
      setTitle(selected.title);
      setDraft(selected.content);
      setOrganized(selected.organized_content);
      setTags(selected.tags.join(", "));
      setAcceptanceText(selected.acceptance_criteria.join("\n"));
    }
    setIsEditing(false);
  };

  const add = async () => {
    if (!selectedProject || busy || !newTitle.trim() || !newDraft.trim()) return;
    setBusy(true);
    try {
      setMutationError(null);
      const idea = await create(selectedProject.id, newDraft, undefined, undefined, newTitle);
      setNewTitle("");
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
    try {
      await navigator.clipboard.writeText(formatProjectIdea(selected, copyFormat, selectedProject ?? undefined, selectedWorktree ?? undefined));
      setMutationError(null);
      setCopyState("success");
    } catch (error) {
      setCopyState("failure");
      setMutationError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestDeleteSelected = () => {
    if (selected && !busy) setDeleteTarget(selected);
  };

  const confirmDeleteSelected = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setBusy(true);
    try {
      setMutationError(null);
      await remove(target);
      setUndoDelete({ id: target.id, projectId: target.project_id });
      setSelectedId(null);
      window.setTimeout(() => setUndoDelete((current) => current?.id === target.id ? null : current), 6000);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(760px,calc(100vh-32px))] min-h-0 max-w-5xl flex-col gap-0 p-0">
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
            tag={tag}
            setTag={setTag}
            allTags={allTags}
            workspaceFilter={workspaceFilter}
            setWorkspaceFilter={setWorkspaceFilter}
          />
          {undoDelete && (
            <div className="flex items-center justify-between rounded border border-border bg-bg-secondary px-3 py-2 text-xs">
              <span>{t("projectIdeas.workspace.deleted")}</span>
              <Button size="sm" onClick={() => { void restore(undoDelete.id, undoDelete.projectId).then(() => setUndoDelete(null)); }}>{t("projectIdeas.workspace.undo")}</Button>
            </div>
          )}
          {(error || mutationError) && (
            <div className="flex items-center justify-between rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
              <span>
                {error
                  ? t("projectIdeas.workspace.error")
                  : t("projectIdeas.workspace.saveError")}
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
              selected={selected}
              loading={loading}
              busy={busy}
              newTitle={newTitle}
              setNewTitle={setNewTitle}
              newDraft={newDraft}
              setNewDraft={setNewDraft}
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
              title={title}
              draft={draft}
              organized={organized}
              tags={tags}
              busy={busy}
              setTitle={setTitle}
              setDraft={setDraft}
              setOrganized={setOrganized}
              setTags={setTags}
              onCopy={() => void copySelected()}
              copyFormat={copyFormat}
              setCopyFormat={setCopyFormat}
              copyState={copyState}
              acceptanceText={acceptanceText}
              setAcceptanceText={setAcceptanceText}
              checklist={checklist}
              checklistText={checklistText}
              setChecklistText={setChecklistText}
              onAddChecklist={async () => { if (isEditing && selected && selectedProject && checklistText.trim()) { const item = await addChecklist(selected.id, selectedProject.id, checklistText); setChecklist((items) => [...items, item]); setChecklistText(""); } }}
              onToggleChecklist={async (item) => { if (isEditing && selected && selectedProject) { await updateChecklist(item.id, selected.id, selectedProject.id, { is_completed: !item.is_completed }); setChecklist((items) => items.map((current) => current.id === item.id ? { ...current, is_completed: !current.is_completed } : current)); } }}
              onDeleteChecklist={async (item) => { if (isEditing && selected && selectedProject) { await deleteChecklist(item.id, selected.id, selectedProject.id); setChecklist((items) => items.filter((current) => current.id !== item.id)); } }}
              onToggle={() => isEditing && selected && void toggle(selected)}
              onPin={() => isEditing && selected && selectedProject && void setPinned(selected.id, selectedProject.id, !selected.is_pinned)}
              onArchive={() => isEditing && selected && selectedProject && void setArchived(selected.id, selectedProject.id, !selected.is_archived)}
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
                  void updateMetadata(
                    selected.id,
                    selected.project_id,
                    value,
                    parseTags(),
                  );
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

interface WorkspaceFiltersProps {
  projects: Project[];
  project: Project | null;
  projectId: string;
  setProjectId: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  status: IdeaStatusFilter;
  setStatus: (value: IdeaStatusFilter) => void;
  priority: IdeaPriorityFilter;
  setPriority: (value: IdeaPriorityFilter) => void;
  tag: string;
  setTag: (value: string) => void;
  allTags: string[];
  workspaceFilter: IdeaWorkspaceFilter;
  setWorkspaceFilter: (value: IdeaWorkspaceFilter) => void;
}

function WorkspaceFilters({
  projects,
  project,
  projectId,
  setProjectId,
  query,
  setQuery,
  status,
  setStatus,
  priority,
  setPriority,
  tag,
  setTag,
  allTags,
  workspaceFilter,
  setWorkspaceFilter,
}: WorkspaceFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={projectId}
        onChange={(event) => setProjectId(event.currentTarget.value)}
        className="h-8 max-w-full rounded border border-border bg-bg-primary px-2 text-xs"
        aria-label={t("projectIdeas.workspace.project")}
      >
        {projects.length > 0 ? (
          projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))
        ) : (
          <option value={project?.id}>{project?.name}</option>
        )}
      </select>
      <input
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={t("projectIdeas.workspace.search")}
        aria-label={t("projectIdeas.workspace.searchAria")}
        className="h-8 min-w-[150px] flex-1 rounded border border-border bg-bg-primary px-2 text-xs"
      />
      <select
        value={workspaceFilter}
        onChange={(event) => setWorkspaceFilter(event.currentTarget.value as IdeaWorkspaceFilter)}
        className="h-8 rounded border border-border bg-bg-primary px-2 text-xs"
        aria-label={t("projectIdeas.workspace.filter")}
      >
        <option value="all">{t("projectIdeas.workspace.all")}</option>
        <option value="unarchived">{t("projectIdeas.workspace.unarchived")}</option>
        <option value="archived">{t("projectIdeas.workspace.archived")}</option>
        <option value="pinned">{t("projectIdeas.workspace.pinned")}</option>
      </select>
      <select
        value={status}
        onChange={(event) => setStatus(event.currentTarget.value as IdeaStatusFilter)}
        className="h-8 rounded border border-border bg-bg-primary px-2 text-xs"
        aria-label={t("projectIdeas.workspace.status")}
      >
        <option value="all">{t("projectIdeas.workspace.all")}</option>
        <option value="open">{t("projectIdeas.workspace.open")}</option>
        <option value="done">{t("projectIdeas.workspace.done")}</option>
      </select>
      <select
        value={priority}
        onChange={(event) =>
          setPriority(event.currentTarget.value as IdeaPriorityFilter)
        }
        className="h-8 rounded border border-border bg-bg-primary px-2 text-xs"
        aria-label={t("projectIdeas.workspace.priority")}
      >
        <option value="all">{t("projectIdeas.workspace.all")}</option>
        <option value="high">{t("projectIdeas.workspace.priorityHigh")}</option>
        <option value="medium">{t("projectIdeas.workspace.priorityMedium")}</option>
        <option value="low">{t("projectIdeas.workspace.priorityLow")}</option>
      </select>
      <select
        value={tag}
        onChange={(event) => setTag(event.currentTarget.value)}
        className="h-8 rounded border border-border bg-bg-primary px-2 text-xs"
        aria-label={t("projectIdeas.workspace.tag")}
      >
        <option value="all">{t("projectIdeas.workspace.all")}</option>
        {allTags.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </div>
  );
}

interface IdeaListProps {
  ideas: ProjectIdea[];
  selected: ProjectIdea | null;
  loading: boolean;
  busy: boolean;
  newTitle: string;
  setNewTitle: (value: string) => void;
  newDraft: string;
  setNewDraft: (value: string) => void;
  onAdd: () => void;
  onSelect: (id: string) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  canReorder: boolean;
  onReorder: (orderedIds: string[], previousIds: string[]) => Promise<void>;
  onBulk: (action: "pin" | "archive" | "complete") => Promise<void>;
}

function IdeaList({
  ideas,
  selected,
  loading,
  busy,
  newTitle,
  setNewTitle,
  newDraft,
  setNewDraft,
  onAdd,
  onSelect,
  selectedIds,
  onSelectedIdsChange,
  canReorder,
  onReorder,
  onBulk,
}: IdeaListProps) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!canReorder || !over || active.id === over.id) return;
    const oldIndex = ideas.findIndex((idea) => idea.id === active.id);
    const newIndex = ideas.findIndex((idea) => idea.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previousIds = ideas.map((idea) => idea.id);
    await onReorder(arrayMove(previousIds, oldIndex, newIndex), previousIds);
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded border border-border p-2">
      <div className="flex gap-2">
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.currentTarget.value)}
          placeholder={t("projectIdeas.workspace.titlePlaceholder")}
          aria-label={t("projectIdeas.workspace.titleAria")}
          className="min-w-0 rounded border border-border bg-bg-primary px-2 py-1.5 text-sm"
        />
        <textarea
          value={newDraft}
          onChange={(event) => setNewDraft(event.currentTarget.value)}
          placeholder={t("projectIdeas.placeholder")}
          aria-label={t("projectIdeas.workspace.newIdeaAria")}
          className="min-w-0 flex-1 resize-y rounded border border-border bg-bg-primary px-2 py-1.5 text-sm"
        />
        <Button size="sm" onClick={onAdd} disabled={busy || !newTitle.trim() || !newDraft.trim()}>
          <Plus size={14} />
          {t("projectIdeas.workspace.new")}
        </Button>
      </div>
      {selectedIds.length > 0 && <div className="flex gap-1"><Button size="sm" onClick={() => void onBulk("complete")}>{t("projectIdeas.complete")}</Button><Button size="sm" onClick={() => void onBulk("archive")}>{t("projectIdeas.workspace.archive")}</Button><Button size="sm" onClick={() => void onBulk("pin")}>{t("projectIdeas.workspace.pin")}</Button></div>}
      {loading ? (
        <p className="p-4 text-center text-xs text-text-muted">
          {t("projectIdeas.loading")}
        </p>
      ) : ideas.length === 0 ? (
        <p className="p-4 text-center text-xs text-text-muted">
          {t("projectIdeas.empty")}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void handleDragEnd(event)}>
          <SortableContext items={ideas.map((idea) => idea.id)} strategy={rectSwappingStrategy}>
            {ideas.map((idea) => <SortableIdeaCard key={idea.id} idea={idea} selected={selected} selectedIds={selectedIds} onSelect={onSelect} onSelectedIdsChange={onSelectedIdsChange} canReorder={canReorder} t={t} />)}
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function SortableIdeaCard({ idea, selected, selectedIds, onSelect, onSelectedIdsChange, canReorder, t }: { idea: ProjectIdea; selected: ProjectIdea | null; selectedIds: string[]; onSelect: (id: string) => void; onSelectedIdsChange: (ids: string[]) => void; canReorder: boolean; t: (key: TranslationKey) => string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idea.id, disabled: !canReorder });
  return <button ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes}
            type="button" onClick={() => onSelect(idea.id)}
            className={`min-w-0 rounded border p-3 text-left transition-colors ${isDragging ? "opacity-60" : ""} ${idea.is_pinned ? "border-amber-400/70 bg-amber-500/10" : idea.id === selected?.id ? "border-[var(--interactive-focus-ring)] bg-[var(--interactive-hover-bg)]" : "border-border"}`}>
            <div className="flex items-start gap-2">
              {canReorder && <span {...listeners} className="cursor-grab pt-0.5 text-text-muted" aria-label={t("projectIdeas.workspace.reorderAria")} title={t("projectIdeas.workspace.reorderAria")}><GripVertical size={14} /></span>}
              <input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={(event) => onSelectedIdsChange(event.target.checked ? [...selectedIds, idea.id] : selectedIds.filter((id) => id !== idea.id))} onClick={(event) => event.stopPropagation()} aria-label={idea.title} />
              <span className="min-w-0 flex-1 overflow-hidden">
                <strong className={`block truncate text-sm font-semibold ${idea.status === "done" ? "line-through opacity-60" : ""}`} title={idea.title}>{idea.title}</strong>
                <span className="mt-1 block max-h-8 overflow-hidden break-words text-xs leading-4 text-text-muted" title={idea.content}>{idea.content}</span>
              </span>
              <span className="shrink-0 text-[10px] text-text-muted">
                {idea.status === "done" ? t("projectIdeas.workspace.done") : t("projectIdeas.workspace.open")}
              </span>
            </div>
            <div className="mt-1 flex gap-1 text-[10px] text-text-muted">{idea.is_pinned && <span><Star size={10} className="inline" /> {t("projectIdeas.workspace.pinned")}</span>}{idea.is_archived && <span><Folder size={10} className="inline" /> {t("projectIdeas.workspace.archived")}</span>}</div>
            {idea.tags.length > 0 && (
              <div className="mt-1 text-[10px] text-text-muted">
                {idea.tags.join(" · ")}
              </div>
            )}
          </button>;
}

interface IdeaInspectorProps {
  selected: ProjectIdea | null;
  title: string;
  draft: string;
  organized: string;
  tags: string;
  busy: boolean;
  isEditing: boolean;
  setTitle: (value: string) => void;
  setDraft: (value: string) => void;
  setOrganized: (value: string) => void;
  setTags: (value: string) => void;
  onCopy: () => void;
  copyFormat: "plain" | "markdown" | "prompt" | "context";
  setCopyFormat: (value: "plain" | "markdown" | "prompt" | "context") => void;
  copyState: "idle" | "success" | "failure";
  acceptanceText: string;
  setAcceptanceText: (value: string) => void;
  checklist: import("../api/projectIdeaStore").ProjectIdeaChecklistItem[];
  checklistText: string;
  setChecklistText: (value: string) => void;
  onAddChecklist: () => Promise<void>;
  onToggleChecklist: (item: import("../api/projectIdeaStore").ProjectIdeaChecklistItem) => Promise<void>;
  onDeleteChecklist: (item: import("../api/projectIdeaStore").ProjectIdeaChecklistItem) => Promise<void>;
  onToggle: () => void;
  onPin: () => void;
  onArchive: () => void;
  onEdit: () => void;
  onCancelEditing: () => void;
  onDelete: () => void;
  onSave: () => void;
  onPriorityChange: (value: ProjectIdeaPriority) => void;
  worktrees: WorktreeRecord[];
  selectedWorktree: WorktreeRecord | null;
  onWorktreeChange: (worktreeId: string | null) => void;
}

function IdeaInspector({
  selected,
  title,
  draft,
  organized,
  tags,
  busy,
  isEditing,
  setTitle,
  setDraft,
  setOrganized,
  setTags,
  onCopy,
  copyFormat,
  setCopyFormat,
  copyState,
  acceptanceText,
  setAcceptanceText,
  checklist,
  checklistText,
  setChecklistText,
  onAddChecklist,
  onToggleChecklist,
  onDeleteChecklist,
  onToggle,
  onPin,
  onArchive,
  onEdit,
  onCancelEditing,
  onDelete,
  onSave,
  onPriorityChange,
  worktrees,
  selectedWorktree,
  onWorktreeChange,
}: IdeaInspectorProps) {
  const { t } = useI18n();
  if (!selected) {
    return (
      <section className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded border border-border p-3">
        <p className="p-4 text-center text-xs text-text-muted">
          {t("projectIdeas.workspace.noSelection")}
        </p>
      </section>
    );
  }

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded border border-border p-3">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3
            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide ${
              isEditing
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                : "border-sky-400/40 bg-sky-400/10 text-sky-200"
            }`}
          >
            {isEditing ? t("projectIdeas.workspace.editing") : t("projectIdeas.workspace.preview")}
          </h3>
          <div className="flex flex-wrap justify-end gap-1">
            {isEditing ? (
              <Button size="sm" variant="outline" onClick={onCancelEditing} disabled={busy}>
                <X size={13} />
                {t("projectIdeas.workspace.cancelEdit")}
              </Button>
            ) : (
              <Button size="sm" onClick={onEdit}>
                <Pencil size={13} />
                {t("projectIdeas.workspace.edit")}
              </Button>
            )}
            <select value={copyFormat} onChange={(event) => setCopyFormat(event.currentTarget.value as typeof copyFormat)} aria-label={t("projectIdeas.toolbar.copyFormat")} className="h-8 rounded border border-border bg-bg-primary px-1 text-xs">
              <option value="plain">{t("projectIdeas.toolbar.copyPlain")}</option>
              <option value="markdown">{t("projectIdeas.toolbar.copyMarkdown")}</option>
              <option value="prompt">{t("projectIdeas.toolbar.copyPrompt")}</option>
              <option value="context">{t("projectIdeas.toolbar.copyContext")}</option>
            </select>
            <Button size="sm" onClick={onCopy} aria-label={t("projectIdeas.toolbar.copyIdea")}>
              <Copy size={13} />
              {copyState === "success" ? t("projectIdeas.toolbar.copied") : t("projectIdeas.toolbar.copyIdea")}
            </Button>
            {copyState === "failure" && <span className="self-center text-[11px] text-danger">{t("projectIdeas.toolbar.copyFailed")}</span>}
            <Button size="sm" onClick={onPin} disabled={!isEditing} aria-label={selected.is_pinned ? t("projectIdeas.toolbar.unpinned") : t("projectIdeas.toolbar.pinned")} title={selected.is_pinned ? t("projectIdeas.toolbar.unpinned") : t("projectIdeas.toolbar.pinned")}><Star size={13} className={selected.is_pinned ? "fill-amber-400 text-amber-400" : ""} /></Button>
            <Button size="sm" onClick={onArchive} disabled={!isEditing} aria-label={selected.is_archived ? t("projectIdeas.toolbar.unarchived") : t("projectIdeas.toolbar.archived")} title={selected.is_archived ? t("projectIdeas.toolbar.unarchived") : t("projectIdeas.toolbar.archived")}><Folder size={13} /></Button>
            <Button size="sm" onClick={onToggle} disabled={!isEditing}>
              <Check size={13} />
              {selected.status === "done"
                ? t("projectIdeas.reopen")
                : t("projectIdeas.complete")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={!isEditing}
              aria-label={t("projectIdeas.workspace.deleteAria")}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
        <label className="block text-xs text-text-muted">
          {t("projectIdeas.workspace.title")}
          <input value={title} onChange={(event) => setTitle(event.currentTarget.value)} readOnly={!isEditing} aria-label={t("projectIdeas.workspace.titleAria")} className="mt-1 h-8 w-full rounded border border-border bg-bg-primary px-2 text-sm read-only:cursor-default read-only:opacity-80" />
        </label>
        <label className="block text-xs text-text-muted">{t("projectIdeas.workspace.original")}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          readOnly={!isEditing}
          rows={6}
          aria-label={t("projectIdeas.workspace.originalAria")}
          className="max-h-56 w-full resize-y overflow-y-auto rounded border border-border bg-bg-primary p-2 text-sm"
        />
        </label>
        <label className="block text-xs text-text-muted">
          {t("projectIdeas.workspace.worktree")}
          <select
            value={selected?.worktree_id ?? ""}
            onChange={(event) => onWorktreeChange(event.currentTarget.value || null)}
            disabled={!isEditing}
            className="mt-1 block h-8 w-full rounded border border-border bg-bg-primary px-2 text-xs"
            aria-label={t("projectIdeas.workspace.worktree")}
          >
            <option value="">{t("projectIdeas.workspace.noWorktree")}</option>
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {getWorktreeDisplayName(worktree)} · {worktree.path}
              </option>
            ))}
            {selected?.worktree_id && !selectedWorktree && (
              <option value={selected.worktree_id}>{t("projectIdeas.workspace.unlinkedWorktree")}</option>
            )}
          </select>
          {selected?.worktree_id && !selectedWorktree && (
            <span className="mt-1 block text-[10px] text-text-muted">{t("projectIdeas.workspace.unlinkedWorktree")}</span>
          )}
        </label>
        <label className="block text-xs text-text-muted">
          {t("projectIdeas.workspace.priority")}
          <select
            value={selected.priority}
            onChange={(event) =>
              onPriorityChange(event.currentTarget.value as ProjectIdeaPriority)
            }
            disabled={!isEditing}
            className="mt-1 block h-8 rounded border border-border bg-bg-primary px-2 text-xs"
          >
            <option value="high">{t("projectIdeas.workspace.priorityHigh")}</option>
            <option value="medium">{t("projectIdeas.workspace.priorityMedium")}</option>
            <option value="low">{t("projectIdeas.workspace.priorityLow")}</option>
          </select>
        </label>
        <label className="block text-xs text-text-muted">
          {t("projectIdeas.workspace.tag")}
          <input
            value={tags}
            onChange={(event) => setTags(event.currentTarget.value)}
            readOnly={!isEditing}
            placeholder={t("projectIdeas.workspace.tagsHint")}
            className="mt-1 block h-8 w-full rounded border border-border bg-bg-primary px-2 text-xs"
          />
        </label>
        <label className="block text-xs text-text-muted">
          {t("projectIdeas.workspace.acceptanceCriteria")}
          <textarea value={acceptanceText} onChange={(event) => setAcceptanceText(event.currentTarget.value)} readOnly={!isEditing} rows={3} placeholder={t("projectIdeas.workspace.acceptanceCriteriaHint")} className="mt-1 w-full resize-y rounded border border-border bg-bg-primary p-2 text-sm read-only:cursor-default read-only:opacity-80" />
        </label>
        <div className="rounded border border-border p-2">
          <h4 className="text-xs font-semibold">{t("projectIdeas.workspace.checklist")}</h4>
          <div className="mt-1 space-y-1">
            {checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(item.is_completed)}
                  disabled={!isEditing}
                  onChange={() => void onToggleChecklist(item)}
                />
                <span className={item.is_completed ? "line-through opacity-60" : ""}>{item.text}</span>
                {isEditing && (
                  <button
                    type="button"
                    className="ml-auto text-danger"
                    onClick={() => void onDeleteChecklist(item)}
                    aria-label={t("projectIdeas.workspace.deleteChecklist")}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {isEditing && <div className="mt-2 flex gap-1"><input value={checklistText} onChange={(event) => setChecklistText(event.currentTarget.value)} placeholder={t("projectIdeas.workspace.checklistPlaceholder")} className="h-7 min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 text-xs" /><Button size="sm" onClick={() => void onAddChecklist()} disabled={!checklistText.trim()}><Plus size={12} /></Button></div>}
        </div>
        <label className="block text-xs text-text-muted">
          {t("projectIdeas.workspace.organized")}
          <textarea
            value={organized}
            onChange={(event) => setOrganized(event.currentTarget.value)}
            readOnly={!isEditing}
            rows={8}
            aria-label={t("projectIdeas.workspace.organizedAria")}
            className="mt-1 max-h-64 w-full resize-y overflow-y-auto rounded border border-border bg-bg-primary p-2 text-sm"
          />
        </label>
        {isEditing && <Button onClick={onSave} disabled={busy || !title.trim() || !draft.trim()}>
          <Pencil size={13} />
          {t("projectIdeas.workspace.save")}
        </Button>}
      </div>
    </section>
  );
}
