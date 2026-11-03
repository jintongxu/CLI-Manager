import type { TerminalPaneNode } from "../api/terminalPaneTree";
import type { TerminalWorkspan } from "../api/terminalWorkspan";

/** Replace one identity in the latest layout, retaining empty and unmapped nodes. */
export function replaceRecoveryLayoutSession(workspans: TerminalWorkspan[], sourceId: string, replacementId: string): TerminalWorkspan[] {
  const id = (value: string | null) => value === sourceId ? replacementId : value;
  const visit = (node: TerminalPaneNode | null): TerminalPaneNode | null => {
    if (!node) return node;
    if (node.type === "leaf") return { ...node, sessionIds: node.sessionIds.map(value => id(value)!), activeSessionId: id(node.activeSessionId) };
    return { ...node, first: visit(node.first)!, second: visit(node.second)! };
  };
  return workspans.map(workspan => ({ ...workspan, paneTree: visit(workspan.paneTree), activeSessionId: id(workspan.activeSessionId) }));
}
