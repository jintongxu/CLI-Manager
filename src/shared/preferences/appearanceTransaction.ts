import type { Settings } from "./settingsStore";

export const APPEARANCE_KEYS = [
  "theme", "lightThemePalette", "darkThemePalette", "terminalThemeMode", "terminalThemeName",
] as const;
export type AppearanceKey = typeof APPEARANCE_KEYS[number];
export type AppearanceValues = Pick<Settings, AppearanceKey>;
declare const ownerBrand: unique symbol;
/** Opaque capability: keep local to the dialog instance; never put it in settings. */
export type AppearanceOwner = { readonly [ownerBrand]: true };
export type AppearancePhase = "idle" | "previewing" | "confirming" | "error";
export interface AppearanceStatus {
  readonly phase: AppearancePhase;
  readonly revision: number;
  readonly dirtyKeys: readonly AppearanceKey[];
  readonly unresolvedKeys: readonly AppearanceKey[];
  readonly error: unknown;
}
export class AppearanceCommitError extends Error {
  constructor(readonly writeError: unknown, readonly compensationErrors: readonly unknown[]) {
    super(compensationErrors.length ? "Appearance save and compensation failed" : "Appearance save failed");
    this.name = "AppearanceCommitError";
  }
}
interface Adapter {
  read(): AppearanceValues;
  /** Applies only these five keys and freshly derives resolvedTheme, in one state update. */
  apply(values: AppearanceValues): void;
  persist(key: AppearanceKey, value: AppearanceValues[AppearanceKey]): Promise<void>;
  ready(): boolean;
}
function pick(values: AppearanceValues): AppearanceValues {
  return Object.fromEntries(APPEARANCE_KEYS.map(key => [key, values[key]])) as AppearanceValues;
}
export function isAppearanceKey(key: PropertyKey): key is AppearanceKey {
  return (APPEARANCE_KEYS as readonly PropertyKey[]).includes(key);
}

/** One serialization boundary for preview commits AND every legacy appearance setter.
 * begin is async: it waits for already queued setters before taking its baseline.
 * An external setter invalidates an open preview before saving; it never inherits
 * provisional values. cancel during confirm waits for its outcome, never rolls back
 * a successful commit. Stale owners cannot mutate a newer session.
 */
export function createAppearanceTransaction(adapter: Adapter) {
  let tail: Promise<unknown> = Promise.resolve();
  let revision = 0;
  let session: {
    owner: AppearanceOwner;
    baseline: AppearanceValues;
    draft: AppearanceValues;
    confirmation?: Promise<void>;
  } | undefined;
  // A rejected write/rollback may have mutated persistence. Memory alone cannot
  // prove these keys converged; every later save must reconcile them explicitly.
  const unresolved = new Set<AppearanceKey>();
  let status: AppearanceStatus = { phase: "idle", revision, dirtyKeys: [], unresolvedKeys: [], error: null };
  const listeners = new Set<() => void>();
  function publish(phase: AppearancePhase, error: unknown = null) {
    status = Object.freeze({
      phase: phase === "idle" && unresolved.size ? "error" : phase,
      revision: ++revision, error: error ?? (unresolved.size ? status.error : null),
      unresolvedKeys: Object.freeze(APPEARANCE_KEYS.filter(k => unresolved.has(k))),
      dirtyKeys: Object.freeze(session ? APPEARANCE_KEYS.filter(k => session!.draft[k] !== session!.baseline[k]) : []),
    });
    // Subscriber failures must never turn a completed persistence operation into rollback.
    for (const listener of listeners) {
      try { listener(); } catch (error) { console.error("Appearance subscriber failed", error); }
    }
  }
  function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  function owns(owner: AppearanceOwner) { return session?.owner === owner; }
  function restore() {
    if (!session) return;
    adapter.apply(session.baseline);
    session = undefined;
    publish("idle");
  }
  async function save(baseline: AppearanceValues, next: AppearanceValues) {
    const dirty = APPEARANCE_KEYS.filter(k => next[k] !== baseline[k] || unresolved.has(k));
    const attempted: AppearanceKey[] = [];
    try {
      for (const key of dirty) {
        // Include the failing key: a backend can reject after mutating its cache.
        attempted.push(key);
        await adapter.persist(key, next[key]);
      }
    } catch (writeError) {
      const compensationErrors: unknown[] = [];
      for (const key of attempted.reverse()) {
        try {
          await adapter.persist(key, baseline[key]);
          unresolved.delete(key);
        } catch (error) {
          unresolved.add(key);
          compensationErrors.push({ key, error });
        }
      }
      throw new AppearanceCommitError(writeError, compensationErrors);
    }
    for (const key of dirty) unresolved.delete(key);
  }
  return {
    /** Detached committed subset for backup/export; never exposes a live draft.
     * Confirmation remains provisional until every write has succeeded. */
    getCommittedValues: (): AppearanceValues => pick(session ? session.baseline : adapter.read()),
    getStatus: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(): Promise<AppearanceOwner> {
      return enqueue(() => {
        if (!adapter.ready()) throw new Error("Settings must finish loading before preview");
        if (session) throw new Error("Appearance preview already owned");
        const owner = Object.freeze({}) as AppearanceOwner;
        const baseline = pick(adapter.read());
        session = { owner, baseline, draft: { ...baseline } };
        publish("previewing");
        return owner;
      });
    },
    preview(owner: AppearanceOwner, patch: Partial<AppearanceValues>): boolean {
      if (!owns(owner) || session!.confirmation) return false;
      // Runtime whitelist: even an untyped caller cannot modify language/font/background.
      const next = { ...session!.draft };
      for (const key of APPEARANCE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
          Object.assign(next, { [key]: patch[key] });
        }
      }
      session!.draft = next;
      adapter.apply(next);
      publish("previewing");
      return true;
    },
    confirm(owner: AppearanceOwner): Promise<void> {
      if (!owns(owner)) return Promise.reject(new Error("Stale appearance owner"));
      if (session!.confirmation) return session!.confirmation;
      const current = session!;
      // Mark synchronously, before the first await, to lock preview and close paths.
      const result = enqueue(async () => {
        // A legacy write already queued before this confirm may have invalidated us.
        if (session !== current) throw new Error("Stale appearance owner");
        try {
          await save(current.baseline, current.draft);
          session = undefined;
          publish("idle");
        } catch (error) {
          adapter.apply(current.baseline);
          session = undefined;
          publish("error", error);
          throw error;
        }
      });
      current.confirmation = result;
      publish("confirming");
      return result;
    },
    cancel(owner: AppearanceOwner): Promise<void> {
      if (!owns(owner)) return Promise.resolve();
      if (session!.confirmation) return session!.confirmation;
      restore();
      return Promise.resolve();
    },
    /** Factory runs at queue execution time, against committed values, not a draft. */
    write(makePatch: (current: AppearanceValues) => Partial<AppearanceValues>): Promise<void> {
      if (session && !session.confirmation) restore();
      return enqueue(async () => {
        // A begin queued earlier can have opened a session since write was called.
        if (session) restore();
        const baseline = pick(adapter.read());
        const patch = makePatch(baseline);
        const next = { ...baseline };
        for (const key of APPEARANCE_KEYS) {
          if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] });
        }
        try {
          await save(baseline, next);
          adapter.apply(next);
          publish("idle");
        } catch (error) {
          publish("error", error);
          throw error;
        }
      });
    },
  };
}
