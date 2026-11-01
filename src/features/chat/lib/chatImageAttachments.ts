/** In-memory clipboard images; they are never persisted with the conversation. */
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024;
const ACCEPTED_PREFIXES = ["data:image/png", "data:image/jpeg", "data:image/webp"];

export function isAcceptedImageDataUri(value: string): boolean {
  return ACCEPTED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function readClipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function readImageFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export type ImageRejection = "too_large" | "limit";

/** Validates clipboard files against count/size limits before they are read. */
export function filterAcceptedImages(
  files: readonly File[],
  currentCount: number,
  limit = MAX_CHAT_IMAGES,
): { accepted: File[]; rejection: ImageRejection | null } {
  let rejection: ImageRejection | null = null;
  const accepted: File[] = [];
  let room = Math.max(0, limit - currentCount);
  for (const file of files) {
    if (room <= 0) { rejection = rejection ?? "limit"; break; }
    if (file.size > MAX_CHAT_IMAGE_BYTES) { rejection = rejection ?? "too_large"; continue; }
    accepted.push(file);
    room -= 1;
  }
  return { accepted, rejection };
}
