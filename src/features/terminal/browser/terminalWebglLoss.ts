/** Native context-loss does not bubble; capture it before the addon's delayed notification. */
export function watchTerminalWebglLoss(element: HTMLElement, recover: () => void): () => void {
  let disposed = false;
  let pending = false;
  const onLoss = (event: Event) => {
    event.preventDefault();
    if (pending || disposed) return;
    pending = true;
    // Let the addon finish handling the event before disposing its renderer and timer.
    queueMicrotask(() => {
      if (!disposed) recover();
    });
  };
  element.addEventListener("webglcontextlost", onLoss, true);
  return () => {
    disposed = true;
    element.removeEventListener("webglcontextlost", onLoss, true);
  };
}
