import type { Project, WorktreeRecord } from "../../../shared/types";
import type { ProjectIdea } from "../api/projectIdeaStore";

export type ProjectIdeaCopyFormat = "plain" | "markdown" | "prompt" | "context";

function body(idea: ProjectIdea): string {
  return idea.content.trim();
}

/** Complete, deterministic plain-text representation of an idea. */
export function formatProjectIdeaPlain(idea: ProjectIdea): string {
  const organized = idea.organized_content.trim();
  return [idea.title.trim(), body(idea), organized ? `Organized content:\n${organized}` : ""].filter(Boolean).join("\n\n");
}

export function formatProjectIdeaMarkdown(idea: ProjectIdea, project?: Project, worktree?: WorktreeRecord): string {
  const metadata = [project && `Project: ${project.name}`, worktree && `Worktree: ${worktree.display_name || worktree.name}`, `Status: ${idea.status}`, `Priority: ${idea.priority}`, idea.tags.length ? `Tags: ${idea.tags.join(", ")}` : ""].filter(Boolean);
  const organized = idea.organized_content.trim();
  return [`# ${idea.title.trim()}`, metadata.length ? metadata.join("\n") : "", body(idea), organized ? `## Organized content\n\n${organized}` : ""].filter(Boolean).join("\n\n");
}

/** A self-contained task prompt suitable for pasting into an assistant. */
export function formatProjectIdeaPrompt(idea: ProjectIdea, project?: Project, worktree?: WorktreeRecord): string {
  const location = [project?.name && `Project: ${project.name}`, project?.path && `Path: ${project.path}`, worktree && `Worktree: ${worktree.display_name || worktree.name}`].filter(Boolean).join("\n");
  const organized = idea.organized_content.trim();
  return [`Task: ${idea.title.trim()}`, location, `Original idea:\n${body(idea)}`, organized ? `Additional context:\n${organized}` : "", "Please clarify assumptions, propose a plan, and identify the smallest safe next steps."].filter(Boolean).join("\n\n");
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
