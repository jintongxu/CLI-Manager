import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real initialization effect, retaining its actual dependency list.
// Stop at the xterm constructor: no browser/native terminal is available in Node.
const path = "../hooks/useXTermController.ts";
const text = readFileSync(new URL(path, import.meta.url), "utf8");
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
const controller = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === "useXTermController");
const declarations = controller.body.statements.filter(ts.isVariableStatement);
const dormantSelector = declarations.find(node => node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "isDormantSession"));
const init = controller.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect"
  && node.getText(source).includes("const terminal = new Terminal("));
assert.ok(dormantSelector, "dormancy is a reactive controller subscription");
assert.ok(init, "test must locate the real initialization effect");
const code = ts.transpileModule(`${dormantSelector.getText(source)}\n${init.getText(source)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  const calls = [];
  const state = { dormantRestoredSessionIds: new Set(["shell"]), daemonAttachPendingSessionIds: new Set() };
  const initialized = new Error("constructor boundary");
  let previousDeps;
  const scope = {
    sessionId: "shell", state,
    useTerminalStore: selector => selector(state),
    containerRef: { current: {} },
    codexSessionDetectedRef: { current: false }, grokSessionDetectedRef: { current: false },
    getSessionToolContext: () => ({}), isCodexTerminalContext: () => false,
    tuiColorSync: { reset: () => calls.push("reset") },
    getTerminalTheme: () => ({}), withTerminalTextColor: theme => theme,
    terminalThemeName: "theme", resolvedTheme: "dark", lightThemePalette: "light", darkThemePalette: "dark", terminalTextColor: null,
    Terminal: function () {
      calls.push(["construct", state.daemonAttachPendingSessionIds.has("shell")]);
      throw initialized;
    },
    createTerminalMouseInteractionOptions: () => ({}),
    fontSize: 16, effectiveFontFamily: "monospace", effectiveTerminalScrollbackRows: 100,
    getTerminalMinimumContrastRatio: () => 1,
    isTransparentRef: { current: false }, background: { overlayDarken: 0 }, withVisibleSelectionTheme: theme => theme,
    useEffect(callback, deps) {
      if (previousDeps && deps.every((dep, index) => Object.is(dep, previousDeps[index]))) return;
      previousDeps = deps;
      try { callback(); } catch (err) { if (err !== initialized) throw err; }
    },
  };
  return {
    state, calls,
    render: props => vm.runInNewContext(code, { ...scope, ...props }),
  };
}

test("dormant hidden shell does not create a parser before daemon materialization publishes pending attach", () => {
  const f = fixture();
  f.render({ isVisible: false });
  f.render({ isVisible: true });
  assert.deepEqual(f.calls, [], "even activation cannot initialize before materialization finishes");
  // This is the real coordinator ordering: publish attach metadata, then clear dormancy.
  f.state.daemonAttachPendingSessionIds.add("shell");
  f.render({ isVisible: true });
  assert.deepEqual(f.calls, [], "pending attach alone cannot bypass dormancy");
  f.state.dormantRestoredSessionIds.delete("shell");
  f.render({ isVisible: true });
  assert.deepEqual(f.calls, ["reset", ["construct", true]]);
  f.render({ isVisible: false });
  f.render({ isVisible: true });
  assert.equal(f.calls.filter(call => Array.isArray(call)).length, 1, "visibility must not recreate the parser/consumer");
});

test("recreated shell initializes under the new PTY identity, never the dormant persisted id", () => {
  const f = fixture();
  f.render({ isVisible: false });
  f.render({ sessionId: "recreated", isVisible: true });
  assert.deepEqual(f.calls, ["reset", ["construct", false]]);
});

test("already-live hidden shell initializes without waiting for visibility", () => {
  const f = fixture();
  f.state.dormantRestoredSessionIds.clear();
  f.render({ isVisible: false });
  assert.deepEqual(f.calls, ["reset", ["construct", false]]);
  f.render({ isVisible: true });
  assert.equal(f.calls.length, 2);
});
