import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const project = { id: "p", path: "C:/p" }, panels = [], reveals = [], tabs = [], hosts = [], errors = [], listeners = new Set(), cleanups = [];
  let current = project;
  const fileStore = Object.assign(selector => selector({
    openProject: () => { const d = defer(); panels.push(d); return d.promise; },
    revealPath: () => { const d = defer(); reveals.push(d); return d.promise; },
  }), { getState: () => ({ project: current }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } });
  const deps = {
    react: { useCallback: fn => fn, useRef: current => ({ current }), useEffect: fn => cleanups.push(fn()) },
    sonner: { toast: { error: (...args) => errors.push(args) } },
    "../../../../shared/i18n/index": { useI18n: () => ({ t: key => key }) },
    "../../../files/api/fileExplorerStore": { useFileExplorerStore: fileStore },
    "../../api/gitDiffWorkspaceStore": { createGitDiffWorkspaceContext: p => ({ key: p.path }), useGitDiffWorkspaceStore: selector => selector({ openTab: (...args) => tabs.push(args) }) },
    "../../../../shared/preferences/settingsStore": { useSettingsStore: selector => selector({ gitDiffOpenMode: "editor", update: async () => {} }) },
    "../../../terminal/state": { useTerminalStore: selector => selector({ openFileEditorPane: (...args) => hosts.push(args) }) },
    "../../../terminal/api/terminalProject": { isSameProjectFileContext: (a, b) => a?.id === b?.id && a?.path === b?.path },
  };
  const source = readFileSync(new URL("../src/features/git/components/diff/useGitDiffOpenWorkflow.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`)(name => { assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  const actions = module.exports.useGitDiffOpenWorkflow({ project, projectPath: project.path, repositoryPath: project.path, changes: [{ path: "a", status: "M", added: 1, deleted: 0 }] });
  return { actions, project, panels, reveals, tabs, hosts, errors,
    switch: p => { current = p; for (const fn of listeners) fn({ project: p }); },
    cleanup: () => cleanups.forEach(fn => fn?.()),
  };
}
const target = { filePath: "a", sourcePath: "a", fileName: "a", status: "M" };
test("pinned diff rejects root departure and return before openProject completion", async () => {
  const f = fixture(), pending = f.actions.pinDiff(target);
  f.switch({ ...f.project, path: "C:/other" }); f.switch(f.project);
  f.panels[0].resolve(); assert.equal(await pending, false);
  assert.equal(f.tabs.length, 0); assert.equal(f.hosts.length, 0);
});
test("newer source open supersedes pinned diff, then opens captured host beside", async () => {
  const f = fixture(), old = f.actions.pinDiff(target), pending = f.actions.openSourcePath("a", "M", 3);
  f.panels[0].resolve(); assert.equal(await old, false);
  f.panels[1].resolve(); await tick(); f.reveals[0].resolve(true);
  assert.equal(await pending, true); assert.equal(f.tabs.length, 0);
  assert.deepEqual(f.hosts, [[f.project, "beside"]]);
});
test("source reveal context departure or unmount suppresses stale success and errors", async () => {
  for (const unmount of [false, true]) {
    const f = fixture(), pending = f.actions.openSourcePath("a", "M");
    f.panels[0].resolve(); await tick();
    if (unmount) f.cleanup(); else f.switch({ ...f.project, path: "C:/other" });
    f.reveals[0].reject(new Error("old"));
    assert.equal(await pending, false); assert.equal(f.hosts.length, 0); assert.equal(f.errors.length, 0);
  }
});
