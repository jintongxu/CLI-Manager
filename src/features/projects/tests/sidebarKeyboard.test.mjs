import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ts from "typescript";

// Execute the production callback, not a regex approximation or a copied keyboard implementation.
const path = new URL("../components/ProjectTree.tsx", import.meta.url);
const file = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handleTreeKeyDown") callback = node.initializer.arguments[0].getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(callback);
const handler = ts.transpileModule(`const handler = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("native Chromium key events bubble from focused pin/ideas controls without opening/selecting rows; row navigation and IME survive", { timeout: 30000 }, async () => {
  const executable = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const profile = mkdtempSync(join(tmpdir(), "sidebar-keyboard-"));
  const chrome = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Chromium debugging startup timed out")), 12000);
      chrome.on("error", reject);
      chrome.stderr.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const origin = endpoint.replace(/^ws:/, "http:").split("/devtools/")[0];
    const targets = await (await fetch(`${origin}/json/list`)).json();
    ws = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
      const response = JSON.parse(data);
      if (!response.id) return;
      const { resolve, reject } = pending.get(response.id);
      pending.delete(response.id);
      response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await evaluate(`
      document.body.innerHTML = '<div id="tree"><div id="row" role="treeitem" tabindex="0" data-tree-key="p:a"><span id="label">Repo</span><button id="pin">Pin</button><button id="ideas"><span id="icon">Ideas</span></button><span id="custom" role="button" tabindex="0">Custom</span><input id="input"><span id="editable" contenteditable="true"><span id="editor-child">Edit</span></span></div></div>';
      var calls = { open: 0, select: 0, pin: 0, ideas: 0, focus: 0, search: 0 };
      var actions = { onOpenProject: () => calls.open++, onSelectProjectByKeyboard: () => calls.select++ };
      var visibleNodes = [{key:'p:a',kind:'project',projectId:'a'}, {key:'p:b',kind:'project',projectId:'b'}];
      var focusedNodeKey = 'p:a', visibleNodeIndex = new Map([['p:a',0],['p:b',1]]), projectById = new Map([['a',{type:'project',project:{id:'a'}}]]);
      var searchActive = false, searchOpen = false, searchQuery = '', openSearch = () => calls.search++, closeSearch = () => {}, focusTreeItem = () => calls.focus++;
      var isProjectSearchKey = key => /^[a-z0-9._/-]$/i.test(key);
      ${handler}
      document.querySelector('#tree').addEventListener('keydown', event => { Object.defineProperty(event, 'nativeEvent', { value: event }); handler(event); });
      for (const name of ['pin','ideas']) document.getElementById(name).addEventListener('click', e => { e.stopPropagation(); calls[name]++; });
    `);
    const press = async (key, code, vk) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(key === " " ? { text: " " } : key === "Enter" ? { text: String.fromCharCode(13) } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    };
    for (const name of ["pin", "ideas"]) {
      await evaluate(`document.getElementById('${name}').focus()`);
      await press("Enter", "Enter", 13);
      await press(" ", "Space", 32);
      assert.equal(await evaluate(`calls.${name}`), 2);
    }
    assert.deepEqual(await evaluate("[calls.open,calls.select,calls.search]"), [0, 0, 0]);
    for (const id of ["custom", "input", "editable"]) {
      await evaluate(`document.getElementById('${id}').focus()`);
      await press("Enter", "Enter", 13); await press(" ", "Space", 32); await press("ArrowDown", "ArrowDown", 40);
    }
    // Inner icon target must not leak activation either.
    await evaluate(`document.getElementById('icon').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`);
    assert.deepEqual(await evaluate("[calls.open,calls.select,calls.focus]"), [0, 0, 0]);
    await evaluate("document.getElementById('row').focus()");
    await press("Enter", "Enter", 13); await press(" ", "Space", 32); await press("ArrowDown", "ArrowDown", 40);
    assert.deepEqual(await evaluate("[calls.open,calls.select,calls.focus]"), [1, 1, 1]);
    await evaluate(`document.getElementById('row').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})); document.getElementById('row').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate("calls.open"), 1);
  } finally {
    ws?.close(); chrome.kill();
    await new Promise((resolve) => chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve));
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
