import { create } from "zustand";
import type { SidebarShellContext } from "../lib/sidebarShellContext";
import type { TerminalStore } from "../types/terminalStoreTypes";
import { useTerminalStore } from "./terminalStore";

export interface SidebarShellOwner {
  readonly context: SidebarShellContext;
  readonly phase: "creating" | "ready" | "closing" | "closeFailed" | "createFailed";
  readonly sessionId?: string;
  readonly error?: unknown;
}

export interface SidebarShellState {
  /** Runtime only. UI must keep every owned session's parser mounted, even hidden. */
  owners: Record<string, SidebarShellOwner>;
  open: (context: SidebarShellContext) => Promise<string>;
  close: (key: string) => Promise<void>;
}

type ShellTerminalApi = Pick<TerminalStore, "createSession" | "closeSession" | "sessions">;

/** Factory permits hermetic lifecycle tests; production has one durable module owner.
 * No selected-context state and no component cleanup: switching/collapse cannot
 * create or discard PTYs. Native exit admission remains in the managed create path.
 */
export function createSidebarShellStore(getTerminal: () => ShellTerminalApi) {
  const creating = new Map<string, Promise<string>>();
  const closing = new Map<string, Promise<void>>();
  return create<SidebarShellState>((set, get) => {
    const put = (key: string, owner: SidebarShellOwner) => set(state => ({ owners: { ...state.owners, [key]: owner } }));
    const remove = (key: string) => set(state => {
      const owners = { ...state.owners };
      delete owners[key];
      return { owners };
    });
    return {
      owners: {},
      open(context) {
        const key = context.key;
        const close = closing.get(key);
        if (close) return close.then(() => get().open(context));
        const pending = creating.get(key);
        if (pending) return pending;
        const existing = get().owners[key];
        if (existing?.sessionId && getTerminal().sessions.some(item => item.id === existing.sessionId)) {
          return Promise.resolve(existing.sessionId);
        }
        // Copy before any await so a late success belongs to this old context.
        const captured = Object.freeze({ ...context, envVars: context.envVars ? Object.freeze({ ...context.envVars }) : undefined });
        const operation = Promise.resolve().then(async () => {
          try {
            // Internal launch policy belongs only to this local pwsh creation,
            // never to inherited user settings or a remote environment.
            const envVars = { ...captured.envVars };
            delete envVars.CLI_MANAGER_SIDEBAR_CLEAN_PWSH;
            if (captured.environmentType === "local" && !captured.sshHostId && captured.shell === "pwsh") {
              envVars.CLI_MANAGER_SIDEBAR_CLEAN_PWSH = "1";
            }
            const id = await getTerminal().createSession(captured.projectId, captured.cwd, undefined, "",
              Object.keys(envVars).length ? envVars : undefined, captured.shell, undefined,
              captured.worktreeId, captured.sshHostId, undefined, undefined, undefined, { transientBackground: true });
            put(key, { context: captured, phase: "ready", sessionId: id });
            return id;
          } catch (error) {
            // Managed creation can retain a candidate when strict cleanup fails.
            const retainedId = typeof error === "object" && error !== null && "sessionId" in error
              && typeof error.sessionId === "string" ? error.sessionId : undefined;
            // Production retention clears transientBackground and publishes a
            // recovery workspan. That is an explicit transfer to the ordinary
            // pane renderer: keep an actionable failure, but never a second parser.
            const retained = getTerminal().sessions.find(item => item.id === retainedId);
            const sidebarSessionId = retained?.transientBackground === true ? retained.id : undefined;
            put(key, { context: captured, phase: "createFailed", sessionId: sidebarSessionId, error });
            throw error;
          } finally {
            creating.delete(key);
          }
        });
        creating.set(key, operation);
        put(key, { context: captured, phase: "creating" });
        return operation;
      },
      close(key) {
        const pending = closing.get(key);
        if (pending) return pending;
        const operation = Promise.resolve().then(async () => {
          // Explicit close waits for launch settlement, including retained failures.
          try { await creating.get(key); } catch { /* inspect retained ownership below */ }
          const owner = get().owners[key];
          if (!owner?.sessionId) { remove(key); return; }
          put(key, { ...owner, phase: "closing", error: undefined });
          try {
            await getTerminal().closeSession(owner.sessionId, true);
            // Some managed close paths deliberately return without removing a locked
            // session. That is not an ACK of disposal and must remain retryable.
            if (getTerminal().sessions.some(item => item.id === owner.sessionId)) throw new Error("sidebar_shell_close_unconfirmed");
            remove(key);
          } catch (error) {
            put(key, { ...owner, phase: "closeFailed", error });
            throw error;
          }
        }).finally(() => { closing.delete(key); });
        closing.set(key, operation);
        return operation;
      },
    };
  });
}

export const useSidebarShellStore = createSidebarShellStore(() => useTerminalStore.getState());
