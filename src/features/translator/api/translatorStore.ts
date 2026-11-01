import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { TranslationKey } from "../../../shared/i18n/index";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import type { TranslatorTargetLanguage } from "../lib/languages";
import {
  resolveTranslatorModel,
  translatorModelKey,
  type TranslatorModelOption,
} from "../lib/models";

interface AcceptedTranslation {
  identity: { generation: number; revision: number; attempt: number };
  translated: string;
}
import { translatorErrorMessage } from "../lib/errors";
export { translatorErrorMessage } from "../lib/errors";

interface TranslatorState {
  generation: number;
  bindOpening: (generation: number) => void;
  open: boolean;
  input: string;
  result: string;
  resultInput: string;
  loading: boolean;
  error: string;
  errorKey: TranslationKey | "";
  targetLang: TranslatorTargetLanguage;
  resolvedTargetLang: string;
  models: TranslatorModelOption[];
  /** 用户显式选择，持久化在设置中；空串表示跟随默认模型。 */
  selectedModelKey: string;
  modelsLoaded: boolean;
  copied: boolean;
  openTranslator: () => void;
  openWithText: (text: string) => void;
  closeTranslator: () => void;
  clear: () => void;
  toggleTranslator: () => void;
  setInput: (value: string) => void;
  setTargetLang: (value: TranslatorTargetLanguage) => void;
  setModel: (key: string) => void;
  setCopied: (value: boolean) => void;
  loadModels: () => Promise<void>;
  resolveTarget: () => Promise<void>;
  translate: () => Promise<void>;
}

// 翻译请求序号：只有最后一次请求可以写回结果，避免防抖与手动重译竞态。
let requestSeq = 0;
let revision = 0;
let invalidation: Promise<unknown> = Promise.resolve();
function invalidate(generation: number) {
  requestSeq += 1;
  revision += 1;
  const current = revision;
  // Send immediately at setter boundary, not from the debounce effect.
  const sent = invoke("translator_invalidate", { generation, revision: current });
  invalidation = sent.catch(() => {});
}

export const useTranslatorStore = create<TranslatorState>((set, get) => ({
  generation: 0,
  bindOpening: (generation) => { revision = 0; requestSeq += 1; set({ generation }); },
  open: false,
  input: "",
  result: "",
  resultInput: "",
  loading: false,
  error: "",
  errorKey: "",
  targetLang: "auto",
  resolvedTargetLang: "",
  models: [],
  selectedModelKey: "",
  modelsLoaded: false,
  copied: false,

  openTranslator: () => set({ open: true }),
  openWithText: (text: string) => {
    invalidate(get().generation);
    set({ open: true, input: text, copied: false, error: "", errorKey: "" });
    void get().translate();
  },
  closeTranslator: () => {
    invalidate(get().generation);
    set({ open: false, loading: false });
  },
  clear: () => {
    invalidate(get().generation);
    set({
      open: true,
      input: "",
      result: "",
      resultInput: "",
      loading: false,
      copied: false,
      error: "",
      errorKey: "",
    });
  },
  toggleTranslator: () => {
    if (get().open) get().closeTranslator();
    else set({ open: true });
  },
  setInput: (value) => { invalidate(get().generation); set({ input: value, copied: false, loading: false, result: "", resultInput: "", error: "", errorKey: "" }); },
  setTargetLang: (value) => { invalidate(get().generation); set({ targetLang: value, copied: false, loading: false, result: "", resultInput: "", error: "", errorKey: "" }); },
  setCopied: (value) => set({ copied: value }),

  setModel: (key) => {
    invalidate(get().generation);
    set({ selectedModelKey: key, copied: false, loading: false, result: "", resultInput: "", error: "", errorKey: "" });
    void useSettingsStore.getState().update("translatorModelKey", key);
  },

  // 已启用的对话模型列表；选择失效时由 resolveTranslatorModel 回退默认项。
  loadModels: async () => {
    const persisted = useSettingsStore.getState().translatorModelKey ?? "";
    try {
      const models = await invoke<TranslatorModelOption[]>("translator_list_models");
      set({ models, modelsLoaded: true, selectedModelKey: persisted });
    } catch {
      set({ models: [], modelsLoaded: true, selectedModelKey: persisted });
    }
  },

  // 自动模式的目标语言预览也由后端解析，避免界面与翻译维护两套语言规则。
  resolveTarget: async () => {
    const { input, targetLang } = get();
    const seq = requestSeq;
    const trimmed = input.trim();
    if (targetLang !== "auto" || !trimmed) {
      set({ resolvedTargetLang: "" });
      return;
    }
    try {
      const resolved = await invoke<string>("translator_resolve_target_lang", { text: trimmed });
      if (seq === requestSeq) set({ resolvedTargetLang: resolved });
    } catch {
      if (seq === requestSeq) set({ resolvedTargetLang: "" });
    }
  },

  translate: async () => {
    if (get().loading) return;
    const { input, targetLang, models, selectedModelKey, generation } = get();
    const submittedRevision = revision;
    const trimmed = input.trim();
    const seq = (requestSeq += 1);
    set({ copied: false, error: "", errorKey: "" });
    if (!trimmed) {
      set({ result: "", resultInput: "", loading: false });
      return;
    }
    const model = resolveTranslatorModel(models, selectedModelKey);
    if (!model) {
      set({ loading: false, errorKey: "translator.error.noModel" });
      return;
    }
    set({ loading: true });
    try {
      const customPrompt = useSettingsStore.getState().translatorPrompt?.trim() || null;
      await invalidation;
      if (seq !== requestSeq) return;
      const accepted = await invoke<AcceptedTranslation>("translator_translate_text", {
        generation, revision: submittedRevision,
        text: trimmed,
        targetLang: targetLang === "auto" ? null : targetLang,
        providerId: model.providerId,
        modelId: model.modelId,
        customPrompt,
      });
      if (seq !== requestSeq) return;
      set({ result: accepted.translated, resultInput: trimmed, loading: false });
    } catch (raw) {
      if (seq !== requestSeq) return;
      const mapped = translatorErrorMessage(raw);
      set({ loading: false, error: "", errorKey: mapped.key });
    }
  },

}));

// 设置页与浮窗共享同一字段：设置里改模型时，已打开的浮窗立即跟随。
useSettingsStore.subscribe((state, previous) => {
  if (state.translatorModelKey !== previous.translatorModelKey) {
    const store = useTranslatorStore.getState();
    // setModel already invalidated synchronously. Its asynchronous preference
    // acknowledgement must not invalidate the replacement attempt a second time.
    if (store.selectedModelKey === state.translatorModelKey) return;
    invalidate(store.generation);
    useTranslatorStore.setState({ selectedModelKey: state.translatorModelKey, result: "", resultInput: "", loading: false });
  }
});

/** 供界面渲染的选择键；未选择时返回默认项键，保证下拉框有稳定值。 */
export function effectiveModelKey(state: Pick<TranslatorState, "models" | "selectedModelKey">): string {
  const model = resolveTranslatorModel(state.models, state.selectedModelKey);
  return model ? translatorModelKey(model.providerId, model.modelId) : "";
}
