// 全局 xterm 写调度器的选帧纯函数：回车后首帧优先，否则沿用可见 burst 让位隐藏的公平规则。
// 放在 lib 以便定向单测直接覆盖，不依赖 React/xterm 运行时。

export interface SchedulableTerminalWrite {
  token: symbol;
  sessionId: string;
  isVisible: () => boolean;
}

// 选择下一次刷出的终端：带有效交互标记的可见终端优先；
// 否则可见终端连续 burstLimit 批后让位隐藏终端一次。
export function selectScheduledTerminalWrite<T extends SchedulableTerminalWrite>(
  entries: T[],
  visibleBurst: number,
  burstLimit: number,
  hasInteractivePriority: (sessionId: string) => boolean,
): T | undefined {
  const interactive = entries.find(
    (entry) => entry.isVisible() && hasInteractivePriority(entry.sessionId),
  );
  if (interactive) return interactive;
  const visible = entries.find((entry) => entry.isVisible());
  const hidden = entries.find((entry) => !entry.isVisible());
  return visible && (!hidden || visibleBurst < burstLimit)
    ? visible
    : hidden ?? visible;
}

// 自适应写封顶：连续 congestedThreshold 个周期队列非空即判定拥塞，
// 单次写上限从 baseLimit 放宽到 reliefLimit（仍按完整帧边界）；队列排空回落。
export function selectWriteBatchLimit(
  congestedCycles: number,
  congestedThreshold: number,
  baseLimitBytes: number,
  reliefLimitBytes: number,
): number {
  return congestedCycles >= congestedThreshold ? reliefLimitBytes : baseLimitBytes;
}
