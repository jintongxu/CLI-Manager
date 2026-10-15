import { SidebarTerminalList } from "./SidebarTerminalList";

/** Pinned/narrow project shortcuts show only the main project terminals. */
export function SidebarProjectTerminals({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  return <SidebarTerminalList projectId={projectId} depth={1} compact={compact} />;
}
