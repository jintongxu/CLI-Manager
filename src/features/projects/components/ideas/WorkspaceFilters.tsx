import { useI18n } from "../../../../shared/i18n";
import type { Project } from "../../../../shared/types";
import type { IdeaPriorityFilter, IdeaStatusFilter, IdeaWorkspaceFilter } from "./types";

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
  workspaceFilter: IdeaWorkspaceFilter;
  setWorkspaceFilter: (value: IdeaWorkspaceFilter) => void;
}

export function WorkspaceFilters({
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
    </div>
  );
}
