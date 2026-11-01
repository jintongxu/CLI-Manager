/** Decode the committed image and await two render frames; cleanup fences even late decoder callbacks. */
export function prepareCaptureImage(
  image: Pick<HTMLImageElement, "decode" | "naturalWidth">,
  ready: () => void,
  fail: () => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  unschedule: (id: number) => void = cancelAnimationFrame,
) {
  let disposed = false;
  let first = 0;
  let second = 0;
  void image.decode().then(() => {
    if (disposed) return;
    if (!image.naturalWidth) { fail(); return; }
    first = schedule(() => {
      second = schedule(() => { if (!disposed) ready(); });
    });
  }).catch(() => { if (!disposed) fail(); });
  return () => {
    disposed = true;
    unschedule(first);
    unschedule(second);
  };
}
