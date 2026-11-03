import type { ProjectIdeaPriority } from "../../api/projectIdeaStore";

export type IdeaStatusFilter = "all" | "open" | "done";
export type IdeaWorkspaceFilter = "all" | "unarchived" | "archived" | "pinned";
export type IdeaPriorityFilter = "all" | ProjectIdeaPriority;
