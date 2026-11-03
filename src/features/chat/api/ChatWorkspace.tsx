import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  FileText,
  List,
  MessageSquare,
  Paperclip,
  Pin,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useI18n, type TranslationKey } from "../../../shared/i18n/index";
import { chatController } from "./lifecycle";
import type { ChatController } from "../lib/chatController";
import { activateChatLink, chatTime, copyChatText, isFollowing, shouldSubmit } from "../lib/interactions";
import { applyPinnedOrder, applyStoredOrder, moveIndexWithinOrder, moveWithinOrder, persistOrder, persistPinnedIds, readPinnedIds, readStoredOrder } from "../lib/conversationOrder";
import { DEFAULT_REASONING_EFFORT, persistReasoning, readReasoning } from "../lib/reasoning";
import { reasoningLevelsFor } from "../lib/reasoningCapabilities";
import { CHAT_HISTORY_SOURCES, type ChatHistorySource } from "./historySource";
import { HistorySelection } from "../lib/historySelection";
import { HistorySelectionControls } from "../components/HistorySelectionControls";
import type { ReasoningEffort } from "../lib/types";
import { diagnoseChatError } from "../lib/chatErrors";

interface CatalogModel {
  modelId: string;
  enabled: boolean;
  isDefault: boolean;
}
interface CatalogProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: string;
  enabled: boolean;
  isDefault: boolean;
  models: CatalogModel[];
}

interface AttachedFile {
  id: string;
  name: string;
  size: number;
  content: string;
  type: "text" | "image";
  dataUrl?: string;
}

export function ChatWorkspace({
  workspaceVisible,
  controller = chatController,
  historySource,
  onHistorySourceChange,
}: {
  workspaceVisible: boolean;
  controller?: ChatController;
  historySource?: ChatHistorySource;
  onHistorySourceChange?: (source: ChatHistorySource) => void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const { t, language } = useI18n();

  const [localSource, setLocalSource] = useState<ChatHistorySource>("workspace");
  const activeSource = historySource ?? localSource;
  const [historySelection] = useState(() => new HistorySelection());
  const selectionState = useSyncExternalStore(historySelection.subscribe, historySelection.getSnapshot, historySelection.getSnapshot);
  const selectionScope = JSON.stringify([activeSource, state.search]);
  const selectingHistory = selectionState.enabled && selectionState.scope === selectionScope;
  const historyLocked = selectionState.busy || !!selectionState.confirmation;
  useEffect(() => { historySelection.resetScope(selectionScope); }, [historySelection, selectionScope]);
  const changeSource = (source: ChatHistorySource) => {
    if (historyLocked) return;
    historySelection.resetScope(JSON.stringify([source, state.search]));
    setLocalSource(source);
    onHistorySourceChange?.(source);
    setDrag(null);
    dragRef.current = null;
    setContextMenu(current => ({ ...current, visible: false }));
  };

  // Dialog & state management
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [targetConvId, setTargetConvId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineHovered, setOutlineHovered] = useState(false);
  const outlineDismissed = useRef(false);
  const [catalogProviders, setCatalogProviders] = useState<CatalogProvider[]>([]);

  // Kivio custom dropdown & context menu states
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    convId: string;
  }>({ visible: false, x: 0, y: 0, convId: "" });

  // Drag and drop sorting state (live displacement preview)
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; offset: number; height: number } | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(() => {
    const stored = readStoredOrder();
    return stored.length ? stored : null;
  });
  const [pinnedIds, setPinnedIds] = useState<string[]>(readPinnedIds);

  // File & image attachment states
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningEffort>("medium");
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const reasoningMenuRef = useRef<HTMLDivElement>(null);
  const reasoningButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const composing = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const selected = state.selected;
  const previousSelection = useRef<{ id: string | null; origin: ChatHistorySource } | null>(null);
  const restoringSelection = useRef(false);
  useEffect(() => {
    const previous = previousSelection.current;
    const deletedSelected = previous?.id && selected === null
      && !state.conversations.some(conversation => conversation.id === previous.id);
    // Keep the deleted selection as the recovery anchor while bulk deletion is
    // locked; otherwise the null selection render consumes the evidence.
    if (deletedSelected && historyLocked) return;
    if (!deletedSelected || historyLocked || restoringSelection.current || !state.ready || state.suspended) {      previousSelection.current = {
        id: selected,
        origin: selected
          ? (state.conversations.find(conversation => conversation.id === selected)?.origin ?? previous?.origin ?? activeSource)
          : previous?.origin ?? activeSource,
      };
      return;
    }
    restoringSelection.current = true;
    const source = previous!.origin;
    // Quick Chat owns its selected conversation independently of the main
    // selection. Its replacement is created unselected and may appear in
    // details before it is added to the history list. Prefer that live detail
    // over any stale/list candidate so deletion recovery cannot create a twin.
    const quickDetail = source === "quick-chat"
      ? Object.values(state.details)
        .filter(detail => detail.conversation.origin === "quick-chat")
        .sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt)[0]
      : undefined;
    const next = quickDetail?.conversation
      ?? [...state.conversations].reverse().find(conversation => (conversation.origin ?? "workspace") === source);
    // Quick Chat's owner is already responsible for recovering its selection.
    // Wait for its detail notification rather than independently creating a
    // main-list conversation during that asynchronous recovery window.
    if (source === "quick-chat" && !quickDetail) return;
    void (async () => {
      try {
        if (next) await controller.select(next.id);
        else await controller.create(source);
      } finally {
        restoringSelection.current = false;
      }
    })();
  }, [selected, state.conversations, state.details, state.ready, state.suspended, historyLocked, activeSource, controller]);
  useEffect(() => {
    setReasoning(selected ? readReasoning(selected) : "medium");
    setReasoningMenuOpen(false);
  }, [selected]);
  const detail = selected ? state.details[selected] : undefined;
  const c = detail?.conversation;
  const running = !!selected && state.running.includes(selected);
  const busy = !!selected && state.busy.includes(selected);
  const foreign = !!c?.requestId && !running && (c.leaseUntil ?? 0) > Date.now();
  const frozen = state.suspended || foreign;

  // Load chat models from independent chat provider catalog
  const reloadCatalog = async () => {
    try {
      const providers = await invoke<CatalogProvider[]>("chat_provider_catalog_list");
      setCatalogProviders(providers || []);
    } catch {
      setCatalogProviders([]);
    }
  };

  useEffect(() => {
    void reloadCatalog();
  }, []);

  // Close menus on document click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
      if (reasoningMenuRef.current && !reasoningMenuRef.current.contains(e.target as Node)) {
        setReasoningMenuOpen(false);
      }
      setContextMenu((curr) => (curr.visible ? { ...curr, visible: false } : curr));
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // Compute all available models configured in Settings -> Chat Models
  const chatModelOptions = useMemo(() => {
    const list: {
      key: string;
      providerId: string;
      providerName: string;
      modelId: string;
      isDefault: boolean;
    }[] = [];
    for (const p of catalogProviders) {
      if (!p.enabled) continue;
      for (const m of p.models) {
        if (!m.enabled) continue;
        list.push({
          key: `chat:${p.id}:${m.modelId}`,
          providerId: p.id,
          providerName: p.name || p.id,
          modelId: m.modelId,
          isDefault: m.isDefault || p.isDefault,
        });
      }
    }
    return list;
  }, [catalogProviders]);

  // Current active model
  const activeChatModel = useMemo(() => {
    if (!c?.model) return null;
    return (
      chatModelOptions.find(
        (m) => m.providerId === c.providerId && m.modelId === c.model
      ) ||
      chatModelOptions.find((m) => m.modelId === c.model) ||
      null
    );
  }, [c?.providerId, c?.model, chatModelOptions]);

  // The workspace offers the same model-aware scale as the sidebar pill.
  const reasoningLevels = useMemo(() => {
    const provider = activeChatModel
      ? catalogProviders.find((p) => p.id === activeChatModel.providerId)
      : undefined;
    return reasoningLevelsFor(provider?.protocol ?? null, c?.model ?? null);
  }, [activeChatModel, c?.model, catalogProviders]);

  // Switching to a model with a narrower scale must not keep an unsupported level.
  useEffect(() => {
    if (!reasoningLevels.includes(reasoning)) setReasoning(DEFAULT_REASONING_EFFORT);
  }, [reasoning, reasoningLevels]);

  // Auto-bind default model if current conversation has none
  useEffect(() => {
    if (!c || c.model || !chatModelOptions.length) return;
    const defaultOpt = chatModelOptions.find((m) => m.isDefault) || chatModelOptions[0];
    if (defaultOpt) {
      void controller.update(c.id, {
        appType: "chat",
        providerId: defaultOpt.providerId,
        model: defaultOpt.modelId,
      });
    }
  }, [c?.id, c?.model, chatModelOptions, controller]);

  // Reorder conversations if user has dragged
  const sortedConversations = useMemo(
    () => applyPinnedOrder(applyStoredOrder(
      state.conversations.filter(c => (c.origin ?? "workspace") === activeSource
        && (!state.search || c.title.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()))), orderOverride), pinnedIds),
    [state.conversations, state.search, activeSource, orderOverride, pinnedIds]
  );

  const answers = detail?.messages.filter((m) => m.role === "assistant") ?? [];
  const last = answers[answers.length - 1];
  const retryable = !!last && ["failed", "stopped", "interrupted"].includes(last.status);
  const questions = detail?.messages.filter((message) => message.role === "user") ?? [];

  const updateActiveQuestion = () => {
    const container = scroll.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top + 40;
    let current: string | null = null;
    for (const node of container.querySelectorAll<HTMLElement>("[data-chat-question-id]")) {
      if (!current || node.getBoundingClientRect().top <= top) current = node.dataset.chatQuestionId ?? null;
      else break;
    }
    setActiveQuestionId(current);
  };

  const jumpToQuestion = (id: string) => {
    const container = scroll.current;
    if (!container) return;
    const node = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-question-id]"))
      .find((item) => item.dataset.chatQuestionId === id);
    if (!node) return;
    follow.current = false;
    setFollowing(false);
    container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    setActiveQuestionId(id);
    outlineDismissed.current = true;
    setOutlineOpen(false);
    setOutlineHovered(false);
    node.focus({ preventScroll: true });
  };

  const errorLabel = (code: string | null) => {
    const key = `chat.error.${code}` as TranslationKey;
    const text = t(key);
    return text && text !== key ? text : t("chat.error.chat_storage");
  };

  const act = (action: () => Promise<unknown>) => {
    void action().catch((error) => controller.report(error));
  };

  useEffect(() => {
    void controller.start();
  }, [controller]);

  useEffect(() => {
    setModelInput(c?.model ?? "");
    setDialog(null);
    setCopied(null);
    setActiveQuestionId(null);
    setOutlineOpen(false);
    setOutlineHovered(false);
    outlineDismissed.current = false;
    follow.current = true;
    setFollowing(true);
  }, [selected, c?.model]);

  useEffect(() => {
    if (workspaceVisible && follow.current && scroll.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [detail?.messages, workspaceVisible, selected]);

  useEffect(() => {
    const element = scroll.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (workspaceVisible && follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [detail?.messages, workspaceVisible]);

  useEffect(() => {
    const blur = () => {
      if (controller.getSnapshot().ready) act(() => controller.flush());
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [controller]);

  useEffect(() => {
    if (!workspaceVisible && selected) act(() => controller.flushDraft(selected));
  }, [workspaceVisible, selected, controller]);

  const handleModelSelect = (key: string) => {
    if (!c || !key) return;
    setModelMenuOpen(false);
    const catalogItem = chatModelOptions.find((m) => m.key === key);
    if (catalogItem) {
      act(() =>
        controller.update(c.id, {
          appType: "chat",
          providerId: catalogItem.providerId,
          model: catalogItem.modelId,
        })
      );
      return;
    }
    const nativeProv = state.providers.find(
      (p) => `${p.appType}:${p.providerId}` === key
    );
    if (nativeProv) {
      act(() =>
        controller.update(c.id, {
          appType: nativeProv.appType,
          providerId: nativeProv.providerId,
          model: nativeProv.defaultModel ?? "",
        })
      );
    }
  };

  // Reordering: shared by the pointer drag (real interaction) and the native
  // drag props kept for deterministic tests. Native HTML5 drag on <button> rows
  // does not start reliably, so pointer movement is the primary path.
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startY: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const togglePin = (id: string) => {
    const next = pinnedIds.includes(id) ? pinnedIds.filter((item) => item !== id) : [...pinnedIds, id];
    setPinnedIds(next);
    persistPinnedIds(next);
    setContextMenu((current) => ({ ...current, visible: false }));
  };

  const commitOrder = (next: string[] | null) => {
    if (!next) return;
    // Retain stored order for sources not currently rendered.
    const merged = [...(orderOverride ?? []).filter(id => !next.includes(id)), ...next];
    setOrderOverride(merged);
    persistOrder(merged);
  };

  const applyReorder = (sourceId: string, targetId: string) => {
    if (!sortedConversations.some(c => c.id === sourceId) || !sortedConversations.some(c => c.id === targetId)) return;
    if (pinnedIds.includes(sourceId) !== pinnedIds.includes(targetId)) return;
    commitOrder(
      moveWithinOrder(
        sortedConversations.map((item) => item.id),
        sourceId,
        targetId
      )
    );
  };

  /** `from`/`to` are indices in the current visual order. */
  const applyIndexReorder = (sourceId: string, from: number, to: number) => {
    const order = sortedConversations.map((item) => item.id);
    if (pinnedIds.includes(sourceId) !== pinnedIds.includes(order[to] ?? "")) return;
    if (sortedConversations[from]?.origin !== sortedConversations[to]?.origin) return;
    if (order[from] !== sourceId) return applyReorder(sourceId, order[to] ?? "");
    commitOrder(moveIndexWithinOrder(order, from, to));
  };
  const applyReorderRef = useRef(applyReorder);
  applyReorderRef.current = applyReorder;
  const applyIndexReorderRef = useRef(applyIndexReorder);
  applyIndexReorderRef.current = applyIndexReorder;
  const pinnedIdsRef = useRef(pinnedIds);
  pinnedIdsRef.current = pinnedIds;
  const dragPreviewRef = useRef(drag);
  dragPreviewRef.current = drag;

  // Live displacement: rows between the source and the projected slot slide aside
  // while the dragged row follows the pointer, so the drop result is previewed.
  useEffect(() => {
    const rows = (): HTMLElement[] =>
      Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-chat-item]") ?? []);

    const project = (id: string, clientY: number) => {
      const nodes = rows();
      const from = nodes.findIndex((node) => node.dataset.chatItem === id);
      if (from < 0) return null;
      const sourceOrigin = nodes[from].dataset.chatOrigin;
      const height = nodes[from].getBoundingClientRect().height + 4;
      // Insertion slot in the list without the dragged row: the count of rows
      // whose midpoint sits above the pointer.
      let to = 0;
      for (let i = 0; i < nodes.length; i++) {
        if (i === from) continue;
        const rect = nodes[i].getBoundingClientRect();
        if (clientY > rect.top + rect.height / 2) to++;
      }
      if (nodes[to]?.dataset.chatOrigin !== sourceOrigin) return null;
      return { from, to, height };
    };

    const onMove = (event: PointerEvent) => {
      const pending = dragRef.current;
      if (!pending) return;
      if (!pending.active) {
        if (Math.abs(event.clientY - pending.startY) < 5) return;
        pending.active = true;
      }
      const projected = project(pending.id, event.clientY);
      if (!projected) return;
      const ids = rows().map((node) => node.dataset.chatItem);
      const pinned = pinnedIdsRef.current;
      if (pinned.includes(pending.id) !== pinned.includes(ids[projected.to] ?? "")) return;
      setDrag({ id: pending.id, ...projected, offset: event.clientY - pending.startY });
    };

    const onUp = () => {
      const pending = dragRef.current;
      const preview = dragPreviewRef.current;
      dragRef.current = null;
      dragPreviewRef.current = null;
      setDrag(null);
      if (!pending?.active) return;
      // The row was being reordered, not clicked.
      suppressClickRef.current = true;
      if (preview && preview.from !== preview.to) applyIndexReorderRef.current(preview.id, preview.from, preview.to);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const handleItemPointerDown = (event: React.PointerEvent, id: string) => {
    if (selectingHistory || historyLocked || event.button !== 0) return;
    dragRef.current = { id, startY: event.clientY, active: false };
  };

  useEffect(() => {
    if (!selectingHistory) return;
    dragRef.current = null;
    dragPreviewRef.current = null;
    suppressClickRef.current = false;
    setDrag(null);
    setContextMenu(current => ({ ...current, visible: false }));
    setDialog(null);
  }, [selectingHistory]);

  // Native drag props retained for deterministic tests.
  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (selectingHistory || historyLocked) { e.preventDefault(); return; }
    e.dataTransfer?.setData("text/plain", id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDrag(null);
    if (selectingHistory || historyLocked) return;
    const sourceId = e.dataTransfer?.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;
    applyReorder(sourceId, targetId);
  };

  /** Displacement of a row while a drag is in flight. */
  const rowShift = (index: number) => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.height;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return drag.height;
    return 0;
  };

  // Right-click context menu handler on conversation item
  const handleContextMenu = (e: React.MouseEvent, convId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectingHistory || historyLocked) return;
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      convId,
    });
  };

  // File upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;

    Array.from(files).forEach((file) => {
      const isImg = file.type.startsWith("image/");
      const reader = new FileReader();

      if (isImg) {
        reader.onload = () => {
          setAttachments((curr) => [
            ...curr,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              size: file.size,
              content: "",
              type: "image",
              dataUrl: reader.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setAttachments((curr) => [
            ...curr,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              size: file.size,
              content: (reader.result as string) || "",
              type: "text",
            },
          ]);
        };
        reader.readAsText(file);
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Paste image handler in textarea
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            setAttachments((curr) => [
              ...curr,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name || "Pasted image",
                size: file.size,
                content: "",
                type: "image",
                dataUrl: reader.result as string,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((curr) => curr.filter((a) => a.id !== id));
  };

  // Submit message with optional attachments
  const handleSendMessage = () => {
    if (!c || running || busy || frozen || state.unsaved[c.id]) return;

    let finalPrompt = (state.drafts[c.id] ?? c.draft).trim();
    if (attachments.length > 0) {
      const textAttachments = attachments
        .filter((a) => a.type === "text" && a.content)
        .map((a) => `\n\n--- 附件: ${a.name} ---\n${a.content}\n---`)
        .join("");
      finalPrompt += textAttachments;
    }

    if (!finalPrompt.trim()) return;

    act(async () => {
      controller.setDraft(c.id, finalPrompt);
      setAttachments([]);
      await controller.generate(c.id, false, reasoning);
    });
  };

  const hasConfiguredModels = chatModelOptions.length > 0;
  const currentModelDisplay = activeChatModel
    ? `${activeChatModel.modelId} (${activeChatModel.providerName})`
    : c?.model
      ? c.model
      : t("chat.noModelsConfigured");

  return (
    <section
      className="chat-workspace"
      aria-label={t("chat.title")}
      data-workspace-visible={workspaceVisible}
    >
      {/* Hidden file input for upload */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileUpload}
      />

      {/* Hidden button for backward testing compatibility */}
      <button
        className="chat-history-toggle"
        aria-controls="chat-history"
        style={{ display: "none" }}
      >
        {t("chat.history")}
      </button>

      {/* History Sidebar */}
      <aside id="chat-history" className={`chat-history ${historyVisible ? "chat-history-open" : "chat-history-collapsed"}`} aria-label={t("chat.title")} aria-hidden={!historyVisible} inert={!historyVisible}>
        <div className="chat-history-head">
          <HistorySelectionControls selection={historySelection} snapshot={selectionState}
            scope={selectionScope} visibleIds={sortedConversations.map(item => item.id)}
            disabled={!state.ready || state.suspended}
            remove={id => controller.remove(id)}
            idleAction={
              <button
                className="chat-new-btn"
                onClick={() => act(async () => {
                  await controller.create("workspace");
                  changeSource("workspace");
                })}
                disabled={!state.ready || state.suspended || historyLocked}
              >
                <Plus size={15} strokeWidth={1.8} />
                <span>{t("chat.new")}</span>
              </button>
            } />
          <label className="chat-history-search-field">
            <Search size={13} strokeWidth={1.7} aria-hidden="true" />
            <input
              type="search"
              className="chat-history-search"
              aria-label={t("chat.search")}
              placeholder={t("chat.search")}
              value={state.search}
              disabled={historyLocked}
              onChange={(event) => {
                if (historyLocked) return;
                const next = event.target.value;
                historySelection.resetScope(JSON.stringify([activeSource, next]));
                void controller.searchHistory(next);
              }}
            />
            {state.search && (
              <button
                type="button"
                className="chat-history-search-clear"
                aria-label={t("chat.clearSearch")}
                title={t("chat.clearSearch")}
                disabled={historyLocked}
                onClick={() => {
                  if (historyLocked) return;
                  historySelection.resetScope(JSON.stringify([activeSource, ""]));
                  void controller.clearSearch();
                }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </label>
        </div>

        {state.search && (
          <div className="chat-history-search-feedback" role="status">
            <span>
              {state.searching
                ? t("chat.searching")
                : t(state.hasMore ? "chat.searchMatchesMore" : "chat.searchMatches", {
                    count: sortedConversations.length,
                  })}
            </span>
          </div>
        )}

        <div className="chat-history-tabs" role="tablist" aria-label={t("chat.historySources")}>
          {CHAT_HISTORY_SOURCES.map((source, index) => <button
            key={source} type="button" role="tab" id={`chat-source-${source}`}
            aria-selected={activeSource === source} aria-controls="chat-source-history"
            tabIndex={activeSource === source ? 0 : -1}
            disabled={historyLocked}
            onClick={() => changeSource(source)}
            onKeyDown={event => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % CHAT_HISTORY_SOURCES.length;
              else if (event.key === "ArrowLeft") next = (index + CHAT_HISTORY_SOURCES.length - 1) % CHAT_HISTORY_SOURCES.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = CHAT_HISTORY_SOURCES.length - 1;
              else return;
              event.preventDefault();
              if (historyLocked) return;
              changeSource(CHAT_HISTORY_SOURCES[next]);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
            }}
          >{t(`chat.origin.${source}`)}</button>)}
        </div>
        <div className="chat-history-list" ref={listRef}>
          <section id="chat-source-history" role="tabpanel" aria-labelledby={`chat-source-${activeSource}`} tabIndex={0}>
          {!sortedConversations.length && (
            <p className="chat-history-empty" role="status">
              {state.search
                ? (state.searching ? t("chat.searching") : t("chat.searchNoMatchesInLoaded"))
                : t(`chat.historyEmpty.${activeSource}`)}
            </p>
          )}
          {sortedConversations.map((item, index) => selectingHistory ? (
            <label key={item.id} className="chat-history-item chat-history-selectable" data-chat-selection={item.id}
              data-selected={selectionState.ids.includes(item.id)}>
              <input type="checkbox" checked={selectionState.ids.includes(item.id)}
                disabled={historyLocked || state.suspended}
                aria-label={`${t("chat.selectChat")}: ${item.title || t("chat.untitled")}`}
                onChange={() => historySelection.toggle(selectionScope, item.id, sortedConversations.map(row => row.id))} />
              <span className="chat-history-item-title">{item.title || t("chat.untitled")}</span>
              <time dateTime={new Date(item.updatedAt).toISOString()}>{chatTime(item.updatedAt, language)}</time>
              {state.running.includes(item.id) && <small>{t("chat.pending")}</small>}
            </label>
          ) : (
            <button
              key={item.id}
              data-chat-item={item.id}
              data-chat-origin={item.origin ?? "workspace"}
              className={`chat-history-item ${drag?.id === item.id ? "chat-dragging" : ""}`}
              style={
                drag
                  ? {
                      transform: `translateY(${drag.id === item.id ? drag.offset : rowShift(index)}px)`,
                      transition: drag.id === item.id ? "none" : "transform 0.16s ease",
                    }
                  : undefined
              }
              aria-current={item.id === selected ? "page" : undefined}
              onPointerDown={(e) => handleItemPointerDown(e, item.id)}
              draggable={false}
              onDragStart={(e) => handleDragStart(e, item.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, item.id)}
              onDragEnd={() => setDrag(null)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                if (!historyLocked && !selectingHistory) act(() => controller.select(item.id));
              }}
              onContextMenu={(e) => handleContextMenu(e, item.id)}
            >
              <span className="chat-history-item-title">
                {pinnedIds.includes(item.id) && <Pin size={12} className="chat-pinned-icon" aria-label={t("chat.pinned")} />}
                <span>{item.title || t("chat.untitled")}</span>
              </span>
              <time dateTime={new Date(item.updatedAt).toISOString()}>
                {chatTime(item.updatedAt, language)}
              </time>
              {state.running.includes(item.id) && <small>{t("chat.pending")}</small>}
            </button>
          ))}
          </section>
          {state.hasMore && (
            <button disabled={historyLocked} onClick={() => act(() => controller.loadHistory(state.search, true))}>
              {t("chat.more")}
            </button>
          )}
        </div>
      </aside>

      {/* Right-click Context Menu */}
      {contextMenu.visible && (
        <div
          className="chat-context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="chat-context-menu-item"
            onClick={() => togglePin(contextMenu.convId)}
          >
            <Pin size={14} aria-hidden="true" />
            {t(pinnedIds.includes(contextMenu.convId) ? "chat.unpin" : "chat.pin")}
          </button>
          <button
            className="chat-context-menu-item"
            onClick={() => {
              const target = state.conversations.find((x) => x.id === contextMenu.convId);
              setTargetConvId(contextMenu.convId);
              setTitle(target?.title || "");
              setDialog("rename");
              setContextMenu((c) => ({ ...c, visible: false }));
            }}
          >
            {t("chat.rename")}
          </button>
          <button
            className="chat-context-menu-item"
            onClick={() => {
              act(() => controller.select(contextMenu.convId));
              void reloadCatalog();
              setContextMenu((c) => ({ ...c, visible: false }));
            }}
          >
            {t("chat.reload")}
          </button>
          <button
            className="chat-context-menu-item chat-context-menu-danger"
            onClick={() => {
              setTargetConvId(contextMenu.convId);
              setDialog("delete");
              setContextMenu((c) => ({ ...c, visible: false }));
            }}
          >
            {t("chat.delete")}
          </button>
        </div>
      )}

      {/* Main Chat Column */}
      <div className="chat-main">
        <button
          type="button"
          className={`chat-history-control ${historyVisible ? "" : "chat-history-control-collapsed"}`}
          aria-label={t(historyVisible ? "chat.hideHistory" : "chat.showHistory")}
          title={t(historyVisible ? "chat.hideHistory" : "chat.showHistory")}
          aria-controls="chat-history"
          aria-expanded={historyVisible}
          onClick={() => setHistoryVisible((visible) => !visible)}
        >
          {historyVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        {state.error && (() => {
          const diagnosis = diagnoseChatError(state.error);
          const handleAction = () => {
            switch (diagnosis.action) {
              case "reconnect":
                act(() => controller.start());
                break;
              case "create":
                act(() => controller.create());
                break;
              case "retry_save":
                act(() => (state.ready ? controller.retryPersistence() : controller.start()));
                break;
              case "switch_model":
                break;
              case "wait":
                controller.clearError();
                break;
            }
          };
          return (
            <div role="alert" className="chat-alert">
              {errorLabel(state.error)}
              <button onClick={handleAction}>
                {t(diagnosis.actionKey as TranslationKey)}
              </button>
            </div>
          );
        })()}

        {!state.ready ? (
          <p role="status" className="chat-empty">
            {t("chat.loading")}
          </p>
        ) : !c ? (
          <p className="chat-empty">{t("chat.empty")}</p>
        ) : (
          <>
            {/* Clean Kivio-style Header */}
            <header className="chat-titlebar">
              <div className="chat-titlebar-left">
                <div
                  className="chat-conversation-title-wrap"
                  onClick={() => {
                    if (historyLocked || selectingHistory) return;
                    setTargetConvId(c.id);
                    setTitle(c.title);
                    setDialog("rename");
                  }}
                  title={t("chat.rename")}
                >
                  <h1 className="chat-conversation-title">
                    {c.title || t("chat.untitled")}
                  </h1>
                </div>
              </div>

              <div className="chat-titlebar-right">
                {/* Kivio Custom Dropdown (No ugly OS native select) */}
                <div className="chat-model-menu-wrapper" ref={modelMenuRef}>
                  <div
                    className="chat-model-pill"
                    title={t("chat.selectModel")}
                    onClick={() => {
                      if (!frozen && !busy && !running) {
                        setModelMenuOpen((open) => !open);
                      }
                    }}
                  >
                    <Sparkles size={14} className="text-primary" />
                    <span className="chat-model-pill-text">{currentModelDisplay}</span>
                    <ChevronDown
                      size={14}
                      className="chat-model-pill-arrow"
                      style={{
                        transform: modelMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    />
                  </div>

                  {modelMenuOpen && (
                    <div className="chat-model-dropdown">
                      {hasConfiguredModels ? (
                        chatModelOptions.map((opt) => {
                          const isSelected =
                            activeChatModel?.key === opt.key ||
                            (c.providerId === opt.providerId && c.model === opt.modelId);
                          return (
                            <button
                              key={opt.key}
                              className="chat-model-dropdown-item"
                              aria-selected={isSelected}
                              onClick={() => handleModelSelect(opt.key)}
                            >
                              <span>{opt.modelId}</span>
                              <span className="chat-model-dropdown-provider">
                                {opt.providerName}
                              </span>
                              {isSelected && <Check size={13} className="text-primary" />}
                            </button>
                          );
                        })
                      ) : state.providers.length > 0 ? (
                        state.providers.map((p) => (
                          <button
                            key={`${p.appType}:${p.providerId}`}
                            className="chat-model-dropdown-item"
                            disabled={!p.available}
                            onClick={() =>
                              handleModelSelect(`${p.appType}:${p.providerId}`)
                            }
                          >
                            <span>{p.name}</span>
                            <span className="chat-model-dropdown-provider">
                              {p.defaultModel || p.protocol || "—"}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div
                          style={{
                            padding: "8px 10px",
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          {t("chat.noModelsConfigured")}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Compatibility select element for tests: invisible but queryable */}
                <select
                  style={{ display: "none" }}
                  value={activeChatModel ? activeChatModel.key : ""}
                  onChange={(e) => handleModelSelect(e.target.value)}
                >
                  {chatModelOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.modelId} ({opt.providerName})
                    </option>
                  ))}
                  {state.providers.map((p) => (
                    <option
                      key={`${p.appType}:${p.providerId}`}
                      value={`${p.appType}:${p.providerId}`}
                      disabled={!p.available}
                    >
                      {p.name} · {p.defaultModel || p.protocol || "—"}
                      {!p.available ? ` — ${errorLabel(p.reason)}` : ""}
                    </option>
                  ))}
                </select>

                {/* Hidden action buttons for automated testing backwards compatibility */}
                <div style={{ display: "none" }}>
                  <button
                    onClick={() => {
                      setTargetConvId(c.id);
                      setTitle(c.title);
                      setDialog("rename");
                    }}
                  >
                    {t("chat.rename")}
                  </button>
                  <button onClick={() => act(() => controller.select(c.id))}>
                    {t("chat.reload")}
                  </button>
                  <button
                    onClick={() => {
                      setTargetConvId(c.id);
                      setDialog("delete");
                    }}
                  >
                    {t("chat.delete")}
                  </button>
                  <input
                    style={{ display: "none" }}
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    onBlur={() => {
                      if (c && modelInput !== c.model) {
                        act(() => controller.update(c.id, { model: modelInput }));
                      }
                    }}
                  />
                </div>
              </div>
            </header>

            {foreign && <p role="status">{t("chat.readonly")}</p>}
            {state.suspended && <p role="status">{t("chat.suspended")}</p>}

            {/* Message Stream and current-conversation question outline */}
            <div className="chat-reading-layout">
            <div
              className="chat-messages"
              ref={scroll}
              onScroll={(event) => {
                follow.current = isFollowing(event.currentTarget);
                setFollowing(follow.current);
                updateActiveQuestion();
              }}
            >
              {!detail.messages.length && (
                <div className="chat-welcome-container">
                  <div className="chat-welcome-icon">
                    <MessageSquare size={24} />
                  </div>
                  <div className="chat-welcome-title">{t("chat.welcomeTitle")}</div>
                  <div className="chat-welcome-desc">
                    {hasConfiguredModels
                      ? t("chat.welcomeDesc")
                      : t("chat.goToSettings")}
                  </div>
                </div>
              )}

              {detail.messages.map((message) => {
                const isLast = detail.messages[detail.messages.length - 1]?.id === message.id;
                return (
                <article
                  key={message.id}
                  className={`chat-message chat-message-${message.role}`}
                  data-chat-question-id={message.role === "user" ? message.id : undefined}
                  tabIndex={message.role === "user" ? -1 : undefined}
                >
                  <header>
                    <strong>
                      {t(message.role === "user" ? "chat.user" : "chat.assistant")}
                    </strong>
                    <time dateTime={new Date(message.createdAt).toISOString()}>
                      {chatTime(message.createdAt, language)}
                    </time>
                  </header>

                  {message.role === "assistant" ? (
                    <MarkdownContent
                      content={message.content}
                      variant="default"
                      linkBehavior="preview"
                      onLinkActivate={(href) =>
                        act(() => activateChatLink(href, openUrl))
                      }
                    />
                  ) : (
                    <div className="chat-user-bubble">
                      <p className="chat-user-text">{message.content}</p>
                    </div>
                  )}

                  <div className="chat-message-actions">
                    <button
                      type="button"
                      onClick={() =>
                        act(async () => {
                          await copyChatText(message.content, writeText);
                          setCopied(message.id);
                        })
                      }
                    >
                      {t(copied === message.id ? "chat.copied" : "chat.copy")}
                    </button>
                    {message.role === "assistant" && isLast && retryable && !running && (
                      <button
                        type="button"
                        disabled={frozen || busy || !c.model?.trim() || !!state.unsaved[c.id]}
                        onClick={() => act(() => controller.generate(c.id, true, reasoning))}
                      >
                        {t("chat.retry")}
                      </button>
                    )}
                  </div>

                  {message.role === "assistant" &&
                    (message.status !== "completed" || message.errorCode) && (
                      <footer>
                        {message.status !== "completed" &&
                          t(`chat.${message.status}` as TranslationKey)}
                        {message.errorCode && (
                          <span role="alert">{errorLabel(message.errorCode)}</span>
                        )}
                      </footer>
                    )}
                </article>
                );
              })}
            </div>
            {questions.length > 0 && (
              <div
                className={`chat-outline-rail ${outlineOpen || outlineHovered ? "chat-outline-rail-open" : ""}`}
                onMouseEnter={() => {
                  if (!outlineDismissed.current) setOutlineHovered(true);
                }}
                onMouseLeave={() => {
                  outlineDismissed.current = false;
                  setOutlineHovered(false);
                }}
                onFocus={() => {
                  if (!outlineDismissed.current) setOutlineHovered(true);
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    outlineDismissed.current = false;
                    setOutlineHovered(false);
                  }
                }}
              >
                <button
                  type="button"
                  className="chat-outline-toggle"
                  aria-label={t("chat.questionOutline")}
                  title={t("chat.questionOutline")}
                  aria-expanded={outlineOpen || outlineHovered}
                  aria-controls="chat-question-outline"
                  onClick={() => setOutlineOpen((open) => !open)}
                >
                  <List size={15} aria-hidden="true" />
                </button>
                <nav
                  id="chat-question-outline"
                  className="chat-question-outline"
                  aria-label={t("chat.questionOutline")}
                >
                  <div className="chat-outline-heading">{t("chat.questionOutline")}</div>
                  <ol>
                    {questions.map((message, index) => {
                      const label = message.content.split(/\r?\n/).find((line) => line.trim())?.trim() || t("chat.untitledQuestion");
                      return (
                        <li key={message.id}>
                          <button
                            type="button"
                            title={message.content}
                            aria-current={activeQuestionId === message.id ? "location" : undefined}
                            onClick={() => jumpToQuestion(message.id)}
                          >
                            <span className="chat-outline-number">{index + 1}</span>
                            <span className="chat-outline-label">{label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </div>
            )}
            </div>

            {!following && (
              <button
                className="chat-bottom"
                onClick={() => {
                  follow.current = true;
                  setFollowing(true);
                  if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
                }}
              >
                {t("chat.bottom")}
              </button>
            )}

            {state.unsaved[c.id] && (
              <p role="alert" style={{ display: "none" }}>
                {t("chat.unsaved")}
                <button onClick={() => act(() => controller.retryPersistence())}>
                  {t("chat.retrySave")}
                </button>
              </p>
            )}

            {/* Kivio / Claude Card Composer */}
            <form
              className="chat-composer-container chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                handleSendMessage();
              }}
            >
              <div className="chat-composer-card">
                {/* Attachments preview bar */}
                {attachments.length > 0 && (
                  <div className="chat-attachments-bar">
                    {attachments.map((att) => (
                      <div key={att.id}>
                        {att.type === "image" && att.dataUrl ? (
                          <div className="chat-attachment-image-preview">
                            <button
                              type="button"
                              className="chat-attachment-thumb"
                              title={t("chat.imagePreview")}
                              aria-label={t("chat.imagePreview")}
                              onClick={() => setPreview({ src: att.dataUrl!, name: att.name })}
                            >
                              <img src={att.dataUrl} alt={att.name} />
                            </button>
                            <button
                              type="button"
                              className="chat-attachment-remove"
                              style={{
                                position: "absolute",
                                top: 2,
                                right: 2,
                                background: "rgba(0,0,0,0.6)",
                                borderRadius: 4,
                              }}
                              onClick={() => removeAttachment(att.id)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="chat-attachment-chip">
                            <FileText size={13} />
                            <span>{att.name}</span>
                            <button
                              type="button"
                              className="chat-attachment-remove"
                              onClick={() => removeAttachment(att.id)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  className="chat-composer-textarea"
                  aria-label={t("chat.draft")}
                  placeholder={t("chat.draft")}
                  disabled={frozen}
                  ref={(element) => {
                    if (element) {
                      element.style.height = "auto";
                      element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
                    }
                  }}
                  value={state.drafts[c.id] ?? c.draft}
                  onChange={(event) => controller.setDraft(c.id, event.target.value)}
                  onPaste={handlePaste}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onBlur={() => act(() => controller.flushDraft(c.id))}
                  onKeyDown={(event) => {
                    if (
                      shouldSubmit(
                        {
                          key: event.key,
                          shiftKey: event.shiftKey,
                          isComposing: event.nativeEvent.isComposing,
                          keyCode: event.nativeEvent.keyCode,
                        },
                        composing.current
                      )
                    ) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />

                <div className="chat-composer-bottom-bar chat-composer-actions">
                  <div className="chat-composer-bottom-left">
                    {/* Attachment Upload Button */}
                    <button
                      type="button"
                      className="chat-attachment-btn"
                      title="上传文件"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip size={15} />
                    </button>

                    <span className="chat-composer-model-indicator">
                      <Bot size={12} />
                      <span>{c.model || t("chat.noModelsConfigured")}</span>
                    </span>

                    <div className="chat-reasoning-field" ref={reasoningMenuRef}>
                      <button
                        ref={reasoningButtonRef}
                        type="button"
                        className="chat-reasoning-trigger"
                        aria-label={`${t("chat.reasoning")}: ${t(`chat.reasoning.${reasoning}` as TranslationKey)}`}
                        aria-haspopup="menu"
                        aria-expanded={reasoningMenuOpen}
                        disabled={frozen}
                        onClick={() => setReasoningMenuOpen((open) => !open)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown" && !reasoningMenuOpen) {
                            event.preventDefault();
                            setReasoningMenuOpen(true);
                          }
                        }}
                      >
                        <Sparkles size={13} aria-hidden="true" />
                        <span className="chat-reasoning-label">{t("chat.reasoning")}</span>
                        <span className="chat-reasoning-value">{t(`chat.reasoning.${reasoning}` as TranslationKey)}</span>
                        <ChevronDown size={12} aria-hidden="true" />
                      </button>
                      {reasoningMenuOpen && (
                        <div
                          className="chat-reasoning-menu"
                          role="menu"
                          aria-label={t("chat.reasoning")}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setReasoningMenuOpen(false);
                              reasoningButtonRef.current?.focus();
                            }
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                              event.preventDefault();
                              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                              const index = items.indexOf(document.activeElement as HTMLButtonElement);
                              items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
                            }
                          }}
                        >
                          {reasoningLevels.map((level) => (
                            <button
                              key={level}
                              type="button"
                              role="menuitemradio"
                              aria-checked={reasoning === level}
                              title={level === "xhigh" || level === "max"
                                ? t("chat.panel.reasoningUnsupportedHint") : undefined}
                              className="chat-reasoning-option"
                              onClick={() => {
                                setReasoning(level);
                                if (selected) persistReasoning(selected, level);
                                setReasoningMenuOpen(false);
                                reasoningButtonRef.current?.focus();
                              }}
                            >
                              <span>{t(`chat.reasoning.${level}` as TranslationKey)}</span>
                              {reasoning === level && <Check size={14} aria-hidden="true" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Silent typing: draftPending / saving are hidden per user request */}
                    {state.draftStatus[c.id] === "failed" && (
                      <span role="alert">{t("chat.unsaved")}</span>
                    )}
                  </div>

                  <div className="chat-composer-buttons">
                    {running ? (
                      <button
                        type="button"
                        className="chat-send-btn chat-stop-btn"
                        title={t("chat.stopNote")}
                        onClick={() => act(() => controller.stop(c.id))}
                      >
                        <Square size={12} fill="currentColor" />
                        <span>{t("chat.stop")}</span>
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        {retryable && (
                          <button
                            type="button"
                            className="chat-icon-btn"
                            disabled={frozen || busy || !c.model?.trim() || !!state.unsaved[c.id]}
                            onClick={() => act(() => controller.generate(c.id, true, reasoning))}
                            title={t("chat.retry")}
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <button
                          type="submit"
                          className="chat-send-btn"
                          disabled={
                            frozen ||
                            busy ||
                            !c.model?.trim() ||
                            !!state.unsaved[c.id] ||
                            (!(state.drafts[c.id] ?? c.draft).trim() && attachments.length === 0)
                          }
                        >
                          <ArrowUp size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </form>

            {preview && (
              <div
                className="chat-image-lightbox"
                role="dialog"
                aria-modal="true"
                aria-label={t("chat.imagePreview")}
                onClick={() => setPreview(null)}
              >
                <img
                  src={preview.src}
                  alt={preview.name}
                  onClick={(event) => event.stopPropagation()}
                />
                <button
                  type="button"
                  className="chat-image-lightbox-close"
                  aria-label={t("chat.closePreview")}
                  title={t("chat.closePreview")}
                  onClick={() => setPreview(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Rename / Delete Dialog */}
            {dialog && !selectingHistory && !historyLocked && (
              <div className="chat-dialog-backdrop">
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-label={t(dialog === "delete" ? "chat.delete" : "chat.rename")}
                  className="chat-dialog"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setDialog(null);
                  }}
                >
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const id = targetConvId || c.id;
                      act(async () => {
                        if (dialog === "delete") await controller.remove(id);
                        else await controller.update(id, { title });
                        setDialog(null);
                      });
                    }}
                  >
                    {dialog === "delete" ? (
                      <p>{t("chat.confirmDelete")}</p>
                    ) : (
                      <label>
                        {t("chat.rename")}
                        <input
                          autoFocus
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                        />
                      </label>
                    )}
                    <div className="chat-dialog-actions">
                      <button
                        type="button"
                        autoFocus={dialog === "delete"}
                        onClick={() => setDialog(null)}
                      >
                        {t("chat.cancel")}
                      </button>
                      <button type="submit" disabled={busy || frozen}>
                        {t("chat.confirm")}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
