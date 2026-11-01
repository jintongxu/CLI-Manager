import type { ProjectCapabilities } from "../../projects/api/projectCapabilities";
import type { TerminalToolbarVisibilitySettings } from "../../../shared/preferences/settingsStore";
import { TERMINAL_SIDE_PANEL_TAB_ORDER, type TerminalSidePanelTab } from "../components/TerminalSidePanel";

/** Which side-panel tabs are reachable for the current session, toolbar settings and project. */
export function selectVisibleSidePanelTabs(input: {
  terminalToolbarVisibility: TerminalToolbarVisibilitySettings;
  panelGitSupported: boolean;
  panelCapabilities: Pick<ProjectCapabilities, "files" | "history" | "statistics">;
}): TerminalSidePanelTab[] {
  const { terminalToolbarVisibility, panelGitSupported, panelCapabilities } = input;
  return TERMINAL_SIDE_PANEL_TAB_ORDER.filter((tab) => {
    if (tab === "git") return terminalToolbarVisibility.gitChanges && panelGitSupported;
    if (tab === "stats") return terminalToolbarVisibility.stats && panelCapabilities.statistics;
    if (tab === "replay") return terminalToolbarVisibility.replay && panelCapabilities.history;
    if (tab === "files") return terminalToolbarVisibility.files && panelCapabilities.files;
    if (tab === "btw") return true;
    if (tab === "chat") return terminalToolbarVisibility.chat === true;
    return terminalToolbarVisibility[tab];
  });
}
