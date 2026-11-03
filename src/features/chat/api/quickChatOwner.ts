import { Channel, invoke } from "@tauri-apps/api/core";
import { chatController as owner } from "./lifecycle";
import { loadChatProviderCatalog, type ChatProvider } from "../lib/chatProviderCatalog";
import { CommandLedger, selectedSnapshot, type CommandEnvelope, type QuickSnapshot } from "../lib/panelController";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import { useQuickChatSettings } from "../../../shared/preferences/quickChatSettings";

import type { ChatHistorySource } from "./historySource";

let starting: Promise<void> | undefined;
let stopCurrentOwner: (() => void) | undefined;

export function stopQuickChatOwner(): void {
  stopCurrentOwner?.();
}

/** Main WebView only. Channel endpoints are installed through identity-validated native commands. */
export function startQuickChatOwner(continueInMain: (source: ChatHistorySource) => void | Promise<void>): Promise<void> {
  return starting ??= (async () => {
    let version = 0;
    let initialized = false;
    const epoch = crypto.randomUUID();
    let catalog: ChatProvider[] = [];
    const ledger = new CommandLedger();
    let scheduled = false;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let recovering = false;
    let creating: Promise<void> | undefined;
    let quickSelected: string | null = null;
    // Selection-changing intents complete in arrival order, not IPC/get completion order.
    let navigationTail: Promise<void> = Promise.resolve();
    const navigate = (action: () => Promise<void>) => {
      const next = navigationTail.catch(() => {}).then(action);
      navigationTail = next;
      return next;
    };
    const createQuick = () => creating ??= (async () => {
      if (quickSelected && owner.getSnapshot().details[quickSelected]) await owner.flushDraft(quickSelected);
      const id = await owner.createUnselected("quick-chat");
      if (!owner.getSnapshot().details[id]) throw "chat_conflict";
      quickSelected = id;
    })().finally(() => { creating = undefined; });
    const ensureQuick = async () => {
      if (quickSelected && !owner.getSnapshot().details[quickSelected]) quickSelected = null;
      if (!quickSelected) await createQuick();
    };
    const publish = () => {
      scheduled = false;
      publishTimer = undefined;
      const settings = useSettingsStore.getState();
      const payload: QuickSnapshot = { epoch, version: ++version, state: { ...selectedSnapshot(owner.getSnapshot(), quickSelected, true), ready: initialized && owner.getSnapshot().ready }, catalog,
        language: settings.language, theme: settings.resolvedTheme,
        lightPalette: settings.lightThemePalette, darkPalette: settings.darkThemePalette };
      void invoke("quick_chat_publish", { kind: "snapshot", payload }).catch(() => {});
    };
    const schedule = () => {
      if (initialized && quickSelected && !owner.getSnapshot().details[quickSelected]) {
        quickSelected = null;
        if (publishTimer) { clearTimeout(publishTimer); publishTimer = undefined; }
        scheduled = false;
        if (!recovering) {
          recovering = true;
          // Do not publish an initialized ready snapshot until replacement exists.
          // Repeated subscriptions coalesce; publish reads latest settings/catalog.
          void navigate(ensureQuick).then(() => {
            owner.clearError();
            recovering = false;
            publish();
          }).catch(error => {
            owner.report(error);
            recovering = false;
            publish();
          });
        }
        return;
      }
      if (!scheduled && !recovering) { scheduled = true; publishTimer = setTimeout(publish, 32); }
    };
    const channel = new Channel<CommandEnvelope>();
    channel.onmessage = envelope => {
      void ledger.run(envelope, () => {
        const command = envelope.command;
        const execute = async () => {
          if (owner.getSnapshot().suspended) throw "chat_shutting_down";
          if (command.op === "hello") {
            await owner.start();
            if (!owner.getSnapshot().ready) throw "chat_quick_not_ready";
            catalog = (await loadChatProviderCatalog()).map(p => ({
              id: p.id, name: p.name, baseUrl: "", protocol: p.protocol, enabled: p.enabled, isDefault: p.isDefault,
              models: p.models.map(m => ({ modelId: m.modelId, enabled: m.enabled, isDefault: m.isDefault })),
            }));
            if (!owner.getSnapshot().ready) throw "chat_quick_not_ready";
            await ensureQuick();
            if (owner.getSnapshot().error) owner.clearError();
            initialized = true;
            publish(); return;
          }
          if (envelope.epoch !== epoch) throw "chat_quick_not_ready";
          if (!owner.getSnapshot().ready) throw "chat_quick_not_ready";
          if (command.op === "create") {
            await createQuick(); return;
          }
          if (command.op === "continue") {
            await ensureQuick();
            const target = quickSelected!;
            await owner.loadDetail(target);
            await owner.select(target, { strict: true });
            if (owner.getSnapshot().selected !== target || !owner.getSnapshot().details[target]) throw "chat_conflict";
            await continueInMain("quick-chat"); return;
          }
          if (command.op === "select") {
            const previous = quickSelected;
            const detail = await owner.loadDetail(command.conversationId);
            if (detail.conversation.origin !== "quick-chat") throw "chat_conflict";
            if (previous && previous !== command.conversationId) await owner.flushDraft(previous);
            if (!owner.getSnapshot().details[command.conversationId]) throw "chat_conflict";
            quickSelected = command.conversationId; return;
          }
          if (!("conversationId" in command)) throw "chat_invalid_input";
          if (quickSelected !== command.conversationId || !owner.getSnapshot().details[command.conversationId]) throw "chat_conflict";
          switch (command.op) {
            case "draft": owner.setDraft(command.conversationId, command.text); break;
            case "update":
              if (!catalog.some(p => p.enabled && p.id === command.providerId && p.models.some(m => m.enabled && m.modelId === command.model))) throw "chat_invalid_input";
              await owner.update(command.conversationId, { appType: "chat", providerId: command.providerId, model: command.model }); break;
            case "generate": await owner.generate(command.conversationId, command.retry, command.reasoning, command.images); break;
            case "stop": await owner.stop(command.conversationId); break;
          }
        };
        return ["hello", "create", "select", "continue"].includes(command.op) ? navigate(execute) : execute();
      }).then(async ack => {
        publish();
        await invoke("quick_chat_publish", { kind: "ack", payload: ack });
      }).catch(() => {});
    };
    const unsubOwner = owner.subscribe(schedule);
    const unsubSettings = useSettingsStore.subscribe(schedule);
    stopCurrentOwner = () => {
      if (publishTimer) { clearTimeout(publishTimer); publishTimer = undefined; }
      scheduled = false;
      unsubOwner();
      unsubSettings();
      publish();
      starting = undefined;
    };
    await invoke("quick_chat_connect_main", { channel });
    await useQuickChatSettings.getState().load();
  })();
}
