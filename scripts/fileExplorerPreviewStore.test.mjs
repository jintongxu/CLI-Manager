import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as operations from "../src/features/files/lib/fileExplorerOperations.ts";
import { isFileExplorerIgnoreCaseInsensitive } from "../src/features/files/lib/fileExplorerIgnore.ts";
import { loadFilePreviewModules } from "./helpers/filePreviewModules.mjs";
const { terminalProject: { isSameProjectFileContext, isSameProjectFileLocation }, previewHelpers } = loadFilePreviewModules();

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/files/api/fileExplorerStore.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const project = (id = "one") => ({ id, name: id, path: `E:\\${id}`, environment_type: "local", remote_path: "", ssh_host_id: null });
const entry = (path, kind = "file") => ({ path, name: path.split("/").pop(), kind, sizeBytes: 4, modifiedMs: 1 });
const buffer = (path, dirty = false) => ({ ...entry(path), content: dirty ? "edited" : "disk", savedContent: "disk", previewKind: "text" });

function harness(customInvoke, remoteRead) {
  const calls = [];
  const warnings = [];
  let store;
  const dependencies = {
    "zustand": require("zustand"),
    "../../terminal/api/backgroundOperationStore": { useBackgroundOperationStore: { getState: () => ({ updateProgress() {} }) } },
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (customInvoke) {
        const result = await customInvoke(command, args, store);
        if (result !== undefined) return result;
      }
      if (command === "file_list_dir" || command === "git_get_changes") return [];
      if (command === "file_read_project_text") return { content: "disk", encoding: "utf-8", hasBom: false, sizeBytes: 4 };
      return null;
    } },
    "sonner": { toast: { success() {}, error() {}, warning(...args) { warnings.push(args); } } },
    "../../../shared/platform/logger": { logError() {}, recordCrashActivity() {} },
    "../../../shared/i18n/index": { translateCurrent: (key) => key },
    "../../terminal/api/terminalProject": { isSameProjectFileLocation, isSameProjectFileContext },
    "../../projects/api/projectCapabilities": { projectSupportsCapability: () => true },
    "../lib/fileExplorerIgnore": { isFileExplorerIgnoreCaseInsensitive },
    "../lib/fileExplorerOperations": operations,
    "../lib/fileEditorPreview": previewHelpers,
    "../../git/api/gitDiffWorkspaceStore": { activateProjectFileSurface() {} },
    "../../remote/api/sshRemoteFiles": {
      buildSshRemoteFileContext: async (p) => ({ project: p, launch: { hostId: p.ssh_host_id }, consumerId: p.remote_path }),
      releaseSshRemoteFileContext: async () => {},
      sshRemoteListDir: async () => [],
      sshRemoteReadFile: remoteRead,
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function(require, module, exports) { ${compiled}\n})`, { setTimeout, clearTimeout, console, Set, Map })(
    (name) => {
      assert.ok(name in dependencies, `unexpected dependency: ${name}`);
      return dependencies[name];
    }, module, module.exports,
  );
  store = module.exports.useFileExplorerStore;
  store.setState({ project: project() });
  return { store, calls, warnings, mutations: () => calls.filter((call) => ["file_delete", "file_copy", "file_move", "file_import_external", "file_import_image"].includes(call.command)) };
}

const preview = { intent: "preview" };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const text = (content = "disk") => ({ content, encoding: "utf-8", hasBom: false, sizeBytes: 4 });
const paths = (h) => h.store.getState().openFiles.map((file) => file.path);

test("one clean preview is reused; legacy opens remain pinned and never demote", async () => {
  const h = harness();
  const s = () => h.store.getState();
  await s().openFile(entry("legacy"));
  await s().openFile(entry("a"), preview);
  await s().openFile(entry("b"), preview);
  assert.deepEqual([...paths(h)], ["legacy", "b"]);
  await s().openFile(entry("legacy"), preview);
  assert.equal(s().activeFile.isPreview, false);
  assert.equal(s().openFiles.filter((file) => file.isPreview).length, 1);
  s().pinFile("b");
  await s().openFile(entry("c"), preview);
  assert.deepEqual([...paths(h)], ["legacy", "b", "c"]);
});

test("first edit pins atomically and dirty preview is never discarded", async () => {
  const h = harness();
  const s = () => h.store.getState();
  await s().openFile(entry("a"), preview);
  const observed = [];
  const unsubscribe = h.store.subscribe((state) => observed.push(state.activeFile));
  s().setActiveContent("draft");
  unsubscribe();
  assert.ok(observed.every((file) => file.content !== "draft" || file.isPreview === false));
  await s().openFile(entry("b"), preview);
  assert.equal(s().openFiles[0].content, "draft");
  h.store.setState({ openFiles: s().openFiles.map((file) => ({ ...file, isPreview: file.path === "a" })) });
  await s().openFile(entry("c"), preview);
  assert.equal(s().openFiles[0].content, "draft");
  assert.equal(s().openFiles.filter((file) => file.isPreview).length, 1);
});

test("slow old preview and stale failure cannot replace newer selection or loading", async () => {
  for (const fail of [false, true]) {
    const old = deferred(), newer = deferred();
    const h = harness((command, args) => command === "file_read_project_text"
      ? (args.relativePath === "a" ? old.promise : newer.promise) : undefined);
    const first = h.store.getState().openFile(entry("a"), preview);
    const second = h.store.getState().openFile(entry("b"), preview);
    fail ? old.reject(new Error("failed")) : old.resolve(text());
    await first;
    assert.equal(h.store.getState().loading, true);
    assert.equal(h.warnings.length, 0);
    newer.resolve(text());
    await second;
    assert.deepEqual([...paths(h)], ["b"]);
    assert.equal(h.store.getState().activeFilePath, "b");
  }
});

test("pin during pending read wins; repeated preview cannot undo double-click pin", async () => {
  const old = deferred(), newer = deferred();
  let reads = 0;
  const h = harness((command) => command === "file_read_project_text" ? (++reads === 1 ? old.promise : newer.promise) : undefined);
  const first = h.store.getState().openFile(entry("a"), preview);
  h.store.getState().pinFile("a");
  const second = h.store.getState().openFile(entry("a"), preview);
  newer.resolve(text("new"));
  await second;
  old.resolve(text("old"));
  await first;
  assert.equal(h.store.getState().activeFile.content, "new");
  assert.equal(h.store.getState().activeFile.isPreview, false);
});

test("pin or manual selection supersedes a different pending preview", async () => {
  for (const action of ["pinFile", "setActiveFilePath"]) {
    const pending = deferred();
    const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "b" ? pending.promise : undefined);
    await h.store.getState().openFile(entry("a"), preview);
    const reading = h.store.getState().openFile(entry("b"), preview);
    h.store.getState()[action]("a");
    pending.resolve(text());
    await reading;
    assert.deepEqual([...paths(h)], ["a"]);
    assert.equal(h.store.getState().activeFilePath, "a");
  }
});

test("context switch and return invalidates old previews; buffers and preview identity park", async () => {
  for (const target of [
    { ...project(), path: "E:/worktree" },
    { ...project(), environment_type: "wsl", path: "//wsl$/Ubuntu/home/Repo" },
    { ...project(), environment_type: "ssh", ssh_host_id: "host", remote_path: "/repo" },
  ]) {
    const pending = deferred();
    const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "slow" ? pending.promise : undefined);
    const s = () => h.store.getState();
    await s().openFile(entry("draft"), preview);
    s().setActiveContent("unsaved");
    await s().openFile(entry("a"), preview);
    const reading = s().openFile(entry("slow"), preview);
    await s().openProject(target);
    await s().openProject(project());
    pending.resolve(text());
    await reading;
    assert.deepEqual([...paths(h)], ["draft", "a"]);
    assert.equal(s().openFiles[0].content, "unsaved");
    assert.equal(s().openFiles[1].isPreview, true);
    assert.equal(s().activeFilePath, "a");
  }
});

test("WSL case-sensitive roots and SSH host/root identities keep independent previews", async () => {
  const h = harness(undefined, async () => ({ previewKind: "text", content: "remote", sizeBytes: 6 }));
  for (const pair of [
    [{ ...project(), environment_type: "wsl", path: "//wsl$/Ubuntu/home/Repo" }, { ...project(), environment_type: "wsl", path: "//wsl$/Ubuntu/home/repo" }],
    [{ ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/repo" }, { ...project(), environment_type: "ssh", ssh_host_id: "two", remote_path: "/repo" }],
    [{ ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/Repo" }, { ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/repo" }],
  ]) {
    await h.store.getState().openProject(pair[0]);
    await h.store.getState().openFile(entry("first"), preview);
    await h.store.getState().openProject(pair[1]);
    await h.store.getState().openFile(entry("second"), preview);
    assert.deepEqual([...paths(h)], ["second"]);
    await h.store.getState().openProject(pair[0]);
    assert.deepEqual([...paths(h)], ["first"]);
  }
});

test("late pinned opens park without stealing focus; closes preserve normal fallback", async () => {
  const pending = deferred();
  const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "slow" ? pending.promise : undefined);
  const reading = h.store.getState().openFile(entry("slow"));
  await h.store.getState().openFile(entry("new"), preview);
  pending.resolve(text());
  await reading;
  assert.equal(h.store.getState().activeFilePath, "new");
  assert.equal(h.store.getState().openFiles.find((file) => file.path === "new").isPreview, true);
  h.store.getState().closeFile("new");
  assert.equal(h.store.getState().activeFilePath, "slow");
  h.store.getState().closeFile("slow");
  assert.equal(h.store.getState().activeFile, null);
});

test("save failure preserves pinned draft; late save preserves newer edits in parked workspace", async () => {
  const pending = deferred();
  let fail = true;
  const h = harness((command) => {
    if (command !== "file_write_project_text") return;
    if (fail) throw new Error("save failed");
    return pending.promise;
  });
  await h.store.getState().openFile(entry("a"), preview);
  h.store.getState().setActiveContent("draft");
  await assert.rejects(h.store.getState().saveFile("a"), /save failed/);
  assert.equal(h.store.getState().activeFile.content, "draft");
  assert.equal(h.store.getState().activeFile.isPreview, false);
  fail = false;
  const saving = h.store.getState().saveFile("a");
  h.store.getState().setActiveContent("newer draft");
  await h.store.getState().openProject({ ...project(), path: "E:/worktree" });
  await h.store.getState().openFile(entry("a"), preview);
  pending.resolve(null);
  await saving;
  assert.equal(h.store.getState().activeFile.content, "disk");
  await h.store.getState().openProject(project());
  assert.equal(h.store.getState().activeFile.content, "newer draft");
  assert.equal(h.store.getState().activeFile.savedContent, "draft\n");
});

test("slow SSH preview cannot cross host/root; absent remote context never reads local disk", async () => {
  const pending = deferred();
  const h = harness(undefined, async () => pending.promise);
  const one = { ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/repo" };
  const two = { ...one, ssh_host_id: "two", remote_path: "/Repo" };
  await h.store.getState().openProject(one);
  const reading = h.store.getState().openFile(entry("slow"), preview);
  await h.store.getState().openProject(two);
  pending.resolve({ previewKind: "text", content: "remote", sizeBytes: 6 });
  await reading;
  assert.deepEqual([...paths(h)], []);
  assert.equal(h.store.getState().project.ssh_host_id, "two");
  h.store.setState({ remoteFileContext: null });
  await h.store.getState().openFile(entry("missing"), preview);
  assert.equal(h.calls.filter((call) => call.command === "file_read_project_text").length, 0);
});

test("close cancels in-flight pinned read instead of resurrecting a closed tab", async () => {
  const pending = deferred();
  const h = harness((command) => command === "file_read_project_text" ? pending.promise : undefined);
  const reading = h.store.getState().openFile(entry("a"));
  h.store.getState().closeFile("a");
  pending.resolve(text());
  await reading;
  assert.deepEqual([...paths(h)], []);
  assert.equal(h.store.getState().loading, false);
});

test("refresh preserves clean preview replacement and concurrent pin/edit/close ownership", async () => {
  for (const action of ["none", "pin", "edit", "close"]) {
    const pending = deferred();
    let refreshing = false;
    const h = harness((command) => {
      if (command === "file_list_dir") return [{ ...entry("a"), modifiedMs: 2 }];
      if (command === "file_read_project_text" && refreshing) return pending.promise;
    });
    const s = () => h.store.getState();
    await s().openFile(entry("a"), preview);
    refreshing = true;
    const refresh = s().refreshVisibleState(["a"]);
    // Directory listing precedes the deferred content read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (action === "pin") s().pinFile("a");
    if (action === "edit") s().setActiveContent("draft");
    if (action === "close") s().closeFile("a");
    pending.resolve(text("refreshed"));
    await refresh;
    if (action === "close") assert.deepEqual([...paths(h)], []);
    else {
      assert.equal(s().activeFile.isPreview, action === "none");
      assert.equal(s().activeFile.content, action === "edit" ? "draft" : action === "pin" ? "disk" : "refreshed");
    }
    refreshing = false;
    await s().openFile(entry("b"), preview);
    assert.deepEqual([...paths(h)], action === "pin" || action === "edit" ? ["a", "b"] : ["b"]);
  }
});

test("editing A settles loading when it invalidates B preview or pinned read, success or failure", async () => {
  for (const intent of ["preview", "pinned"]) for (const fail of [false, true]) {
    const pending = deferred();
    const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "b" ? pending.promise : undefined);
    const s = () => h.store.getState();
    await s().openFile(entry("a"), preview);
    const reading = s().openFile(entry("b"), { intent });
    assert.equal(s().loading, true);
    s().setActiveContent("draft");
    assert.equal(s().loading, false);
    fail ? pending.reject(new Error("stale failure")) : pending.resolve(text());
    await reading;
    assert.equal(s().loading, false);
    assert.equal(s().activeFilePath, "a");
    assert.equal(s().activeFile.content, "draft");
    assert.equal(s().activeFile.isPreview, false);
    assert.deepEqual([...paths(h)], intent === "pinned" ? ["a", "b"] : ["a"]);
  }
});

test("closing another path or same path in another context never cancels durable open", async () => {
  for (const crossContext of [false, true]) {
    const pending = deferred();
    const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "a" ? pending.promise : undefined);
    const s = () => h.store.getState();
    await s().openFile(entry("b"));
    const reading = s().openFile(entry("a"));
    if (crossContext) await s().openProject({ ...project(), path: "E:/other" });
    s().closeFile(crossContext ? "a" : "b");
    pending.resolve(text());
    await reading;
    assert.equal(s().loading, false);
    if (crossContext) {
      assert.deepEqual([...paths(h)], []);
      await s().openProject(project());
    }
    assert.equal(s().openFiles.find((file) => file.path === "a").isPreview, false);
    assert.equal(s().activeFilePath, crossContext ? "b" : null);
  }
});

test("durable A pin survives intervening B and newer A preview in either completion order", async () => {
  for (const latePin of [false, true]) for (const park of [false, true]) {
    const old = deferred(), newer = deferred();
    let reads = 0;
    const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "a"
      ? (++reads === 1 ? old.promise : newer.promise) : undefined);
    const s = () => h.store.getState();
    const first = s().openFile(entry("a"));
    await s().openFile(entry("b"), preview);
    const second = s().openFile(entry("a"), preview);
    if (park) await s().openProject({ ...project(), path: "E:/other" });
    if (latePin) {
      newer.resolve(text("new")); await second;
      if (!park) s().setActiveContent("draft");
      old.resolve(text("old")); await first;
    } else {
      old.resolve(text("old")); await first;
      newer.resolve(text("new")); await second;
    }
    if (park) await s().openProject(project());
    const a = s().openFiles.find((file) => file.path === "a");
    assert.equal(a.isPreview, false);
    assert.equal(a.content, latePin ? park ? "new" : "draft" : "old");
    if (!park) assert.equal(s().activeFile.isPreview, false);
    await s().openFile(entry("c"), preview);
    assert.ok(paths(h).includes("a"));
  }
});

test("existing-path late pinned merge preserves a newer preview buffer and active pointer", async () => {
  const pending = deferred();
  let reads = 0;
  const h = harness((command, args) => command === "file_read_project_text" && args.relativePath === "a"
    ? (++reads === 1 ? pending.promise : text("new")) : undefined);
  const s = () => h.store.getState();
  const first = s().openFile(entry("a"));
  await s().openFile(entry("b"), preview);
  await s().openFile(entry("a"), preview);
  // Emulate an existing preview imported by a caller: arriving pinned intent must merge.
  const a = { ...s().activeFile, isPreview: true };
  h.store.setState({ openFiles: s().openFiles.map((file) => file.path === "a" ? a : file), activeFile: a });
  pending.resolve(text("old")); await first;
  assert.equal(s().activeFile.content, "new");
  assert.equal(s().activeFile.isPreview, false);
  assert.equal(s().activeFile, s().openFiles.find((file) => file.path === "a"));
});

test("closing same path resets durable pin but cancels only its old generation", async () => {
  const old = deferred(), newer = deferred();
  let reads = 0;
  const h = harness((command) => command === "file_read_project_text" ? (++reads === 1 ? old.promise : newer.promise) : undefined);
  const s = () => h.store.getState();
  const first = s().openFile(entry("a"));
  s().closeFile("a");
  const second = s().openFile(entry("a"), preview);
  old.resolve(text("old")); await first;
  assert.equal(s().loading, true);
  newer.resolve(text("new")); await second;
  assert.equal(s().activeFile.isPreview, true);
  assert.equal(s().activeFile.content, "new");
});

test("clearing another project does not cancel parked pinned reads", async () => {
  const pending = deferred();
  const h = harness((command) => command === "file_read_project_text" ? pending.promise : undefined);
  const s = () => h.store.getState();
  const reading = s().openFile(entry("a"));
  await s().openProject(project("two"));
  s().clearProjectEditorWorkspaces("two");
  pending.resolve(text()); await reading;
  await s().openProject(project());
  assert.equal(s().activeFile?.isPreview ?? s().openFiles[0]?.isPreview, false);
});

test("content search forwards explicit preview intent", async () => {
  const h = harness();
  await h.store.getState().openFileAtSearchMatch({ name: 'a', path: 'a', lineNumber: 2, lineText: 'match' }, preview);
  assert.equal(h.store.getState().activeFile.isPreview, true);
  assert.equal(h.store.getState().searchNavigationTarget.lineNumber, 2);
});

test("slow reveal traversal cannot open after a newer file click or context departure", async () => {
  const listing = deferred();
  const h = harness((command) => command === 'file_list_dir' ? listing.promise : undefined);
  const revealing = h.store.getState().revealPath('old');
  await h.store.getState().openFile(entry('new'), preview);
  listing.resolve([entry('old')]);
  assert.equal(await revealing, false);
  assert.equal(h.store.getState().activeFilePath, 'new');
});

test("newer reveal traversal supersedes the prior traversal before it can open", async () => {
  const first = deferred(), second = deferred(); let lists = 0;
  const h = harness(command => command === 'file_list_dir' ? (++lists === 1 ? first.promise : second.promise) : undefined);
  const older = h.store.getState().revealPath('old');
  const newer = h.store.getState().revealPath('new');
  second.resolve([entry('new')]);
  assert.equal(await newer, true);
  first.resolve([entry('old')]);
  assert.equal(await older, false);
  assert.equal(h.store.getState().activeFilePath, 'new');
});

test("pin intent is isolated by filesystem context, including WSL case and SSH host/root", async () => {
  for (const [one, two] of [
    [project(), { ...project(), path: "E:/other" }],
    [{ ...project(), environment_type: "wsl", path: "//wsl$/Ubuntu/home/Repo" },
      { ...project(), environment_type: "wsl", path: "//wsl$/Ubuntu/home/repo" }],
    [{ ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/repo" },
      { ...project(), environment_type: "ssh", ssh_host_id: "two", remote_path: "/repo" }],
    [{ ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/Repo" },
      { ...project(), environment_type: "ssh", ssh_host_id: "one", remote_path: "/repo" }],
  ]) {
    const pending = deferred();
    const h = harness((command, args) => command === "file_read_project_text" && args.rootPath === one.path && args.relativePath === "a"
      ? pending.promise : undefined, async (context) => context.project === one
      ? pending.promise : { previewKind: "text", content: "other", sizeBytes: 5 });
    const s = () => h.store.getState();
    await s().openProject(one);
    const reading = s().openFile(entry("a"));
    await s().openProject(two);
    await s().openFile(entry("a"), preview);
    assert.equal(s().activeFile.isPreview, true);
    pending.resolve(one.environment_type === "ssh" ? { previewKind: "text", content: "first", sizeBytes: 5 } : text("first"));
    await reading;
    assert.equal(s().activeFile.isPreview, true);
    await s().openFile(entry("b"), preview);
    assert.deepEqual([...paths(h)], ["b"]);
    await s().openProject(one);
    assert.equal(s().openFiles.find((file) => file.path === "a").isPreview, false);
  }
});

test("clearing the owning parked workspace cancels its pending pinned reads", async () => {
  const pending = deferred();
  const h = harness((command) => command === "file_read_project_text" ? pending.promise : undefined);
  const s = () => h.store.getState();
  const reading = s().openFile(entry("a"));
  await s().openProject(project("two"));
  s().clearProjectEditorWorkspaces("one");
  pending.resolve(text()); await reading;
  await s().openProject(project());
  assert.deepEqual([...paths(h)], []);
  assert.equal(s().loading, false);
});
