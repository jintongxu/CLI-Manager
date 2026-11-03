import { useEffect, useState, useSyncExternalStore } from "react";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { defaultCatalogModel, loadChatProviderCatalog, type ChatProvider } from "../api/chatProviderCatalog";
import type { ChatController } from "../lib/chatController";

type Controller = Pick<ChatController, "subscribe" | "getSnapshot" | "bindDefaultModel" | "report">;

/** Refresh per stable selection (including newly created chats), not just per mount.
 * A failed read is never an empty catalog; native compatibility is only offered after success.
 */
export function useConversationDefaultModel(controller: Controller) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const preference = useSettingsStore(s => s.chatDefaultModel);
  const loaded = useSettingsStore(s => s.loaded);
  const id = state.selected;
  const model = id ? state.details[id]?.conversation.model : undefined;
  const origin = id ? state.details[id]?.conversation.origin : undefined;
  const [catalog, setCatalog] = useState<readonly ChatProvider[]>([]);
  const [ready, setReady] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setReady(false);
    void loadChatProviderCatalog().then(providers => {
      if (!active) return;
      setCatalog(providers);
      setReady(true);
      if (!loaded || !id || model || origin === "quick-chat") return;
      const current = controller.getSnapshot();
      const conversation = current.details[id]?.conversation;
      if (current.selected !== id || !conversation || conversation.model || conversation.origin === "quick-chat") return;
      const latestPreference = useSettingsStore.getState().chatDefaultModel;
      // The persisted creation origin owns fallback, not whichever mounted view
      // finishes its catalog request first. Both views may display the same chat.
      const policy = conversation.origin === "sidebar" ? "sidebar" : "workspace";
      const chosen = defaultCatalogModel(providers, latestPreference, policy);
      if (chosen) void controller.bindDefaultModel(id, chosen,
        () => active && useSettingsStore.getState().chatDefaultModel === latestPreference,
      ).catch(error => controller.report(error));
    }).catch(error => { if (active) controller.report(error); });
    return () => { active = false; };
  }, [controller, id, model, origin, preference, loaded, refresh]);

  return { catalog, ready, reloadCatalog: () => setRefresh(value => value + 1) };
}
