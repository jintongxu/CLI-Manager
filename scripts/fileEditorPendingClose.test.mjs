import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual controller callbacks with deterministic hooks and deferred I/O.
function harness() {
  const slots = []; let cursor = 0; let effects = []; let result;
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn, deps) { const i = cursor++; const previous = slots[i]; if (!previous || deps.some((dep, n) => dep !== previous.deps[n])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) {
      const i = cursor++; const previous = slots[i];
      if (!previous || !deps || deps.some((dep, n) => dep !== previous.deps?.[n])) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const project = { id: "p", path: "C:/p" };
  const file = (path) => ({ path, name: path, content: "dirty", savedContent: "old", previewKind: "text" });
  const listeners = new Set(); const writes = []; const closed = []; let paneClosed = 0;
  let state = { project, openFiles: [file("A"), file("B")], activeFilePath: "A", activeFile: file("A"), gitChanges: [],
    closeFile(path) { closed.push(path); set({ openFiles: state.openFiles.filter((f) => f.path !== path) }); },
    saveFile(path) { return new Promise((resolve, reject) => writes.push({ path, resolve() {
      set({ openFiles: state.openFiles.map((f) => f.path === path ? { ...f, savedContent: f.content } : f) }); resolve();
    }, reject })); },
  };
  function set(patch) { const previous = state; state = { ...state, ...patch }; for (const listener of listeners) listener(state, previous); }
  const store = Object.assign((selector) => selector(state), { getState: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
  const noop = () => {};
  const dependencies = {
    react: hooks,
    "../api/fileExplorerStore": { useFileExplorerStore: store },
    "../../../shared/i18n/index": { useI18n: () => ({ language: "en-US", t: (key) => key }) },
    "../../../shared/preferences/settingsStore": { useSettingsStore: (fn) => fn({ keyboardShortcuts: {} }) },
    "../../projects/api/projectStore": { useProjectStore: (fn) => fn({ projects: [project] }) },
    "../../terminal/api/terminalProject": { isSameProjectFileContext: (a, b) => a?.id === b?.id && a?.path === b?.path },
    "../../git/api/gitDiffWorkspaceStore": { createGitDiffWorkspaceContext: (p) => ({ key: p.path }), EMPTY_GIT_DIFF_WORKSPACE: { tabs: [], activeId: null }, resolveGitDiffProject: (p) => p, useGitDiffWorkspaceStore: (fn) => fn({ workspaces: {} }) },
    "../../../shared/platform/monacoSetup": { configureMonaco: noop, configureMonacoLocale: noop, languageFromPath: () => "text" },
    "../components/useGitFileDecorations": { useGitFileDecorations: noop },
    "../components/useFileEditorSearchNavigation": { useFileEditorSearchNavigation: noop },
    "../components/useFileEditorShortcuts": { useFileEditorShortcuts: noop },
    "../lib/fileEditorTheme": { getFileEditorTheme: noop },
    "./useFileEditorMarkdownNavigation": { useFileEditorMarkdownNavigation: () => ({}) },
  };
  const source = readFileSync(new URL("../src/features/files/hooks/useFileEditorController.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { window: { addEventListener: noop, removeEventListener: noop } })((name) => dependencies[name] ?? {}, module, module.exports);
  let props = { session: { fileEditor: { project } }, isActive: true, companion: true, onClose: () => paneClosed++ };
  function render() { cursor = 0; result = module.exports.useFileEditorController(props); const pending = effects; effects = []; pending.forEach((fn) => fn()); return result; }
  render();
  return {
    render, writes, closed, get paneClosed() { return paneClosed; }, get state() { return state; },
    begin() { render().requestCloseFiles(["A", "B"]); return render().saveAndRun(); },
    edit(path) { set({ openFiles: state.openFiles.map((f) => f.path === path ? { ...f, content: "new edit" } : f) }); },
    switchContext() { const next = { id: "q", path: "C:/q" }; set({ project: next }); props = { ...props, session: { fileEditor: { project: next } } }; render(); },
    replaceTargets() { set({ openFiles: [] }); set({ openFiles: [file("A"), file("B")] }); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const cancel of ["cancel", "dismiss", "replacement", "context", "unmount", "reopen"]) {
  test(`in-flight A/B save cannot close after ${cancel}`, async () => {
    const h = harness(); const operation = h.begin();
    assert.equal(h.render().pendingSaveBusy, true);
    h.writes[0].resolve(); await tick(); assert.equal(h.writes[1].path, "B");
    if (cancel === "context") h.switchContext();
    else if (cancel === "unmount") h.unmount();
    else if (cancel === "reopen") h.replaceTargets();
    else if (cancel === "replacement") h.render().requestCloseFiles(["B"]);
    else h.render().setPendingAction(null);
    h.edit("A"); h.writes[1].resolve(); await operation;
    assert.deepEqual(h.closed, []); assert.equal(h.paneClosed, 0);
  });
}
test("editing earlier A during deferred B keeps every tab and confirmation", async () => {
  const h = harness(); const operation = h.begin();
  h.writes[0].resolve(); await tick(); h.edit("A"); h.writes[1].resolve(); await operation;
  assert.deepEqual(h.closed, []); assert.equal(h.state.openFiles[0].content, "new edit");
  assert.ok(h.render().pendingAction); assert.equal(h.render().pendingSaveBusy, false);
});
test("per-file save failure retains dialog and buffers and permits retry", async () => {
  const h = harness(); const operation = h.begin();
  h.writes[0].resolve(); await tick(); h.writes[1].reject(new Error("write failed")); await operation;
  assert.deepEqual(h.closed, []); assert.equal(h.state.openFiles.length, 2);
  assert.ok(h.render().pendingAction); assert.equal(h.render().pendingSaveBusy, false);
  const retry = h.render().saveAndRun(); h.writes[2].resolve(); await tick(); h.writes[3].resolve(); await retry;
  assert.deepEqual(h.closed, ["A", "B"]);
});
test("duplicate Save and Discard are inert while busy but Cancel remains effective", async () => {
  const h = harness(); const operation = h.begin();
  await h.render().saveAndRun(); h.render().discardAndRun();
  assert.equal(h.writes.length, 1); assert.deepEqual(h.closed, []);
  h.render().setPendingAction(null); h.writes[0].resolve(); await operation;
  assert.deepEqual(h.closed, []); assert.equal(h.render().pendingSaveBusy, false);
});
test("successful batch closes only after both saves", async () => {
  const h = harness(); const operation = h.begin();
  h.writes[0].resolve(); await tick(); assert.deepEqual(h.closed, []);
  h.writes[1].resolve(); await operation;
  assert.deepEqual(h.closed, ["A", "B"]); assert.equal(h.paneClosed, 1);
});

test("rendered portal marker, busy controls, Cancel and dismissal call the real invalidator", async () => {
  const source = readFileSync(new URL("../src/features/files/components/FileEditorPaneView.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const ui = { Button: "Button", Dialog: "Dialog", DialogContent: "DialogContent", DialogFooter: "DialogFooter", DialogTitle: "DialogTitle", DialogDescription: "DialogDescription", FileEditorContent: "FileEditorContent", FileEditorHeader: "FileEditorHeader", FileEditorTabs: "FileEditorTabs" };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`)((name) => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : ui, module, module.exports);
  for (const dismiss of [false, true]) {
    const h = harness(); const operation = h.begin();
    const tree = module.exports.FileEditorPaneView(h.render());
    const nodes = []; const walk = (node) => { if (!node || typeof node !== "object") return; nodes.push(node); const children = node.props?.children; (Array.isArray(children) ? children : [children]).forEach(walk); }; walk(tree);
    const content = nodes.find((node) => node.type === "DialogContent");
    assert.equal(content.props["data-file-editor-dialog"], true);
    assert.equal(content.props["aria-busy"], true);
    const buttons = nodes.filter((node) => node.type === "Button");
    assert.equal(buttons[0].props.disabled, undefined);
    assert.equal(buttons[1].props.disabled, true); assert.equal(buttons[2].props.disabled, true);
    if (dismiss) nodes.find((node) => node.type === "Dialog").props.onOpenChange(false);
    else buttons[0].props.onClick();
    h.writes[0].resolve(); await operation;
    assert.deepEqual(h.closed, []); assert.equal(h.render().pendingAction, null);
  }
});
