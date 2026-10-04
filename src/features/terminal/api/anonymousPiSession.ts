import type { TerminalStore } from "../types/terminalStoreTypes";

type CreateSession = TerminalStore["createSession"];

export function createAnonymousPiSessionHandler(
  createSession: CreateSession,
  closeHistory: () => void,
  setActiveWorkspaceTab: (tab: "terminal" | "history") => void,
) {
  return async () => {
    await createSession(undefined, undefined, "Anonymous Pi", "pi --no-session", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { sessionKind: "ephemeral-pi" });
    closeHistory();
    setActiveWorkspaceTab("terminal");
  };
}
