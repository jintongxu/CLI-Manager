import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// 真实执行 runner（含 zustand store），mock 外部边界：
// terminal state / processManager / worktreeStore / toast / i18n / shell。
function loadRunner(overrides = {}) {
  const code = ts.transpileModule(readFileSync("src/features/projects/api/worktreeDepsRunner.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = { created: [], closed: [], toasts: [], dismissed: [], checks: 0, subscribes: [] };
  let statusListener = null;
  const deps = {
    shell: { normalizeShellKey: (value) => value },
    i18n: { translateCurrent: (key, params) => `${key}${params ? JSON.stringify(params) : ""}` },
    logger: { logInfo: () => {}, logWarn: () => {} },
    sonner: {
      toast: Object.assign(
        (...args) => { calls.toasts.push(["toast", ...args]); return "id"; },
        {
          loading: (...args) => { calls.toasts.push(["loading", ...args]); return "id"; },
          success: (...args) => { calls.toasts.push(["success", ...args]); return "id"; },
          error: (...args) => { calls.toasts.push(["error", ...args]); return "id"; },
          info: (...args) => { calls.toasts.push(["info", ...args]); return "id"; },
          dismiss: (...args) => { calls.dismissed.push(args); return "id"; },
        },
      ),
    },
    processManager: {
      terminalProcessManager: {
        subscribeStatus: async (sessionId, listener) => {
          calls.subscribes.push(sessionId);
          statusListener = listener;
          return () => {};
        },
        subscribeOutput: async (sessionId, listener) => {
          calls.subscribes.push(`output:${sessionId}`);
          if (overrides.emitOutput) overrides.emitOutput(listener);
          return () => {};
        },
      },
    },
    terminalState: {
      useTerminalStore: Object.assign(
        () => { throw new Error("hook call not supported in test"); },
        {
          getState: () => ({
            createSession: async (...args) => {
              calls.created.push(args);
              if (overrides.createImpl) return overrides.createImpl(...args);
              return "session-1";
            },
            closeSession: async (...args) => { calls.closed.push(args); },
            subscribe: () => () => {},
          }),
          setState: () => {},
          subscribe: () => () => {},
        },
      ),
    },
    metadata: { getWorktreeDisplayName: (worktree) => worktree.display_name || worktree.name },
    worktreeStore: {
      useWorktreeStore: {
        getState: () => ({
          checkDeps: async (worktree) => {
            calls.checks += 1;
            if (overrides.checkImpl) return overrides.checkImpl(worktree);
            return { needsInstall: true, command: "npm install", reason: null };
          },
          dismissDepsPrompt: async () => {},
        }),
      },
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, console, setTimeout, clearTimeout,
    require: (name) => {
      if (name === "zustand") return { create: (...args) => {
        const makeStore = (init) => {
          let s = {};
          const set = (u) => {
            const next = typeof u === "function" ? u({ tasks: s.tasks }) : u;
            if (next && typeof next === "object") s = { ...s, ...next };
          };
          const get = () => ({ tasks: s.tasks });
          s = { ...init(set, get) };
          const hook = (selector) => selector(s);
          hook.getState = () => s;
          hook.setState = (u) => set(u);
          return hook;
        };
        // zustand v5 柯里化：create<T>()(init)
        if (args.length === 0 || typeof args[0] !== "function") return (init) => makeStore(init);
        return makeStore(args[0]);
      } };
      if (name === "sonner") return deps.sonner;
      if (name.endsWith("/shared/platform/shell")) return deps.shell;
      if (name.endsWith("/shared/i18n/index")) return deps.i18n;
      if (name.endsWith("/shared/platform/logger")) return deps.logger;
      if (name.endsWith("/terminal/api/TerminalProcessManager")) return deps.processManager;
      if (name.endsWith("/terminal/state")) return deps.terminalState;
      if (name.endsWith("/worktreeMetadata")) return deps.metadata;
      if (name.endsWith("/worktreeStore")) return deps.worktreeStore;
      throw new Error(`unexpected dependency ${name}`);
    },
  });
  return {
    calls,
    store: exports.useWorktreeDepsRunnerStore,
    build: exports.buildDepsInstallCommand,
    emitStatus: (payload) => statusListener?.(payload),
    project: { id: "p", name: "Project", worktree_deps_prompt_enabled: 1 },
    worktree: { id: "w", project_id: "p", name: "one", display_name: "Task One", path: "D:/tasks/one", status: "active", deps_prompt_dismissed: 0 },
    launch: (shell) => ({ projectId: "p", envVars: {}, shell }),
  };
}

test("buildDepsInstallCommand covers the shell matrix", () => {
  const { build } = loadRunner();
  assert.equal(typeof build, "function");
  const cases = [
    ["powershell", "npm install; exit $LASTEXITCODE"],
    ["pwsh", "npm install; exit $LASTEXITCODE"],
    ["cmd", "npm install && exit 0 || exit 1"],
    ["bash", "npm install; exit $?"],
    ["gitbash", "npm install; exit $?"],
    ["wsl", "npm install; exit $?"],
    ["sh", "npm install; exit $?"],
    ["zsh", "npm install; exit $?"],
    ["fish", "npm install; exit $status"],
    [undefined, "npm install; exit $?"],
  ];
  for (const [shell, expected] of cases) {
    assert.equal(build("npm install", shell), expected, `shell=${shell}`);
  }
});

test("start writes a chained transient-background session", async () => {
  const h = loadRunner();
  const result = await h.store.getState().start(h.project, h.worktree, h.launch("powershell"), "manual");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { started: true });
  assert.equal(h.calls.created.length, 1);
  const args = h.calls.created[0];
  assert.equal(args[1], "D:/tasks/one");
  assert.equal(args[3], "npm install; exit $LASTEXITCODE");
  assert.equal(args[7], "w");
  assert.equal(args[12]?.transientBackground, true);
  assert.equal(args[12]?.oneShot, true);
  assert.equal(args[6], undefined); // 无 pane 归属：不挂 pane 树，无 XTerm 挂载
});

test("auto start respects switch and dismissed flag; same worktree is single-flight", async () => {
  const h = loadRunner();
  const api = () => h.store.getState();
  const snap = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(
    snap(await api().start({ ...h.project, worktree_deps_prompt_enabled: 0 }, h.worktree, h.launch("bash"), "auto")),
    { started: false, reason: "disabled" },
  );
  assert.deepEqual(
    snap(await api().start(h.project, { ...h.worktree, deps_prompt_dismissed: 1 }, h.launch("bash"), "auto")),
    { started: false, reason: "dismissed" },
  );
  assert.deepEqual(
    snap(await api().start(h.project, { ...h.worktree, status: "missing" }, h.launch("bash"), "auto")),
    { started: false, reason: "missing" },
  );
  assert.equal((await api().start(h.project, h.worktree, h.launch("bash"), "auto")).started, true);
  assert.deepEqual(
    snap(await api().start(h.project, h.worktree, h.launch("bash"), "auto")),
    { started: false, reason: "running" },
  );
  assert.equal(h.calls.created.length, 1);
});

test("manual start reports notNeeded without creating a session", async () => {
  const h = loadRunner({ checkImpl: () => ({ needsInstall: false, command: null, reason: null }) });
  const result = await h.store.getState().start(h.project, h.worktree, h.launch("bash"), "manual");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { started: false, reason: "notNeeded" });
  assert.equal(h.calls.created.length, 0);
  assert.ok(h.calls.toasts.some(([kind, message]) => kind === "info" && String(message).includes("worktree.deps.notNeeded")));
});

test("successful exit closes the hidden session and toasts done", async () => {
  const h = loadRunner();
  await h.store.getState().start(h.project, h.worktree, h.launch("bash"), "manual");
  await h.emitStatus({ status: "exited", exit_code: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.calls.toasts.some(([kind, message]) => kind === "success" && String(message).includes("worktree.deps.done")));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.closed)), [["session-1", true]]);
});

test("failed exit toasts with retry and recycles the session; retry restarts", async () => {
  const h = loadRunner();
  await h.store.getState().start(h.project, h.worktree, h.launch("bash"), "manual");
  await h.emitStatus({ status: "exited", exit_code: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  const failed = h.calls.toasts.find(([kind]) => kind === "error");
  assert.ok(failed && String(failed[1]).includes("worktree.deps.failed"));
  assert.ok(String(failed[1]).includes("exit 1"));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.closed)), [["session-1", true]]);
  await failed[2].action.onClick();
  for (let i = 0; i < 50 && h.calls.created.length < 2; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(h.calls.created.length, 2);
});

test("null exit code is treated as failure with unknown status", async () => {
  const h = loadRunner();
  await h.store.getState().start(h.project, h.worktree, h.launch("bash"), "manual");
  await h.emitStatus({ status: "exited", exit_code: null });
  await new Promise((resolve) => setImmediate(resolve));
  const failed = h.calls.toasts.find(([kind]) => kind === "error");
  assert.ok(failed && String(failed[1]).includes("unknownStatus"));
});

test("start subscribes output and acks frames to avoid daemon flow control", async () => {
  let outputListener = null;
  const committed = [];
  const h = loadRunner({ emitOutput: (listener) => { outputListener = listener; } });
  await h.store.getState().start(h.project, h.worktree, h.launch("bash"), "manual");
  assert.ok(h.calls.subscribes.includes("output:session-1"));
  assert.equal(typeof outputListener, "function");
  outputListener({ frame: { data: new Uint8Array([104, 105]) }, commit: (n) => committed.push(n) });
  assert.deepEqual(committed, [2]);
});

test("cancel closes the session and clears the task", async () => {
  const h = loadRunner();
  const api = () => h.store.getState();
  await api().start(h.project, h.worktree, h.launch("bash"), "manual");
  await api().cancel("w");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.closed)), [["session-1", true]]);
  assert.deepEqual(JSON.parse(JSON.stringify(api().tasks)), {});
  assert.equal((await api().start(h.project, h.worktree, h.launch("bash"), "manual")).started, true);
});

test("completion and cancellation share one session close", async () => {
  const h = loadRunner();
  const api = () => h.store.getState();
  await api().start(h.project, h.worktree, h.launch("bash"), "manual");
  const completion = h.emitStatus({ status: "exited", exit_code: 0 });
  await api().cancel("w");
  await completion;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.closed)), [["session-1", true]]);
});
