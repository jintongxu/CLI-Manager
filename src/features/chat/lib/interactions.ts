export function shouldSubmit(event: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }, composing: boolean) {
  return event.key === "Enter" && !event.shiftKey && !composing && !event.isComposing && event.keyCode !== 229;
}
export function isFollowing(element: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}
export function chatTime(timestamp: number, language: string) {
  return new Intl.DateTimeFormat(language, {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(timestamp);
}
export async function activateChatLink(href: string, open: (url: string) => Promise<void>) {
  let url: URL;
  try { url = new URL(href); } catch { throw "chat_link"; }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw "chat_link";
  try { await open(url.href); } catch { throw "chat_link"; }
}
export async function copyChatText(text: string, write: (text: string) => Promise<void>) {
  try { await write(text); } catch { throw "chat_copy"; }
}
