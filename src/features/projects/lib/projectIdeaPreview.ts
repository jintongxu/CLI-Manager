import type { ProjectIdea } from "../api/projectIdeaStore";

export function projectIdeaPreview(idea: Pick<ProjectIdea, "title" | "content">): { heading: string; excerpt: string } {
  const lines = idea.content.trim().split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const heading = idea.title.trim() || firstLine;
  const normalizedHeading = heading.replace(/^#{1,6}\s+/, "");
  const excerptLines = normalizedHeading === firstLine.replace(/^#{1,6}\s+/, "")
    ? lines.slice(1)
    : lines;
  return { heading, excerpt: excerptLines.join(" ").trim() };
}
