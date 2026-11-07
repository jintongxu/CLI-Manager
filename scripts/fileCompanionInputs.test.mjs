import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const project = { id: "one", path: "C:/one" };
  let state = { project, activeFilePath: "a.md" }, cleanup;
  const listeners = new Set(), events = new Map(), panels = [], reveals = [], opens = [], errors = [];
  const store = { getState: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const dependencies = {
    react: { useEffect: fn => { cleanup = fn(); } },
    "../../workspace/api/primarySpaceState": { showProjectSpace() {} },
    sonner: { toast: { error: (...args) => errors.push(args) } },
    "../../../shared/platform/logger": { logError() {} },
    "../api/terminalProject": {
      resolveProjectForSessionFileContext: () => project,
      isSameProjectFileContext: (a, b) => a?.id === b?.id && a?.path === b?.path,
    },
    "../../files/api/fileExplorerStore": { useFileExplorerStore: store },
    "../lib/terminalFileNavigation": { TERMINAL_FILE_NAVIGATION_REQUEST_EVENT: "navigate" },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(read("src/features/terminal/hooks/useTerminalFileNavigation.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { window: {
    addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key),
  } })(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  module.exports.useTerminalFileNavigation({
    openFileEditorPane: (...args) => opens.push(args),
    openFilesPanelForProject: () => { const d = deferred(); panels.push(d); return d.promise; },
    revealFilePath: (...args) => { const d = deferred(); reveals.push({ ...d, args }); return d.promise; },
    projectById: new Map(), projects: [project], sessions: [], sshHosts: [], worktrees: [], t: key => key,
  });
  return { project, panels, reveals, opens, errors,
    navigate: (path = "a.md", kind = "file") => events.get("navigate")({ detail: { sessionId: "s", path, kind, lineNumber: 4, columnNumber: 2 } }),
    update: patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); },
    cleanup: () => cleanup(),
  };
}
test("terminal reveal opens captured project beside without changing main selection", async () => {
  const f = harness(); f.navigate(); f.panels[0].resolve(true); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(f.reveals[0].args)), ["a.md", { lineNumber: 4, columnNumber: 2 }]);
  f.reveals[0].resolve(true); await settle();
  assert.deepEqual(f.opens, [[f.project, "beside"]]);
});
test("newer terminal request fences old panel completion", async () => {
  const f = harness(); f.navigate(); f.navigate("b.md");
  f.panels[0].resolve(true); await settle(); assert.equal(f.reveals.length, 0);
  f.panels[1].resolve(true); await settle(); f.update({ activeFilePath: "b.md" });
  f.reveals[0].resolve(true); await settle(); assert.equal(f.opens.length, 1);
});
test("same-id root departure and return cannot reopen a late terminal reveal", async () => {
  const f = harness(); f.navigate(); f.panels[0].resolve(true); await settle();
  f.update({ project: { ...f.project, path: "C:/other" } }); f.update({ project: f.project });
  f.reveals[0].resolve(true); await settle(); assert.equal(f.opens.length, 0);
});
test("unmount and rejected panel requests are fenced and handled", async () => {
  const f = harness(); f.navigate(); f.panels[0].reject(new Error("failure")); await settle(); assert.equal(f.errors.length, 1);
  f.navigate(); f.cleanup(); f.panels[1].resolve(true); await settle(); assert.equal(f.reveals.length, 0);
});
test("tree and tab inputs use preview, pending-safe pin and explicit same-host modes", () => {
  const sidebar = read("src/features/files/api/FileExplorerSidebar.tsx");
  const tabs = read("src/features/files/components/FileEditorTabs.tsx");
  assert.match(sidebar, /openFile\(entry, \{ intent: "preview" \}\)/);
  assert.match(sidebar, /onOpenFile\(entry, "current"\)/);
  assert.match(sidebar, /onOpenFile\(entry, "beside"\)/);
  assert.match(sidebar, /pinFile\(displayEntry.path\)/);
  assert.doesNotMatch(sidebar, /dispatchTerminalSessionTarget/);
  assert.match(tabs, /onDoubleClick=\{\(\) => pinFile\(file.path\)\}/);
  assert.match(tabs, /file.isPreview \? " italic"/);
  for (const language of ["en-US", "zh-CN"]) {
    const dictionary = read(`src/shared/i18n/messages/files.${language}.ts`);
    assert.match(dictionary, /"files.menu.openCurrent":/); assert.match(dictionary, /"files.menu.openBeside":/);
  }
});
