import type { AppearanceOwner, AppearanceValues } from "../../../shared/preferences/appearanceTransaction";

export type PreviewFailure = "save" | "compensation" | "start";
export interface PreviewTransaction {
  begin(): Promise<AppearanceOwner>;
  preview(owner: AppearanceOwner, patch: Partial<AppearanceValues>): boolean;
  confirm(owner: AppearanceOwner): Promise<void>;
  cancel(owner: AppearanceOwner): Promise<void>;
}
export const PREVIEW_SCHEMES = {
  storm: { theme: "dark", darkThemePalette: "tokyo-night-storm", terminalThemeMode: "independent", terminalThemeName: "tokyoNightStormOfficial" },
  seaSalt: { theme: "light", lightThemePalette: "sea-salt", terminalThemeMode: "independent", terminalThemeName: "tokyoNightStorm" },
} as const satisfies Record<string, Partial<AppearanceValues>>;

/** Instance-local capability and generation guard. Never persist provisional values. */
export function createAppearancePreviewSession(tx: PreviewTransaction, report: (failure: PreviewFailure) => void) {
  let enabled = false;
  let generation = 0;
  let owner: AppearanceOwner | undefined;
  let acquisition: Promise<unknown> = Promise.resolve();
  let snapshot: { phase: "idle" | "starting" | "previewing" | "confirming"; error: PreviewFailure | null } = { phase: "idle", error: null };
  const listeners = new Set<() => void>();
  const reported = new Set<unknown>();
  const publish = (phase: typeof snapshot.phase, error: PreviewFailure | null = null) => {
    snapshot = { phase, error };
    listeners.forEach(listener => listener());
  };
  const fail = (error: unknown, fallback: PreviewFailure) => {
    const failure = error && typeof error === "object" && "compensationErrors" in error
      && Array.isArray(error.compensationErrors) && error.compensationErrors.length ? "compensation" : fallback;
    if (!reported.has(error)) { reported.add(error); report(failure); }
    return failure;
  };
  const cancel = async () => {
    ++generation;
    const current = owner;
    owner = undefined;
    publish("idle");
    if (current) {
      try { await tx.cancel(current); }
      catch (error) { const failure = fail(error, "save"); if (enabled) publish("idle", failure); }
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled(value: boolean) { enabled = value; if (!value) void cancel(); },
    cancel,
    async preview(scheme: keyof typeof PREVIEW_SCHEMES) {
      if (!enabled || snapshot.phase === "starting" || snapshot.phase === "confirming") return;
      const token = generation;
      publish("starting");
      try {
        const acquire = async () => {
          const current = await tx.begin();
          if (!enabled || token !== generation) { await tx.cancel(current); return undefined; }
          return current;
        };
        const pending = owner ? Promise.resolve(owner) : acquisition.then(acquire);
        acquisition = pending.catch(() => {});
        const current = await pending;
        if (!current) return;
        if (!enabled || token !== generation) { await tx.cancel(current); return; }
        owner = current;
        if (!tx.preview(current, PREVIEW_SCHEMES[scheme])) {
          owner = undefined;
          throw new Error("Preview ownership expired");
        }
        publish("previewing");
      } catch (error) {
        if (enabled && token === generation) publish("idle", fail(error, "start"));
      }
    },
    async confirm() {
      if (!enabled || !owner || snapshot.phase !== "previewing") return;
      const current = owner;
      const token = generation;
      publish("confirming");
      try {
        await tx.confirm(current);
        if (token === generation) { owner = undefined; publish("idle"); }
      } catch (error) {
        const failure = fail(error, "save");
        if (token === generation) { owner = undefined; publish("idle", failure); }
      }
    },
  };
}
