export const MAX_BTW_IMAGES = 4;
export const MAX_BTW_IMAGE_BYTES = 6 * 1024 * 1024;
export type BtwImageMime = "image/png" | "image/jpeg" | "image/webp";
export interface BtwImageContent { type: "image"; source: { type: "base64"; media_type: BtwImageMime; data: string }; name?: string }
export function isBtwImageMime(value: string): value is BtwImageMime {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}
export function readBtwImages(files: readonly File[], current = 0): { accepted: File[]; rejection: "too_large" | "unsupported" | "limit" | null } {
  let rejection: "too_large" | "unsupported" | "limit" | null = null;
  const accepted: File[] = [];
  for (const file of files) {
    if (current + accepted.length >= MAX_BTW_IMAGES) { rejection ??= "limit"; break; }
    if (!isBtwImageMime(file.type)) { rejection ??= "unsupported"; continue; }
    if (file.size > MAX_BTW_IMAGE_BYTES) { rejection ??= "too_large"; continue; }
    accepted.push(file);
  }
  return { accepted, rejection };
}
export function fileToBtwImage(file: File): Promise<BtwImageContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("image_read_failed"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0 || !isBtwImageMime(file.type)) return reject(new Error("image_read_failed"));
      resolve({ type: "image", source: { type: "base64", media_type: file.type, data: value.slice(comma + 1) }, name: file.name });
    };
    reader.readAsDataURL(file);
  });
}
