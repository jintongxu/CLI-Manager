import { useEffect } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentLanguage } from "../../../shared/i18n/index";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { BtwWindowOwner, type BtwWindowIntent } from "../lib/btwWindowProtocol";
import type { BtwThreadModel } from "../lib/btwThreadModel";

// Serialize owner registration across real unmount/remount while IPC is pending.
let registrations: Promise<unknown> = Promise.resolve();
function registerOwner(onIntent: Channel<BtwWindowIntent>) {
  const next = registrations.then(() => invoke<string>("btw_window_register", { onIntent }));
  registrations = next.catch(() => {});
  return next;
}

/** Main alone owns inference. StrictMode's probe never registers a competing native owner. */
export function useBtwNativeWindow(model: BtwThreadModel) {
  useEffect(() => {
    let disposed = false;
    let owner: BtwWindowOwner | undefined;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeSettings: (() => void) | undefined;
    queueMicrotask(() => {
      if (disposed) return;
      void (async () => {
        const onIntent = new Channel<BtwWindowIntent>();
        onIntent.onmessage = (payload) => { if (!disposed) owner?.accept(payload); };
        const epoch = await registerOwner(onIntent);
        if (disposed) { await invoke("btw_window_release", { ownerEpoch: epoch }); return; }
        owner = new BtwWindowOwner(epoch, model);
        let lastOpenVersion = -1;
        let publishing = false;
        let pending: { snapshot: ReturnType<BtwWindowOwner["snapshot"]>; reveal: boolean } | null = null;
        // One ordered invoke at a time; coalesce streaming updates but never lose a reveal.
        const flush = async () => {
          if (publishing) return;
          publishing = true;
          try {
            while (pending && !disposed) {
              const next = pending;
              pending = null;
              await invoke("btw_window_publish", next);
            }
          } catch (error) { console.warn("BTW snapshot failed", error); }
          finally { publishing = false; }
        };
        const publish = () => {
          if (disposed || !owner) return;
          const state = model.getSnapshot();
          const reveal = state.openVersion !== lastOpenVersion && !!state.openId;
          lastOpenVersion = state.openVersion;
          const settings = useSettingsStore.getState();
          const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
          const snapshot = owner.snapshot(getCurrentLanguage(), dark, settings.lightThemePalette, settings.darkThemePalette);
          pending = { snapshot, reveal: reveal || !!pending?.reveal };
          void flush();
        };
        unsubscribe = model.subscribe(publish);
        unsubscribeSettings = useSettingsStore.subscribe(publish);
        publish();
      })().catch((error) => console.warn("BTW native owner unavailable", error));
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      unsubscribeSettings?.();
      if (owner) {
        owner.dispose();
        void invoke("btw_window_release", { ownerEpoch: owner.ownerEpoch }).catch(() => {});
      }
    };
  }, [model]);
}
