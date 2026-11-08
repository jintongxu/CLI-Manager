import { useEffect } from "react";
import { Button } from "../../../shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../shared/ui/dialog";
import Editor from "@monaco-editor/react";
import { useState, useRef } from "react";
import { FileEditorContent } from "./FileEditorContent";
import { FileEditorHeader } from "./FileEditorHeader";
import type { useFileEditorController } from "../hooks/useFileEditorController";
import { languageFromPath } from "../../../shared/platform/monacoSetup";
type FileEditorPaneViewProps = ReturnType<typeof useFileEditorController>;

function FileEditorPaneView(props: FileEditorPaneViewProps) {
  const {
    activeDiff, t, visibleFile, session, project, dirty, isNewFile, previewMode, setPreviewMode,
    copyActiveAiPath, copyActiveAiContext, save, requestClose,
    diffContext, diffWorkspace, editorProject, language,
    editorTheme, handleEditorMount, setActiveContent, handleMarkdownLinkActivate,
    pendingMarkdownNavigation, handleMarkdownFragmentHandled, outlineSymbols, outlineActiveLine, selectOutlineSymbol, definitionPeek, setDefinitionPeek, openDefinition, pendingAction, setPendingAction,
    discardAndRun, saveAndRun, pendingSaveBusy,
  } = props;
  const [definitionPeekHeight, setDefinitionPeekHeight] = useState(() => {
    const stored = Number(localStorage.getItem("cli-manager.file-editor.peek-height"));
    return Number.isFinite(stored) ? Math.max(140, Math.min(560, stored)) : 280;
  });
  const [outlineOpen, setOutlineOpen] = useState(false);
  const peekDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  useEffect(() => {
    if (!definitionPeek) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDefinitionPeek(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [definitionPeek, setDefinitionPeek]);
  return (
    <div className="ui-file-editor-pane flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <FileEditorHeader
        title={activeDiff
          ? t("git.diff.title", { fileName: activeDiff.fileName })
          : visibleFile?.name ?? session.fileEditor?.projectName ?? project?.name ?? t("files.editor.titleFallback")}
        path={activeDiff?.sourcePath ?? visibleFile?.path ?? session.fileEditor?.projectPath ?? project?.path ?? t("files.editor.noFile")}
        dirty={dirty}
        isNewFile={isNewFile}
        showMarkdownModes={visibleFile?.previewKind === "markdown"}
        previewMode={previewMode}
        canUseFileActions={Boolean(visibleFile)}
        onPreviewModeChange={setPreviewMode}
        onCopyAiPath={copyActiveAiPath}
        onCopyAiContext={copyActiveAiContext}
        onSave={() => void save()}
        onClose={requestClose}
      />
      <FileEditorContent
        file={visibleFile}
        activeDiff={activeDiff}
        project={editorProject}
        diffContext={diffContext}
        diffWorkspace={diffWorkspace}
        previewMode={previewMode}
        language={language}
        editorTheme={editorTheme}
        onEditorMount={handleEditorMount}
        onContentChange={setActiveContent}
        onMarkdownLinkActivate={(href) => handleMarkdownLinkActivate(href, "preview")}
        markdownFragmentRequest={pendingMarkdownNavigation?.mode === "preview"
          && pendingMarkdownNavigation.path === visibleFile?.path
          ? { id: pendingMarkdownNavigation.id, fragment: pendingMarkdownNavigation.fragment }
          : null}
        onMarkdownFragmentHandled={handleMarkdownFragmentHandled}
        outlineSymbols={outlineSymbols}
        outlineActiveLine={outlineActiveLine}
        onOutlineSelect={selectOutlineSymbol}
        outlineOpen={outlineOpen}
        onOutlineOpenChange={setOutlineOpen}
      />
      {definitionPeek && (
        <section className="ui-file-editor-definition-peek" style={{ height: definitionPeekHeight }} aria-label={t("files.editor.definitionPeek")}>
          <div className="ui-file-editor-definition-peek__resize" role="separator" tabIndex={0} aria-orientation="horizontal"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              peekDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: definitionPeekHeight };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = peekDragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const nextHeight = Math.max(140, Math.min(560, drag.startHeight + drag.startY - event.clientY));
              setDefinitionPeekHeight(nextHeight);
              localStorage.setItem("cli-manager.file-editor.peek-height", String(nextHeight));
            }}
            onPointerUp={(event) => { if (peekDragRef.current?.pointerId === event.pointerId) { peekDragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
            onPointerCancel={() => { peekDragRef.current = null; }}
          />
          <div className="ui-file-editor-definition-peek__header">
            <span className="truncate">{definitionPeek.symbol.name} · {definitionPeek.symbol.path}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => void openDefinition(definitionPeek.symbol)}>{t("files.editor.openDefinition")}</button>
              <button type="button" onClick={() => setDefinitionPeek(null)} aria-label={t("common.close")}>×</button>
            </div>
          </div>
          <div className="ui-file-editor-definition-peek__editor">
            <Editor path={`peek:${definitionPeek.symbol.path}`} value={definitionPeek.content} language={languageFromPath(definitionPeek.symbol.path)} theme={editorTheme}
              onMount={(editor) => { editor.revealLineInCenter(definitionPeek.symbol.line); editor.setPosition({ lineNumber: definitionPeek.symbol.line, column: definitionPeek.symbol.column }); }}
              options={{ readOnly: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, folding: true, lineNumbers: "on", glyphMargin: false, wordWrap: "off", overviewRulerLanes: 0 }} />
          </div>
        </section>
      )}

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent data-file-editor-dialog aria-busy={pendingSaveBusy} className="max-w-[420px]">
          <DialogTitle>{t("files.editor.unsavedTitle")}</DialogTitle>
          <DialogDescription className="mt-2">
            {pendingAction?.dirtyPaths.length === 1
              ? t("files.editor.unsavedOne")
              : t("files.editor.unsavedMany", { count: pendingAction?.dirtyPaths.length ?? 0 })}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>{t("common.cancel")}</Button>
            <Button variant="outline" disabled={pendingSaveBusy} onClick={discardAndRun}>{t("files.editor.discard")}</Button>
            <Button disabled={pendingSaveBusy} onClick={() => void saveAndRun()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { FileEditorPaneView };
export default FileEditorPaneView;
