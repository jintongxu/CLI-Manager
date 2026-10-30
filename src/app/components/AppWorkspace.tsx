import type { ReactNode } from "react";
import { ChatWorkspace } from "../../features/chat/api/ChatWorkspace";
import type { PrimarySpace } from "../../features/workspace/api/primarySpaceState";

/** Stable siblings: changing primary space never changes either owner identity. */
export function AppWorkspace({ space, children, chatWorkspace }: {
  space: PrimarySpace;
  children: ReactNode;
  chatWorkspace?: ReactNode;
}) {
  const projectsVisible = space === "projects";
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" hidden={!projectsVisible}
      inert={!projectsVisible} aria-hidden={!projectsVisible} style={{ display: projectsVisible ? undefined : "none" }}>
      {children}
    </div>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" hidden={projectsVisible}
      inert={projectsVisible} aria-hidden={projectsVisible} style={{ display: projectsVisible ? "none" : undefined }}>
      {chatWorkspace ?? <ChatWorkspace workspaceVisible={!projectsVisible} />}
    </div>
  </div>;
}
