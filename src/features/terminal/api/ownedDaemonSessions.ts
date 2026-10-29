import { invoke } from "@tauri-apps/api/core";
import { ptyHostSocket } from "../transport/PtyHostSocket";
import type { DaemonSessionMeta } from "../types/terminalStoreTypes";

/** Unknown/legacy ownership is never permission to adopt another runtime's PTY. */
export async function listOwnedDaemonSessions(): Promise<DaemonSessionMeta[]> {
  const scopes = await ptyHostSocket.sessionScopes();
  const sessions = await invoke<DaemonSessionMeta[]>("pty_daemon_sessions");
  return sessions.filter((session) => scopes[session.sessionId] === "owned");
}
