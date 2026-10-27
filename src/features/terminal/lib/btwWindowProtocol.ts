import type { BtwThread, BtwThreadModel } from "./btwThreadModel";
import type { LightThemePalette, DarkThemePalette } from "../../../shared/preferences/settingsStore";
import type { AppLanguage } from "../../../shared/i18n/index";

export const BTW_SNAPSHOT_EVENT = "btw-window-snapshot";
export interface BtwWindowSnapshot {
  ownerEpoch: string;
  revision: number;
  selectionRevision: number;
  thread: BtwThread | null;
  language: AppLanguage;
  dark: boolean;
  lightThemePalette: LightThemePalette;
  darkThemePalette: DarkThemePalette;
}
export type BtwWindowAction = "draft" | "send" | "retry" | "stop" | "reset" | "close";
export interface BtwWindowIntent {
  commandSession: number;
  commandSequence: number;
  ownerEpoch: string;
  revision: number;
  selectionRevision: number;
  threadId: string;
  generation: number;
  action: BtwWindowAction;
  draft?: string;
  inherit?: boolean;
}

/** Only backend-verified child IPC reaches this owner; no inference exists in the reader. */
export class BtwWindowOwner {
  private revision = 0;
  private selectionRevision = 0;
  private selected: string | null = null;
  private commandSession = 0;
  private commandSequence = 0;
  private active = true;
  constructor(readonly ownerEpoch: string, private model: BtwThreadModel) {}
  snapshot(language: AppLanguage, dark: boolean, lightThemePalette: LightThemePalette, darkThemePalette: DarkThemePalette): BtwWindowSnapshot {
    const state = this.model.getSnapshot();
    const thread = state.entries.find((entry) => entry.id === state.openId) ?? null;
    if (this.selected !== (thread?.id ?? null)) {
      this.selected = thread?.id ?? null;
      this.selectionRevision = this.revision + 1;
    }
    return { ownerEpoch: this.ownerEpoch, revision: ++this.revision, selectionRevision: this.selectionRevision,
      thread, language, dark, lightThemePalette, darkThemePalette };
  }
  // Native ready assigns increasing sessions; each reader sends increasing sequences.
  // Two high-water marks bound memory without ever forgetting a replay fence.
  accept(intent: BtwWindowIntent): boolean {
    const thread = this.model.getSnapshot().entries.find((entry) => entry.id === this.selected);
    if (!this.active || !thread || intent.generation !== thread.generation || intent.ownerEpoch !== this.ownerEpoch || intent.threadId !== thread.id
      || intent.selectionRevision !== this.selectionRevision || !Number.isSafeInteger(intent.revision)
      || intent.revision < this.selectionRevision || intent.revision > this.revision
      || !Number.isSafeInteger(intent.commandSession) || intent.commandSession <= 0
      || !Number.isSafeInteger(intent.commandSequence) || intent.commandSequence <= 0
      || intent.commandSession < this.commandSession
      || (intent.commandSession === this.commandSession && intent.commandSequence <= this.commandSequence)) return false;
    if (!["draft", "send", "retry", "stop", "reset", "close"].includes(intent.action)) return false;
    if ((intent.action === "draft" || intent.action === "send")
      && (typeof intent.draft !== "string" || intent.draft.length > 100_000)) return false;
    if (intent.action === "reset" && typeof intent.inherit !== "boolean") return false;
    this.commandSession = intent.commandSession;
    this.commandSequence = intent.commandSequence;
    switch (intent.action) {
      case "draft": this.model.setDraft(thread.id, intent.draft!); break;
      // Atomic draft+send avoids IPC/React acknowledgement races on the last keystroke.
      case "send":
        if (thread.status === "pending" || thread.status === "failed" || thread.status === "stopped") return false;
        this.model.setDraft(thread.id, intent.draft!); this.model.send(thread.id); break;
      case "retry": this.model.send(thread.id, true); break;
      case "stop": this.model.stop(thread.id); break;
      case "reset": this.model.reset(thread.id, intent.inherit); break;
      case "close": this.model.open(null); break;
    }
    return true;
  }
  dispose() { this.active = false; }
}

export interface BtwWindowReady {
  snapshot: BtwWindowSnapshot | null;
  commandSession: number;
}

const LIGHT_PALETTES: readonly LightThemePalette[] = ["clear-focus", "warm-paper", "cream-green", "ink-red", "emerald-mist",
  "saas-analytics-dashboard", "apple-pure", "apple-mist", "apple-warm", "apple-mono"];
const DARK_PALETTES: readonly DarkThemePalette[] = ["midnight-aurora", "terminal-acrylic", "night-indigo", "forest-night",
  "graphite-red", "investment-platform", "github-dark", "catppuccin-mocha", "terminal-green", "dracula-purple", "carbon-black"];

/** Session identity comes from the IPC response, not from a potentially late old event. */
export function newerBtwSnapshot(current: BtwWindowSnapshot | null, incoming: BtwWindowSnapshot, epoch: string) {
  if (incoming.ownerEpoch !== epoch || !Number.isSafeInteger(incoming.revision)
    || typeof incoming.dark !== "boolean" || !LIGHT_PALETTES.includes(incoming.lightThemePalette)
    || !DARK_PALETTES.includes(incoming.darkThemePalette)
    || (current?.ownerEpoch === epoch && incoming.revision <= current.revision)) return current;
  return incoming;
}
