import { create } from "zustand";
import { toast } from "sonner";
import { normalizeShellKey } from "../../../shared/platform/shell";
import { translateCurrent } from "../../../shared/i18n/index";
import { logInfo, logWarn } from "../../../shared/platform/logger";
import type { Project, WorktreeRecord } from "../../../shared/types/index";
import type { TerminalStatusEvent } from "../../terminal/api/TerminalProcessManager";
import { terminalProcessManager } from "../../terminal/api/TerminalProcessManager";
import { useTerminalStore } from "../../terminal/state";
import { getWorktreeDisplayName } from "./worktreeMetadata";
import { useWorktreeStore } from "./worktreeStore";

export type WorktreeDepsStartMode = "auto" | "manual";

export interface WorktreeDepsLaunch {
  projectId: string;
  envVars?: Record<string, string>;
  shell?: string;
}

export interface WorktreeDepsTask {
  sessionId: string;
  command: string;
  startedAt: number;
}

export interface WorktreeDepsStartResult {
  started: boolean;
  reason?: "running" | "missing" | "disabled" | "dismissed" | "notNeeded" | "failed";
}

interface WorktreeDepsRunnerState {
  tasks: Record<string, WorktreeDepsTask>;
  start: (
    project: Project,
    worktree: WorktreeRecord,
    launch: WorktreeDepsLaunch,
    mode: WorktreeDepsStartMode,
  ) => Promise<WorktreeDepsStartResult>;
  cancel: (worktreeId: string) => Promise<void>;
}

/**
 * 按 shell 把安装命令拼成“跑完即退出”，让 PTY 退出码等于安装结果。
 * 输入均为简单命令（npm/pnpm/yarn install、cargo fetch），不含 shell 元字符。
 */
export function buildDepsInstallCommand(command: string, shell?: string | null): string {
  const key = normalizeShellKey(shell ?? undefined);
  if (key === "powershell" || key === "pwsh") return `${command}; exit $LASTEXITCODE`;
  if (key === "cmd") return `${command} && exit 0 || exit 1`;
  if (key === "fish") return `${command}; exit $status`;
  return `${command}; exit $?`;
}

function depsToastId(worktreeId: string): string {
  return `worktree-deps-${worktreeId}`;
}

const unlistens = new Map<string, () => void>();
const closingSessions = new Map<string, Promise<void>>();
const starting = new Set<string>();

function finishTask(worktreeId: string): void {
  unlistens.get(worktreeId)?.();
  unlistens.delete(worktreeId);
  logInfo("Worktree deps task finished", { worktreeId });
  useWorktreeDepsRunnerStore.setState((state) => {
    if (!(worktreeId in state.tasks)) return state;
    const tasks = { ...state.tasks };
    delete tasks[worktreeId];
    return { tasks };
  });
}

async function handleDepsStatus(
  project: Project,
  worktree: WorktreeRecord,
  launch: WorktreeDepsLaunch,
  sessionId: string,
  payload: TerminalStatusEvent,
): Promise<void> {
  if (payload.status === "running") return;
  logInfo("Worktree deps status received", { worktreeId: worktree.id, sessionId, status: payload.status, exitCode: payload.exit_code });
  const store = useWorktreeDepsRunnerStore.getState();
  const task = store.tasks[worktree.id];
  if (!task || task.sessionId !== sessionId) return;
  const name = getWorktreeDisplayName(worktree);
  const toastId = depsToastId(worktree.id);
  finishTask(worktree.id);
  if (payload.status === "exited" && payload.exit_code === 0) {
    toast.success(translateCurrent("worktree.deps.done", { name }), { id: toastId });
  } else {
    const reason = payload.exit_code == null
      ? translateCurrent("worktree.deps.unknownStatus")
      : `exit ${payload.exit_code}`;
    toast.error(translateCurrent("worktree.deps.failed", { reason }), {
      id: toastId,
      duration: 15000,
      action: {
        label: translateCurrent("worktree.deps.retry"),
        onClick: () => {
          void store.start(project, worktree, launch, "manual");
        },
      },
    });
  }
  await closeTaskSession(worktree.id, sessionId);
}

export function waitForWorktreeDepsClose(worktreeId: string): Promise<void> {
  return closingSessions.get(worktreeId) ?? Promise.resolve();
}

function closeTaskSession(worktreeId: string, sessionId: string): Promise<void> {
  const existing = closingSessions.get(worktreeId);
  if (existing) return existing;
  const closing = useTerminalStore.getState().closeSession(sessionId, true).catch(() => {});
  closingSessions.set(worktreeId, closing);
  void closing.finally(() => {
    if (closingSessions.get(worktreeId) === closing) closingSessions.delete(worktreeId);
  });
  return closing;
}

let cleanupSubscribed = false;
/** worktree 删除/Finish 会关闭其全部会话；会话消失即清理 runner 残留状态，不由此处再关会话。 */
function ensureCleanupSubscription(): void {
  if (cleanupSubscribed) return;
  cleanupSubscribed = true;
  useTerminalStore.subscribe((state) => {
    const { tasks } = useWorktreeDepsRunnerStore.getState();
    const ids = Object.keys(tasks);
    if (ids.length === 0) return;
    const alive = new Set(state.sessions.map((session) => session.id));
    for (const worktreeId of ids) {
      if (alive.has(tasks[worktreeId].sessionId)) continue;
      finishTask(worktreeId);
      toast.dismiss(depsToastId(worktreeId));
    }
  });
}

export const useWorktreeDepsRunnerStore = create<WorktreeDepsRunnerState>()((set, get) => ({
  tasks: {},

  start: async (project, worktree, launch, mode) => {
    ensureCleanupSubscription();
    if (get().tasks[worktree.id] || starting.has(worktree.id)) {
      return { started: false, reason: "running" };
    }
    if (worktree.status !== "active") return { started: false, reason: "missing" };
    if (mode === "auto") {
      if (!project.worktree_deps_prompt_enabled) return { started: false, reason: "disabled" };
      if (worktree.deps_prompt_dismissed) return { started: false, reason: "dismissed" };
    }
    starting.add(worktree.id);
    logInfo("Worktree deps start", { worktreeId: worktree.id, mode, shell: launch.shell });
    try {
      let deps;
      try {
        deps = await useWorktreeStore.getState().checkDeps(worktree);
      } catch (err) {
        if (mode === "manual") {
          toast.error(translateCurrent("worktree.deps.checkFailed"), { description: String(err) });
        } else {
          logWarn("Worktree deps auto check failed", { worktreeId: worktree.id, err });
        }
        return { started: false, reason: "failed" };
      }
      if (!deps.needsInstall || !deps.command) {
        if (mode === "manual") toast.info(translateCurrent("worktree.deps.notNeeded"));
        return { started: false, reason: "notNeeded" };
      }
      const name = getWorktreeDisplayName(worktree);
      const installCommand = deps.command;
      const chained = buildDepsInstallCommand(installCommand, launch.shell);
      logInfo("Worktree deps check passed", { worktreeId: worktree.id, command: installCommand, shell: launch.shell, chained });
      await useWorktreeStore.getState().dismissDepsPrompt(worktree.id);
      let sessionId: string;
      try {
        sessionId = await useTerminalStore.getState().createSession(
          launch.projectId,
          worktree.path,
          translateCurrent("worktree.deps.installTitle", { name }),
          chained,
          launch.envVars,
          launch.shell,
          undefined,
          worktree.id,
          undefined,
          undefined,
          undefined,
          undefined,
          { transientBackground: true, oneShot: true },
        );
      } catch (err) {
        toast.error(translateCurrent("worktree.deps.failed", { reason: String(err) }), { duration: 15000 });
        return { started: false, reason: "failed" };
      }
      set((state) => ({
        tasks: { ...state.tasks, [worktree.id]: { sessionId, command: installCommand, startedAt: Date.now() } },
      }));
      logInfo("Worktree deps session created", { worktreeId: worktree.id, sessionId });
      toast.loading(translateCurrent("worktree.deps.installing", { name }), {
        id: depsToastId(worktree.id),
        description: installCommand,
        duration: Infinity,
        cancel: {
          label: translateCurrent("worktree.deps.cancel"),
          onClick: () => {
            void get().cancel(worktree.id);
          },
        },
      });
      try {
        const unlisten = await terminalProcessManager.subscribeStatus(sessionId, (payload) => {
          void handleDepsStatus(project, worktree, launch, sessionId, payload);
        });
        unlistens.set(worktree.id, unlisten);
        // 后台会话无 XTerm 订阅输出：立即消费全部输出帧并 ack，避免 daemon 侧流控暂停。
        const unlistenOutput = await terminalProcessManager.subscribeOutput(sessionId, (delivery) => {
          delivery.commit(Number(delivery.frame.data?.byteLength ?? 0));
        });
        const prev = unlistens.get(worktree.id);
        unlistens.set(worktree.id, () => { prev?.(); unlistenOutput(); });
      } catch (err) {
        logWarn("Worktree deps status subscription failed", { worktreeId: worktree.id, err });
      }
      return { started: true };
    } finally {
      starting.delete(worktree.id);
    }
  },

  cancel: async (worktreeId) => {
    const task = get().tasks[worktreeId];
    if (!task) return;
    finishTask(worktreeId);
    toast.dismiss(depsToastId(worktreeId));
    await closeTaskSession(worktreeId, task.sessionId);
  },
}));
