import { Button } from "../../../../shared/ui/button";
import { useI18n } from "../../../../shared/i18n";
import { Check, Copy, Folder, Pencil, Star, Trash2, X } from "../../../../shared/ui/icons";
import type { WorktreeRecord } from "../../../../shared/types";
import type { ProjectIdea, ProjectIdeaPriority } from "../../api/projectIdeaStore";
import { getWorktreeDisplayName } from "../../api/worktreeMetadata";

interface IdeaInspectorProps {
  selected: ProjectIdea | null;
  draft: string;
  busy: boolean;
  isEditing: boolean;
  setDraft: (value: string) => void;
  onCopy: () => void;
  copyFormat: "plain" | "markdown" | "prompt" | "context";
  setCopyFormat: (value: "plain" | "markdown" | "prompt" | "context") => void;
  copyState: "idle" | "success" | "failure";
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

export function IdeaInspector({
  selected,
  draft,
  busy,
  isEditing,
  setDraft,
  onCopy,
  copyFormat,
  setCopyFormat,
  copyState,
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
            <Button size="sm" onClick={onPin} aria-label={selected.is_pinned ? t("projectIdeas.toolbar.unpinned") : t("projectIdeas.toolbar.pinned")} title={selected.is_pinned ? t("projectIdeas.toolbar.unpinned") : t("projectIdeas.toolbar.pinned")}><Star size={13} className={selected.is_pinned ? "fill-amber-400 text-amber-400" : ""} /></Button>
            <Button size="sm" onClick={onArchive} aria-label={selected.is_archived ? t("projectIdeas.toolbar.unarchived") : t("projectIdeas.toolbar.archived")} title={selected.is_archived ? t("projectIdeas.toolbar.unarchived") : t("projectIdeas.toolbar.archived")}><Folder size={13} /></Button>
            <Button size="sm" onClick={onToggle} disabled={busy}>
              <Check size={13} />
              {selected.status === "done"
                ? t("projectIdeas.reopen")
                : t("projectIdeas.complete")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              disabled={busy}
              aria-label={t("projectIdeas.workspace.deleteAria")}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
        <label className="block text-xs text-text-muted">{t("projectIdeas.workspace.original")}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (!isEditing || event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            onSave();
          }}
          readOnly={!isEditing}
          rows={6}
          aria-label={t("projectIdeas.workspace.originalAria")}
          className={`mt-1 max-h-56 w-full resize-y overflow-y-auto rounded border bg-bg-primary p-2 text-sm outline-none ${isEditing ? "border-border focus:border-[var(--interactive-focus-ring)]" : "border-transparent read-only:cursor-default read-only:opacity-80"}`}
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
        {isEditing && <Button onClick={onSave} disabled={busy || !draft.trim()}>
          <Pencil size={13} />
          {t("projectIdeas.workspace.save")}
        </Button>}
      </div>
    </section>
  );
}
