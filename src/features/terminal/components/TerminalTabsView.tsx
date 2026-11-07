import type { useTerminalTabsController } from "../hooks/useTerminalTabsController";
import { Suspense, useRef } from "react";
import { toast } from "sonner";
import { DndContext } from "@dnd-kit/core";
import { TERMINAL_PANEL_WIDTH_DEFAULTS } from "../../../shared/preferences/settingsStore";
import { SplitTerminalView } from "./SplitTerminalView";
import { SystemResourcesPanel } from "./SystemResourcesPanel";
import { TerminalSidePanel } from "./TerminalSidePanel";
import { ResizableTerminalPanelFrame } from "./ResizableTerminalPanelFrame";
import { TerminalWorkspaceFrame } from "./TerminalWorkspaceFrame";
import { ProviderQuickSwitchPanel } from "./ProviderQuickSwitchPanel";
import { WorktreeFinishDialog } from "../../projects/api/WorktreeFinishDialog";
import { FileExplorerSidebar } from "../../files/api/FileExplorerSidebar";
import { Terminal } from "../../../shared/ui/icons";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { WorkspanTerminalLayout } from "../../workspace/api/WorkspanTerminalLayout";
import {
  HistoryWorkspace, GitChangesPanel, GitWorkspace, TerminalStatsPanel, SessionReplayPanel,
} from "./lazyTerminalPanels";
import { terminalTabCollisionDetection } from "../lib/terminalTabsModel";
import { TerminalNavigationAdapter } from "./TerminalNavigationAdapter";
import { TerminalTabDragOverlay } from "./TerminalTabDragOverlay";
import { BtwSideQuestionPanel } from "./BtwSideQuestionPanel";
import { ChatPanel } from "../../chat/api/ChatPanel";
import { useChatPanelStore } from "../store/chatPanelStore";
import { useChatPanelDrag } from "../hooks/useChatPanelDrag";
import { usePrimarySpaceStore } from "../../workspace/api/primarySpaceState";
import { BtwTerminalDrawer } from "./BtwTerminalDrawer";
import { SplitProjectPicker, TerminalCloseConfirmBubble } from "./TerminalTabDialogs";
import { getWorktreeDisplayName } from "../../projects/api/worktreeMetadata";
import { SidebarShellHost } from "./SidebarShellHost";
import { FileCompanionSurface } from "./FileCompanionSurface";
import { BottomShellPanel } from "./BottomShellPanel";

export function TerminalTabsView({
  workspaceVisible,
  fullscreen,
  historyActive,
  editorActive,
  hasEditorWorkspace,
  switchToTerminalWorkspace,
  switchToEditorWorkspace,
  terminalWellStyle,
  promptDialog,
  confirmDialog,
  saveSessionDialog,
  splitPicker,
  projectTree,
  splitPickerMenuStyle,
  handleSplitEmpty,
  handleSplitProject,
  handleCloseSplitPicker,
  shouldIgnoreSplitPickerOutsideInteraction,
  closeConfirm,
  confirmCloseSessions,
  cancelCloseSessions,
  shouldIgnoreCloseConfirmOutsideInteraction,
  finishTarget,
  setFinishTarget,
  discardTarget,
  t,
  removeWorktree,
  setDiscardTarget,
  historyOpen,
  onOpenHistorySettings,
  gitWorkspaceOpen,
  gitWorkspaceHeight,
  beginGitWorkspaceResize,
  gitWorkspaceProject,
  gitWorkspaceProjectPath,
  closeGitWorkspace,
  handleOpenGitChangesPanel,
  handleOpenGitWorkspaceWorktree,
  terminalThemeTone,
  terminalSidePanelVisible,
  terminalSidePanelSide,
  sidePanelMerged,
  sidePanelOpen,
  sidePanelTab,
  visibleSidePanelTabs,
  sidebarShell,
  panelSessionId,
  sidePanelProjectPath,
  panelSession,
  filePanelProject,
  panelProviderAppType,
  closeFilesPanel,
  handleSidePanelTabChange,
  onOpenProviderSettings,
  statsOpen,
  panelCapabilities,
  gitOpen,
  panelGitSupported,
  replayOpen,
  filesOpen,
  systemResourcesOpen,
  providersOpen,
  btwPanelOpen,
  btwDrawerOpen,
  closeBtwDrawer,
  openBtwReader,
  btwSideQuestion,
  setSidePanelOpen,
  setSidePanelTab,
  renderToolbarActions,
  sensors,
  handleDragStart,
  handleDragOver,
  clearDragState,
  handleDragEnd,
  workspanTabBarPosition,
  workspanTabBarVisible,
  handleCloseSessions,
  handleCloseOtherNavigationSessions,
  projects,
  worktrees,
  handleSubmitTabEdit,
  prompt,
  mountedWorkspanLayouts,
  effectiveActiveWorkspanId,
  groups, terminalScopeValue, handleActivateSession, paneNavigationProps,
  effectiveActiveSessionId,
  renderWorkspanLeaf,
  activeFullscreenPaneId,
  visibleSessions,
  useExternalTerminal,
  scopedEmptyState,
  handleNewTab,
  sessions,
}: ReturnType<typeof useTerminalTabsController>) {
  const chatPanelMode = useChatPanelStore((s) => s.mode);
  const chatPanelFloatOpen = useChatPanelStore((s) => s.floatOpen);
  const chatPanelAttached = useChatPanelStore((s) => s.attachedSelection);
  const chatReasoningEffort = useChatPanelStore((s) => s.reasoningEffort);
  const terminalWellRef = useRef<HTMLDivElement | null>(null);
  const chatDrag = useChatPanelDrag(terminalWellRef, chatPanelMode === "float" && chatPanelFloatOpen);
  const renderChatPanel = (mode: "dock" | "float") => <ChatPanel
    mode={mode}
    attachedSelection={chatPanelAttached}
    reasoningEffort={chatReasoningEffort}
    onReasoningEffortChange={useChatPanelStore.getState().setReasoningEffort}
    dragging={mode === "float" ? chatDrag.dragging : undefined}
    dragHandleProps={mode === "float" ? {
      onPointerDown: chatDrag.handlePointerDown,
      onPointerMove: chatDrag.handlePointerMove,
      onPointerUp: chatDrag.finish,
      onPointerCancel: chatDrag.finish,
      onKeyDown: chatDrag.handleKeyDown,
    } : undefined}
    onAttachSelectionChange={useChatPanelStore.getState().setAttachedSelection}
    onModeChange={(next) => {
      if (next === "dock" && !sidePanelMerged) return;
      useChatPanelStore.getState().setMode(next);
      useChatPanelStore.getState().setFloatOpen(next === "float");
      if (next === "float") setSidePanelOpen(false);
      else { setSidePanelTab("chat"); setSidePanelOpen(true); }
    }}
    onExpand={() => usePrimarySpaceStore.getState().setSpace("chat", "sidebar")}
    onClose={() => {
      if (chatPanelMode === "float") useChatPanelStore.getState().setFloatOpen(false);
      else setSidePanelOpen(false);
    }}
  />;
  const shellVisible = workspaceVisible && !historyActive && sidebarShell.shellOpen;
  const hasVisibleSessions = visibleSessions.length > 0;
  return (
    <div
      className="ui-terminal-tabs-shell flex h-full min-h-0 flex-col"
      data-fullscreen={fullscreen ? "true" : "false"}
      data-workspace-view={historyActive ? "history" : "terminal"}
      style={terminalWellStyle}
    >
      <SidebarShellHost target={sidebarShell.target} contextKey={sidebarShell.context?.key ?? null} visible={shellVisible} />
      {workspaceVisible && <>
      {promptDialog}
      {confirmDialog}
      {saveSessionDialog}
      <SplitProjectPicker
        picker={splitPicker}
        tree={projectTree}
        menuStyle={splitPickerMenuStyle}
        onSelectEmpty={handleSplitEmpty}
        onSelectProject={handleSplitProject}
        onClose={handleCloseSplitPicker}
        shouldIgnoreOutsideInteraction={shouldIgnoreSplitPickerOutsideInteraction}
      />
      <TerminalCloseConfirmBubble
        confirm={closeConfirm}
        menuStyle={splitPickerMenuStyle}
        onConfirm={confirmCloseSessions}
        onClose={cancelCloseSessions}
        shouldIgnoreOutsideInteraction={shouldIgnoreCloseConfirmOutsideInteraction}
      />
      <WorktreeFinishDialog
        open={!!finishTarget}
        project={finishTarget?.project ?? null}
        worktree={finishTarget?.worktree ?? null}
        onClose={() => setFinishTarget(null)}
      />
      <ConfirmDialog
        open={!!discardTarget}
        title={t("worktree.discard.title", { name: discardTarget ? getWorktreeDisplayName(discardTarget.worktree) : "" })}
        message={t("worktree.discard.message", { branch: discardTarget?.worktree.branch ?? "" })}
        confirmText={t("worktree.discard.confirm")}
        cancelText={t("common.cancel")}
        danger
        onConfirm={() => {
          if (discardTarget) {
            void removeWorktree(discardTarget.worktree, true).catch((err) => {
              toast.error(t("worktree.toast.discardFailed"), { description: String(err) });
            });
          }
          setDiscardTarget(null);
        }}
        onClose={() => setDiscardTarget(null)}
      />

      </>}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {historyOpen && (
          <div
            className="absolute inset-0 min-h-0 overflow-hidden"
            style={{ display: historyActive ? "block" : "none" }}
          >
            <Suspense fallback={null}>
              <HistoryWorkspace active={workspaceVisible && historyActive} onOpenSettings={onOpenHistorySettings} />
            </Suspense>
          </div>
        )}
        {gitWorkspaceOpen && (
          <div
            className="absolute inset-x-0 bottom-0 z-[2] min-h-0 overflow-hidden border-t shadow-2xl"
            style={{ height: gitWorkspaceHeight, borderColor: "var(--border-subtle, rgba(255,255,255,0.12))" }}
          >
            <div
              className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none select-none"
              onPointerDown={beginGitWorkspaceResize}
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("git.workspace.resizeHeight")}
            >
              <span
                className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-[height] group-hover:h-0.5 group-active:h-0.5"
                style={{ backgroundColor: "var(--border-subtle, rgba(255,255,255,0.12))" }}
              />
            </div>
            <Suspense fallback={null}>
              <GitWorkspace
                active={workspaceVisible && gitWorkspaceOpen}
                project={gitWorkspaceProject}
                projectPath={gitWorkspaceProjectPath}
                onClose={closeGitWorkspace}
                onOpenChanges={handleOpenGitChangesPanel}
                onOpenWorktreeSession={handleOpenGitWorkspaceWorktree}
              />
            </Suspense>
          </div>
        )}
        <div
          className="ui-terminal-well absolute inset-0 min-h-0 flex"
          ref={terminalWellRef}
          data-terminal-mode="independent"
          data-terminal-theme-tone={terminalThemeTone}
          data-terminal-side-panel-visible={terminalSidePanelVisible ? "true" : "false"}
          style={{ display: historyActive ? "none" : "flex" }}
        >
          <TerminalWorkspaceFrame
            dockSide={terminalSidePanelSide}
            panels={[
              sidePanelMerged ? (
                <TerminalSidePanel
                  key="merged"
                  open={sidePanelOpen}
                  dockSide={terminalSidePanelSide}
                  activeTab={sidePanelTab}
                  visibleTabs={visibleSidePanelTabs}
                  activeSessionId={panelSessionId}
                  projectPath={sidePanelProjectPath}
                  projectId={panelSession?.projectId}
                  filesTabDisabled={!filePanelProject}
                  systemResourcesEnabled
                  resourcesVisible={workspaceVisible && terminalSidePanelVisible && !historyActive}
                  providerDefaultAppType={panelProviderAppType}
                  filesPanelContent={<FileExplorerSidebar mode="panel" onClosePanel={closeFilesPanel} editorActive={editorActive} hasEditorWorkspace={hasEditorWorkspace} onSwitchToTerminalWorkspace={switchToTerminalWorkspace} onSwitchToEditorWorkspace={switchToEditorWorkspace} />}
                  btwPanelContent={
                    <BtwSideQuestionPanel controller={btwSideQuestion} onOpenReader={openBtwReader} />
                  }
                  chatPanelContent={renderChatPanel("dock")}
                  onTabChange={handleSidePanelTabChange}
                  onOpenProviderSettings={onOpenProviderSettings}
                />
              ) : null,
              !sidePanelMerged && gitOpen && panelGitSupported ? (
                <ResizableTerminalPanelFrame
                  key="git"
                  widthKey="git"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.git}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeGitLabel")}
                  resizeTitle={t("terminal.panel.resizeGitTitle")}
                >
                  <Suspense fallback={null}>
                    <GitChangesPanel open={gitOpen} projectPath={sidePanelProjectPath} projectId={panelSession?.projectId} embedded />
                  </Suspense>
                </ResizableTerminalPanelFrame>
              ) : null,
              !sidePanelMerged && statsOpen && panelCapabilities.statistics ? (
                <ResizableTerminalPanelFrame
                  key="stats"
                  widthKey="stats"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.stats}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeStatsLabel")}
                  resizeTitle={t("terminal.panel.resizeStatsTitle")}
                >
                  <Suspense fallback={null}>
                    <TerminalStatsPanel activeSessionId={panelSessionId} open={statsOpen} embedded />
                  </Suspense>
                </ResizableTerminalPanelFrame>
              ) : null,
              !sidePanelMerged && replayOpen && panelCapabilities.history ? (
                <ResizableTerminalPanelFrame
                  key="replay"
                  widthKey="replay"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.replay}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeReplayLabel")}
                  resizeTitle={t("terminal.panel.resizeReplayTitle")}
                >
                  <Suspense fallback={null}>
                    <SessionReplayPanel activeSessionId={panelSessionId} open={replayOpen} />
                  </Suspense>
                </ResizableTerminalPanelFrame>
              ) : null,
              !sidePanelMerged && filesOpen && panelCapabilities.files ? (
                <ResizableTerminalPanelFrame
                  key="files"
                  widthKey="files"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.files}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeFilesLabel")}
                  resizeTitle={t("terminal.panel.resizeFilesTitle")}
                >
                  <FileExplorerSidebar mode="panel" onClosePanel={closeFilesPanel} editorActive={editorActive} hasEditorWorkspace={hasEditorWorkspace} onSwitchToTerminalWorkspace={switchToTerminalWorkspace} onSwitchToEditorWorkspace={switchToEditorWorkspace} />
                </ResizableTerminalPanelFrame>
              ) : null,
              !sidePanelMerged && systemResourcesOpen ? (
                <ResizableTerminalPanelFrame
                  key="systemResources"
                  widthKey="systemResources"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.systemResources}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeSystemResourcesLabel")}
                  resizeTitle={t("terminal.panel.resizeSystemResourcesTitle")}
                >
                  <SystemResourcesPanel open={systemResourcesOpen} visible={workspaceVisible && terminalSidePanelVisible && !historyActive} embedded />
                </ResizableTerminalPanelFrame>
              ) : null,
              !sidePanelMerged && providersOpen ? (
                <ResizableTerminalPanelFrame
                  key="providers"
                  widthKey="providers"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.providers}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeProvidersLabel")}
                  resizeTitle={t("terminal.panel.resizeProvidersTitle")}
                >
                  <ProviderQuickSwitchPanel open={providersOpen} defaultAppType={panelProviderAppType} onOpenSettings={onOpenProviderSettings} />
                </ResizableTerminalPanelFrame>
              ) : null,
              !sidePanelMerged && btwPanelOpen ? (
                <ResizableTerminalPanelFrame
                  key="btw"
                  widthKey="btw"
                  defaultWidth={TERMINAL_PANEL_WIDTH_DEFAULTS.btw}
                  dockSide={terminalSidePanelSide}
                  resizeLabel={t("terminal.panel.resizeProvidersLabel")}
                  resizeTitle={t("terminal.panel.resizeProvidersTitle")}
                >
                  <BtwSideQuestionPanel controller={btwSideQuestion} onOpenReader={openBtwReader} />
                </ResizableTerminalPanelFrame>
              ) : null,
            ]}
            actions={renderToolbarActions()}
          >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-terminal-center>
          <div className="btw-terminal-split">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {(
              <DndContext
                sensors={sensors}
                collisionDetection={terminalTabCollisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragCancel={clearDragState}
                onDragEnd={handleDragEnd}
              >
                <WorkspanTerminalLayout
                  position={workspanTabBarPosition}
                  tabBarVisible={workspanTabBarVisible}
                  tabBar={<TerminalNavigationAdapter
                    sessions={sessions} projects={projects} worktrees={worktrees} groups={groups}
                    scope={terminalScopeValue} currentSessionId={effectiveActiveSessionId}
                    position={workspanTabBarPosition} tabBarVisible={workspanTabBarVisible}
                    onActivateSession={handleActivateSession} onNewTab={() => { void handleNewTab(); }}
                    onCloseSession={(id) => {
                      handleCloseSessions([id]);
                    }}
                    onCloseOthers={handleCloseOtherNavigationSessions}
                    onRename={(session) => { void prompt({ title: t("terminal.tab.rename"), initialValue: session.title }).then((title) => {
                      if (title !== null) void handleSubmitTabEdit(session.id, title);
                    }); }} paneProps={paneNavigationProps} layouts={mountedWorkspanLayouts}
                  />}
                >
                <FileCompanionSurface hasTerminal={hasVisibleSessions} visible={workspaceVisible && !historyActive}
                  background={paneNavigationProps?.terminalThemeBackground ?? "transparent"}>
                <div className="relative h-full min-h-0 flex-1 overflow-hidden">
                  {mountedWorkspanLayouts.map((layout) => {
                    const layoutVisible = Boolean(layout.visiblePaneTree)
                      && layout.workspan.id === effectiveActiveWorkspanId;
                    const layoutActiveSessionId = layoutVisible
                      ? effectiveActiveSessionId
                      : layout.visiblePaneTree
                        ? layout.workspan.activeSessionId
                        : null;
                    return (
                      <div
                        key={layout.workspan.id}
                        className="absolute inset-0 min-h-0 min-w-0 overflow-hidden"
                        style={{ display: layoutVisible ? "block" : "none" }}
                        aria-hidden={layoutVisible ? undefined : "true"}
                      >
                        <SplitTerminalView
                          node={layout.paneTree}
                          visibleNode={layout.visiblePaneTree}
                          renderLeaf={(pane) => renderWorkspanLeaf(
                            pane,
                            layout.visiblePanes,
                            layoutActiveSessionId,
                            hasVisibleSessions && layoutVisible && layout.visiblePaneIds.has(pane.id),
                          )}
                          fullscreenLeafId={layoutVisible ? activeFullscreenPaneId : null}
                        />
                      </div>
                    );
                  })}
                {!hasVisibleSessions && !useExternalTerminal && (
                  <div className="absolute inset-0 flex items-center justify-center px-6">
                    <EmptyState
                      icon={<Terminal size={40} strokeWidth={1} />}
                      title={scopedEmptyState?.title ?? t("terminal.empty.title")}
                      description={scopedEmptyState?.description ?? t("terminal.empty.description")}
                      tone="inverse"
                      action={scopedEmptyState?.action ?? { label: t("terminal.empty.action"), onClick: handleNewTab }}
                    />
                  </div>
                )}
                </div>
                </FileCompanionSurface>
                </WorkspanTerminalLayout>
                <TerminalTabDragOverlay style={terminalWellStyle} themeTone={terminalThemeTone} />
              </DndContext>
            )}
          </div>
          {btwDrawerOpen ? (
            <div className="btw-terminal-split-pane" style={{ display: gitWorkspaceOpen ? "none" : "flex" }}>
              <BtwTerminalDrawer controller={btwSideQuestion} onClose={closeBtwDrawer} />
            </div>
          ) : null}
          </div>
          <BottomShellPanel visible={shellVisible} context={sidebarShell.context} error={sidebarShell.error}
            registerTarget={sidebarShell.setTarget} onOpen={sidebarShell.open} onCollapse={sidebarShell.collapse} />
          </div>
          </TerminalWorkspaceFrame>
          {chatPanelMode === "float" && chatPanelFloatOpen ? (
            <div
              className="absolute z-30"
              data-chat-panel-float="true"
              style={{
                left: chatDrag.geometry.x,
                top: chatDrag.geometry.y,
                width: chatDrag.geometry.width,
                height: chatDrag.geometry.height,
              }}
            >
              {renderChatPanel("float")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
