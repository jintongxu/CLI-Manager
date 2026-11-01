import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ScreenshotOverlay } from "../components/ScreenshotOverlay";
import { useTranslatorStore } from "./translatorStore";
import type { CropBounds } from "../lib/crop";
import type { ScreenshotResult } from "../lib/resultWindow";
import { resolveTranslatorModel } from "../lib/models";
import { CaptureSession, confirmCapture, type CapturePayload } from "../lib/captureSession";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import "../../../App.css";

/** Each opening is native-owned; mounting a hidden prewarmed webview never consumes a frame. */
export function CaptureWindowApp() {
  const [payload, setPayload] = useState<CapturePayload | null>(null);
  const coordinator = useRef<CaptureSession | null>(null);

  useEffect(() => {
    const session = new CaptureSession();
    coordinator.current = session;
    const root = document.documentElement;
    root.dataset.window = "translator-capture";
    for (const element of [root, document.body, document.getElementById("root")]) {
      if (element) element.style.background = "transparent";
    }
    void useSettingsStore.getState().load().then(() => {
      const s = useSettingsStore.getState();
      root.dataset.theme = s.resolvedTheme ?? "dark";
      root.dataset.lightPalette = s.lightThemePalette;
      root.dataset.darkPalette = s.darkThemePalette;
    }).catch(console.error);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = () => session.refresh(
      async () => {
        const start = performance.now();
        const frame = await invoke<CapturePayload | null>("translator_take_capture");
        console.debug("[capture timing]", { stage: "payload_read_ipc", elapsedMs: performance.now() - start });
        return frame;
      }, setPayload,
    ).catch((error: unknown) => {
      console.error("capture read failed", error);
      // No identity is guessed: a failed handshake remains hidden and native timeout expires it.
    });
    // Subscribe before reading closes both warm-publication and cold-mount races.
    void listen("translator:capture-changed", () => { void refresh(); }).then((off) => {
      if (disposed) { off(); return; }
      unlisten = off;
      void refresh();
    }).catch(console.error);
    return () => {
      disposed = true;
      session.stop();
      unlisten?.();
      delete root.dataset.window;
    };
  }, []);

  const cancel = useCallback((id: number) => {
    const session = coordinator.current;
    if (!session?.isCurrent(id)) return;
    session.clear(id);
    // Keep the last rendered image until native release resolves; never create a blank interceptor.
    void invoke("translator_capture_end", { sessionId: id }).then(() => {
      setPayload((current) => current?.sessionId === id ? null : current);
    }).catch(console.error);
  }, []);

  const ready = useCallback((id: number) => {
    if (!coordinator.current?.isCurrent(id)) return;
    const start = performance.now();
    void invoke("translator_capture_ready", { sessionId: id }).then(() => {
      console.debug("[capture timing]", { stage: "ready_ack_ipc", elapsedMs: performance.now() - start });
    }).catch(() => cancel(id));
  }, [cancel]);

  const confirm = useCallback(async (id: number, crop: () => string, physical: CropBounds) => {
    const session = coordinator.current;
    if (!session?.beginConfirmation(id)) return;
    let hidden = false;
    let generation: number | null = null;
    try {
      await confirmCapture(id, () => session.isCurrent(id),
        async () => {
          const frame = session.current!.capture;
          generation = await invoke<number>("translator_capture_confirm", { sessionId: id,
            anchor: { ...physical, x: frame.originX + physical.x, y: frame.originY + physical.y } });
          hidden = true;
          setPayload((current) => current?.sessionId === id ? null : current);
        },
        async (croppedBase64) => {
          // Native release and crop have completed before model discovery/network.
          if (!session.isCurrent(id)) throw new Error("capture_session_obsolete");
          const store = useTranslatorStore.getState();
          const models = store.models.length ? store.models : await invoke<typeof store.models>("translator_list_models");
          if (!session.isCurrent(id)) throw new Error("capture_session_obsolete");
          const model = resolveTranslatorModel(models, store.selectedModelKey);
          return invoke<ScreenshotResult>("translator_translate_image", {
            imageBase64: croppedBase64,
            sessionId: id, generation,
            targetLang: store.targetLang === "auto" ? null : store.targetLang,
            providerId: model?.providerId ?? null,
            modelId: model?.modelId ?? null,
          });
        },
        async () => {}, // Native translation owns acceptance and card delivery.
        crop,
        (stage, elapsedMs) => console.debug("[capture timing]", { stage, elapsedMs }),
        () => performance.now(),
        (imageBase64) => invoke("translator_update_thumbnail", { sessionId: id, generation, imageBase64 }),
      );
    } catch {
      // Error updates only the same native opening; close/Alt+T/new capture reject it.
      if (generation !== null) {
        await invoke("translator_capture_failed", { sessionId: id, generation }).catch(() => {});
      }
      console.error("capture confirmation/crop/translation failed");
      cancel(id);
    } finally {
      if (hidden && session.isCurrent(id)) { session.clear(id); setPayload(null); }
    }
  }, [cancel]);

  if (!payload) return null;
  const { sessionId: id, capture } = payload;
  return <ScreenshotOverlay
    key={id}
    imageSrc={capture.imageBase64}
    imageWidth={capture.width}
    imageHeight={capture.height}
    onReady={() => ready(id)}
    onConfirm={(crop, physical) => void confirm(id, crop, physical)}
    onCancel={() => cancel(id)}
  />;
}
