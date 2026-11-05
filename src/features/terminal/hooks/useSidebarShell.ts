import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "../../../shared/i18n/index";
import { resolveSidebarShellContext, type SidebarShellContextInput } from "../lib/sidebarShellContext";
import { useSidebarShellStore } from "../store/sidebarShellStore";

/** Resolution never launches. Only an explicit selection/open gesture may create a shell. */
export function useSidebarShell(input: SidebarShellContextInput) {
  const { t } = useI18n();
  const [shellOpen, setShellOpen] = useState(false);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const resolved = useMemo(() => {
    try { return { context: resolveSidebarShellContext(input), error: false }; }
    catch { return { context: null, error: true }; }
  }, [input.activeSession, input.sessions, input.projects, input.worktrees, input.groups, input.scope]);
  const open = useCallback(() => {
    if (!resolved.context) return;
    void useSidebarShellStore.getState().open(resolved.context).catch(() => {
      toast.error(t("terminal.shell.createFailed"));
    });
  }, [resolved.context, t]);
  // Revealing the bottom panel is a launch gesture only for a never-opened context. Exited
  // or failed owners remain visible with explicit reopen/retry actions instead.
  const select = useCallback(() => {
    if (resolved.context && !useSidebarShellStore.getState().owners[resolved.context.key]) open();
  }, [resolved.context, open]);
  const toggle = useCallback(() => {
    if (!shellOpen) select();
    setShellOpen(!shellOpen);
  }, [shellOpen, select]);
  const collapse = useCallback(() => setShellOpen(false), []);
  return { ...resolved, target, setTarget, open, select, shellOpen, toggle, collapse };
}
