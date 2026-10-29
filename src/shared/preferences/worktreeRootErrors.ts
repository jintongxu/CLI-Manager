export function worktreeRootErrorKey(error: unknown) {
  const message = String(error);
  if (message.includes("worktree_default_root_inside_repository")) return "worktree.settings.rootInsideRepository" as const;
  if (message.includes("worktree_default_root_invalid")) return "worktree.settings.rootInvalid" as const;
  if (message.includes("worktree_default_root_read_failed")) return "worktree.settings.rootReadFailed" as const;
  if (/worktree_default_root_home|home_dir_unavailable|home_directory_unavailable/.test(message)) return "worktree.settings.rootHomeUnavailable" as const;
  return null;
}
