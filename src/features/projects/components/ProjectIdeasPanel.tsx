import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/popover";
import { useI18n } from "../../../shared/i18n";
import { Check, ChevronDown, Pencil, Plus, Star, X } from "../../../shared/ui/icons";
import type { Project } from "../../../shared/types";
import { useProjectIdeaStore, type ProjectIdea } from "../api/projectIdeaStore";
import { formatProjectIdea, type ProjectIdeaCopyFormat } from "../lib/projectIdeaFormatter";

interface ProjectIdeasPanelProps {
  projects: Project[];
  activeProject: Project | null;
  popoverSide?: "top" | "right" | "bottom" | "left";
  popoverStyle?: React.CSSProperties;
}

const EMPTY_IDEAS: ProjectIdea[] = [];

export function ProjectIdeasPanel({
  projects,
  activeProject,
  popoverSide = "left",
  popoverStyle,
}: ProjectIdeasPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(activeProject?.id ?? projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingText, setEditingText] = useState("");
  const [copyFormat, setCopyFormat] = useState<ProjectIdeaCopyFormat>("plain");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoDelete, setUndoDelete] = useState<{ id: string; projectId: string } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const project = projects.find((item) => item.id === projectId) ?? activeProject ?? null;
  const ideas = useProjectIdeaStore((state) => project ? state.ideasByProject[project.id] ?? EMPTY_IDEAS : EMPTY_IDEAS);
  const loadingProjectId = useProjectIdeaStore((state) => state.loadingProjectId);
  const loadProjectIdeas = useProjectIdeaStore((state) => state.loadProjectIdeas);
  const createIdea = useProjectIdeaStore((state) => state.createIdea);
  const updateIdea = useProjectIdeaStore((state) => state.updateIdea);
  const toggleIdea = useProjectIdeaStore((state) => state.toggleIdea);
  const deleteIdea = useProjectIdeaStore((state) => state.deleteIdea);
  const restoreIdea = useProjectIdeaStore((state) => state.restoreIdea);
  const setIdeaPinned = useProjectIdeaStore((state) => state.setIdeaPinned);
  const setIdeaArchived = useProjectIdeaStore((state) => state.setIdeaArchived);
  const openWorkspace = useProjectIdeaStore((state) => state.openProjectIdeas);

  useEffect(() => {
    if (activeProject && projects.some((item) => item.id === activeProject.id)) {
      setProjectId(activeProject.id);
    }
  }, [activeProject, projects]);

  useEffect(() => {
    if (open && project) void loadProjectIdeas(project.id);
  }, [loadProjectIdeas, open, project?.id]);

  const pinnedIdeas = useMemo(
    () => ideas.filter((idea) => idea.is_pinned && !idea.is_archived).slice(0, 3),
    [ideas],
  );
  const recentIdeas = useMemo(
    () => ideas.filter((idea) => !idea.is_archived && !idea.is_pinned && idea.status === "open").slice(0, 5),
    [ideas],
  );
  const visibleIdeas = [...pinnedIdeas, ...recentIdeas];

  const showMessage = (value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage((current) => current === value ? null : current), 1800);
  };
  const showError = (value: string) => {
    setError(value);
    window.setTimeout(() => setError((current) => current === value ? null : current), 2200);
  };

  const saveIdea = async () => {
    if (!project || !title.trim() || !draft.trim() || busy) return;
    setBusy(true);
    try {
      await createIdea(project.id, draft.trim(), undefined, undefined, title.trim());
      setTitle("");
      setDraft("");
      showMessage(t("projectIdeas.toolbar.saved"));
    } catch {
      showError(t("projectIdeas.toolbar.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const copyIdea = async (idea: ProjectIdea) => {
    try {
      const text = formatProjectIdea(idea, copyFormat, project ?? undefined);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("clipboard_copy_failed");
      }
      showMessage(t("projectIdeas.toolbar.copied"));
    } catch {
      showError(t("projectIdeas.toolbar.copyFailed"));
    }
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      setOpenMenuId(null);
      showMessage(success);
    } catch {
      showError(t("projectIdeas.toolbar.actionFailed"));
    }
  };

  const saveEdit = async (idea: ProjectIdea) => {
    if (!editingTitle.trim() || !editingText.trim() || busy) return;
    setBusy(true);
    try {
      await updateIdea(idea.id, idea.project_id, editingTitle.trim(), editingText.trim());
      setEditingId(null);
      showMessage(t("projectIdeas.toolbar.saved"));
    } catch {
      showError(t("projectIdeas.toolbar.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const removeIdea = async (idea: ProjectIdea) => {
    try {
      await deleteIdea(idea);
      setUndoDelete({ id: idea.id, projectId: idea.project_id });
      showMessage(t("projectIdeas.workspace.deleted"));
      window.setTimeout(() => setUndoDelete((current) => current?.id === idea.id ? null : current), 6000);
    } catch {
      showError(t("projectIdeas.toolbar.actionFailed"));
    }
  };

  const renderIdea = (idea: ProjectIdea) => editingId === idea.id ? (
    <div key={idea.id} className="rounded border border-border p-2">
      <input value={editingTitle} onChange={(event) => setEditingTitle(event.currentTarget.value)} aria-label={t("projectIdeas.workspace.titleAria")} className="mb-1 h-8 w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-on-surface outline-none" />
      <textarea value={editingText} onChange={(event) => setEditingText(event.currentTarget.value)} rows={3} autoFocus className="max-h-32 w-full resize-y overflow-y-auto rounded border border-border bg-bg-primary px-2 py-1 text-xs text-on-surface outline-none" />
      <div className="mt-1 flex justify-end gap-1">
        <button type="button" className="icon-btn" onClick={() => setEditingId(null)} aria-label={t("projectIdeas.cancelEdit")}><X size={13} /></button>
        <button type="button" className="icon-btn" onClick={() => void saveEdit(idea)} disabled={!editingTitle.trim() || !editingText.trim() || busy} aria-label={t("projectIdeas.saveEdit")}><Check size={13} /></button>
      </div>
    </div>
  ) : (
    <div key={idea.id} className={`group rounded border px-2 py-1.5 ${idea.is_pinned ? "border-amber-400/70 bg-amber-500/10" : "border-border"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="flex items-center gap-1 truncate text-xs font-semibold" title={idea.title}>
            {idea.is_pinned && <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" aria-label={t("projectIdeas.workspace.pinned")} />}
            <span className={idea.status === "done" ? "line-through opacity-60" : ""}>{idea.title}</span>
          </p>
          <p className="mt-0.5 max-h-8 overflow-hidden break-words text-[11px] leading-4 text-text-muted" title={idea.content}>{idea.content}</p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" className="icon-btn" onClick={() => void runAction(() => toggleIdea(idea), idea.status === "done" ? t("projectIdeas.toolbar.reopened") : t("projectIdeas.toolbar.completed"))} aria-label={idea.status === "done" ? t("projectIdeas.reopen") : t("projectIdeas.complete")}><Check size={12} /></button>
          <details className="relative" open={openMenuId === idea.id} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) setOpenMenuId(idea.id); }}>
            <summary className="icon-btn list-none cursor-pointer" aria-label={t("projectIdeas.toolbar.moreActions")}>•••</summary>
            <div className="absolute right-0 z-10 mt-1 flex min-w-36 flex-col rounded border border-border bg-bg-primary p-1 shadow-lg">
              <button type="button" className="px-2 py-1 text-left text-[11px] hover:bg-[var(--interactive-hover-bg)]" onClick={() => void runAction(() => setIdeaPinned(idea.id, idea.project_id, !idea.is_pinned), idea.is_pinned ? t("projectIdeas.toolbar.unpinned") : t("projectIdeas.toolbar.pinned"))}>{idea.is_pinned ? t("projectIdeas.workspace.unpin") : t("projectIdeas.workspace.pin")}</button>
              <button type="button" className="px-2 py-1 text-left text-[11px] hover:bg-[var(--interactive-hover-bg)]" onClick={() => void runAction(() => setIdeaArchived(idea.id, idea.project_id, !idea.is_archived), idea.is_archived ? t("projectIdeas.toolbar.unarchived") : t("projectIdeas.toolbar.archived"))}>{idea.is_archived ? t("projectIdeas.workspace.unarchive") : t("projectIdeas.workspace.archive")}</button>
              <button type="button" className="px-2 py-1 text-left text-[11px] hover:bg-[var(--interactive-hover-bg)]" onClick={() => { setOpenMenuId(null); void copyIdea(idea); }}>{t("projectIdeas.toolbar.copyIdea")}</button>
              <button type="button" className="px-2 py-1 text-left text-[11px] hover:bg-[var(--interactive-hover-bg)]" onClick={() => { setOpenMenuId(null); setEditingId(idea.id); setEditingTitle(idea.title); setEditingText(idea.content); }}>{t("projectIdeas.edit")}</button>
              <button type="button" className="px-2 py-1 text-left text-[11px] text-danger hover:bg-[var(--interactive-hover-bg)]" onClick={() => { setOpenMenuId(null); void removeIdea(idea); }}>{t("projectIdeas.delete")}</button>
            </div>
          </details>
        </div>
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="ui-focus-ring ui-icon-action ui-action-project-ideas" aria-label={t("projectIdeas.toolbar.open")} title={t("projectIdeas.toolbar.open")}><Pencil size={16} strokeWidth={1.8} /></button></PopoverTrigger>
      <PopoverContent side={popoverSide} style={popoverStyle} className="w-[min(380px,calc(100vw-32px))] p-3 text-on-surface">
        <div className="mb-2 flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">{t("projectIdeas.toolbar.title")}</h2><p className="text-[11px] text-text-muted">{t("projectIdeas.toolbar.description")}</p></div><button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label={t("projectIdeas.toolbar.close")}><X size={14} /></button></div>
        <label className="mb-2 block text-[11px] text-text-muted">
          {t("projectIdeas.toolbar.project")}
          <span className="relative mt-1 block">
            <select
              value={project?.id ?? ""}
              onChange={(event) => setProjectId(event.currentTarget.value)}
              className="h-8 w-full appearance-none rounded-md border border-border bg-bg-primary px-2 pr-7 text-xs text-on-surface outline-none"
              disabled={projects.length === 0}
            >
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 top-2 text-text-muted" />
          </span>
        </label>
        <button type="button" className="mb-2 w-full rounded border border-border px-2 py-1.5 text-left text-xs hover:bg-[var(--interactive-hover-bg)]" onClick={() => { if (project) { openWorkspace(project.id); setOpen(false); } }}>{t("projectIdeas.workspace.openWorkspace")}</button>
        <div className="mb-2 flex gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <input
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={t("projectIdeas.workspace.titlePlaceholder")}
              aria-label={t("projectIdeas.workspace.titleAria")}
              className="h-8 w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 text-xs text-on-surface outline-none"
            />
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              rows={2}
              placeholder={t("projectIdeas.toolbar.placeholder")}
              aria-label={t("projectIdeas.toolbar.inputAria")}
              className="w-full resize-y rounded-md border border-border bg-bg-primary px-2 py-1.5 text-xs text-on-surface outline-none"
            />
            <button
              type="button"
              className="icon-btn self-end"
              onClick={() => void saveIdea()}
              disabled={!project || !draft.trim() || busy}
              title={t("projectIdeas.toolbar.add")}
              aria-label={t("projectIdeas.toolbar.add")}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        {undoDelete && <div className="mb-2 flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]"><span>{t("projectIdeas.workspace.deleted")}</span><button type="button" className="underline" onClick={() => void restoreIdea(undoDelete.id, undoDelete.projectId).then(() => setUndoDelete(null))}>{t("projectIdeas.workspace.undo")}</button></div>}
        {(message || error) && <p className={`mb-2 text-[11px] ${error ? "text-danger" : "text-success"}`}>{error ?? message}</p>}
        <label className="mb-2 flex items-center gap-2 text-[11px] text-text-muted">
          {t("projectIdeas.toolbar.copyFormat")}
          <select
            value={copyFormat}
            onChange={(event) => setCopyFormat(event.currentTarget.value as ProjectIdeaCopyFormat)}
            className="h-7 rounded border border-border bg-bg-primary px-1 text-xs"
          >
            <option value="plain">{t("projectIdeas.toolbar.copyPlain")}</option>
            <option value="markdown">{t("projectIdeas.toolbar.copyMarkdown")}</option>
            <option value="prompt">{t("projectIdeas.toolbar.copyPrompt")}</option>
            <option value="context">{t("projectIdeas.toolbar.copyContext")}</option>
          </select>
        </label>
        <div className="max-h-64 space-y-1.5 overflow-y-auto">{!project && <p className="py-4 text-center text-xs text-text-muted">{t("projectIdeas.toolbar.noProject")}</p>}{project && loadingProjectId === project.id && <p className="py-4 text-center text-xs text-text-muted">{t("projectIdeas.loading")}</p>}{project && loadingProjectId !== project.id && ideas.length === 0 && <p className="py-4 text-center text-xs text-text-muted">{t("projectIdeas.empty")}</p>}{visibleIdeas.map(renderIdea)}</div>
        <button type="button" className="mt-2 w-full rounded border border-border px-2 py-1.5 text-xs hover:bg-[var(--interactive-hover-bg)]" onClick={() => { if (project) { openWorkspace(project.id); setOpen(false); } }}>{t("projectIdeas.toolbar.viewAll")}</button>
      </PopoverContent>
    </Popover>
  );
}
