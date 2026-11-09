import type { Project, WorktreeRecord } from "../../../shared/types";
import type { ProjectIdea } from "../api/projectIdeaStore";

export type ProjectIdeaCopyFormat = "plain" | "markdown" | "prompt" | "context";

function body(idea: ProjectIdea): string {
  return idea.content.trim();
}

/** Copy the idea body only; the title is an internal list label, not user content. */
export function formatProjectIdeaPlain(idea: ProjectIdea): string {
  return body(idea);
}

export function formatProjectIdeaMarkdown(idea: ProjectIdea, project?: Project, worktree?: WorktreeRecord): string {
  const metadata = [project && `Project: ${project.name}`, worktree && `Worktree: ${worktree.display_name || worktree.name}`, `Status: ${idea.status}`, `Priority: ${idea.priority}`].filter(Boolean);
  return [metadata.length ? metadata.join("\n") : "", body(idea)].filter(Boolean).join("\n\n");
}

/** A task prompt based on the idea body; the removed title is never reintroduced. */
export function formatProjectIdeaPrompt(idea: ProjectIdea, project?: Project, worktree?: WorktreeRecord): string {
  const location = [project?.name && `Project: ${project.name}`, project?.path && `Path: ${project.path}`, worktree && `Worktree: ${worktree.display_name || worktree.name}`].filter(Boolean).join("\n");
  return [location, `Original idea:\n${body(idea)}`, "Please clarify assumptions, propose a plan, and identify the smallest safe next steps."].filter(Boolean).join("\n\n");
}

/** Project context without executing commands or creating/mutating a Worktree. */
export function formatProjectContext(project: Project, worktree?: WorktreeRecord): string {
  const lines = [`Project: ${project.name}`, `Path: ${project.path}`];
  if (project.cli_tool) lines.push(`CLI tool: ${project.cli_tool}`);
  if (worktree) {
    lines.push(`Worktree: ${worktree.display_name || worktree.name}`, `Worktree path: ${worktree.path}`, `Branch: ${worktree.branch}`);
  }
  return lines.join("\n");
}

export function formatProjectIdea(idea: ProjectIdea, format: ProjectIdeaCopyFormat, project?: Project, worktree?: WorktreeRecord): string {
  if (format === "markdown") return formatProjectIdeaMarkdown(idea, project, worktree);
  if (format === "prompt") return formatProjectIdeaPrompt(idea, project, worktree);
  if (format === "context") return project ? `${formatProjectContext(project, worktree)}\n\n${formatProjectIdeaPlain(idea)}` : formatProjectIdeaPlain(idea);
  return formatProjectIdeaPlain(idea);
}

// Concise aliases for callers that prefer copy-oriented names.
export const formatIdeaPlain = formatProjectIdeaPlain;
export const formatIdeaMarkdown = formatProjectIdeaMarkdown;
export const formatIdeaPrompt = formatProjectIdeaPrompt;
export const formatIdeaContext = formatProjectContext;
