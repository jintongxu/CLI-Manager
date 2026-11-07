import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "../../../../shared/i18n/index";
import type { Project } from "../../../../shared/types/index";
import { useFileExplorerStore } from "../../../files/api/fileExplorerStore";
import {
  createGitDiffWorkspaceContext,
  useGitDiffWorkspaceStore,
} from "../../api/gitDiffWorkspaceStore";
import { useSettingsStore } from "../../../../shared/preferences/settingsStore";
import { useTerminalStore } from "../../../terminal/state";
import { isSameProjectFileContext } from "../../../terminal/api/terminalProject";
import type { GitDiffReviewTarget } from "./reviewNavigation";

interface GitChangeSummary {
  path: string;
  status: string;
  added: number;
  deleted: number;
}

interface GitDiffOpenWorkflowOptions {
  project: Project | null;
  projectPath: string | null;
  repositoryPath: string | null;
  repositoryRelativePath?: string;
  changes: readonly GitChangeSummary[];
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/gu, "");
}

export function useGitDiffOpenWorkflow({
  project,
  projectPath,
  repositoryPath,
  repositoryRelativePath = "",
  changes,
}: GitDiffOpenWorkflowOptions) {
  const { t } = useI18n();
  const openProject = useFileExplorerStore((state) => state.openProject);
  const revealPath = useFileExplorerStore((state) => state.revealPath);
  const openPinnedDiff = useGitDiffWorkspaceStore((state) => state.openTab);
  const openFileEditorPane = useTerminalStore((state) => state.openFileEditorPane);
  const gitDiffOpenMode = useSettingsStore((state) => state.gitDiffOpenMode);
  const updateSetting = useSettingsStore((state) => state.update);

  const requestRef = useRef(0);
  const stopWatchingRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    requestRef.current += 1;
    stopWatchingRef.current?.();
  }, [project]);
  const beginOpen = useCallback((targetProject: Project) => {
    const id = ++requestRef.current;
    stopWatchingRef.current?.();
    let reachedContext = isSameProjectFileContext(useFileExplorerStore.getState().project, targetProject);
    stopWatchingRef.current = useFileExplorerStore.subscribe((state) => {
      const matches = isSameProjectFileContext(state.project, targetProject);
      if (reachedContext && !matches) requestRef.current += 1;
      if (matches) reachedContext = true;
    });
    return () => requestRef.current === id
      && isSameProjectFileContext(useFileExplorerStore.getState().project, targetProject);
  }, []);

  const sourcePathForFile = useCallback((filePath: string) => {
    const prefix = normalizeRelativePath(repositoryRelativePath);
    const normalizedFilePath = normalizeRelativePath(filePath);
    return prefix ? `${prefix}/${normalizedFilePath}` : normalizedFilePath;
  }, [repositoryRelativePath]);

  const openPinnedTarget = useCallback(async (
    target: GitDiffReviewTarget,
    persistAsDefault: boolean,
  ): Promise<boolean> => {
    if (!project) return false;
    const change = changes.find(
      (candidate) => normalizeRelativePath(candidate.path) === normalizeRelativePath(target.filePath),
    );
    if (!change) return false;
    const isCurrent = beginOpen(project);
    try {
      await openProject(project);
      if (!isCurrent()) return false;
      const context = createGitDiffWorkspaceContext(project);
      openPinnedDiff(context, {
        repositoryId: repositoryPath ?? (project.environment_type === "ssh" ? "" : projectPath ?? project.path),
        repositoryRelativePath,
        filePath: target.filePath,
        sourcePath: target.sourcePath,
        fileName: target.fileName,
        status: target.status,
        additions: change.added,
        deletions: change.deleted,
      });
      openFileEditorPane(project, "beside");
      if (persistAsDefault) await updateSetting("gitDiffOpenMode", "editor");
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      toast.error(t("files.toast.openFileFailed"), { description: String(error) });
      return false;
    }
  }, [
    beginOpen,
    changes,
    openFileEditorPane,
    openPinnedDiff,
    openProject,
    project,
    projectPath,
    repositoryPath,
    repositoryRelativePath,
    t,
    updateSetting,
  ]);

  const openPreferredDiff = useCallback((filePath: string): boolean => {
    if (gitDiffOpenMode !== "editor") return false;
    const change = changes.find(
      (candidate) => normalizeRelativePath(candidate.path) === normalizeRelativePath(filePath),
    );
    if (!change) return false;
    const normalizedFilePath = normalizeRelativePath(filePath);
    const target: GitDiffReviewTarget = {
      id: `${repositoryPath ?? projectPath ?? ""}\u0000${normalizedFilePath}`,
      projectPath: repositoryPath ?? projectPath ?? undefined,
      filePath: normalizedFilePath,
      fileName: normalizedFilePath.split("/").pop() ?? normalizedFilePath,
      status: change.status,
      sourcePath: sourcePathForFile(normalizedFilePath),
      additions: change.added,
      deletions: change.deleted,
    };
    void openPinnedTarget(target, false);
    return true;
  }, [changes, gitDiffOpenMode, openPinnedTarget, projectPath, repositoryPath, sourcePathForFile]);

  const openSourcePath = useCallback(async (
    sourcePath: string,
    status: string,
    lineNumber?: number,
  ): Promise<boolean> => {
    if (!project || status === "D") return false;
    const isCurrent = beginOpen(project);
    try {
      await openProject(project);
      if (!isCurrent()) return false;
      const revealed = await revealPath(sourcePath, { lineNumber });
      if (!isCurrent()) return false;
      if (!revealed) throw new Error("git_diff_source_not_found");
      openFileEditorPane(project, "beside");
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      toast.error(t("files.toast.openFileFailed"), { description: String(error) });
      return false;
    }
  }, [beginOpen, openFileEditorPane, openProject, project, revealPath, t]);

  const pinDiff = useCallback(
    (target: GitDiffReviewTarget) => openPinnedTarget(target, true),
    [openPinnedTarget],
  );

  return {
    openPreferredDiff,
    openSourcePath,
    pinDiff,
    sourcePathForFile,
  };
}
