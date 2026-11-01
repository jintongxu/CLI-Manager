import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ScreenshotResultCard } from "../components/ScreenshotResultCard";
import { ResultWindowSession, ResizeQueue, type TranslatorOpening } from "../lib/resultWindow";
import { TranslatorPanel } from "../components/TranslatorPanel";
import { useTranslatorStore } from "./translatorStore";
import { useSettingsStore } from "../../../shared/preferences/settingsStore";
import "../../../App.css";

/**
 * 独立 `translator` 窗口的根组件：只有浮窗卡片本身，没有全屏遮罩，
 * 也不会把主应用带到前台。窗口由 Rust 侧按鼠标位置创建与显示。
 */
export function TranslatorWindowApp() {
  const [opening, setOpening] = useState<TranslatorOpening | null>(null);
  const session = useRef(new ResultWindowSession());
  const queue = useRef(new ResizeQueue<NonNullable<ReturnType<ResultWindowSession["measure"]>>>(
    (payload) => invoke("translator_resize", payload),
  ));
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.window = "translator";
    for (const element of [root, document.body, document.getElementById("root")]) {
      if (element) element.style.background = "transparent";
    }

    // 加载持久化的主题设置，注入 dataset 以便 themes.css 的变量完整生效
    void useSettingsStore.getState().load().then(() => {
      const s = useSettingsStore.getState();
      const theme = s.resolvedTheme ?? "dark";
      root.dataset.theme = theme;
      root.dataset.lightPalette = s.lightThemePalette;
      root.dataset.darkPalette = s.darkThemePalette;
    });

    return () => {
      delete root.dataset.window;
    };
  }, []);

  useEffect(() => {
    useTranslatorStore.getState().loadModels();
  }, []);

  useEffect(() => {
    const container = document.querySelector<HTMLElement>(".translator-window-shell");
    if (!container || !opening) return;
    const measure = () => {
      if (session.current.current?.generation !== opening.generation) return;
      const card = container.firstElementChild as HTMLElement | null;
      const scrollArea = container.querySelector<HTMLElement>(".screenshot-result-body, .translator-result");
      const overflow = scrollArea ? Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight) : 0;
      const height = container.getBoundingClientRect().height
        + Math.max(0, (card?.scrollHeight ?? 0) - (card?.clientHeight ?? 0)) + overflow;
      const request = session.current.measure(height);
      if (request) queue.current.push(request);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const mutations = new MutationObserver(measure);
    mutations.observe(container, { childList: true, subtree: true, characterData: true });
    const raf = requestAnimationFrame(measure);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); mutations.disconnect(); };
  }, [opening]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const accept = (payload: TranslatorOpening) => {
      const previousGeneration = session.current.current?.generation;
      if (disposed || !session.current.accept(payload)) return;
      // Separate screenshot view never runs input translation debouncing.
      if (payload.generation !== previousGeneration) {
        useTranslatorStore.getState().bindOpening(payload.generation);
        useTranslatorStore.getState().clear();
      }
      if (payload.mode === "input" && payload.text.trim()) useTranslatorStore.getState().openWithText(payload.text.trim());
      setOpening(payload);
    };
    void listen<TranslatorOpening>("translator:prefill", ({ payload }) => accept(payload)).then((unlisten) => {
      if (disposed) { unlisten(); return; }
      off = unlisten;
      void invoke<TranslatorOpening>("translator_take_opening").then(accept).catch(console.error);
    });
    return () => { disposed = true; off?.(); };
  }, []);

  return (
    <div className={`translator-window-shell translator-window-shell--${opening?.mode ?? "input"}`}>
      {opening?.mode === "screenshot"
        ? <ScreenshotResultCard generation={opening.generation} key={opening.generation} result={opening.result} card={opening.card} />
        : <TranslatorPanel key={opening?.generation ?? 0} variant="window" />}
    </div>
  );
}
