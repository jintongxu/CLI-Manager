import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const catalogs = {
  "zh-CN": require("../src/shared/i18n/messages/terminal.zh-CN.ts").zh,
  "en-US": require("../src/shared/i18n/messages/terminal.en-US.ts").en,
};
function loader(language, reset = null, scrollElement = null, allHistory = false) {
  const cache = new Map();
  let resetState = reset;
  let stateIndex = 0;
  const missing = [];
  const t = (key) => { if (!catalogs[language][key]) missing.push(key); return catalogs[language][key] ?? key; };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/features/terminal/${file}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, require: (name) => {
      if (name === "react") return { ...React, useRef: () => ({ current: scrollElement }), useEffect: () => {}, useState: (initial) => { const index = stateIndex++; return initial === null ? [resetState, (next) => { resetState = next; }] : [index === 1 ? allHistory : initial, () => {}]; } };
      if (name.endsWith(".css")) return {};
      if (name === "./btwQuestionNavigation") return load("components/btwQuestionNavigation.ts");
      if (name.endsWith("shared/ui/MarkdownContent")) return { MarkdownContent: ({ content, linkBehavior }) => React.createElement("div", { "data-markdown": linkBehavior }, content) };
      if (name === "../state") return { useTerminalStore: (select) => select({ activeSessionId: "rightclicked-terminal" }) };
      if (name.endsWith("shared/ui/popover")) return Object.fromEntries(
        ["Popover", "PopoverTrigger", "PopoverContent"].map((key) => [key, ({ children }) => React.createElement("div", null, children)]));
      if (name === "react/jsx-runtime") return require(name);
      if (name.endsWith("shared/i18n/index")) return { useI18n: () => ({ t }) };
      if (name.endsWith("shared/ui/button")) return { Button: ({ size, variant, children, ...props }) => React.createElement("button", props, children) };
      if (name.endsWith("shared/ui/icons")) return { Check: "Check", Pencil: "Pencil", Pin: "Pin", X: "X" };
      if (name.endsWith("shared/ui/dialog")) return {
        Dialog: ({ open, children }) => open ? React.createElement("section", { role: "dialog" }, children) : null,
        DialogContent: ({ showCloseButton, ...props }) => React.createElement("div", props),
        DialogTitle: (props) => React.createElement("h2", props),
        DialogDescription: (props) => React.createElement("p", props),
      };
      if (name.endsWith("shared/platform/systemClipboard")) return { copyTextToClipboard: async () => {} };
      if (name === "./BtwPersistenceStatus") return load("components/BtwPersistenceStatus.tsx");
      if (name === "./BtwContextDetails") return load("components/BtwContextDetails.tsx");
      if (name === "../lib/btwThreadModel") return load("lib/btwThreadModel.ts");
      throw new Error(`Unexpected dependency ${name}`);
    } }); return exports;
  }
  return { load, missing };
}
const source = { terminalId: "rightclicked-terminal", sessionId: "pi-source", reason: null };
const context = { available: true, text: "snapshot", truncated: true, reason: null };
const thread = (status = "done") => ({ id: "card", source, context, title: "Explain xargs", quote: "quoted text",
  status, answer: "xargs builds commands", error: status === "failed" ? "side_question_timeout" : null,
  inherit: false, contextLoading: false, messages: [{ role: "user", content: "why?" }, { role: "assistant", content: "because" }], draft: "more?" });
const controller = (entries = [], openId = null) => ({
  state: { question: "what is xargs", quote: "quoted", source, context, inherit: false, contextLoading: false, entries, openId },
  model: new Proxy({}, { get: () => () => {} }),
});

test("bilingual compact cards stay collapsed; native reader exposes all conversation actions without a dialog", () => {
  for (const language of Object.keys(catalogs)) {
    const { load, missing } = loader(language);
    const Panel = load("components/BtwSideQuestionPanel.tsx").BtwSideQuestionPanel;
    const Dialog = load("components/BtwThreadDialog.tsx").BtwThreadReader;
    const c = controller([thread(), { ...thread("failed"), id: "failed" }, { ...thread("pending"), id: "pending" }]);
    const markup = renderToStaticMarkup(React.createElement(Panel, { controller: c }));
    for (const label of ["newQuestion", "more", "openEmbedded", "retry", "copyThread", "delete", "rename", "pin"])
      assert.ok(markup.includes(catalogs[language][`terminal.btw.${label}`]), label);
    assert.ok(!markup.includes(catalogs[language]["terminal.btw.openSeparate"]));
    assert.ok(!markup.includes('data-action="popout"'));
    assert.ok(markup.includes(`data-action="rename"`));
    assert.ok(markup.includes(`data-action="pin"`));
    assert.ok(markup.includes('data-btw-preview="true"')); assert.ok(!markup.includes("data-btw-turns"));
    const dialog = renderToStaticMarkup(React.createElement(Dialog, { model: controller().model, thread: thread() }));
    for (const label of ["close", "restart", "followup", "copyThread", "copyAnswer", "inherit", "contextTruncated"])
      assert.ok(dialog.includes(catalogs[language][`terminal.btw.${label}`]), label);
    assert.ok(dialog.includes('data-btw-turns="true"')); assert.ok(dialog.includes("because"));
    const transcript = dialog.slice(dialog.indexOf('data-btw-turns="true"'), dialog.indexOf('<nav'));
    assert.ok(!transcript.includes('data-btw-source-details'));
    assert.ok(!transcript.includes(catalogs[language]['terminal.btw.quoteLabel']));
    assert.ok(dialog.includes('class="btw-composer-input"'));
    assert.ok(dialog.includes('class="btw-composer-actions"'));
    assert.ok(dialog.includes('btw-reading-workspace'));
    assert.ok(dialog.includes('data-btw-composer="true"'));
    assert.ok(dialog.includes('aria-label="' + catalogs[language]["terminal.btw.questionOutline"] + '"'));
    assert.ok(dialog.includes('data-markdown="open"'));
    assert.ok(dialog.includes('data-btw-question="0"'));
    assert.ok(dialog.includes('data-btw-source-details="true"'));
    assert.doesNotMatch(dialog, /<details[^>]*\sopen(?:=|\s|>)/);
    for (const status of ["pending", "failed", "stopped", "idle"]) {
      const rendered = renderToStaticMarkup(React.createElement(Dialog, { model: controller().model, thread: thread(status) }));
      assert.ok(rendered.includes(catalogs[language][`terminal.btw.${status === "pending" ? "stop" : status === "idle" ? "ask" : "retry"}`]));
    }
    assert.deepEqual(missing, []);
  }
});

test("history filters current terminal without deleting owner threads; More and row share embedded restoration, never native", () => {
  const { load } = loader("en-US");
  const Panel = load("components/BtwSideQuestionPanel.tsx").BtwSideQuestionPanel;
  const c = controller([thread(), { ...thread(), id: "other-project", source: { ...source, terminalId: "other" } }]);
  const calls = [];
  c.model = { selectEmbedded: (id) => calls.push(["embedded", id]), open: (id) => calls.push(["native", id]) };
  c.stageFromTerminal = (...args) => calls.push(["stage", ...args]);
  const tree = Panel({ controller: c, onOpenReader: () => calls.push(["reader"]) });
  const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  const all = nodes(tree);
  assert.equal(all.filter((node) => node.props?.["data-btw-entry"]).length, 1);
  assert.equal(c.state.entries.length, 2);
  all.find((node) => node.props?.["data-action"] === "open-embedded").props.onClick();
  assert.deepEqual(calls, [["embedded", "card"], ["reader"]]);
  const menuOpen = all.find((node) => node.props?.["data-action"] === "open-side-question");
  assert.equal(menuOpen.props.onClick, all.find((node) => node.props?.["data-action"] === "open-embedded").props.onClick);
  menuOpen.props.onClick();
  assert.deepEqual(calls, [["embedded", "card"], ["reader"], ["embedded", "card"], ["reader"]]);
  assert.ok(!all.some((node) => node.props?.["data-action"] === "popout"));
  all.find((node) => node.props?.["data-action"] === "new-question").props.onClick();
  assert.deepEqual(calls.slice(-2), [["stage", "", "rightclicked-terminal"], ["reader"]]);
});

test("More opens the persisted transcript and draft through owner embedded state without changing native reveal", async () => {
  const { load } = loader("en-US");
  const { BtwThreadModel } = load("lib/btwThreadModel.ts");
  const saved = { ...thread(), draft: "saved follow-up", createdAt: 1234 };
  const model = new BtwThreadModel({
    ask: async () => { throw new Error("Opening history must not infer"); },
    listen: async () => () => {}, cancel: async () => {}, context: async () => {},
  }, { list: async () => [saved], save: async () => {}, remove: async () => {} });
  await model.loadHistory("", false, source.terminalId);
  const before = model.getSnapshot();
  model.open = () => assert.fail("History More must not call native open/reveal");
  let readerOpens = 0;
  const Panel = load("components/BtwSideQuestionPanel.tsx").BtwSideQuestionPanel;
  const tree = Panel({ controller: { state: before, model }, onOpenReader: () => { readerOpens++; } });
  const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  nodes(tree).find((node) => node.props?.["data-action"] === "open-side-question").props.onClick();
  const after = model.getSnapshot();
  assert.equal(readerOpens, 1);
  assert.equal(after.embeddedId, saved.id);
  assert.equal(after.openId, before.openId);
  assert.equal(after.openVersion, before.openVersion);
  assert.equal(after.entries[0].draft, "saved follow-up");
  assert.deepEqual(after.entries[0].messages, saved.messages);
});

test("history cards expose inline rename controls and persistent pinned status", () => {
  const { load } = loader("en-US");
  const Panel = load("components/BtwSideQuestionPanel.tsx").BtwSideQuestionPanel;
  const pinned = { ...thread(), pinned: true };
  const markup = renderToStaticMarkup(React.createElement(Panel, { controller: controller([pinned]) }));
  assert.ok(markup.includes('data-action="rename"'));
  assert.ok(markup.includes('data-action="pin"'));
  assert.ok(markup.includes('aria-pressed="true"'));
  assert.ok(markup.includes(catalogs["en-US"]["terminal.btw.pinned"]));
  const source = readFileSync(new URL("../src/features/terminal/components/BtwSideQuestionPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.prompt/);
  assert.match(source, /renameInput/);
  assert.match(source, /model\.rename\(entry\.id, value\)/);
});

test("bilingual precise unavailable reasons, truncation and inline reset confirmation", () => {
  const rust = readFileSync(new URL("../src-tauri/src/features/terminal/side_question.rs", import.meta.url), "utf8");
  const sidecar = readFileSync(new URL("../scripts/piSideQuestionAgentCore.mjs", import.meta.url), "utf8");
  const reasons = new Set([...`${rust} ${sidecar}`.matchAll(/unavailable\("(source_[a-z_]+)"/g)].map((match) => match[1]));
  for (const extra of ["source_not_found", "source_ambiguous", "source_timeout", "source_unreadable", "inherit_off"]) reasons.add(extra);
  for (const language of Object.keys(catalogs)) {
    const { load, missing } = loader(language, { inherit: true });
    const Details = load("components/BtwContextDetails.tsx").BtwContextDetails;
    for (const reason of reasons) {
      const markup = renderToStaticMarkup(React.createElement(Details, { source, context: { available: false, reason }, loading: false }));
      assert.ok(catalogs[language][`terminal.btw.reason.${reason}`]);
      assert.ok(markup.includes(catalogs[language][`terminal.btw.reason.${reason}`]));
    }
    const Dialog = load("components/BtwThreadDialog.tsx").BtwThreadReader;
    const markup = renderToStaticMarkup(React.createElement(Dialog, { model: controller().model, thread: thread() }));
    assert.equal((markup.match(/role="dialog"/g) ?? []).length, 0);
    assert.ok(markup.includes('role="alert"'));
    for (const key of ["confirmReset", "confirm", "cancel"]) assert.ok(markup.includes(catalogs[language][`terminal.btw.${key}`]));
    assert.deepEqual(missing, []);
  }
});

test("btw standalone panel keeps an independent persisted width key", () => {
  const view = readFileSync(new URL("../src/features/terminal/components/TerminalTabsView.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/shared/preferences/settingsStore.ts", import.meta.url), "utf8");
  const btwBlock = view.slice(view.indexOf('key="btw"'), view.indexOf('key="btw"') + 520);
  assert.match(btwBlock, /widthKey="btw"/);
  assert.match(btwBlock, /defaultWidth=\{TERMINAL_PANEL_WIDTH_DEFAULTS\.btw\}/);
  assert.match(settings, /TerminalPanelWidthKey = .*"btw"/);
  assert.match(settings, /btw: 320/);
  assert.match(settings, /btw: clampNumber\(raw\.btw/);
});

test("side panel tab order registers btw after providers", () => {
  const sidePanelSource = readFileSync(new URL("../src/features/terminal/components/TerminalSidePanel.tsx", import.meta.url), "utf8");
  assert.match(sidePanelSource, /useLayoutEffect\(\(\) => \{[\s\S]*?if \(!open\) return;/);
  assert.doesNotMatch(sidePanelSource, /useEffect\(\(\) => \{[\s\S]*?setCompactTabs/);
  assert.match(sidePanelSource, /"btw"/);
  assert.match(sidePanelSource, /btwPanelContent/);
  const order = sidePanelSource.match(/TERMINAL_SIDE_PANEL_TAB_ORDER[^;]*\[/s);
  assert.ok(order);
  const orderBlock = sidePanelSource.slice(sidePanelSource.indexOf("TERMINAL_SIDE_PANEL_TAB_ORDER"));
  assert.ok(orderBlock.indexOf("\"providers\"") < orderBlock.indexOf("\"btw\""));
  const controller = readFileSync(new URL("../src/features/terminal/hooks/useTerminalTabsController.tsx", import.meta.url), "utf8");
  assert.match(controller, /if \(tab === "btw"\) return true;/);
  assert.match(readFileSync(new URL("../src/features/terminal/hooks/useBtwSideQuestion.ts", import.meta.url), "utf8"), /BtwThreadModel/);
  assert.match(controller, /useBtwSideQuestion/);
  const view = readFileSync(new URL("../src/features/terminal/components/TerminalTabsView.tsx", import.meta.url), "utf8");
  assert.match(view, /BtwSideQuestionPanel/);
  assert.match(view, /btwPanelContent=/);
  const toolbar = readFileSync(new URL("../src/features/terminal/hooks/useTerminalToolbarRenderer.tsx", import.meta.url), "utf8");
  assert.match(toolbar, /btw: \(\s*<button/);
  assert.match(toolbar, /handleToggleBtwPanel/);
  assert.match(toolbar, /if \(key === "btw"\) return terminalToolbarVisibility\.btw === true;/);
  const settings = readFileSync(new URL("../src/shared/preferences/settingsStore.ts", import.meta.url), "utf8");
  assert.match(settings, /btw: boolean;/);
  assert.match(settings, /btw: true,/);
  assert.match(settings, /"providers", "btw", "systemResources"/);
  assert.match(settings, /btw: typeof raw\.btw === "boolean" \? raw\.btw : defaults\.btw,/);
});


test("reader mode and restart handlers require confirmation; cancel/close preserve conversation", () => {
  const { load } = loader("en-US");
  const Dialog = load("components/BtwThreadDialog.tsx").BtwThreadReader;
  const calls = [];
  const c = controller([thread()], "card");
  c.model = { reset: (...args) => calls.push(["reset", ...args]), open: (...args) => calls.push(["open", ...args]) };
  const render = () => Dialog({ model: c.model, thread: c.state.entries[0] });
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  };
  const button = (tree, label) => nodes(tree).find((node) => node.props?.onClick && node.props.children === label);
  let tree = render();
  nodes(tree).find((node) => node.type === "input").props.onChange({ target: { checked: true } });
  assert.deepEqual(calls, []); tree = render();
  button(tree, catalogs["en-US"]["terminal.btw.cancel"]).props.onClick(); assert.deepEqual(calls, []);
  tree = render(); button(tree, catalogs["en-US"]["terminal.btw.restart"]).props.onClick(); assert.deepEqual(calls, []);
  tree = render(); button(tree, catalogs["en-US"]["terminal.btw.confirm"]).props.onClick();
  assert.deepEqual(calls, [["reset", "card", false]]);
  tree = render(); nodes(tree).find((node) => node.type === "input").props.onChange({ target: { checked: true } });
  tree = render(); button(tree, catalogs["en-US"]["terminal.btw.confirm"]).props.onClick();
  assert.deepEqual(calls[1], ["reset", "card", true]);
  tree = render(); button(tree, catalogs["en-US"]["terminal.btw.close"]).props.onClick();
  assert.deepEqual(calls[2], ["open", null]);
});


test("bilingual question outline indexes repeated user turns and streams through shared Markdown", () => {
  for (const language of Object.keys(catalogs)) {
    const { load, missing } = loader(language);
    const Dialog = load("components/BtwThreadDialog.tsx").BtwThreadReader;
    const entry = { ...thread("pending"), answer: `## Streaming
**partial**`, messages: [
      { role: "user", content: "Repeated question" },
      { role: "assistant", content: `# Heading not a question
**bold** [safe](https://example.com)` },
      { role: "user", content: "Repeated question" },
    ] };
    const markup = renderToStaticMarkup(React.createElement(Dialog, { model: controller().model, thread: entry }));
    assert.equal((markup.match(/data-btw-question=/g) ?? []).length, 2);
    assert.ok(markup.includes('data-btw-question="2"'));
    const outline = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));
    assert.equal((outline.match(/<button/g) ?? []).length, 2);
    assert.ok(!outline.includes("Heading not a question"));
    assert.equal((markup.match(/data-markdown="open"/g) ?? []).length, 2);
    assert.ok(markup.includes("## Streaming"));
    assert.deepEqual(missing, []);
  }
});


test("outline button executes a jump against its own transcript ref", () => {
  const calls = [];
  const scroller = {
    scrollTop: 80, clientTop: 0,
    getBoundingClientRect: () => ({ top: 50 }),
    querySelector: (selector) => {
      assert.equal(selector, '[data-btw-question="2"]');
      return { getBoundingClientRect: () => ({ top: 350 }), focus: ({ preventScroll }) => calls.push(["focus", preventScroll]) };
    },
    scrollTo: ({ top }) => calls.push(["scroll", top]),
  };
  const { load } = loader("en-US", null, scroller);
  const Dialog = load("components/BtwThreadDialog.tsx").BtwThreadReader;
  const entry = thread(); entry.messages.push({ role: "user", content: "Second question" });
  const tree = Dialog({ model: controller().model, thread: entry });
  const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  const nav = nodes(tree).find((node) => node.type === "nav");
  const buttons = nodes(nav).filter((node) => node.type === "button");
  assert.equal(buttons.length, 2);
  buttons[1].props.onClick();
  assert.deepEqual(calls, [["scroll", 364], ["focus", true]]);
});


test("all-history toggle exposes old PTY rows and bilingual persistence error has retry action", () => {
  for (const language of Object.keys(catalogs)) {
    const { load, missing } = loader(language, null, null, true);
    const Panel = load("components/BtwSideQuestionPanel.tsx").BtwSideQuestionPanel;
    const c = controller([{ ...thread(), source: { ...source, terminalId: "old-runtime-pty" } }]);
    c.state.persistenceError = "disk full";
    const markup = renderToStaticMarkup(React.createElement(Panel, { controller: c }));
    assert.ok(markup.includes('data-btw-entry="card"'));
    assert.ok(markup.includes(catalogs[language]["terminal.btw.allHistory"]));
    assert.ok(markup.includes('role="alert"'));
    assert.ok(markup.includes(catalogs[language]["terminal.btw.retryPersistence"]));
    assert.deepEqual(missing, []);
  }
});
