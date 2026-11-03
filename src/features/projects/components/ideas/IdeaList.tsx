import type { KeyboardEvent, RefObject } from "react";
import { useRef } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSwappingStrategy, useSortable, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "../../../../shared/ui/button";
import { useI18n, type TranslationKey } from "../../../../shared/i18n";
import { Folder, GripVertical, Plus, Star } from "../../../../shared/ui/icons";
import type { ProjectIdea } from "../../api/projectIdeaStore";
import { projectIdeaPreview } from "../../lib/projectIdeaPreview";

interface IdeaListProps {
  ideas: ProjectIdea[];
  totalCount: number;
  selected: ProjectIdea | null;
  loading: boolean;
  busy: boolean;
  newDraft: string;
  setNewDraft: (value: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onAdd: () => void;
  onSelect: (id: string) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  canReorder: boolean;
  onReorder: (orderedIds: string[], previousIds: string[]) => Promise<void>;
  onBulk: (action: "pin" | "archive" | "complete") => Promise<void>;
}

export function IdeaList({
  ideas,
  totalCount,
  selected,
  loading,
  busy,
  newDraft,
  setNewDraft,
  composerRef,
  onAdd,
  onSelect,
  selectedIds,
  onSelectedIdsChange,
  canReorder,
  onReorder,
  onBulk,
}: IdeaListProps) {
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
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
  const handleListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true'], [data-idea-drag-handle]")) return;
    if (ideas.length === 0) return;
    const currentIndex = ideas.findIndex((idea) => idea.id === selected?.id);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? (delta > 0 ? 0 : ideas.length - 1)
      : Math.min(ideas.length - 1, Math.max(0, currentIndex + delta));
    const next = ideas[nextIndex];
    if (!next || next.id === selected?.id) return;
    event.preventDefault();
    onSelect(next.id);
    const node = sectionRef.current?.querySelector<HTMLButtonElement>(`[data-idea-id="${next.id}"]`);
    node?.focus();
    node?.scrollIntoView({ block: "nearest" });
  };
  return (
    <section
      ref={sectionRef}
      onKeyDown={handleListKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded border border-border p-2"
    >
      <div className="ui-idea-composer flex min-w-0 flex-col rounded-lg border border-border bg-bg-primary px-2.5 py-2">
        <textarea
          ref={composerRef}
          value={newDraft}
          onChange={(event) => setNewDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            if (newDraft.trim() && !busy) void onAdd();
          }}
          placeholder={t("projectIdeas.placeholder")}
          aria-label={t("projectIdeas.workspace.newIdeaAria")}
          rows={2}
          className="min-h-[38px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-text-muted"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-text-muted">{t("projectIdeas.saveHint")}</span>
          <Button
            size="sm"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onAdd}
            disabled={busy || !newDraft.trim()}
          >
            <Plus size={13} />
            {t("projectIdeas.workspace.new")}
          </Button>
        </div>
      </div>
      {selectedIds.length > 0 && <div className="flex gap-1"><Button size="sm" onClick={() => void onBulk("complete")}>{t("projectIdeas.complete")}</Button><Button size="sm" onClick={() => void onBulk("archive")}>{t("projectIdeas.workspace.archive")}</Button><Button size="sm" onClick={() => void onBulk("pin")}>{t("projectIdeas.workspace.pin")}</Button></div>}
      {loading ? (
        <p className="p-4 text-center text-xs text-text-muted">
          {t("projectIdeas.loading")}
        </p>
      ) : ideas.length === 0 ? (
        <div className="p-4 text-center text-xs text-text-muted">
          <p>{totalCount === 0 ? t("projectIdeas.empty") : t("projectIdeas.workspace.noMatches")}</p>
          <p className="mt-1">{totalCount === 0 ? t("projectIdeas.workspace.emptyHint") : t("projectIdeas.workspace.noMatchesHint")}</p>
        </div>
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
  const { heading, excerpt } = projectIdeaPreview(idea);
  const isSelected = idea.id === selected?.id;
  return <button ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes}
            type="button" data-idea-id={idea.id} onClick={() => onSelect(idea.id)} aria-current={isSelected ? "true" : undefined}
            className={`min-w-0 rounded border p-3 text-left transition-colors ${isDragging ? "opacity-60" : ""} ${idea.is_pinned ? "border-amber-400/70 bg-amber-500/10" : isSelected ? "border-[var(--interactive-focus-ring)] bg-[var(--interactive-hover-bg)] shadow-[inset_2px_0_0_0_var(--primary)]" : "border-border"}`}>
            <div className="flex items-start gap-2">
              {canReorder && <span {...listeners} data-idea-drag-handle className="cursor-grab pt-0.5 text-text-muted" aria-label={t("projectIdeas.workspace.reorderAria")} title={t("projectIdeas.workspace.reorderAria")}><GripVertical size={14} /></span>}
              <input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={(event) => onSelectedIdsChange(event.target.checked ? [...selectedIds, idea.id] : selectedIds.filter((id) => id !== idea.id))} onClick={(event) => event.stopPropagation()} aria-label={heading} />
              <span className="min-w-0 flex-1 overflow-hidden">
                <strong className={`block truncate text-sm font-semibold ${idea.status === "done" ? "line-through opacity-60" : ""}`} title={idea.title}>{heading}</strong>
                {excerpt && <span className="mt-1 block max-h-8 overflow-hidden break-words text-xs leading-4 text-text-muted" title={idea.content}>{excerpt}</span>}
              </span>
              <span className="shrink-0 text-[10px] text-text-muted">
                {idea.status === "done" ? t("projectIdeas.workspace.done") : t("projectIdeas.workspace.open")}
              </span>
            </div>
            <div className="mt-1 flex gap-1 text-[10px] text-text-muted">{idea.is_pinned && <span><Star size={10} className="inline" /> {t("projectIdeas.workspace.pinned")}</span>}{idea.is_archived && <span><Folder size={10} className="inline" /> {t("projectIdeas.workspace.archived")}</span>}</div>
          </button>;
}
