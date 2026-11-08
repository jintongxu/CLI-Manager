import type { OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyAiText } from "../api/aiClipboard";
import { formatAiAnchor, formatAiContextBlock, type AiTextSelection } from "../api/aiPathFormatter";
import { useI18n } from "../../../shared/i18n/index";
import type { GitFileChange, Project } from "../../../shared/types/index";
import { configureMonaco, configureMonacoLocale, languageFromPath, monaco } from "../../../shared/platform/monacoSetup";
import { findMarkdownLinkAtPosition } from "../../../shared/lib/markdownNavigation";
import { isSameProjectFileContext } from "../../terminal/api/terminalProject";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { useFileExplorerStore, type ActiveProjectFile } from "../api/fileExplorerStore";
import { useProjectStore } from "../../projects/api/projectStore";
import { createGitDiffWorkspaceContext, EMPTY_GIT_DIFF_WORKSPACE, resolveGitDiffProject, useGitDiffWorkspaceStore } from "../../git/api/gitDiffWorkspaceStore";
import { clearEditorDecorations, useGitFileDecorations } from "../components/useGitFileDecorations";
import { useFileEditorSearchNavigation } from "../components/useFileEditorSearchNavigation";
import { useFileEditorShortcuts } from "../components/useFileEditorShortcuts";
import type { FileEditorPaneProps, PendingAction, MonacoEditor, MarkdownNavigationMode, PendingMarkdownNavigation } from "../types/fileEditorModel";
import { getFileEditorTheme } from "../lib/fileEditorTheme";
import { definitionAt, definitionAtSync, ProjectSymbolIndex, registerFileDefinitionProviders, type ProjectSymbol } from "../lib/fileEditorDefinitions";
import { useFileEditorMarkdownNavigation } from "./useFileEditorMarkdownNavigation";
configureMonaco();

export function useFileEditorController({ session, isActive, terminalThemeBackground, onClose, companion = false }: FileEditorPaneProps) {
  const { language: appLanguage, t } = useI18n();
  const editorRef = useRef<MonacoEditor | null>(null);
  const searchDecorationIdsRef = useRef<string[]>([]);
  const gitDecorationIdsRef = useRef<string[]>([]);
  const markdownMouseDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const markdownNavigationRef = useRef<(href: string, mode: MarkdownNavigationMode) => void>(() => undefined);
  const markdownNavigationIdRef = useRef(0);
  const markdownFileRef = useRef<ActiveProjectFile | null>(null);
  const definitionFilesRef = useRef<ActiveProjectFile[]>([]);
  const definitionIndexRef = useRef(new ProjectSymbolIndex());
  const editorProjectRef = useRef<Project | null>(null);
  const revealPathRef = useRef<((path: string, options?: { lineNumber?: number; columnNumber?: number; source?: "terminal" | "definition" }) => Promise<boolean>) | null>(null);
  const nextMarkdownModeRef = useRef<{ path: string; mode: MarkdownNavigationMode } | null>(null);
  const [editorReadyNonce, setEditorReadyNonce] = useState(0);
  const [outlineSymbols, setOutlineSymbols] = useState<ProjectSymbol[]>([]);
  const copyAiShortcut = useSettingsStore((s) => s.keyboardShortcuts.copyAi);
  const project = useFileExplorerStore((s) => s.project);

  useEffect(() => {
    configureMonacoLocale(appLanguage);
  }, [appLanguage]);

  const openProject = useFileExplorerStore((s) => s.openProject);
  const openFiles = useFileExplorerStore((s) => s.openFiles);
  const activeFilePath = useFileExplorerStore((s) => s.activeFilePath);
  const activeFile = useFileExplorerStore((s) => s.activeFile);
  const searchQuery = useFileExplorerStore((s) => s.searchQuery);
  const gitChanges = useFileExplorerStore((s) => s.gitChanges);
  const searchNavigationTarget = useFileExplorerStore((s) => s.searchNavigationTarget);
  const setActiveFilePath = useFileExplorerStore((s) => s.setActiveFilePath);
  const clearSearchNavigationTarget = useFileExplorerStore((s) => s.clearSearchNavigationTarget);
  const closeFile = useFileExplorerStore((s) => s.closeFile);
  const setActiveContent = useFileExplorerStore((s) => s.setActiveContent);
  const revealPath = useFileExplorerStore((s) => s.revealPath);
  revealPathRef.current = revealPath;
  const saveFile = useFileExplorerStore((s) => s.saveFile);
  const saveActiveFile = useFileExplorerStore((s) => s.saveActiveFile);
  const projects = useProjectStore((s) => s.projects);
  const [previewMode, setPreviewMode] = useState<"source" | "preview">("source");
  const [pendingAction, updatePendingAction] = useState<PendingAction>(null);
  const pendingActionRef = useRef<PendingAction>(null);
  const pendingGeneration = useRef(0);
  const savingGeneration = useRef<number | null>(null);
  const [pendingSaveBusy, setPendingSaveBusy] = useState(false);
  // Invalidate synchronously: an awaiting save must not outlive Cancel, dismissal,
  // a replacement request, or a context transition.
  const setPendingAction = useCallback((action: PendingAction) => {
    pendingGeneration.current += 1;
    pendingActionRef.current = action;
    savingGeneration.current = null;
    setPendingSaveBusy(false);
    updatePendingAction(action);
  }, []);
  useEffect(() => {
    const unsubscribe = useFileExplorerStore.subscribe((state, previous) => {
      const action = pendingActionRef.current;
      if (!action) return;
      if (state.project !== previous.project
        || action.paths.some((path) => !state.openFiles.some((file) => file.path === path))) {
        setPendingAction(null);
      }
    });
    return () => {
      unsubscribe();
      pendingGeneration.current += 1;
      pendingActionRef.current = null;
      savingGeneration.current = null;
    };
  }, [setPendingAction]);
  const [pendingMarkdownNavigation, setPendingMarkdownNavigation] = useState<PendingMarkdownNavigation | null>(null);
  const sessionProject = session.fileEditor?.project ?? null;
  const latestProject = sessionProject
    ? projects.find((candidate) => candidate.id === sessionProject.id) ?? null
    : null;
  const editorProject = useMemo(
    () => sessionProject ? companion ? sessionProject : resolveGitDiffProject(sessionProject, latestProject) : null,
    [companion, latestProject, sessionProject],
  );
  editorProjectRef.current = editorProject;
  const diffContext = useMemo(
    () => editorProject ? createGitDiffWorkspaceContext(editorProject) : null,
    [editorProject],
  );
  const diffWorkspace = useGitDiffWorkspaceStore((state) => (
    diffContext ? state.workspaces[diffContext.key] ?? EMPTY_GIT_DIFF_WORKSPACE : EMPTY_GIT_DIFF_WORKSPACE
  ));
  const activeDiff = diffWorkspace.tabs.find((tab) => tab.id === diffWorkspace.activeId) ?? null;
  useEffect(() => {
    // A parked context must not carry its confirmation or navigation into the next location.
    setPendingAction(null);
    setPendingMarkdownNavigation(null);
    markdownNavigationIdRef.current += 1;
    nextMarkdownModeRef.current = null;
  }, [diffContext?.key]);
  const ownsFileState = isSameProjectFileContext(project, editorProject);
  const visibleFiles = ownsFileState ? openFiles : [];
  const visibleFile = ownsFileState && !activeDiff ? activeFile : null;
  definitionFilesRef.current = visibleFiles;
  markdownFileRef.current = visibleFile;
  const dirty = Boolean(visibleFile && visibleFile.content !== visibleFile.savedContent);
  const dirtyFiles = visibleFiles.filter((file) => file.content !== file.savedContent);
  const activeGitChange = useMemo<GitFileChange | null>(
    () => visibleFile ? gitChanges.find((change) => change.path === visibleFile.path) ?? null : null,
    [gitChanges, visibleFile?.path]
  );
  const isNewFile = activeGitChange?.status === "U" || activeGitChange?.status === "??" || activeGitChange?.status === "A";
  const language = useMemo(() => visibleFile ? languageFromPath(visibleFile.path, visibleFile.content) : "plaintext", [visibleFile]);
  const editorTheme = useMemo(
    () => getFileEditorTheme(terminalThemeBackground),
    [terminalThemeBackground]
  );

  const handleEditorMount = useCallback<OnMount>((editor) => {
    editorRef.current = editor;
    markdownMouseDisposableRef.current?.dispose();
    markdownMouseDisposableRef.current = editor.onMouseDown((event) => {
      if (!event.target.position) return;
      const file = markdownFileRef.current;
      if ((event.event.ctrlKey || event.event.metaKey) && event.event.leftButton) {
        const model = editor.getModel();
        if (model && editorProjectRef.current) {
          const symbol = definitionAtSync(definitionIndexRef.current, model, event.target.position);
          if (symbol) {
            event.event.preventDefault();
            event.event.stopPropagation();
            void revealPathRef.current?.(symbol.path, { lineNumber: symbol.line, columnNumber: symbol.column, source: "definition" }).then((opened) => {
              if (!opened) return;
              const targetEditor = editorRef.current;
              if (!targetEditor) return;
              clearEditorDecorations(targetEditor, searchDecorationIdsRef);
              targetEditor.setSelection({
                startLineNumber: symbol.line,
                startColumn: symbol.column,
                endLineNumber: symbol.line,
                endColumn: symbol.column,
              });
              targetEditor?.revealPositionInCenter({ lineNumber: symbol.line, column: symbol.column });
            });
            return;
          }
          void definitionAt(definitionIndexRef.current, model, event.target.position).then((resolved) => {
            if (resolved) void revealPathRef.current?.(resolved.path, { lineNumber: resolved.line, columnNumber: resolved.column, source: "definition" }).then((opened) => {
              if (!opened) return;
              const targetEditor = editorRef.current;
              if (!targetEditor) return;
              clearEditorDecorations(targetEditor, searchDecorationIdsRef);
              targetEditor.setSelection({
                startLineNumber: resolved.line,
                startColumn: resolved.column,
                endLineNumber: resolved.line,
                endColumn: resolved.column,
              });
              targetEditor?.revealPositionInCenter({ lineNumber: resolved.line, column: resolved.column });
            });
          });
        }
      }
      if (!event.event.ctrlKey || !event.event.rightButton) return;
      if (file?.previewKind !== "markdown") return;
      const href = findMarkdownLinkAtPosition(
        file.content,
        event.target.position.lineNumber,
        event.target.position.column,
      );
      if (!href) return;
      event.event.preventDefault();
      event.event.stopPropagation();
      markdownNavigationRef.current(href, "source");
    });
    editor.addAction({
      id: "cli-manager.go-to-definition",
      label: "Go to Definition",
      keybindings: [monaco.KeyCode.F12],
      run: async (activeEditor) => {
        const model = activeEditor.getModel();
        const position = activeEditor.getPosition();
        if (!model || !position || !editorProjectRef.current) return;
        const symbol = await definitionAt(definitionIndexRef.current, model, position);
        if (!symbol) return;
        const opened = await revealPathRef.current?.(symbol.path, { lineNumber: symbol.line, columnNumber: symbol.column, source: "definition" });
        if (!opened) return;
        const targetEditor = editorRef.current;
        if (!targetEditor) return;
        clearEditorDecorations(targetEditor, searchDecorationIdsRef);
        targetEditor.setSelection({
          startLineNumber: symbol.line,
          startColumn: symbol.column,
          endLineNumber: symbol.line,
          endColumn: symbol.column,
        });
        targetEditor?.revealPositionInCenter({ lineNumber: symbol.line, column: symbol.column });
      },
    });
    setEditorReadyNonce((value) => value + 1);
  }, [editorProject, revealPath]);

  useEffect(() => {
    const disposables = registerFileDefinitionProviders(definitionIndexRef.current);
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, []);

  useEffect(() => {
    if (!editorProject) return;
    void definitionIndexRef.current.build(editorProject.path, visibleFiles);
  }, [editorProject?.path]);

  useEffect(() => definitionIndexRef.current.subscribe(() => {
    if (visibleFile) setOutlineSymbols(definitionIndexRef.current.forPath(visibleFile.path));
  }), [visibleFile?.path]);

  useEffect(() => {
    visibleFiles.forEach((file) => definitionIndexRef.current.replaceOpenFile(file));
    if (visibleFile) setOutlineSymbols(definitionIndexRef.current.forPath(visibleFile.path));
  }, [visibleFiles, visibleFile]);

  const selectOutlineSymbol = useCallback((symbol: ProjectSymbol) => {
    if (!editorRef.current) return;
    editorRef.current.setPosition({ lineNumber: symbol.line, column: symbol.column });
    editorRef.current.revealPositionInCenter({ lineNumber: symbol.line, column: symbol.column });
    editorRef.current.focus();
  }, []);

  useEffect(() => () => markdownMouseDisposableRef.current?.dispose(), []);

  useGitFileDecorations({
    editorRef,
    decorationIdsRef: gitDecorationIdsRef,
    editorReadyNonce,
    project: editorProject,
    change: isNewFile ? null : activeGitChange,
    filePath: visibleFile?.path ?? null,
    previewKind: visibleFile?.previewKind ?? null,
    previewMode,
    modifiedMs: visibleFile?.modifiedMs,
    sizeBytes: visibleFile?.sizeBytes,
  });

  useEffect(() => {
    if (companion || !isActive || !editorProject || isSameProjectFileContext(useFileExplorerStore.getState().project, editorProject)) return;
    void openProject(editorProject);
  }, [companion, editorProject, isActive, openProject]);

  useEffect(() => {
    const requestedMode = nextMarkdownModeRef.current;
    setPreviewMode(requestedMode && requestedMode.path === visibleFile?.path ? requestedMode.mode : "source");
    if (requestedMode?.path === visibleFile?.path) nextMarkdownModeRef.current = null;
    setPendingMarkdownNavigation((pending) => {
      if (!pending || pending.path === visibleFile?.path) return pending;
      markdownNavigationIdRef.current += 1;
      nextMarkdownModeRef.current = null;
      return null;
    });
  }, [visibleFile?.path]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    clearEditorDecorations(editor, searchDecorationIdsRef);
    clearEditorDecorations(editor, gitDecorationIdsRef);
  }, [visibleFile?.path]);

  useFileEditorSearchNavigation({
    editorRef,
    decorationIdsRef: searchDecorationIdsRef,
    editorReadyNonce,
    file: visibleFile,
    previewMode,
    target: searchNavigationTarget,
    searchQuery,
    setPreviewMode,
    onHandled: clearSearchNavigationTarget,
  });
  const { handleMarkdownLinkActivate, handleMarkdownFragmentHandled } = useFileEditorMarkdownNavigation({
    t, visibleFile, revealPath, editorRef, markdownNavigationRef, markdownNavigationIdRef,
    nextMarkdownModeRef, pendingMarkdownNavigation, setPendingMarkdownNavigation, previewMode,
    setPreviewMode, editorReadyNonce,
  });

  const save = useCallback(async () => {
    if (!visibleFile || visibleFile.previewKind === "image") return;
    try {
      await saveActiveFile();
    } catch {
      // Store 已提示错误；保留 dirty 状态。
    }
  }, [saveActiveFile, visibleFile]);

  const getEditorSelection = useCallback((): AiTextSelection | null => {
    const selection = editorRef.current?.getSelection();
    if (!editorRef.current || !selection || selection.isEmpty()) return null;
    return {
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
      text: editorRef.current.getModel()?.getValueInRange(selection),
    };
  }, []);

  const copyActiveAiPath = useCallback(() => {
    if (!project || !visibleFile) return;
    const selection = (visibleFile.previewKind === "text" || visibleFile.previewKind === "markdown") && previewMode === "source"
      ? getEditorSelection()
      : null;
    void copyAiText(formatAiAnchor(project, visibleFile.path, selection), t("files.toast.aiPathCopied"));
  }, [getEditorSelection, previewMode, project, t, visibleFile]);

  const copyActiveAiContext = useCallback(() => {
    if (!project || !visibleFile) return;
    const selection = (visibleFile.previewKind === "text" || visibleFile.previewKind === "markdown") && previewMode === "source"
      ? getEditorSelection()
      : null;
    void copyAiText(formatAiContextBlock(project, visibleFile.path, selection), t("files.toast.aiContextCopied"));
  }, [getEditorSelection, previewMode, project, t, visibleFile]);

  useFileEditorShortcuts({
    active: isActive,
    copyAiShortcut,
    onCopyAiPath: copyActiveAiPath,
    onSave: save,
  });

  const requestClose = () => {
    setPendingAction(null);
    const paths = visibleFiles.map((file) => file.path);
    if (dirtyFiles.length > 0) {
      setPendingAction({ closePane: true, paths, dirtyPaths: dirtyFiles.map((file) => file.path) });
      return;
    }
    onClose();
  };

  const closeFiles = (paths: string[]) => {
    if (!isSameProjectFileContext(useFileExplorerStore.getState().project, editorProject)) return false;
    const remainingCount = visibleFiles.filter((file) => !paths.includes(file.path)).length;
    const hasDiffTabs = diffWorkspace.tabs.length > 0;
    paths.forEach(closeFile);
    if (remainingCount === 0 && !hasDiffTabs) {
      onClose();
      return true;
    }
    return false;
  };
  const requestCloseFiles = (paths: string[]) => {
    const targetFiles = visibleFiles.filter((file) => paths.includes(file.path));
    if (targetFiles.length === 0) return;
    setPendingAction(null);
    const targetPaths = targetFiles.map((file) => file.path);
    const dirtyPaths = targetFiles.filter((file) => file.content !== file.savedContent).map((file) => file.path);
    if (dirtyPaths.length > 0) {
      setPendingAction({ closePane: false, paths: targetPaths, dirtyPaths });
      return;
    }
    closeFiles(targetPaths);
  };

  // Companion close is scoped to this controller, never to the selected Pi session.
  useEffect(() => {
    if (!companion || !isActive) return;
    const handleClose = () => {
      if (activeDiff && diffContext) {
        useGitDiffWorkspaceStore.getState().closeTab(diffContext.key, activeDiff.id);
      } else if (visibleFile) requestCloseFiles([visibleFile.path]);
      else onClose();
    };
    window.addEventListener("file-companion-close-file", handleClose);
    return () => window.removeEventListener("file-companion-close-file", handleClose);
  });

  const previousTabs = useRef({ context: diffContext?.key, count: 0 });
  useEffect(() => {
    const count = visibleFiles.length + diffWorkspace.tabs.length;
    const previous = previousTabs.current;
    if (companion && ownsFileState && previous.context === diffContext?.key && previous.count > 0 && count === 0) onClose();
    previousTabs.current = { context: diffContext?.key, count };
  }, [companion, ownsFileState, diffContext?.key, visibleFiles.length, diffWorkspace.tabs.length, onClose]);

  const discardAndRun = () => {
    if (!pendingActionRef.current || savingGeneration.current !== null) return;
    const { closePane, paths } = pendingActionRef.current;
    setPendingAction(null);
    const closed = closeFiles(paths);
    if (closePane && !closed) onClose();
  };

  const saveAndRun = async () => {
    const action = pendingActionRef.current;
    if (!action || savingGeneration.current !== null) return;
    const generation = pendingGeneration.current;
    const capturedProject = useFileExplorerStore.getState().project;
    const isCurrent = () => pendingGeneration.current === generation
      && pendingActionRef.current === action
      && useFileExplorerStore.getState().project === capturedProject
      && isSameProjectFileContext(capturedProject, editorProject);
    if (!isCurrent()) return;
    savingGeneration.current = generation;
    setPendingSaveBusy(true);
    try {
      const { closePane, dirtyPaths, paths } = action;
      for (const path of dirtyPaths) {
        if (!isCurrent()) return;
        await saveFile(path);
        if (!isCurrent()) return;
        const saved = useFileExplorerStore.getState().openFiles.find((file) => file.path === path);
        if (!saved || saved.content !== saved.savedContent) return;
      }
      // Recheck the entire captured set, including initially clean files and
      // earlier saves edited while a later write was pending. No close before this.
      const files = useFileExplorerStore.getState().openFiles;
      if (!isCurrent() || !paths.every((path) => {
        const file = files.find((candidate) => candidate.path === path);
        return file && file.content === file.savedContent;
      })) return;
      setPendingAction(null);
      const closed = closeFiles(paths);
      if (closePane && !closed) onClose();
    } catch {
      // Store reports the failure; retain this dialog and every target buffer.
    } finally {
      if (savingGeneration.current === generation) {
        savingGeneration.current = null;
        setPendingSaveBusy(false);
      }
    }
  };
  return {
    activeDiff, t, visibleFile, session, project, dirty, isNewFile, previewMode, setPreviewMode,
    copyActiveAiPath, copyActiveAiContext, save, requestClose, visibleFiles, activeFilePath,
    diffContext, diffWorkspace, setActiveFilePath, requestCloseFiles, editorProject, language,
    editorTheme, handleEditorMount, setActiveContent, handleMarkdownLinkActivate,
    pendingMarkdownNavigation, handleMarkdownFragmentHandled, outlineSymbols, selectOutlineSymbol, pendingAction, setPendingAction,
    discardAndRun, saveAndRun, pendingSaveBusy,
  };
}
