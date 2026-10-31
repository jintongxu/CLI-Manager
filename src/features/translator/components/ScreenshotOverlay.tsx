import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Languages, X } from "lucide-react";
import { Portal } from "../../../shared/ui/Portal";
import { useI18n } from "../../../shared/i18n/index";
import { prepareCaptureImage } from "../lib/captureReadiness";
import { cropDecodedImage, scaleRectToImage, type CropBounds } from "../lib/crop";
import { HANDLES, MIN_SELECTION, SelectionInteraction, selectionChrome, type Handle } from "../lib/selection";

interface ScreenshotOverlayProps {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  onReady: () => void;
  // A lazy crop keeps all encoding behind the native release authorization boundary.
  onConfirm: (crop: () => string, physical: CropBounds) => void;
  onCancel: () => void;
}

export function ScreenshotOverlay({ imageSrc, imageWidth, imageHeight, onConfirm, onReady, onCancel }: ScreenshotOverlayProps) {
  const { t } = useI18n();
  const [bounds, setBounds] = useState<CropBounds | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [chrome, setChrome] = useState({ tag: { x: 0, y: 0 }, bar: { x: 0, y: 0 } });
  const imageRef = useRef<HTMLImageElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<SelectionInteraction | null>(null);
  if (!interaction.current) interaction.current = new SelectionInteraction(setBounds);
  const locked = useRef(false);
  const decoded = useRef(false);
  const alive = useRef(true);
  const callbacks = useRef({ onReady, onConfirm, onCancel });
  callbacks.current = { onReady, onConfirm, onCancel };

  useEffect(() => {
    alive.current = true;
    decoded.current = false;
    const start = performance.now();
    const image = imageRef.current;
    if (!image) return;
    const cleanup = prepareCaptureImage(image, () => {
      decoded.current = true;
      console.debug("[capture timing]", { stage: "decode_and_ready_paints", elapsedMs: performance.now() - start });
      callbacks.current.onReady();
    }, () => callbacks.current.onCancel());
    const resize = () => { callbacks.current.onCancel(); setView({ width: window.innerWidth, height: window.innerHeight }); };
    window.addEventListener("resize", resize);
    return () => { alive.current = false; cleanup(); interaction.current?.dispose(); window.removeEventListener("resize", resize); };
  }, [imageSrc]);

  const cancel = useCallback(() => {
    locked.current = true;
    interaction.current?.dispose();
    callbacks.current.onCancel();
  }, []);
  const submit = useCallback(() => {
    const current = interaction.current;
    const rect = current?.bounds;
    const image = imageRef.current;
    if (locked.current || current?.dragging || !decoded.current || !image || !rect ||
      rect.width < MIN_SELECTION || rect.height < MIN_SELECTION) return;
    const physical = scaleRectToImage(rect, view.width, view.height, imageWidth, imageHeight);
    if (!physical) return;
    locked.current = true;
    setBusy(true);
    // Retain the exact decoded node and coordinates across overlay unmount after native hide.
    callbacks.current.onConfirm(() => cropDecodedImage(image, physical), physical);
  }, [view, imageWidth, imageHeight]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
      if (event.key === "Enter" && !event.shiftKey && !event.repeat) { event.preventDefault(); submit(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [cancel, submit]);

  useLayoutEffect(() => {
    if (!bounds || !barRef.current || !tagRef.current) return;
    const measure = (element: HTMLElement) => ({ width: element.offsetWidth, height: element.offsetHeight });
    setChrome({ tag: selectionChrome(bounds, view, measure(tagRef.current), false),
      bar: selectionChrome(bounds, view, measure(barRef.current), true) });
  }, [bounds, view, t]);

  const hasSelection = bounds && bounds.width >= MIN_SELECTION && bounds.height >= MIN_SELECTION;
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!alive.current || locked.current || !decoded.current || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, .screenshot-action-bar")) return;
    const handle = target.dataset.handle as Handle | undefined;
    const mode = handle ?? (target.closest(".screenshot-crop-box") ? "move" : "draw");
    if (interaction.current?.begin(event.pointerId, { x: event.clientX, y: event.clientY }, mode, view)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  return <Portal><div className="screenshot-overlay" onPointerDown={begin}
    onPointerMove={(event) => {
      if (locked.current) return;
      const samples = event.nativeEvent.getCoalescedEvents?.();
      const last = samples?.length ? samples[samples.length - 1] : event;
      interaction.current?.update(event.pointerId, { x: last.clientX, y: last.clientY }, view);
    }}
    onPointerUp={(event) => {
      if (locked.current) return;
      interaction.current?.end(event.pointerId, { x: event.clientX, y: event.clientY }, view);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={(event) => interaction.current?.cancel(event.pointerId)}
    onLostPointerCapture={(event) => interaction.current?.cancel(event.pointerId)}
    onContextMenu={(event) => { event.preventDefault(); cancel(); }}>
    <img ref={imageRef} src={imageSrc.startsWith("data:") ? imageSrc : `data:image/png;base64,${imageSrc}`}
      alt="" className="screenshot-frozen-image" draggable={false} />
    {!hasSelection && <div className="screenshot-dark-backdrop" />}
    {hasSelection ? <>
      <div className="screenshot-crop-box" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
        {HANDLES.map((handle) => <div key={handle} data-handle={handle}
          className={`screenshot-handle screenshot-handle--${handle}`} />)}
      </div>
      <div ref={tagRef} className="screenshot-size-tag" style={{ left: chrome.tag.x, top: chrome.tag.y }}>
        {Math.round(bounds.width)} × {Math.round(bounds.height)}
      </div>
      <div ref={barRef} className="screenshot-action-bar" style={{ left: chrome.bar.x, top: chrome.bar.y }}
        onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="screenshot-action-btn screenshot-action-confirm"
          title={t("translator.footer.enter")} disabled={busy} onClick={submit}>
          <Languages size={13} /><span>{t("translator.title")}</span><Check size={13} />
        </button>
        <button type="button" className="screenshot-action-btn screenshot-action-cancel"
          aria-label={t("translator.footer.esc")} title={t("translator.footer.esc")} onClick={cancel}><X size={13} /></button>
      </div>
    </> : <div className="screenshot-hint-badge"><span>{t("translator.screenshot.dragHint")}</span>
      <span className="screenshot-hint-esc">{t("translator.footer.esc")}</span></div>}
  </div></Portal>;
}
