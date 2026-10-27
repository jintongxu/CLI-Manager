import type { BtwMessage } from "../lib/btwThreadModel";

export function btwQuestions(messages: BtwMessage[]) {
  return messages.flatMap((message, index) => message.role === "user"
    ? [{ index, snippet: message.content.replace(/\s+/g, " ").trim().slice(0, 96) }] : []);
}

// 只写入当前会话滚动容器；禁止 scrollIntoView 带动 portal 或窗口。
export function jumpToBtwQuestion(scroller: HTMLElement, index: number): boolean {
  const target = scroller.querySelector<HTMLElement>(`[data-btw-question="${index}"]`);
  if (!target) return false;
  const top = scroller.scrollTop + target.getBoundingClientRect().top
    - scroller.getBoundingClientRect().top - scroller.clientTop - 16;
  scroller.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  target.focus({ preventScroll: true });
  return true;
}

// 用容器内坐标决定当前问题；答案再长也归属最近的前置提问。
export function activeBtwQuestion(scroller: HTMLElement): number | null {
  const targets = Array.from(scroller.querySelectorAll<HTMLElement>("[data-btw-question]"));
  const threshold = scroller.getBoundingClientRect().top + scroller.clientTop + 32;
  let active = targets[0];
  for (const target of targets) {
    if (target.getBoundingClientRect().top > threshold) break;
    active = target;
  }
  return active ? Number(active.dataset.btwQuestion) : null;
}
