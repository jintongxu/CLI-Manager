// 回车→首帧渲染延迟诊断：记录「回车提交 → 首帧到达 → 首帧渲染提交」三段时间。
// 只统计回车后的首个 live 帧（replay/reset 不计），按 session 保留最近 50 次样本，
// 每 30s 随 runtimeDiagnostics 快照输出 P50/P95/max，不逐次打日志。

const MAX_SAMPLES = 50;

export interface TerminalLatencySample {
  // 回车提交到首帧到达（daemon 聚合 + 传输 + 队列）。
  enterToFirstFrameMs: number;
  // 首帧到达后排队到开始写入 xterm。
  firstFrameQueuedMs: number;
  // xterm.write 到回调（渲染提交）。
  writeCommittedMs: number;
}

export interface TerminalLatencyStats {
  count: number;
  enterToFirstFrameMs: { p50: number; p95: number; max: number };
  firstFrameQueuedMs: { p50: number; p95: number; max: number };
  writeCommittedMs: { p50: number; p95: number; max: number };
}

interface PendingEnter {
  enterAt: number;
  firstFrameAt: number | null;
  flushStartAt: number | null;
}

const pendingEnters = new Map<string, PendingEnter>();
const samples = new Map<string, TerminalLatencySample[]>();

// 回车提交时调用（useTerminalInput 转发 "\r" 处）。只保留最近一次回车。
export function noteTerminalEnter(sessionId: string, now: number): void {
  pendingEnters.set(sessionId, { enterAt: now, firstFrameAt: null, flushStartAt: null });
}

// 首个 live 帧到达队列时调用。返回是否命中了一次待统计的回车。
export function noteTerminalFirstFrame(sessionId: string, now: number): boolean {
  const pending = pendingEnters.get(sessionId);
  if (!pending || pending.firstFrameAt !== null) return false;
  pending.firstFrameAt = now;
  return true;
}

// 首帧开始写入 xterm 时调用（flush 取出首帧时）。
export function noteTerminalFlushStart(sessionId: string, now: number): void {
  const pending = pendingEnters.get(sessionId);
  if (!pending || pending.firstFrameAt === null || pending.flushStartAt !== null) return;
  pending.flushStartAt = now;
}

// 首帧写回调（渲染提交）时调用，生成样本并清除待统计状态。
export function noteTerminalWriteCommitted(sessionId: string, now: number): void {
  const pending = pendingEnters.get(sessionId);
  if (!pending || pending.firstFrameAt === null || pending.flushStartAt === null) return;
  pendingEnters.delete(sessionId);
  const list = samples.get(sessionId) ?? [];
  list.push({
    enterToFirstFrameMs: pending.firstFrameAt - pending.enterAt,
    firstFrameQueuedMs: pending.flushStartAt - pending.firstFrameAt,
    writeCommittedMs: now - pending.flushStartAt,
  });
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
  samples.set(sessionId, list);
}

// 会话关闭时清理，避免 Map 无限增长。
export function clearTerminalLatency(sessionId: string): void {
  pendingEnters.delete(sessionId);
  samples.delete(sessionId);
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
}

function summarize(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
  };
}

// 供 runtimeDiagnostics 快照调用：各 session 最近 50 次的三段时间分布。
export function terminalLatencySnapshot(): Record<string, TerminalLatencyStats> {
  const result: Record<string, TerminalLatencyStats> = {};
  for (const [sessionId, list] of samples) {
    if (list.length === 0) continue;
    result[sessionId] = {
      count: list.length,
      enterToFirstFrameMs: summarize(list.map((sample) => sample.enterToFirstFrameMs)),
      firstFrameQueuedMs: summarize(list.map((sample) => sample.firstFrameQueuedMs)),
      writeCommittedMs: summarize(list.map((sample) => sample.writeCommittedMs)),
    };
  }
  return result;
}
