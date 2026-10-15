import { ChevronRight, FolderPlus, Plus } from "../../../shared/ui/icons";
import { useI18n } from "../../../shared/i18n/index";
import type { WorkspaceDockSide } from "../../../shared/lib/workspaceLayout";

export type ProjectListFilter = "all" | "open" | "pinned";

interface SidebarHeaderProps {
  collapsed: boolean;
  density: "compact" | "comfortable";
  dockSide: WorkspaceDockSide;
  onToggleCollapse: () => void;
  onCreateGroup: () => void;
  onCreateProject: () => void;
}

export function SidebarHeader({
  collapsed,
  density,
  dockSide,
  onToggleCollapse,
  onCreateGroup,
  onCreateProject,
}: SidebarHeaderProps) {
  const { t } = useI18n();
  const compact = density === "compact";
  const collapseIconClassName = dockSide === "right" ? "" : "rotate-180";
  const expandIconClassName = dockSide === "right" ? "rotate-180" : "";
  if (collapsed) {
    return (
      <div className={`flex flex-col items-center ${compact ? "gap-1 px-1.5 pb-1.5 pt-2.5" : "gap-1.5 px-2 pb-2 pt-3"}`}>
        <button
          onClick={onToggleCollapse}
          className={`ui-flat-action ui-toolbar-button-compact px-0 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
          title={t("sidebar.expand")}
          aria-label={t("sidebar.expand")}
        >
          <ChevronRight size={14} strokeWidth={1.8} className={expandIconClassName} />
        </button>
        <button
          onClick={onCreateGroup}
          className={`ui-flat-action ui-toolbar-button-compact px-0 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
          title={t("sidebar.newGroup")}
          aria-label={t("sidebar.newGroup")}
        >
          <FolderPlus size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={onCreateProject}
          className={`ui-flat-action ui-primary-action px-0 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
          title={t("sidebar.newTerminal")}
          aria-label={t("sidebar.newTerminal")}
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? "pb-1.5 pt-2.5" : "pb-2 pt-3"}>
      <div className={`flex items-center justify-between ${compact ? "px-2.5" : "px-3"}`}>
        <span className="text-[12px] font-semibold tracking-[0.03em] text-primary">{t("sidebar.projects")}</span>
        <div className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`}>
          <button
            onClick={onToggleCollapse}
            className={`ui-flat-action ui-toolbar-button-compact px-0 ${compact ? "h-7 w-7" : "h-8 w-8"}`}
            title={t("sidebar.collapse")}
            aria-label={t("sidebar.collapse")}
          >
            <ChevronRight size={14} strokeWidth={1.8} className={collapseIconClassName} />
          </button>
          <button
            onClick={onCreateGroup}
            className={`ui-flat-action ui-toolbar-button-compact ${compact ? "h-7 w-7 px-0" : "px-2.5 text-xs"}`}
            title={t("sidebar.newGroup")}
            aria-label={t("sidebar.newGroup")}
          >
            <FolderPlus size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={onCreateProject}
            className={`ui-flat-action ui-primary-action ui-toolbar-button-compact ${compact ? "h-7 px-2 text-[12px]" : "px-2.5 text-[12px]"}`}
            aria-label={t("sidebar.newTerminal")}
          >
            {t("sidebar.new")}
          </button>
        </div>
      </div>

    </div>
  );
}
