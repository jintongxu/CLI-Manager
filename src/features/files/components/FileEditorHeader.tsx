import { useI18n } from "../../../shared/i18n/index";
import { Button } from "../../../shared/ui/button";
import { Copy, FileCode, Link2, Maximize2, Minimize2, Save, X } from "../../../shared/ui/icons";

interface FileEditorHeaderProps {
  title: string;
  path: string;
  dirty: boolean;
  showMarkdownModes: boolean;
  previewMode: "source" | "preview";
  canUseFileActions: boolean;
  onPreviewModeChange: (mode: "source" | "preview") => void;
  onCopyAiPath: () => void;
  onCopyAiContext: () => void;
  onSave: () => void;
  onClose: () => void;
  showCloseFileAction?: boolean;
  companionMode?: "beside" | "current";
  onToggleCompanionMode?: () => void;
  onCollapseCompanion?: () => void;
}

export function FileEditorHeader({
  title,
  path,
  dirty,
  showMarkdownModes,
  previewMode,
  canUseFileActions,
  onPreviewModeChange,
  onCopyAiPath,
  onCopyAiContext,
  onSave,
  onClose,
  showCloseFileAction = true,
  companionMode,
  onToggleCompanionMode,
  onCollapseCompanion,
}: FileEditorHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="ui-file-editor-header flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface-container-low px-3">
      <FileCode size={15} strokeWidth={1.8} className="text-on-surface-variant" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-xs font-semibold text-on-surface">{title}{dirty ? " *" : ""}</div>
        </div>
        <div className="truncate text-[10px] text-text-muted">{path}</div>
      </div>
      {showMarkdownModes && (
        <div className="ui-file-editor-segment flex rounded-md border border-border bg-surface-container-lowest p-0.5">
          <button
            type="button"
            className="rounded px-2 py-1 text-[11px]"
            data-active={previewMode === "source" ? "true" : "false"}
            onClick={() => onPreviewModeChange("source")}
          >
            {t("files.editor.source")}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-[11px]"
            data-active={previewMode === "preview" ? "true" : "false"}
            onClick={() => onPreviewModeChange("preview")}
          >
            {t("files.editor.preview")}
          </button>
        </div>
      )}
      <div className="ui-file-editor-file-actions">
      <Button size="sm" variant="outline" className="ui-file-editor-ai-action" disabled={!canUseFileActions} title={t("files.editor.aiPathHint")} onClick={onCopyAiPath}>
        <Link2 size={13} aria-hidden="true" />
        {t("files.editor.aiPath")}
      </Button>
      <Button size="sm" variant="outline" className="ui-file-editor-ai-action" disabled={!canUseFileActions} title={t("files.editor.aiContextHint")} onClick={onCopyAiContext}>
        <Copy size={13} aria-hidden="true" />
        {t("files.editor.aiContext")}
      </Button>
      <Button size="sm" variant="outline" disabled={!dirty} onClick={onSave}>
        <Save size={13} />
        {t("common.save")}
      </Button>
      {showCloseFileAction && <button
        type="button"
        className="ui-icon-action"
        title={t("files.editor.close")}
        aria-label={t("files.editor.close")}
        onClick={onClose}
      >
        <X size={15} />
      </button>}
      </div>
      {onToggleCompanionMode && <div className="ui-file-editor-layout-actions" role="group">
        <button type="button" className="ui-file-editor-layout-action" aria-label={t(companionMode === "current" ? "terminal.companion.restore" : "terminal.companion.maximize")} title={t(companionMode === "current" ? "terminal.companion.restore" : "terminal.companion.maximize")} onClick={onToggleCompanionMode}>
          {companionMode === "current" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {onCollapseCompanion && <button type="button" className="ui-file-editor-layout-action" aria-label={t("terminal.companion.collapse")} title={t("terminal.companion.collapse")} onClick={onCollapseCompanion}><X size={14} /></button>}
      </div>}
    </div>
  );
}
