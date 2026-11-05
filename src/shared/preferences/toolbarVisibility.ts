export interface TerminalToolbarVisibilitySettings {
  templates: boolean;
  fullscreen: boolean;
  sessionHistory: boolean;
  replay: boolean;
  files: boolean;
  shell: boolean;
  stats: boolean;
  gitChanges: boolean;
  systemResources: boolean;
  providers: boolean;
  btw: boolean;
  chat: boolean;
  backgroundTasks: boolean;
  showText: boolean;
}

export interface SidebarToolbarVisibilitySettings {
  stats: boolean;
  gitChanges: boolean;
}

export const DEFAULT_TERMINAL_TOOLBAR_VISIBILITY: TerminalToolbarVisibilitySettings = {
  templates: true,
  fullscreen: true,
  sessionHistory: true,
  replay: false,
  files: true,
  shell: true,
  stats: true,
  gitChanges: true,
  systemResources: false,
  providers: true,
  btw: true,
  chat: true,
  backgroundTasks: true,
  showText: false,
};

export const DEFAULT_SIDEBAR_TOOLBAR_VISIBILITY: SidebarToolbarVisibilitySettings = {
  stats: true,
  gitChanges: true,
};

export const DEFAULT_TERMINAL_TOOLBAR_ORDER = [
  "new", "templates", "fullscreen", "sessionHistory", "replay", "files",
  "gitChanges", "stats", "providers", "btw", "chat", "systemResources", "backgroundTasks",
];

export function migrateTerminalToolbarVisibility(value: unknown): TerminalToolbarVisibilitySettings {
  const defaults = DEFAULT_TERMINAL_TOOLBAR_VISIBILITY;
  if (typeof value !== "object" || value === null) {
    return { ...defaults };
  }
  const raw = value as Record<string, unknown>;

  return {
    templates: typeof raw.templates === "boolean" ? raw.templates : defaults.templates,
    fullscreen: typeof raw.fullscreen === "boolean" ? raw.fullscreen : defaults.fullscreen,
    sessionHistory: typeof raw.sessionHistory === "boolean" ? raw.sessionHistory : defaults.sessionHistory,
    replay: typeof raw.replay === "boolean" ? raw.replay : defaults.replay,
    files: typeof raw.files === "boolean" ? raw.files : defaults.files,
    shell: typeof raw.shell === "boolean" ? raw.shell : defaults.shell,
    stats: typeof raw.stats === "boolean" ? raw.stats : defaults.stats,
    gitChanges: typeof raw.gitChanges === "boolean" ? raw.gitChanges : defaults.gitChanges,
    systemResources: typeof raw.systemResources === "boolean" ? raw.systemResources : defaults.systemResources,
    providers: typeof raw.providers === "boolean" ? raw.providers : defaults.providers,
    btw: typeof raw.btw === "boolean" ? raw.btw : defaults.btw,
    chat: typeof raw.chat === "boolean" ? raw.chat : defaults.chat,
    backgroundTasks: typeof raw.backgroundTasks === "boolean" ? raw.backgroundTasks : defaults.backgroundTasks,
    showText: typeof raw.showText === "boolean" ? raw.showText : defaults.showText,
  };
}

export function migrateSidebarToolbarVisibility(value: unknown): SidebarToolbarVisibilitySettings {
  const defaults = DEFAULT_SIDEBAR_TOOLBAR_VISIBILITY;
  if (typeof value !== "object" || value === null) {
    return { ...defaults };
  }
  const raw = value as Record<string, unknown>;

  return {
    stats: typeof raw.stats === "boolean" ? raw.stats : defaults.stats,
    gitChanges: typeof raw.gitChanges === "boolean" ? raw.gitChanges : defaults.gitChanges,
  };
}

export function migrateTerminalToolbarOrder(value: unknown): string[] {
  const defaults = DEFAULT_TERMINAL_TOOLBAR_ORDER;
  if (!Array.isArray(value)) return [...defaults];

  const validKeys = new Set(defaults);
  const filtered = value.filter((k): k is string => typeof k === "string" && validKeys.has(k));
  const missing = defaults.filter((k) => !filtered.includes(k));
  return [...filtered, ...missing];
}

