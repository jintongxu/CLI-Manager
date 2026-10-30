export type NativeExitSource = "window" | "tray" | "menu" | "native" | "quit";
export interface ExitResource {
  kind: string; resourceId: string; ownership: "exclusive" | "shared" | "unknown";
  status: string; evidence: string | null; errorCode: string | null; retryable: boolean;
}
export interface ExitReceipt {
  protocolVersion: 1; transactionId: string; instanceId: string; generation: number;
  phase: "preparing" | "prepared" | "stopping" | "blocked" | "ready" | "committed";
  canExit: boolean; metadataSaved: boolean; workerRunning: boolean;
  resources: ExitResource[]; daemon: { epoch: string | null; status: string };
  errors: { resourceId: string; code: string }[];
}
export interface ExitView {
  phase: "saving" | "stopping" | "blocked" | null;
  receipt: ExitReceipt | null;
  error: string | null;
}
interface Dependencies {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  pause: () => Promise<void>;
  save: () => Promise<void>;
  resume: () => void;
  show: () => Promise<void>;
  changed: (view: ExitView) => void;
  wait: () => Promise<void>;
}

/** Native owns admission and termination. This controller only orders metadata and commands. */
export function createExitTransaction(deps: Dependencies) {
  let receipt: ExitReceipt | null = null;
  let busy = false;
  let saved = false;
  let cleanupStarted = false;
  let source: NativeExitSource = "window";
  function publish(phase: ExitView["phase"], error: string | null = null) {
    deps.changed({ phase, receipt, error });
  }
  function accept(next: ExitReceipt) {
    if (next.protocolVersion !== 1 || !next.transactionId || (receipt && (
      next.transactionId !== receipt.transactionId || next.generation !== receipt.generation
      || next.instanceId !== receipt.instanceId
    ))) throw new Error("exit_transaction_stale");
    receipt = next;
    return next;
  }
  async function status() {
    return accept(await deps.invoke<ExitReceipt>("app_exit_status", { transactionId: receipt!.transactionId }));
  }
  async function run(nextSource: NativeExitSource = source) {
    if (busy) return;
    busy = true;
    source = nextSource;
    try {
      await deps.show();
      publish(saved ? "stopping" : "saving");
      if (!receipt) accept(await deps.invoke<ExitReceipt>("app_exit_prepare", { source }));
      else await status();
      if (!saved) {
        if (receipt!.phase !== "prepared") throw new Error("exit_not_prepared");
        try {
          await deps.pause();
          await deps.save();
          saved = true;
        } catch (error) {
          await deps.invoke("app_exit_abort", { transactionId: receipt!.transactionId });
          receipt = null;
          deps.resume();
          throw error;
        }
      }
      publish("stopping");
      if (!receipt!.workerRunning && receipt!.phase !== "ready") {
        cleanupStarted = true;
        accept(await deps.invoke<ExitReceipt>("app_exit_cleanup", {
          transactionId: receipt!.transactionId, metadataSaved: true,
        }));
      }
      while (receipt!.workerRunning) {
        if (receipt!.phase === "blocked") throw new Error("exit_worker_timeout_retained");
        await deps.wait();
        await status();
      }
      if (receipt!.phase !== "ready" || !receipt!.canExit || !receipt!.metadataSaved) {
        throw new Error("exit_cleanup_blocked");
      }
      await deps.invoke("app_exit_commit", { transactionId: receipt!.transactionId });
    } catch (error) {
      publish("blocked", String(error));
      await deps.show().catch(() => {});
    } finally { busy = false; }
  }
  async function resume() {
    if (busy) return;
    busy = true;
    try {
      if (receipt) {
        await status();
        await deps.invoke(cleanupStarted ? "app_exit_resume" : "app_exit_abort", {
          transactionId: receipt!.transactionId,
        });
      }
      receipt = null;
      saved = false;
      cleanupStarted = false;
      deps.resume();
      publish(null);
    } catch (error) { publish("blocked", String(error)); }
    finally { busy = false; }
  }
  return { run, retry: () => run(), resume, isActive: () => busy || receipt !== null };
}
