import type { Project, TerminalSession, WorktreeRecord } from "../../../shared/types/index";
import type { TerminalWorkspan } from "../api/terminalWorkspan";
import type { TabNotificationState } from "../state";
import type { WorkspanTabModel } from "../../workspace/api/WorkspanTabBar";
import { inferSessionCliToolIcon, inferSessionVendor, getTerminalTabScopeKey, getWorkspanNotification } from "./terminalTabsModel";
import { inferVendor } from "../../../shared/ui/VendorIcon";
import type { TranslationKey } from "../../../shared/i18n/index";

import {
  buildWorkspanProjectMemberships, resolveTerminalProjectMembership,
  type ProjectTabLabels, type TerminalProjectMembership, type WorkspanProjectMembership,
} from "../api/terminalProjectTabsModel";

export interface ProjectWorkspanTabModel extends WorkspanTabModel {
  memberSessions: TerminalSession[];
  members: TerminalProjectMembership[];
  projectKeys: string[];
  projectMemberships: WorkspanProjectMembership[];
  mixedProject: boolean;
}

export function buildWorkspanTabModels(
  layouts: Array<{ workspan: TerminalWorkspan; sessionIds: string[]; closeSessionIds: string[] }>,
  sessions: TerminalSession[],
  projects: Map<string, Project>,
  notifications: Record<string, TabNotificationState>,
  translateCurrent: (key: TranslationKey, params?: Record<string, string | number>) => string,
  worktrees: WorktreeRecord[] = [],
  labels: ProjectTabLabels = {
    unboundProject: translateCurrent("terminal.context.unboundProject"),
    missingWorktree: translateCurrent("terminal.context.worktreeMissing"),
  },
): ProjectWorkspanTabModel[] {
  return layouts.map(({ workspan, sessionIds, closeSessionIds }) => {
    const memberSessions = sessionIds
      .map((sessionId) => sessions.find((session) => session.id === sessionId))
      .filter((session): session is TerminalSession => Boolean(session));
    const singleSession = memberSessions.length === 1 ? memberSessions[0] : null;
    const members = memberSessions.map((session) => resolveTerminalProjectMembership(session, sessions, projects, worktrees, labels));
    const projectMemberships = buildWorkspanProjectMemberships(members, workspan.activeSessionId);
    return {
      memberSessions, members, projectMemberships,
      projectKeys: projectMemberships.map((membership) => membership.projectKey),
      mixedProject: projectMemberships.length > 1,
      workspan,
      sessionIds,
      closeSessionIds,
      singleSession,
      title: workspan.customTitle ?? singleSession?.title ?? translateCurrent("terminal.workspan.title", { count: memberSessions.length }),
      notification: getWorkspanNotification(sessionIds, notifications),
      vendor: singleSession ? (inferVendor(projects.get(singleSession.projectId!)?.cli_tool) ?? inferSessionVendor(singleSession)) : null,
      cliToolIcon: singleSession ? inferSessionCliToolIcon(singleSession, projects.get(singleSession.projectId!)) : null,
      contextKey: singleSession ? getTerminalTabScopeKey(singleSession) : null,
    };
  });
}
