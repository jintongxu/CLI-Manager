/** Serializes automatic metadata writes and fences late process-exit callbacks. */
let paused = false;
let generation = 0;
let pending: Promise<void> = Promise.resolve();

export function sessionPersistencePaused(): boolean { return paused; }

export function queueSessionPersistence(write: () => Promise<void>): Promise<void> {
  if (paused) return Promise.resolve();
  const admittedGeneration = generation;
  const result = pending.then(async () => {
    if (admittedGeneration === generation) await write();
  });
  pending = result.catch(() => {});
  return result;
}

export async function pauseSessionPersistence(): Promise<void> {
  paused = true;
  await pending;
  generation += 1;
}

export function resumeSessionPersistence(): void {
  generation += 1;
  paused = false;
}
