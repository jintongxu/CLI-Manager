export function attachTerminalTabWheelScroll(element: HTMLDivElement, onScroll: () => void) {
  let frame: number | null = null;
  let target = element.scrollLeft;
  let lastTime: number | null = null;
  const clamp = (value: number) => Math.max(0, Math.min(Math.max(0, element.scrollWidth - element.clientWidth), value));
  const cancel = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    lastTime = null;
    target = element.scrollLeft;
  };
  const animate = (time: number) => {
    const elapsed = lastTime === null ? 16 : Math.max(0, time - lastTime);
    lastTime = time;
    target = clamp(target);
    const remaining = target - element.scrollLeft;
    // Time-based easing keeps wheel motion consistent on different refresh rates.
    element.scrollLeft = Math.abs(remaining) < 0.5 ? target
      : element.scrollLeft + remaining * (1 - Math.exp(-elapsed / 65));
    if (Math.abs(target - element.scrollLeft) < 0.5) {
      element.scrollLeft = target;
      frame = null;
      lastTime = null;
    } else {
      frame = window.requestAnimationFrame(animate);
    }
    onScroll();
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return;
    const horizontal = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
    let delta = horizontal ? event.deltaX : event.deltaY;
    if (!delta) return;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= element.clientWidth;
    event.preventDefault();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (horizontal || reducedMotion) {
      cancel();
      element.scrollLeft = clamp(element.scrollLeft + delta);
      onScroll();
      return;
    }
    // Accumulate bursts against the pending target, not the partially animated position.
    target = clamp((frame === null ? element.scrollLeft : target) + delta);
    if (frame === null) frame = window.requestAnimationFrame(animate);
  };
  element.addEventListener("pointerdown", cancel, { passive: true });
  element.addEventListener("wheel", handleWheel, { passive: false });
  return {
    cancel,
    dispose() {
      cancel();
      element.removeEventListener("pointerdown", cancel);
      element.removeEventListener("wheel", handleWheel);
    },
  };
}
