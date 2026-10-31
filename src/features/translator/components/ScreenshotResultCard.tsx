import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../../../shared/i18n/index";
import { copyTextToClipboard } from "../../../shared/platform/systemClipboard";
import { translatedClipboardText, type ScreenshotResult, type ScreenshotCardState } from "../lib/resultWindow";

import { translatorErrorMessage } from "../lib/errors";
import { useTranslatorStore } from "../api/translatorStore";
import { resolveTranslatorModel } from "../lib/models";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";

export function ScreenshotResultCard({ result, card, generation }: {
  generation: number;
  result: ScreenshotResult | null;
  card?: ScreenshotCardState | null;
}) {
  const { t } = useI18n();
  const retrying = useRef(false);
  const [retryPending, setRetryPending] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const retry = async () => {
    if (retrying.current) return;
    retrying.current = true; setRetryPending(true); setRetryError(false);
    try {
      await useSettingsStore.getState().load();
      await useTranslatorStore.getState().loadModels();
      const store = useTranslatorStore.getState();
      const model = resolveTranslatorModel(store.models, store.selectedModelKey);
      await invoke("translator_retry_image", { generation,
        targetLang: store.targetLang === "auto" ? null : store.targetLang,
        providerId: model?.providerId ?? null, modelId: model?.modelId ?? null });
    } catch { setRetryError(true); /* Never expose raw IPC errors. */ }
    finally { retrying.current = false; setRetryPending(false); }
  };
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const phase = card?.phase ?? (result ? "success" : "loading");
  const rawImage = card?.imageBase64 || result?.imageBase64 || "";
  useEffect(() => { setImageFailed(false); }, [rawImage]);
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void invoke("translator_hide");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const image = rawImage.startsWith("data:") ? rawImage : `data:image/png;base64,${rawImage}`;
  const elapsed = phase === "loading" && card ? Math.max(0, now - card.startedAt)
    : card?.elapsedMs ?? result?.elapsedMs ?? 0;
  return <article className="translator-card translator-card--window screenshot-result-card" onMouseDown={(event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,[data-selectable]")) return;
    void getCurrentWindow().startDragging().catch(() => {});
  }}>
    <header className="translator-header screenshot-result-header">
      {!rawImage || imageFailed
        ? <span className="screenshot-result-thumbnail screenshot-result-placeholder" role={imageFailed ? "alert" : undefined}>
          {t(imageFailed ? "translator.screenshot.imageFailed" : "translator.screenshot.title")}
        </span>
        : <img className="screenshot-result-thumbnail" src={image} alt={t("translator.screenshot.title")}
          onError={() => setImageFailed(true)} />}
      <span className="translator-title">{t("translator.screenshot.title")}</span>
      <span>{(elapsed / 1000).toFixed(2)} s</span>
    </header>
    <div className="screenshot-result-body" data-selectable aria-busy={phase === "loading"}>
      {phase !== "success" ? <p role={phase === "error" ? "alert" : "status"}>
        {t(phase === "error" ? translatorErrorMessage(card?.errorCode).key : "translator.screenshot.loading")}
      </p> : result && <>
        <section>
          <h2>{t("translator.screenshot.translated")}</h2>
          <p className="translator-translation">{result.translated}</p>
        </section>
        <section>
          <h2>{t("translator.screenshot.original")}</h2>
          <p className="translator-translation">{result.original ?? t("translator.screenshot.originalMissing")}</p>
        </section>
      </>}
    </div>
    {retryError && phase === "error" && <p role="alert">{t("translator.screenshot.retryFailed")}</p>}
    <footer className="translator-footer">
      {phase === "error" && <>
        <button type="button" disabled={retryPending} onClick={() => void retry()}>{t("translator.retry")}</button>
        <button type="button" onClick={() => void invoke("translator_open_settings").catch(() => {})}>{t("translator.error.goToSettings")}</button>
      </>}
      <button type="button" className="screenshot-result-copy" disabled={phase !== "success" || !result?.translated} onClick={() => {
        if (phase !== "success" || !result?.translated) return;
        void copyTextToClipboard(translatedClipboardText(result)).then(() => {
          setCopied(true); setError(false);
        }).catch(() => { setCopied(false); setError(true); });
      }}>{t(copied ? "translator.status.copied" : "translator.status.copy")}</button>
      {error ? <span role="alert">{t("translator.screenshot.copyFailed")}</span> : <span>{t("translator.footer.esc")}</span>}
    </footer>
  </article>;
}
