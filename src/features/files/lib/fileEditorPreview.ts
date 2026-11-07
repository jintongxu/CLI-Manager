import type { Project } from "../../../shared/types/index";
import { isSameProjectFileLocation } from "../../terminal/api/terminalProject";
import { fileOperationRootKey } from "./fileExplorerOperations";
import type { ActiveProjectFile } from "../api/fileExplorerStore";

/** Match filesystem case rules rather than terminal display-path rules. */
export function isSameEditorFileLocation(left: Project | null, right: Project | null): boolean {
  if (!left || !right) return false;
  if (left.environment_type === "ssh" || right.environment_type === "ssh") {
    return isSameProjectFileLocation(left, right);
  }
  return left.environment_type === right.environment_type
    && fileOperationRootKey(left.path) === fileOperationRootKey(right.path);
}

export interface FileOpenOptions {
  /** Omitted intent preserves the legacy pinned-open behavior. */
  intent?: "preview" | "pinned";
}

/** Request metadata only; file buffers remain exclusively in fileExplorerStore. */
export function createFileOpenIntents() {
  let revision = 0;
  const contexts: Array<{
    project: Project;
    paths: Map<string, { revision: number; pinned: boolean }>;
  }> = [];
  const pathIntent = (project: Project, path: string) => {
    let context = contexts.find((item) => isSameEditorFileLocation(item.project, project));
    if (!context) {
      context = { project, paths: new Map() };
      contexts.push(context);
    }
    let intent = context.paths.get(path);
    if (!intent) {
      intent = { revision: 0, pinned: false };
      context.paths.set(path, intent);
    }
    return intent;
  };
  let current: { revision: number; project: Project; path: string } | null = null;
  const invalidate = () => { current = null; revision += 1; };
  return {
    begin(project: Project, path: string, options?: FileOpenOptions) {
      const intent = pathIntent(project, path);
      if (options?.intent !== "preview") intent.pinned = true;
      const closeRevision = intent.revision;
      current = { revision: ++revision, project, path };
      return {
        ...current,
        // Shared per-path intent survives intervening opens and completion order.
        get pinned() { return intent.pinned; },
        isValid: () => intent.revision === closeRevision,
      };
    },
    invalidate,
    close(project: Project | null, path: string) {
      if (!project) return;
      const intent = pathIntent(project, path);
      intent.revision += 1;
      intent.pinned = false;
      invalidate();
    },
    clearProject(projectId: string) {
      for (const context of contexts.filter((item) => item.project.id === projectId)) {
        for (const intent of context.paths.values()) {
          intent.revision += 1;
          intent.pinned = false;
        }
      }
      if (current?.project.id === projectId) invalidate();
    },
    pin(project: Project | null, path: string) {
      if (!project) return;
      pathIntent(project, path).pinned = true;
      if (current?.path !== path || !isSameEditorFileLocation(current.project, project)) invalidate();
    },
    isCurrent(request: { revision: number }) {
      return current?.revision === request.revision;
    },
  };
}

/** Replacement never discards a draft, even if an external caller left it marked preview. */
export function openPreviewBuffer(
  files: ActiveProjectFile[], file: ActiveProjectFile, preview: boolean,
): ActiveProjectFile[] {
  if (files.some((candidate) => candidate.path === file.path)) {
    // Merge intent only: a late read must never overwrite a newer buffer/draft.
    return preview ? files : files.map((candidate) => candidate.path === file.path && candidate.isPreview
      ? { ...candidate, isPreview: false } : candidate);
  }
  const replacement = preview
    ? files.findIndex((candidate) => candidate.isPreview && candidate.content === candidate.savedContent)
    : -1;
  const retained = files.map((candidate) => preview && candidate.isPreview ? { ...candidate, isPreview: false } : candidate);
  const opened = { ...file, isPreview: preview };
  if (replacement < 0) return [...retained, opened];
  return retained.map((candidate, index) => index === replacement ? opened : candidate);
}
