export interface CaptureFrame {
  width: number;
  height: number;
  originX: number;
  originY: number;
  imageBase64: string;
}
export interface CapturePayload { sessionId: number; capture: CaptureFrame }

/** Local async fence complements native identity checks; obsolete reads cannot replace a newer opening. */
export class CaptureSession {
  private revision = 0;
  current: CapturePayload | null = null;
  private stopped = false;
  private retiredThrough = 0;

  async refresh(read: () => Promise<CapturePayload | null>, update: (v: CapturePayload | null) => void) {
    const revision = ++this.revision;
    const payload = await read();
    if (this.stopped || revision !== this.revision ||
      (payload && payload.sessionId <= this.retiredThrough)) return;
    // Confirm drops native retained pixels, not the local in-flight translation identity.
    if (!payload && this.current && this.current.sessionId <= this.retiredThrough) return;
    this.current = payload;
    update(payload);
  }

  isCurrent(id: number) { return !this.stopped && this.current?.sessionId === id; }

  clear(id: number) {
    if (!this.isCurrent(id)) return;
    ++this.revision;
    this.retiredThrough = Math.max(this.retiredThrough, id);
    this.current = null;
  }

  beginConfirmation(id: number) {
    if (!this.isCurrent(id)) return false;
    ++this.revision;
    this.retiredThrough = Math.max(this.retiredThrough, id);
    return true;
  }

  stop() {
    this.stopped = true;
    ++this.revision;
    this.current = null;
  }
}

/** Native confirm must release desktop input before even model discovery starts. */
export async function confirmCapture<T>(
  id: number,
  isCurrent: () => boolean,
  confirm: () => Promise<unknown>,
  translate: (image: string) => Promise<T>,
  deliver: (text: T) => Promise<unknown>,
  crop: () => string = () => "",
  timing: (stage: "confirm_to_release" | "crop_encode" | "model_and_delivery", elapsedMs: number) => void = () => {},
  clock: () => number = () => performance.now(),
  thumbnail: (image: string) => Promise<unknown> = async () => {},
) {
  if (!isCurrent()) return;
  const start = clock();
  await confirm();
  timing("confirm_to_release", clock() - start);
  if (!isCurrent()) return;
  const cropStart = clock();
  const image = crop();
  timing("crop_encode", clock() - cropStart);
  if (!isCurrent()) return;
  await thumbnail(image);
  if (!isCurrent()) return;
  const modelStart = clock();
  const text = await translate(image);
  if (isCurrent()) await deliver(text);
  timing("model_and_delivery", clock() - modelStart);
  // Native also checks id: local fencing is not the authorization boundary.
  return id;
}
