export {
  useTerminalStore,
} from "./store/terminalStore";
export {
  type SessionStatus,
  type CliHookSource,
  type CliHookEventName,
  type TabNotificationState,
  type ShellRuntimeEventName,
  type TabStatusDetails,
  type ShellRuntimePayload,
  type CliHookPayload,
  type SubagentTranscriptContent,
  type SplitState,
  type SplitTerminalOptions,
  type DetachedPtyLaunchOptions,
  type DetachedPtyLaunchResult,
} from "./types/terminalStoreTypes";
export {
  detectCliResumeKind,
  formatStartupInputForPty,
  formatManualDirectCodexInputForPty,
  createDetachedPtyProcess,
} from "./lib/terminalLaunch";

export { isTaskQualifiedAgent, getAgentTaskNotification, buildAgentTaskNotifications } from "./lib/terminalTaskPresentation";
export type { TabStatusSources } from "./types/terminalStoreTypes";
