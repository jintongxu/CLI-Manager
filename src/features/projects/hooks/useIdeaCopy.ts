import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, WorktreeRecord } from "../../../shared/types";
import type { ProjectIdea } from "../api/projectIdeaStore";
import { formatProjectIdea, type ProjectIdeaCopyFormat } from "../lib/projectIdeaFormatter";

export type IdeaCopyState = "idle" | "success" | "failure";

const COPY_STATE_RESET_MS = 1800;

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard_copy_failed");
}

export type IdeaCopyResult = { ok: true } | { ok: false; error: unknown };

interface UseIdeaCopyOptions {
  project?: Project | null;
  worktree?: WorktreeRecord | null;
}

/** 复制想法正文；成功后状态自动复位，避免按钮长期停在“已复制”。 */
export function useIdeaCopy({ project, worktree }: UseIdeaCopyOptions = {}) {
  const [copyFormat, setCopyFormat] = useState<ProjectIdeaCopyFormat>("plain");
  const [copyState, setCopyState] = useState<IdeaCopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current === null) return;
    window.clearTimeout(resetTimer.current);
    resetTimer.current = null;
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const copy = useCallback(
    async (idea: ProjectIdea): Promise<IdeaCopyResult> => {
      clearResetTimer();
      let result: IdeaCopyResult;
      try {
        await writeClipboardText(
          formatProjectIdea(idea, copyFormat, project ?? undefined, worktree ?? undefined),
        );
        setCopyState("success");
        result = { ok: true };
      } catch (error) {
        setCopyState("failure");
        result = { ok: false, error };
      }
      resetTimer.current = window.setTimeout(() => {
        setCopyState("idle");
        resetTimer.current = null;
      }, COPY_STATE_RESET_MS);
      return result;
    },
    [clearResetTimer, copyFormat, project, worktree],
  );

  return { copyFormat, setCopyFormat, copyState, copy };
}
