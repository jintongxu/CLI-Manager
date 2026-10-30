import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports });
  return exports;
};
const { BtwThreadModel } = load("src/features/terminal/lib/btwThreadModel.ts");
const tick = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };

function harness({ contextAvailable = true, autoResolve = true } = {}) {
  const requests = [], cancels = [];
  const model = new BtwThreadModel({
    context: async () => ({ available: contextAvailable, text: "source snapshot", truncated: false, reason: contextAvailable ? null : "source_unreadable" }),
    ask: (request) => autoResolve ? Promise.resolve("answer") : new Promise((resolve) => requests.push({ request, resolve })),
    cancel: async (id) => { cancels.push(id); }, listen: async () => () => {},
  });
  const stage = (quote = "quote") => model.stage(quote, { terminalId: "term-1", sessionId: "sess-1", reason: null });
  return { model, requests, cancels, stage };
}

test("submit returns the created thread id so a drawer can bind locally", async () => {
  const { model, stage } = harness();
  stage();
  model.setQuestion("why did this fail?");
  const created = model.submit();
  assert.equal(typeof created, "string");
  const entries = model.getSnapshot().entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, created);
  await tick();
  assert.equal(model.getSnapshot().entries[0].status, "done");
});

test("historical selection restores owner transcript and draft without native reveal", async () => {
  const { model, stage } = harness();
  stage(); model.setQuestion("historical question");
  const threadId = model.submitEmbedded(); await tick();
  model.setDraft(threadId, "saved followup");
  stage("new quote");
  const before = model.getSnapshot().openVersion;
  model.selectEmbedded(threadId);
  const state = model.getSnapshot();
  assert.equal(state.embeddedId, threadId);
  assert.equal(state.entries.find((thread) => thread.id === threadId).draft, "saved followup");
  assert.equal(state.entries.find((thread) => thread.id === threadId).messages[1].content, "answer");
  assert.equal(state.openId, null); assert.equal(state.openVersion, before);
  model.open(threadId);
  assert.equal(model.getSnapshot().openVersion, before + 1);
});

test("submit returns null for an empty question so the drawer keeps its composer open", () => {
  const { model, stage } = harness();
  stage();
  assert.equal(model.submit(), null);
  model.setQuestion("   ");
  assert.equal(model.submit(), null);
  assert.equal(model.getSnapshot().entries.length, 0);
});

test("drawer binds a local thread id and never triggers a standalone-window reveal", () => {
  const drawer = read("src/features/terminal/components/BtwTerminalDrawer.tsx");
  // model.open() bumps openVersion, which useBtwNativeWindow publishes as a reveal.
  assert.doesNotMatch(drawer, /model\.open\(/);
  assert.doesNotMatch(drawer, /controller\.open\(/);
  assert.match(drawer, /state\.embeddedId/);
  assert.match(drawer, /model\.submitEmbedded\(\)/);
  assert.doesNotMatch(drawer, /createPortal/);
});

test("drawer keeps streaming answers without stealing focus and supports follow-up, stop and copy", () => {
  const drawer = read("src/features/terminal/components/BtwTerminalDrawer.tsx");
  assert.match(drawer, /state\.quote/);
  assert.match(drawer, /data-btw-drawer-staged/);
  assert.match(drawer, /if \(!thread && !collapsed\) inputRef\.current\?\.focus\(\)/);
  assert.match(drawer, /model\.setDraft\(thread\.id, question\);[\s\S]*?model\.send\(thread\.id\)/);
  assert.match(drawer, /model\.stop\(thread\.id\)/);
  assert.match(drawer, /copyTextToClipboard\(btwThreadText\(thread\)\)/);
  assert.match(drawer, /event\.key !== "Enter" \|\| event\.shiftKey/);
  assert.match(drawer, /event\.key !== "Escape"[\s\S]*?setCollapsed\(true\)/);
  // Collapsed state must keep the thread so streaming continues off-screen.
  assert.match(drawer, /\{collapsed \? null : \(/);
});

test("pane is a right split that stays mounted when Git temporarily hides it", () => {
  const view = read("src/features/terminal/components/TerminalTabsView.tsx");
  const css = read("src/features/terminal/components/btwTerminalDrawer.css");
  const controller = read("src/features/terminal/hooks/useTerminalTabsController.tsx");
  assert.match(view, /btwDrawerOpen \? \([\s\S]*?display: gitWorkspaceOpen \? "none" : "flex"/);
  assert.match(css, /\.btw-terminal-split \{ display: flex/);
  assert.match(css, /cursor: col-resize/);
  assert.doesNotMatch(css, /bottom: 0/);
  assert.match(css, /overflow-wrap: anywhere/);
  const askBtw = controller.slice(controller.indexOf("onAskBtw:"), controller.indexOf("onDuplicateSession:"));
  assert.match(askBtw, /setBtwDrawerOpen\(true\)/);
  // The side panel tab keeps its own pre-existing staging path.
  assert.match(controller, /onBtwOpen: \(\) => btwSideQuestion\.stageFromTerminal\(""\)/);
});

test("real browser fixture defines the standalone drawer layout without custom dependencies", () => {
  const fixture = read("scripts/fixtures/btwTerminalDrawer.tsx");
  const server = read("scripts/btwDrawerFixture.server.mjs");
  assert.match(fixture, /BtwTerminalDrawer/);
  assert.match(fixture, /BtwThreadModel/);
  assert.match(server, /createServer/);
  assert.match(server, /BTW_DRAWER_FIXTURE/);
});

test("pane uses the exact terminal preview renderer, not generic Markdown", () => {
  const drawer = read("src/features/terminal/components/BtwTerminalDrawer.tsx");
  assert.match(drawer, /useTerminalPreviewTheme\(\)/);
  assert.equal((drawer.match(/<SessionTranscriptContent/g) ?? []).length, 2);
  assert.equal((drawer.match(/variant="terminal"/g) ?? []).length, 2);
  assert.equal((drawer.match(/terminalCodeTheme=\{terminalCodeTheme\}/g) ?? []).length, 2);
  assert.equal((drawer.match(/markdownClassName="subagent-transcript-markdown"/g) ?? []).length, 2);
  assert.doesNotMatch(drawer, /<MarkdownContent/);
});

test("embedded selection survives subscriber detach/remount and follow-up draft stays in owner", async () => {
  const { model, stage } = harness();
  stage(); model.setQuestion("first");
  const id = model.submitEmbedded(); await tick();
  const detach = model.subscribe(() => {});
  model.setDraft(id, "unfinished followup"); detach();
  const detachAgain = model.subscribe(() => {});
  assert.equal(model.getSnapshot().embeddedId, id);
  assert.equal(model.getSnapshot().entries[0].draft, "unfinished followup");
  assert.equal(model.getSnapshot().openVersion, 0);
  assert.equal(model.getSnapshot().openId, null);
  detachAgain(); model.dispose();
});

test("new staging clears embedded binding even for identical quote/source, without stopping old inference", async () => {
  const { model, stage, requests } = harness({ autoResolve: false });
  stage(); model.setQuestion("old question"); const old = model.submitEmbedded(); await tick();
  const version = model.getSnapshot().stageVersion;
  stage();
  assert.equal(model.getSnapshot().embeddedId, null);
  assert.equal(model.getSnapshot().stageVersion, version + 1);
  assert.equal(model.getSnapshot().question, "");
  assert.equal(model.getSnapshot().entries[0].status, "pending");
  model.setQuestion("new question"); const fresh = model.submitEmbedded(); await tick();
  requests[0].resolve("old answer"); await tick();
  assert.equal(model.getSnapshot().embeddedId, fresh);
  assert.notEqual(old, fresh);
  assert.equal(model.getSnapshot().openVersion, 0);
  model.remove(fresh); assert.equal(model.getSnapshot().embeddedId, null);
  model.clear(); assert.equal(model.getSnapshot().embeddedId, null);
  model.dispose();
});

test("inheritance is visible opt-in, unavailable sources cannot enable it, and no transcript is fetched while staging", async () => {
  let contexts = 0; const asks = [];
  const model = new BtwThreadModel({
    context: async () => { contexts++; return { available: true, text: "snapshot", truncated: false, reason: null }; },
    ask: async (request) => { asks.push(request); return "answer"; },
    cancel: async () => {}, listen: async () => () => {},
  });
  for (const source of [
    { terminalId: null, sessionId: null, reason: "no_source_session" },
    { terminalId: "remote", sessionId: "remote-pi", reason: "remote_source" },
  ]) {
    model.stage("quote", source); model.setInherit(true);
    assert.equal(model.getSnapshot().inherit, false);
    model.setQuestion("independent"); model.submitEmbedded(); await tick();
    assert.equal(asks.at(-1).context, "");
  }
  model.stage("quote", { terminalId: "local", sessionId: "exact", reason: null });
  assert.equal(model.getSnapshot().inherit, false);
  model.setInherit(true); assert.equal(contexts, 0);
  model.setQuestion("inherited"); model.submitEmbedded(); await tick();
  assert.equal(contexts, 1); assert.equal(asks.at(-1).context, "snapshot");
  const drawer = read("src/features/terminal/components/BtwTerminalDrawer.tsx");
  assert.match(drawer, /type="checkbox" checked=\{state.inherit\}/);
  assert.match(drawer, /model\.setInherit\(event.target.checked\)/);
  model.dispose();
});

test("stop during inherited context acquisition fences late snapshot and retry sends exactly once", async () => {
  const snapshots = []; const asks = []; const cancels = [];
  const model = new BtwThreadModel({
    context: () => new Promise((resolve) => snapshots.push(resolve)),
    ask: async (request) => { asks.push(request); return "answer"; },
    cancel: async (id) => { cancels.push(id); }, listen: async () => () => {},
  });
  model.stage("quote", { terminalId: "local", sessionId: "exact", reason: null });
  model.setInherit(true); model.setQuestion("why"); const id = model.submitEmbedded();
  model.stop(id);
  assert.equal(model.getSnapshot().entries[0].status, "stopped");
  snapshots[0]({ available: true, text: "late", truncated: false, reason: null }); await tick();
  assert.equal(asks.length, 0); assert.ok(cancels.length);
  model.send(id, true);
  snapshots[1]({ available: true, text: "fresh", truncated: false, reason: null }); await tick();
  assert.equal(asks.length, 1); assert.equal(asks[0].context, "fresh");
  assert.equal(asks[0].messages.length, 1);
  model.dispose();
});

test("mounted pane lifecycle switches from completed thread to fresh stage and remounts same live turn", async () => {
  const { model, stage, requests } = harness({ autoResolve: false });
  let hooks = [], cursor = 0, effects = [];
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const exports = {};
  const code = ts.transpileModule(read("src/features/terminal/components/BtwTerminalDrawer.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useState: (initial) => { const i = cursor++; if (!(i in hooks)) hooks[i] = initial;
        return [hooks[i], (value) => { hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
      useRef: (initial) => { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
      useEffect: (effect, deps) => { const i = cursor++; const previous = hooks[i];
        if (!previous || deps.some((dep, index) => dep !== previous[index])) effects.push(effect); hooks[i] = deps; },
    };
    if (name.endsWith("/i18n/index")) return { useI18n: () => ({ t: (key) => key }) };
    if (name.endsWith("/useTerminalPreviewTheme")) return { useTerminalPreviewTheme: () => ({ tone: "dark", panelStyle: {} }) };
    if (name.endsWith("/button")) return { Button: "button" };
    if (name.endsWith("/btwBottomFollow")) return load("src/features/terminal/lib/btwBottomFollow.ts");
    if (name.endsWith("/btwThreadModel")) return { btwThreadText: () => "text" };
    return {};
  } });
  let tree;
  const scroller = { scrollTop: 0, scrollHeight: 800, clientHeight: 200, children: [] };
  const render = () => { cursor = 0; effects = [];
    tree = exports.BtwTerminalDrawer({ controller: { model, state: model.getSnapshot() }, onClose: () => {} });
    const transcript = nodes(tree).find((node) => node.props.className === "btw-drawer-transcript");
    if (transcript) transcript.props.ref.current = scroller;
    effects.forEach((effect) => effect()); return tree; };
  const nodes = (node) => !node || typeof node !== "object" ? []
    : Array.isArray(node) ? node.flatMap((child) => nodes(child)) : [node, ...nodes(node.props?.children)];
  const find = (predicate) => nodes(tree).find(predicate);
  stage(); model.setQuestion("first"); render();
  find((node) => node.props["data-btw-drawer-action"] === "submit").props.onClick(); await tick(); render();
  const first = model.getSnapshot().embeddedId;
  assert.equal(find((node) => node.type === "textarea").props.value, "");
  assert.equal(scroller.scrollTop, 600);
  scroller.scrollTop = 40;
  find((node) => node.props.className === "btw-drawer-transcript").props.onScroll({ currentTarget: scroller });
  requests[0].resolve("completed with final chunk"); await tick(); render(); render();
  assert.equal(scroller.scrollTop, 40);
  find((node) => node.props["data-btw-drawer-action"] === "latest").props.onClick(); render();
  assert.equal(scroller.scrollTop, 600);
  assert.equal(find((node) => node.props["data-btw-drawer-action"] === "latest"), undefined);
  find((node) => node.props["data-btw-drawer-action"] === "toggle").props.onClick(); render();
  assert.equal(tree.props["data-collapsed"], "true");
  stage("fresh quote"); render(); render();
  assert.equal(tree.props["data-collapsed"], "false");
  assert.ok(find((node) => node.props["data-btw-drawer-staged"] === "true"));
  assert.equal(model.getSnapshot().entries.find((thread) => thread.id === first).answer, "completed with final chunk");
  model.setQuestion("second"); render();
  find((node) => node.props["data-btw-drawer-action"] === "submit").props.onClick(); await tick(); render();
  const second = model.getSnapshot().embeddedId;
  find((node) => node.type === "textarea").props.onChange({ target: { value: "saved draft" } });
  // A real unmount discards hook state, but selection and draft must remain owner state.
  hooks = []; render();
  assert.equal(model.getSnapshot().embeddedId, second);
  assert.equal(find((node) => node.type === "textarea").props.value, "saved draft");
  assert.equal(model.getSnapshot().openVersion, 0);
  model.dispose();
});

test("history search cannot evict or replace the embedded thread with an older repository copy", async () => {
  let rows = [];
  const model = new BtwThreadModel({ context: async () => ({}), ask: async () => "answer",
    cancel: async () => {}, listen: async () => () => {},
  }, { list: async () => rows, save: async () => {}, remove: async () => {} });
  model.stage("quote", { terminalId: "term", sessionId: "pi", reason: null });
  model.setQuestion("question"); const id = model.submitEmbedded(); await tick();
  const live = model.getSnapshot().entries[0];
  rows = [{ ...live, messages: [], answer: "outdated" }];
  await model.loadHistory();
  assert.equal(model.getSnapshot().entries[0], live);
  rows = []; await model.loadHistory("no match");
  assert.equal(model.getSnapshot().embeddedId, id);
  assert.equal(model.getSnapshot().entries[0], live);
  model.dispose();
});

test("drawer copy ships in both languages", () => {
  const zh = read("src/shared/i18n/messages/terminal.zh-CN.ts");
  const en = read("src/shared/i18n/messages/terminal.en-US.ts");
  for (const key of ["drawerHint", "drawerPlaceholder", "drawerFollowUp", "drawerCollapse", "drawerExpand",
    "drawerClose", "drawerResize", "drawerStop", "drawerRetry", "drawerQuote"]) {
    assert.match(zh, new RegExp(`"terminal\\.btw\\.${key}": "`));
    assert.match(en, new RegExp(`"terminal\\.btw\\.${key}": "`));
  }
});

test("terminal A/B restore blank staged drafts, selected threads, collapse and reader memory independently", async () => {
  const { model } = harness();
  const a = { terminalId: "A", sessionId: "source-A", reason: null };
  model.stage("quote A", a); model.setQuestion("draft A"); model.setInherit(true); model.setCollapsed(true);
  model.stage("quote B", { terminalId: "B", sessionId: "source-B", reason: null });
  model.setQuestion(""); model.setDrawerOpen(false);
  model.activateTerminal("A");
  assert.equal(model.getSnapshot().question, "draft A"); assert.equal(model.getSnapshot().source.sessionId, "source-A");
  assert.equal(model.getSnapshot().collapsed, true); assert.equal(model.getSnapshot().inherit, true);
  model.setInherit(false); const id = model.submitEmbedded(); await tick();
  model.setDraft(id, ""); model.setReader(id, { scrollTop: 85, following: false, content: "read", unread: false });
  model.activateTerminal("B"); assert.equal(model.getSnapshot().question, ""); assert.equal(model.getSnapshot().drawerOpen, false);
  model.setQuestion("B unsent"); model.activateTerminal("A");
  assert.equal(model.getSnapshot().embeddedId, id); assert.equal(model.getSnapshot().entries.find((t) => t.id === id).draft, "");
  assert.equal(model.getReader(id).scrollTop, 85);
  model.stage("new A", a); assert.equal(model.getSnapshot().embeddedId, null); assert.equal(model.getSnapshot().collapsed, false);
  model.activateTerminal("B"); assert.equal(model.getSnapshot().question, "B unsent");
  model.reconcileTerminals(["A"]); model.activateTerminal("B");
  assert.equal(model.getSnapshot().question, ""); assert.equal(model.getSnapshot().drawerOpen, false);
  model.dispose();
});

test("hidden terminal streams and completes without replacing another terminal or losing saved live history", async () => {
  let event; let finish; let request;
  const model = new BtwThreadModel({ context: async () => ({}), cancel: async () => {},
    listen: async (callback) => { event = callback; return () => {}; },
    ask: (value) => { request = value; return new Promise((resolve) => { finish = resolve; }); },
  }, { list: async () => [], save: async () => {}, remove: async () => {} });
  model.stage("A", { terminalId: "A", sessionId: "exact-A", reason: null }); model.setQuestion("ask A");
  const id = model.submitEmbedded(); await tick(); model.setDraft(id, "A followup");
  model.stage("B", { terminalId: "B", sessionId: "exact-B", reason: null }); model.setQuestion("B initial");
  event({ requestId: request.requestId, threadId: id, text: "hidden chunk" });
  finish("final chunk"); await tick(); await model.loadHistory("absent", false, "B");
  assert.equal(model.getSnapshot().question, "B initial"); assert.equal(model.getSnapshot().embeddedId, null);
  model.activateTerminal("A");
  assert.equal(model.getSnapshot().embeddedId, id); assert.equal(model.getSnapshot().entries.find((t) => t.id === id).answer, "final chunk");
  assert.equal(model.getSnapshot().entries.find((t) => t.id === id).draft, "A followup");
  event({ requestId: request.requestId, threadId: id, text: "late" });
  assert.equal(model.getSnapshot().entries.find((t) => t.id === id).answer, "final chunk");
  assert.equal(model.getSnapshot().openVersion, 0); model.dispose();
});

test("bottom follow is explicit across chunks, final completion, hidden updates, remount and latest click", () => {
  const { btwContentChanged, btwReaderScrolled, btwResumeFollowing, btwScrollTarget } = load("src/features/terminal/lib/btwBottomFollow.ts");
  let reader = { scrollTop: 400, following: true, content: "one", unread: false };
  const geometry = { scrollTop: 400, scrollHeight: 600, clientHeight: 200 };
  reader = btwContentChanged(reader, "two"); assert.equal(btwScrollTarget(reader, { ...geometry, scrollHeight: 800 }), 600);
  reader = btwReaderScrolled(reader, { ...geometry, scrollTop: 60 });
  reader = btwContentChanged(reader, "three"); assert.equal(reader.unread, true); assert.equal(btwScrollTarget(reader, geometry), 60);
  reader = btwContentChanged(reader, "final completion only chunk"); assert.equal(btwScrollTarget(reader, geometry), 60);
  const saved = { ...reader }; reader = btwContentChanged(saved, "hidden content"); assert.equal(reader.following, false);
  assert.equal(btwScrollTarget(reader, geometry), 60);
  reader = btwResumeFollowing(reader); assert.equal(reader.unread, false); assert.equal(btwScrollTarget(reader, geometry), 400);
  reader = btwReaderScrolled(reader, geometry); assert.equal(reader.following, true);
  reader = btwContentChanged(reader, "next chunk"); assert.equal(reader.unread, false);
});

test("manual history opening starts at top without forcing latest, repeated opening preserves reader", async () => {
  const { model, stage } = harness(); stage(); model.setQuestion("history"); const id = model.submitEmbedded(); await tick();
  model.selectEmbedded(id); assert.equal(model.getReader(id).following, false); assert.equal(model.getReader(id).scrollTop, 0);
  model.setReader(id, { ...model.getReader(id), scrollTop: 123 });
  model.selectEmbedded(id); assert.equal(model.getReader(id).scrollTop, 123);
  const drawer = read("src/features/terminal/components/BtwTerminalDrawer.tsx");
  assert.match(drawer, /data-btw-drawer-action="latest"/); assert.match(drawer, /onScroll=/);
  for (const locale of ["zh-CN", "en-US"]) assert.match(read(`src/shared/i18n/messages/terminal.${locale}.ts`), /"terminal.btw.newContent":/);
  model.dispose();
});
