import { useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2, Settings2 } from "lucide-react";
import { useI18n } from "../../../shared/i18n/index";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { translatorLanguageLabelKey, TRANSLATOR_TARGET_LANGUAGES, type TranslatorTargetLanguage } from "../lib/languages";
import { resolveTranslatorModel, translatorModelKey, translatorModelLabel } from "../lib/models";
import { useTranslatorStore } from "../api/translatorStore";
import { TranslatorSelect, type TranslatorSelectOption } from "./TranslatorSelect";

const DEBOUNCE_MS = 600;

interface TranslatorPanelProps {
  /**
   * `window` = 独立浮窗（无遮罩，Esc 隐藏 Native 窗口，标题栏可拖动）；
   * `modal` = 主窗口内弹层（保留给命令面板等场景）。
   */
  variant?: "window" | "modal";
}

export function TranslatorPanel({ variant = "modal" }: TranslatorPanelProps) {
  const { t } = useI18n();
  const input = useTranslatorStore((s) => s.input);
  const result = useTranslatorStore((s) => s.result);
  const resultInput = useTranslatorStore((s) => s.resultInput);
  const loading = useTranslatorStore((s) => s.loading);
  const error = useTranslatorStore((s) => s.error);
  const errorKey = useTranslatorStore((s) => s.errorKey);
  const targetLang = useTranslatorStore((s) => s.targetLang);
  const resolvedTargetLang = useTranslatorStore((s) => s.resolvedTargetLang);
  const models = useTranslatorStore((s) => s.models);
  const modelsLoaded = useTranslatorStore((s) => s.modelsLoaded);
  const selectedModelKey = useTranslatorStore((s) => s.selectedModelKey);
  const copied = useTranslatorStore((s) => s.copied);
  const setInput = useTranslatorStore((s) => s.setInput);
  const setTargetLang = useTranslatorStore((s) => s.setTargetLang);
  const setModel = useTranslatorStore((s) => s.setModel);
  const setCopied = useTranslatorStore((s) => s.setCopied);
  const closeTranslator = useTranslatorStore((s) => s.closeTranslator);
  const loadModels = useTranslatorStore((s) => s.loadModels);
  const resolveTarget = useTranslatorStore((s) => s.resolveTarget);
  const translate = useTranslatorStore((s) => s.translate);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousTargetLang = useRef(targetLang);
  const previousModelKey = useRef("");
  const busyRef = useRef(false);
  busyRef.current = loading;

  const activeModel = useMemo(
    () => resolveTranslatorModel(models, selectedModelKey),
    [models, selectedModelKey]
  );
  const activeModelKey = activeModel ? translatorModelKey(activeModel.providerId, activeModel.modelId) : "";

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 输入框随输入行数自增高（上限 5 行），带动窗口一起长高。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input]);

  // 输入停止 600ms 后翻译；切换目标语言或模型时立即重译。
  useEffect(() => {
    void resolveTarget();
    const trimmed = input.trim();
    // 无输入，或者当前输入正好与已有结果匹配（包含刚刚注入的截图结果），不重复请求。
    if (!trimmed || trimmed === resultInput) {
      if (!trimmed && resultInput) {
        // 用户主动把输入清空了，清除旧译文。
        void translate();
      }
      return;
    }
    const languageChanged = previousTargetLang.current !== targetLang;
    const modelChanged = previousModelKey.current !== "" && previousModelKey.current !== activeModelKey;
    previousTargetLang.current = targetLang;
    previousModelKey.current = activeModelKey;
    const timer = setTimeout(() => {
      void translate();
    }, languageChanged || modelChanged ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, resultInput, targetLang, activeModelKey, resolveTarget, translate]);

  const languageOptions = useMemo<TranslatorSelectOption[]>(
    () =>
      TRANSLATOR_TARGET_LANGUAGES.map((value) => ({
        value,
        label: t(translatorLanguageLabelKey(value)),
      })),
    [t]
  );

  const modelOptions = useMemo<TranslatorSelectOption[]>(
    () =>
      models.map((option) => ({
        value: translatorModelKey(option.providerId, option.modelId),
        label: translatorModelLabel(option),
      })),
    [models]
  );

  const targetName = useMemo(() => {
    const code = targetLang === "auto" ? resolvedTargetLang : targetLang;
    if (!code) return "";
    return languageOptions.find((option) => option.value === code)?.label ?? "";
  }, [languageOptions, resolvedTargetLang, targetLang]);

  const targetLabel = useMemo(() => {
    if (targetLang !== "auto") return `${t("translator.target.prefix")}${targetName}`;
    return targetName ? `${t("translator.target.autoPrefix")} → ${targetName}` : t("translator.lang.auto");
  }, [t, targetLang, targetName]);

  const dismiss = useCallback(() => {
    closeTranslator();
    if (variant === "window") {
      void invoke("translator_hide").catch(() => {});
    }
  }, [closeTranslator, variant]);

  const openSettings = useCallback(() => {
    void invoke("translator_open_settings").catch(() => {});
  }, []);

  const copyResult = useCallback(async () => {
    if (!result) return;
    // 允许复制截图翻译结果（input 为空时）或当前 input 对应的最新译文。
    if (input && resultInput !== input) return;
    await copyTextToClipboard(result);
    setCopied(true);
  }, [input, result, resultInput, setCopied]);

  // data-tauri-drag-region 在 WebView2 的无边框透明窗口里并不可靠，
  // 直接调 startDragging() 才能稳定拖动；整张卡都是拖拽区，仅排除输入/按钮/可选中译文。
  const handleDragMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (variant !== "window" || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea,input,button,select,a,[data-no-drag],[data-selectable]")) return;
      void getCurrentWindow().startDragging().catch(() => {});
    },
    [variant]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        // IME 组合输入（中日韩选词回车）不触发复制。
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (busyRef.current) return;
        void copyResult();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    },
    [copyResult, dismiss]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) dismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dismiss]);

  const showModelNotice = modelsLoaded && models.length === 0;
  const message = errorKey ? t(errorKey) : error;

  return (
    <div className={`translator-card translator-card--${variant}`} onMouseDown={handleDragMouseDown}>
      <header className="translator-header">
        <span className="translator-title">{t("translator.title")}</span>
        <span className="translator-header-right">
          {models.length > 0 ? (
            <TranslatorSelect
              value={activeModelKey}
              options={modelOptions}
              onChange={setModel}
              ariaLabel={t("translator.model")}
              align="end"
              triggerClassName="translator-select--model"
            />
          ) : null}
        </span>
      </header>

      {showModelNotice ? (
        <div className="translator-notice">
          <span>{t("translator.error.noModel")}</span>
          <button type="button" className="translator-notice-action" onClick={openSettings} data-no-drag>
            <Settings2 size={12} />
            {t("translator.error.goToSettings")}
          </button>
        </div>
      ) : null}

      <div className="translator-source">
        <textarea
          ref={inputRef}
          className="translator-input"
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("translator.placeholder")}
          aria-label={t("translator.placeholder")}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
      </div>

      <div className="translator-language-row">
        <div className="translator-divider" />
        <TranslatorSelect
          value={targetLang}
          options={languageOptions}
          onChange={(next) => setTargetLang(next as TranslatorTargetLanguage)}
          ariaLabel={targetLabel}
          align="end"
          triggerContent={targetLabel}
          triggerClassName="translator-select--language"
        />
      </div>

      <div className="translator-result" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p className="translator-status">
            <Loader2 size={12} className="translator-spin" />
            {t("translator.status.translating")}
          </p>
        ) : result ? (
          <p className="translator-translation" data-selectable>
            {result}
          </p>
        ) : message ? null : (
          <p className="translator-status">{t("translator.status.empty")}</p>
        )}
        {message ? <div className="translator-error" role="alert"><p>{message}</p>
          <button type="button" disabled={loading} onClick={() => void translate()}>{t("translator.retry")}</button>
          <button type="button" onClick={openSettings}>{t("translator.error.goToSettings")}</button>
        </div> : null}
      </div>

      <footer className="translator-footer">
        <span>
          {copied ? `✓ ${t("translator.status.copied")}` : `${t("translator.footer.enter")} · ${t("translator.footer.esc")}`}
        </span>
        <span>{t("translator.footer.newline")}</span>
      </footer>
    </div>
  );
}
