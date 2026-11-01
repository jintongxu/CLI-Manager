import { WORKSPACE_SELECTION_MAX } from "../../../shared/lib/workspaceSelection";

/** Quoted workspace selection is appended verbatim so the model can see the exact text. */
const SELECTION_HEADER = "--- 以下为我在工作区选中的内容 ---";

export function truncateSelection(text: string, max = WORKSPACE_SELECTION_MAX): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function buildSendText(text: string, selection: string): string {
  const body = text.trim();
  const quoted = truncateSelection(selection);
  if (!quoted) return body;
  return body ? `${body}\n\n${SELECTION_HEADER}\n${quoted}` : `${SELECTION_HEADER}\n${quoted}`;
}

export function canSubmit(text: string, busy: boolean, suspended: boolean): boolean {
  return !busy && !suspended && text.trim().length > 0;
}

export function panelTitle(conversation: { title: string } | undefined, fallback: string): string {
  const title = conversation?.title?.trim();
  return title ? title : fallback;
}
