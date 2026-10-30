import type { BtwReaderState } from "./btwThreadModel";

export interface BtwScrollGeometry { scrollTop: number; scrollHeight: number; clientHeight: number }
/** Content changes never infer intent from the new (longer) document geometry. */
export function btwContentChanged(reader: BtwReaderState, content: string): BtwReaderState {
  return { ...reader, content, unread: reader.following ? false : reader.unread || content !== reader.content };
}
export function btwReaderScrolled(reader: BtwReaderState, geometry: BtwScrollGeometry): BtwReaderState {
  const following = geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop <= 8;
  return { ...reader, scrollTop: geometry.scrollTop, following, unread: following ? false : reader.unread };
}
export function btwResumeFollowing(reader: BtwReaderState): BtwReaderState {
  return { ...reader, following: true, unread: false };
}
export function btwScrollTarget(reader: BtwReaderState, geometry: BtwScrollGeometry): number {
  return reader.following ? Math.max(0, geometry.scrollHeight - geometry.clientHeight) : reader.scrollTop;
}
