export function shouldExpirePtyHostHeartbeat(
  lastPongAt: number,
  now: number,
  timeoutMs: number,
  heartbeatSuspended: boolean,
): boolean {
  return !heartbeatSuspended && now - lastPongAt > timeoutMs;
}
