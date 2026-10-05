import { create } from "zustand";
import { getDb } from "../../../shared/platform/db";

export type ProjectIdeaStatus = "open" | "done";
export type ProjectIdeaPriority = "low" | "medium" | "high";
export const PROJECT_IDEA_MAX_CONTENT_LENGTH = 10_000;
export const PROJECT_IDEA_MAX_TITLE_LENGTH = 200;
export const PROJECT_IDEA_FALLBACK_TITLE = "Untitled";

export interface ProjectIdea {
  id: string;
  project_id: string;
  title: string;
  content: string;
  organized_content: string;
  status: ProjectIdeaStatus;
  priority: ProjectIdeaPriority;
  tags: string[];
  created_at: number;
  updated_at: number;
  worktree_id: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  acceptance_criteria: string[];
  sort_order: number;
}

export interface ProjectIdeaChecklistItem {
  id: string;
  idea_id: string;
  text: string;
  is_completed: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface ProjectIdeaStore {
  ideasByProject: Record<string, ProjectIdea[]>;
  loadingByProject: Record<string, boolean>;
  errorsByProject: Record<string, string | null>;
  /** Compatibility field for existing callers; use loadingByProject for new code. */
  loadingProjectId: string | null;
  activeProjectId: string | null;
  openProjectIdeas: (projectId: string) => void;
  closeProjectIdeas: () => void;
  loadProjectIdeas: (projectId: string) => Promise<void>;
  reloadProjectIdeas: (projectId: string) => Promise<void>;
  createIdea: (
    projectId: string,
    content: string,
    priority?: ProjectIdeaPriority,
    tags?: string[],
    title?: string,
  ) => Promise<ProjectIdea>;
  /** Accepts (id, projectId, content) for compatibility or (id, projectId, title, content). */
  updateIdea: (
    id: string,
    projectId: string,
    titleOrContent: string,
    content?: string,
  ) => Promise<void>;
  updateIdeaMetadata: (
    id: string,
    projectId: string,
    priority: ProjectIdeaPriority,
    tags: string[],
  ) => Promise<void>;
  updateIdeaWorktree: (
    id: string,
    projectId: string,
    worktreeId: string | null,
  ) => Promise<void>;
  updateOrganizedContent: (
    id: string,
    projectId: string,
    organizedContent: string,
  ) => Promise<void>;
  /** Changes status using both the idea id and owning project id. */
  updateIdeaStatus: (
    id: string,
    projectId: string,
    status: ProjectIdeaStatus,
  ) => Promise<void>;
  toggleIdea: (idea: ProjectIdea) => Promise<void>;
  deleteIdea: (idea: ProjectIdea) => Promise<void>;
  setIdeaPinned: (
    id: string,
    projectId: string,
    pinned: boolean,
  ) => Promise<void>;
  setIdeaArchived: (
    id: string,
    projectId: string,
    archived: boolean,
  ) => Promise<void>;
  updateAcceptanceCriteria: (
    id: string,
    projectId: string,
    criteria: string[],
  ) => Promise<void>;
  listChecklistItems: (
    ideaId: string,
    projectId: string,
  ) => Promise<ProjectIdeaChecklistItem[]>;
  addChecklistItem: (
    ideaId: string,
    projectId: string,
    text: string,
  ) => Promise<ProjectIdeaChecklistItem>;
  updateChecklistItem: (
    id: string,
    ideaId: string,
    projectId: string,
    patch: { text?: string; is_completed?: boolean; sort_order?: number },
  ) => Promise<void>;
  deleteChecklistItem: (
    id: string,
    ideaId: string,
    projectId: string,
  ) => Promise<void>;
  batchSetPinned: (
    projectId: string,
    ids: string[],
    pinned: boolean,
  ) => Promise<void>;
  batchSetArchived: (
    projectId: string,
    ids: string[],
    archived: boolean,
  ) => Promise<void>;
  restoreIdea: (ideaId: string, projectId: string) => Promise<ProjectIdea>;
  reorderIdeas: (projectId: string, orderedIds: string[]) => Promise<void>;
}

const requestGenerations = new Map<string, number>();
const PRIORITY_RANK: Record<ProjectIdeaPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function normalizeStatus(value: unknown): ProjectIdeaStatus {
  return value === "done" ? "done" : "open";
}
function normalizePriority(value: unknown): ProjectIdeaPriority {
  return value === "high" || value === "low" ? value : "medium";
}
function normalizeStringList(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = [];
    }
  }
  return Array.isArray(parsed)
    ? parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}
function normalizeTags(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = [];
    }
  }
  return Array.isArray(parsed)
    ? parsed
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
}
function normalizeTitle(value: unknown, content: string): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (title) return title.slice(0, PROJECT_IDEA_MAX_TITLE_LENGTH);
  const firstLine = content.split(/\r?\n/, 1)[0].trim();
  return (firstLine || PROJECT_IDEA_FALLBACK_TITLE).slice(
    0,
    PROJECT_IDEA_MAX_TITLE_LENGTH,
  );
}
function normalizeIdea(idea: ProjectIdea): ProjectIdea {
  const content = String(idea.content ?? "").trim();
  const worktreeId =
    typeof idea.worktree_id === "string" && idea.worktree_id.trim()
      ? idea.worktree_id.trim()
      : null;
  return {
    ...idea,
    title: normalizeTitle(idea.title, content),
    content,
    organized_content: String(idea.organized_content ?? ""),
    status: normalizeStatus(idea.status),
    priority: normalizePriority(idea.priority),
    tags: normalizeTags(idea.tags),
    worktree_id: worktreeId,
    is_pinned: Boolean(idea.is_pinned),
    is_archived: Boolean(idea.is_archived),
    acceptance_criteria: normalizeStringList(idea.acceptance_criteria),
    sort_order: Number.isFinite(Number(idea.sort_order)) ? Number(idea.sort_order) : 0,
  };
}
function sortIdeas(ideas: ProjectIdea[]): ProjectIdea[] {
  return [...ideas].sort(
    (a, b) =>
      Number(b.is_pinned) - Number(a.is_pinned) ||
      a.sort_order - b.sort_order ||
      Number(a.is_archived) - Number(b.is_archived) ||
      Number(a.status === "done") - Number(b.status === "done") ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.updated_at - a.updated_at ||
      b.created_at - a.created_at ||
      a.id.localeCompare(b.id),
  );
}
function validateContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("project_idea_content_blank");
  if (trimmed.length > PROJECT_IDEA_MAX_CONTENT_LENGTH)
    throw new Error("project_idea_content_too_long");
  return trimmed;
}
function normalizeTitleForWrite(value: unknown, content: string): string {
  return normalizeTitle(value, content);
}
async function executeChecked(
  db: Awaited<ReturnType<typeof getDb>>,
  sql: string,
  params: unknown[],
  ownership?: { id: string; projectId: string },
): Promise<void> {
  if (ownership) {
    const existing = await db.select<{ id: string }[]>(
      "SELECT id FROM project_ideas WHERE id = $1 AND project_id = $2 LIMIT 1",
      [ownership.id, ownership.projectId],
    );
    if (existing.length === 0) throw new Error("project_idea_not_found");
  }
  await db.execute(sql, params);
}

export const useProjectIdeaStore = create<ProjectIdeaStore>((set, get) => ({
  ideasByProject: {},
  loadingByProject: {},
  errorsByProject: {},
  loadingProjectId: null,
  activeProjectId: null,
  openProjectIdeas: (projectId) => set({ activeProjectId: projectId }),
  closeProjectIdeas: () => set({ activeProjectId: null }),

  loadProjectIdeas: async (projectId) => {
    const generation = (requestGenerations.get(projectId) ?? 0) + 1;
    requestGenerations.set(projectId, generation);
    set((state) => ({
      loadingByProject: { ...state.loadingByProject, [projectId]: true },
      errorsByProject: { ...state.errorsByProject, [projectId]: null },
      loadingProjectId: projectId,
    }));
    try {
      const db = await getDb();
      const ideas = await db.select<ProjectIdea[]>(
        "SELECT id, project_id, title, content, organized_content, status, priority, tags, created_at, updated_at, worktree_id, is_pinned, is_archived, acceptance_criteria, sort_order FROM project_ideas WHERE project_id = $1",
        [projectId],
      );
      if (requestGenerations.get(projectId) === generation)
        set((state) => ({
          ideasByProject: {
            ...state.ideasByProject,
            [projectId]: sortIdeas(ideas.map(normalizeIdea)),
          },
        }));
    } catch (error) {
      if (requestGenerations.get(projectId) === generation)
        set((state) => ({
          errorsByProject: {
            ...state.errorsByProject,
            [projectId]: error instanceof Error ? error.message : String(error),
          },
        }));
      throw error;
    } finally {
      if (requestGenerations.get(projectId) === generation)
        set((state) => ({
          loadingByProject: { ...state.loadingByProject, [projectId]: false },
          loadingProjectId:
            state.loadingProjectId === projectId
              ? null
              : state.loadingProjectId,
        }));
    }
  },
  reloadProjectIdeas: async (projectId) => get().loadProjectIdeas(projectId),

  createIdea: async (
    projectId,
    content,
    priority = "medium",
    tags = [],
    title,
  ) => {
    const now = Date.now();
    const normalizedContent = validateContent(content);
    const idea: ProjectIdea = {
      id: crypto.randomUUID(),
      project_id: projectId,
      title: normalizeTitleForWrite(title, normalizedContent),
      content: normalizedContent,
      organized_content: "",
      status: "open",
      priority: normalizePriority(priority),
      tags: normalizeTags(tags),
      created_at: now,
      updated_at: now,
      worktree_id: null,
      is_pinned: false,
      is_archived: false,
      acceptance_criteria: [],
      sort_order: 0,
    };
    const db = await getDb();
    await db.execute(
      "INSERT INTO project_ideas (id, project_id, title, content, organized_content, status, priority, tags, created_at, updated_at, worktree_id, is_pinned, is_archived, acceptance_criteria, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        idea.id,
        idea.project_id,
        idea.title,
        idea.content,
        idea.organized_content,
        idea.status,
        idea.priority,
        JSON.stringify(idea.tags),
        idea.created_at,
        idea.updated_at,
        idea.worktree_id,
        0,
        0,
        JSON.stringify(idea.acceptance_criteria),
        idea.sort_order,
      ],
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas([
          idea,
          ...(state.ideasByProject[projectId] ?? []),
        ]),
      },
    }));
    return idea;
  },
  updateIdea: async (id, projectId, titleOrContent, content) => {
    const normalized = validateContent(
      content === undefined ? titleOrContent : content,
    );
    const title = normalizeTitleForWrite(
      content === undefined ? undefined : titleOrContent,
      normalized,
    );
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET title = $1, content = $2, updated_at = $3 WHERE id = $4 AND project_id = $5",
      [title, normalized, updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id
              ? { ...idea, title, content: normalized, updated_at: updatedAt }
              : idea,
          ),
        ),
      },
    }));
  },
  updateIdeaMetadata: async (id, projectId, priority, tags) => {
    const updatedAt = Date.now();
    const db = await getDb();
    const normalizedTags = normalizeTags(tags);
    await executeChecked(
      db,
      "UPDATE project_ideas SET priority = $1, tags = $2, updated_at = $3 WHERE id = $4 AND project_id = $5",
      [
        normalizePriority(priority),
        JSON.stringify(normalizedTags),
        updatedAt,
        id,
        projectId,
      ],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id
              ? {
                  ...idea,
                  priority: normalizePriority(priority),
                  tags: normalizedTags,
                  updated_at: updatedAt,
                }
              : idea,
          ),
        ),
      },
    }));
  },
  updateIdeaWorktree: async (id, projectId, worktreeId) => {
    const normalizedWorktreeId =
      typeof worktreeId === "string" && worktreeId.trim()
        ? worktreeId.trim()
        : null;
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET worktree_id = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
      [normalizedWorktreeId, updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id
              ? {
                  ...idea,
                  worktree_id: normalizedWorktreeId,
                  updated_at: updatedAt,
                }
              : idea,
          ),
        ),
      },
    }));
  },
  updateOrganizedContent: async (id, projectId, organizedContent) => {
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET organized_content = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
      [organizedContent, updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id
              ? {
                  ...idea,
                  organized_content: organizedContent,
                  updated_at: updatedAt,
                }
              : idea,
          ),
        ),
      },
    }));
  },
  updateIdeaStatus: async (id, projectId, requestedStatus) => {
    const status = normalizeStatus(requestedStatus);
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET status = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
      [status, updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id ? { ...idea, status, updated_at: updatedAt } : idea,
          ),
        ),
      },
    }));
  },
  setIdeaPinned: async (id, projectId, pinned) => {
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET is_pinned = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
      [pinned ? 1 : 0, updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id
              ? { ...idea, is_pinned: pinned, updated_at: updatedAt }
              : idea,
          ),
        ),
      },
    }));
  },
  setIdeaArchived: async (id, projectId, archived) => {
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET is_archived = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
      [archived ? 1 : 0, updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas(
          (state.ideasByProject[projectId] ?? []).map((idea) =>
            idea.id === id
              ? { ...idea, is_archived: archived, updated_at: updatedAt }
              : idea,
          ),
        ),
      },
    }));
  },
  updateAcceptanceCriteria: async (id, projectId, criteria) => {
    const normalized = normalizeStringList(criteria);
    const updatedAt = Date.now();
    const db = await getDb();
    await executeChecked(
      db,
      "UPDATE project_ideas SET acceptance_criteria = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
      [JSON.stringify(normalized), updatedAt, id, projectId],
      { id, projectId },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: (state.ideasByProject[projectId] ?? []).map((idea) =>
          idea.id === id
            ? {
                ...idea,
                acceptance_criteria: normalized,
                updated_at: updatedAt,
              }
            : idea,
        ),
      },
    }));
  },
  listChecklistItems: async (ideaId, projectId) => {
    const db = await getDb();
    await executeChecked(
      db,
      "SELECT id FROM project_ideas WHERE id = $1 AND project_id = $2",
      [ideaId, projectId],
      { id: ideaId, projectId },
    );
    return db.select<ProjectIdeaChecklistItem[]>(
      "SELECT id, idea_id, text, is_completed, sort_order, created_at, updated_at FROM project_idea_checklist_items WHERE idea_id = $1 ORDER BY sort_order, created_at",
      [ideaId],
    );
  },
  addChecklistItem: async (ideaId, projectId, text) => {
    const db = await getDb();
    await executeChecked(
      db,
      "SELECT id FROM project_ideas WHERE id = $1 AND project_id = $2",
      [ideaId, projectId],
      { id: ideaId, projectId },
    );
    const now = Date.now();
    const item: ProjectIdeaChecklistItem = {
      id: crypto.randomUUID(),
      idea_id: ideaId,
      text: text.trim(),
      is_completed: false,
      sort_order: 0,
      created_at: now,
      updated_at: now,
    };
    if (!item.text) throw new Error("project_idea_checklist_blank");
    await db.execute(
      "INSERT INTO project_idea_checklist_items (id, idea_id, text, is_completed, sort_order, created_at, updated_at) VALUES ($1,$2,$3,0,0,$4,$4)",
      [item.id, ideaId, item.text, now],
    );
    return item;
  },
  updateChecklistItem: async (id, ideaId, projectId, patch) => {
    const db = await getDb();
    const owned = await db.select<{ id: string }[]>(
      "SELECT c.id FROM project_idea_checklist_items c JOIN project_ideas i ON i.id=c.idea_id WHERE c.id=$1 AND c.idea_id=$2 AND i.project_id=$3",
      [id, ideaId, projectId],
    );
    if (!owned.length) throw new Error("project_idea_not_found");
    const fields: string[] = [];
    const params: unknown[] = [];
    if (patch.text !== undefined) {
      fields.push("text = $" + (params.length + 1));
      params.push(patch.text.trim());
    }
    if (patch.is_completed !== undefined) {
      fields.push("is_completed = $" + (params.length + 1));
      params.push(patch.is_completed ? 1 : 0);
    }
    if (patch.sort_order !== undefined) {
      fields.push("sort_order = $" + (params.length + 1));
      params.push(patch.sort_order);
    }
    if (fields.length) {
      params.push(Date.now(), id);
      await db.execute(
        `UPDATE project_idea_checklist_items SET ${fields.join(", ")}, updated_at = $${params.length - 1} WHERE id = $${params.length}`,
        params,
      );
    }
  },
  deleteChecklistItem: async (id, ideaId, projectId) => {
    const db = await getDb();
    await executeChecked(
      db,
      "DELETE FROM project_idea_checklist_items WHERE id=$1 AND idea_id=$2 AND EXISTS (SELECT 1 FROM project_ideas WHERE id=$2 AND project_id=$3)",
      [id, ideaId, projectId],
    );
  },
  batchSetPinned: async (projectId, ids, pinned) => {
    for (const id of ids) await get().setIdeaPinned(id, projectId, pinned);
  },
  batchSetArchived: async (projectId, ids, archived) => {
    for (const id of ids) await get().setIdeaArchived(id, projectId, archived);
  },
  restoreIdea: async (ideaId, projectId) => {
    const db = await getDb();
    const rows = await db.select<{ snapshot_json: string }[]>(
      "SELECT snapshot_json FROM project_idea_delete_snapshots WHERE idea_id=$1 AND project_id=$2",
      [ideaId, projectId],
    );
    if (!rows.length) throw new Error("project_idea_snapshot_not_found");
    const idea = normalizeIdea(
      JSON.parse(rows[0].snapshot_json) as ProjectIdea,
    );
    await db.execute(
      "INSERT INTO project_ideas (id, project_id, title, content, organized_content, status, priority, tags, created_at, updated_at, worktree_id, is_pinned, is_archived, acceptance_criteria, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        idea.id,
        idea.project_id,
        idea.title,
        idea.content,
        idea.organized_content,
        idea.status,
        idea.priority,
        JSON.stringify(idea.tags),
        idea.created_at,
        idea.updated_at,
        idea.worktree_id,
        idea.is_pinned ? 1 : 0,
        idea.is_archived ? 1 : 0,
        JSON.stringify(idea.acceptance_criteria),
        idea.sort_order,
      ],
    );
    await db.execute(
      "DELETE FROM project_idea_delete_snapshots WHERE idea_id=$1 AND project_id=$2",
      [ideaId, projectId],
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas([
          idea,
          ...(state.ideasByProject[projectId] ?? []),
        ]),
      },
    }));
    return idea;
  },
  reorderIdeas: async (projectId, orderedIds) => {
    const ids = [...orderedIds];
    if (new Set(ids).size !== ids.length) throw new Error("project_idea_duplicate_ids");
    const db = await getDb();
    const owned = await db.select<{ id: string }[]>(
      "SELECT id FROM project_ideas WHERE project_id = $1",
      [projectId],
    );
    const ownedIds = new Set(owned.map((row) => row.id));
    if (ids.length === 0 || ids.some((id) => !ownedIds.has(id)))
      throw new Error("project_idea_not_owned");
    for (let i = 0; i < ids.length; i++)
      await db.execute("UPDATE project_ideas SET sort_order = $1 WHERE id = $2 AND project_id = $3", [i, ids[i], projectId]);
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [projectId]: sortIdeas((state.ideasByProject[projectId] ?? []).map((idea) => ({ ...idea, sort_order: ids.indexOf(idea.id) }))),
      },
    }));
  },
  toggleIdea: async (idea) => {
    const status: ProjectIdeaStatus = idea.status === "done" ? "open" : "done";
    await get().updateIdeaStatus(idea.id, idea.project_id, status);
  },
  deleteIdea: async (idea) => {
    const db = await getDb();
    await executeChecked(
      db,
      "INSERT OR REPLACE INTO project_idea_delete_snapshots " +
        "(idea_id, project_id, snapshot_json, deleted_at) " +
        "SELECT id, project_id, json_object('id',id,'project_id',project_id, " +
        "'title',title,'content',content,'organized_content',organized_content, " +
        "'status',status,'priority',priority,'tags',tags,'created_at',created_at, " +
        "'updated_at',updated_at,'worktree_id',worktree_id,'is_pinned',is_pinned, " +
        "'is_archived',is_archived,'acceptance_criteria',acceptance_criteria,'sort_order',sort_order), " +
        "$3 FROM project_ideas WHERE id=$1 AND project_id=$2",
      [idea.id, idea.project_id, Date.now()],
      { id: idea.id, projectId: idea.project_id },
    );
    await executeChecked(
      db,
      "DELETE FROM project_ideas WHERE id = $1 AND project_id = $2",
      [idea.id, idea.project_id],
      { id: idea.id, projectId: idea.project_id },
    );
    set((state) => ({
      ideasByProject: {
        ...state.ideasByProject,
        [idea.project_id]: (state.ideasByProject[idea.project_id] ?? []).filter(
          (item) => item.id !== idea.id,
        ),
      },
    }));
  },
}));
