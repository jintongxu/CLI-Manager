import type { BranchLineage, BranchSummary } from "../lib/types";

export interface ChatBranchNavigationLabels {
  navigation: string;
  parent: string;
  parentDeleted: string;
  children: string;
  child: (branch: BranchSummary, index: number) => string;
}

export interface ChatBranchNavigationProps {
  lineage: BranchLineage;
  labels: ChatBranchNavigationLabels;
  onSelectConversation: (conversationId: string) => void | Promise<void>;
  /** Whether the current branch's parent still exists in the selectable history. */
  parentAvailable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Defensive UI bound; backend lineage is already capped at 50 direct children. */
  maxChildren?: number;
}

/** One-level branch navigation only: current parent and direct children, never a recursive tree. */
export function ChatBranchNavigation({
  lineage, labels, onSelectConversation, parentAvailable = true, disabled = false,
  className, maxChildren = 50,
}: ChatBranchNavigationProps) {
  const parentId = lineage.current?.parentConversationId ?? null;
  const deletedParent = Boolean(lineage.current && !parentId);
  const children = lineage.children.slice(0, Math.max(0, Math.min(maxChildren, 50)));
  if (!parentId && !deletedParent && children.length === 0) return null;

  return <nav className={className ?? "chat-branch-navigation"} aria-label={labels.navigation}>
    {deletedParent && <span className="chat-branch-parent-deleted" role="status">{labels.parentDeleted}</span>}
    {parentId && (parentAvailable
      ? <button type="button" disabled={disabled} onClick={() => void onSelectConversation(parentId)}>
        {labels.parent}
      </button>
      : <span className="chat-branch-parent-deleted" role="status">{labels.parentDeleted}</span>)}
    {children.length > 0 && <div className="chat-branch-children">
      <span>{labels.children}</span>
      <ol>
        {children.map((branch, index) => <li key={branch.conversationId}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onSelectConversation(branch.conversationId)}
          >
            {labels.child(branch, index)}
          </button>
        </li>)}
      </ol>
    </div>}
  </nav>;
}
