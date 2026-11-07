import type { ChatTransport, StagedAsset } from "./types";

/** UI-neutral staged attachment with one owner-managed preview URL. */
export interface AttachmentDraft {
  localId: string; blob: Blob; descriptor: StagedAsset | null; previewUrl: string; name: string | null;
  status: "staging" | "staged" | "failed";
}

export class AttachmentDraftOwner {
  private drafts: AttachmentDraft[] = [];
  private serial = 0;
  private generation = 0;
  private staging = new Map<string, Promise<AttachmentDraft>>();
  constructor(
    private readonly transport: Pick<ChatTransport, "stage" | "releaseAssets">,
    private readonly createUrl = (blob: Blob) => URL.createObjectURL(blob),
    private readonly revokeUrl = (url: string) => URL.revokeObjectURL(url),
    private readonly reportReleaseError: (error: unknown) => void = () => {},
  ) {}
  get value(): readonly AttachmentDraft[] { return this.drafts; }
  get stageIds(): string[] { return this.drafts.flatMap(draft => draft.descriptor ? [draft.descriptor.stageId] : []); }
  async stage(blob: Blob, name: string | null = typeof File !== "undefined" && blob instanceof File ? blob.name : null): Promise<AttachmentDraft> {
    if (this.drafts.length >= MAX_CHAT_IMAGES) throw new Error("attachment_limit");
    const draft: AttachmentDraft = { localId: `attachment-${++this.serial}`, blob, descriptor: null,
      previewUrl: this.createUrl(blob), name, status: "staging" };
    this.drafts = [...this.drafts, draft];
    return this.startStaging(draft);
  }
  retry(localId: string): Promise<AttachmentDraft> {
    const draft = this.drafts.find(item => item.localId === localId);
    if (!draft) return Promise.reject(new Error("attachment_not_found"));
    if (draft.descriptor) return Promise.resolve(draft);
    return this.staging.get(localId) ?? this.startStaging(draft);
  }
  private startStaging(draft: AttachmentDraft): Promise<AttachmentDraft> {
    draft.status = "staging";
    const pending = this.stageDraft(draft, this.generation).finally(() => {
      if (this.staging.get(draft.localId) === pending) this.staging.delete(draft.localId);
    });
    this.staging.set(draft.localId, pending);
    return pending;
  }
  private async stageDraft(draft: AttachmentDraft, generation: number): Promise<AttachmentDraft> {
    try {
      const descriptor = await this.transport.stage(await draft.blob.arrayBuffer());
      if (generation !== this.generation || !this.drafts.includes(draft)) {
        this.release([descriptor.stageId]);
        return draft;
      }
      draft.descriptor = descriptor;
      draft.status = "staged";
      return draft;
    } catch (error) {
      if (generation === this.generation && this.drafts.includes(draft)) draft.status = "failed";
      throw error;
    }
  }
  private release(stageIds: readonly string[]) {
    if (!stageIds.length) return;
    void this.transport.releaseAssets(stageIds).catch(this.reportReleaseError);
  }
  /** Generation/fork failure intentionally requires no call: drafts and URLs stay owned. */
  remove(id: string): void {
    const removed = this.drafts.filter(draft => draft.localId === id || draft.descriptor?.stageId === id);
    this.drafts = this.drafts.filter(draft => !removed.includes(draft));
    this.release(removed.flatMap(draft => draft.descriptor ? [draft.descriptor.stageId] : []));
    removed.forEach(draft => this.revokeUrl(draft.previewUrl));
  }
  /** Clear local ownership after commit; only IDs not consumed by that commit are released. */
  consumed(consumedStageIds: readonly string[] = this.stageIds): void { this.clear(consumedStageIds); }
  switchConversation(): void { this.clear(); }
  dispose(): void { this.clear(); }
  private clear(consumedStageIds: readonly string[] = []): void {
    const consumed = new Set(consumedStageIds);
    const previous = this.drafts;
    this.drafts = [];
    this.generation += 1;
    this.staging.clear();
    this.release(previous.flatMap(draft => draft.descriptor && !consumed.has(draft.descriptor.stageId)
      ? [draft.descriptor.stageId] : []));
    previous.forEach(draft => this.revokeUrl(draft.previewUrl));
  }
}

/** Limits shared by staging helpers and the later rendered composer lane. */
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024;
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
