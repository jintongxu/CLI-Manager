import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

export interface QuickChatSettings { enabled: boolean; shortcut: string }
export const QUICK_CHAT_DEFAULTS: QuickChatSettings = { enabled: true, shortcut: "Ctrl+Alt+Space" };
export function migrateQuickChatSettings(value: unknown): QuickChatSettings {
  const raw = value as Partial<QuickChatSettings> | null;
  return { enabled: typeof raw?.enabled === "boolean" ? raw.enabled : true,
    shortcut: typeof raw?.shortcut === "string" ? raw.shortcut.trim() : QUICK_CHAT_DEFAULTS.shortcut };
}
let store: Promise<Store> | undefined;
const storage = () => store ??= Store.load("quick-chat.json", { autoSave: true, defaults: {} });
let loading: Promise<void> | undefined;
let queue = Promise.resolve();
export const useQuickChatSettings = create<QuickChatSettings & {
  error: boolean; load: () => Promise<void>; save: (value: QuickChatSettings) => Promise<void>;
}>((set) => {
  const apply = async (value: QuickChatSettings) => {
    set({ ...value, error: false });
    try { await invoke("quick_chat_configure", value as unknown as Record<string, unknown>); }
    catch { set({ error: true }); }
  };
  return { ...QUICK_CHAT_DEFAULTS, error: false,
    load: () => loading ??= (async () => {
      try { await apply(migrateQuickChatSettings(await (await storage()).get("settings"))); }
      catch { set({ error: true }); }
    })(),
    save: value => {
      queue = queue.catch(() => {}).then(async () => {
        const normalized = migrateQuickChatSettings(value);
        try { const s = await storage(); await s.set("settings", normalized); await s.save(); await apply(normalized); }
        catch { set({ error: true }); }
      });
      return queue;
    },
  };
});
