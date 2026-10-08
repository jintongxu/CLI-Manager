import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const tempDir = mkdtempSync(join(tmpdir(), "cli-manager-history-resume-command-"));
process.on("exit", () => rmSync(tempDir, { recursive: true, force: true }));

const source = readFileSync(new URL("../src/features/history/api/historyResumeCommand.ts", import.meta.url), "utf8");
writeFileSync(
  join(tempDir, "cliTools.mjs"),
  `export const resolveCliToolHistorySourceId = (tool) => {
    const value = tool?.trim().toLowerCase();
    return value === "opencode" ? "opencode" : value === "pi" ? "pi" : null;
  };\n`,
  "utf8",
);
writeFileSync(
  join(tempDir, "projectStartupCommand.mjs"),
  `export const appendResumeCliArgs = (base) => base;\n`,
  "utf8",
);
writeFileSync(
  join(tempDir, "resumeCliArgs.mjs"),
  `export const isValidKimiSessionId = (value) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const isValidGrokSessionId = (value) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const stripKimiResumeCliArgs = (value) => value ?? "";\n`,
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.deepEqual(
  (transpiled.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  [],
);
const output = transpiled.outputText
  .replace('from "../../../shared/lib/cliTools"', 'from "./cliTools.mjs"')
  .replace('from "../../projects/api/projectStartupCommand"', 'from "./projectStartupCommand.mjs"')
  .replace('from "./resumeCliArgs"', 'from "./resumeCliArgs.mjs"');
const outputPath = join(tempDir, "historyResumeCommand.mjs");
writeFileSync(outputPath, output, "utf8");

const {
  buildRemoteHandoffResumeCommand,
  buildHistoryResumeCommand,
  stripOpenCodeResumeCliArgs,
} = await import(pathToFileURL(outputPath).href);

const openCodeSession = { source: "opencode", session_id: "ses_abc123" };
const openCodeProject = {
  cli_tool: "opencode",
  cli_args: "--model provider/model --continue ses_wrong --session=ses_wrong2 -s 'ses_wrong3' --fork ses_wrong4 --prompt \"hello world\"",
  startup_cmd: "",
  provider_overrides: "",
  shell: "powershell",
};

test("OpenCode history resume uses the real session ID", () => {
  assert.equal(
    buildHistoryResumeCommand(openCodeSession),
    "opencode --session ses_abc123",
  );
  assert.equal(
    buildHistoryResumeCommand(openCodeSession, openCodeProject),
    'opencode --session ses_abc123 --model provider/model --prompt "hello world"',
  );
});

test("OpenCode locator and invalid IDs are never passed to the CLI", () => {
  assert.equal(
    buildHistoryResumeCommand({
      source: "opencode",
      session_id: "C:/Users/fengx/.local/share/opencode/opencode.db#session=ses_abc123",
    }),
    null,
  );
  assert.equal(buildHistoryResumeCommand({ source: "opencode", session_id: "msg_abc123" }), null);
  assert.equal(buildHistoryResumeCommand({ source: "opencode", session_id: "ses bad" }), null);
});

test("Kimi shell metacharacters are never passed to the CLI", () => {
  assert.equal(buildHistoryResumeCommand({ source: "kimi", session_id: "01KIMI&calc" }), null);
  assert.equal(buildHistoryResumeCommand({ source: "kimi", session_id: "01KIMI;calc" }), null);
});

test("Grok shell metacharacters are never passed to the CLI", () => {
  assert.equal(buildHistoryResumeCommand({ source: "grok", session_id: "grok&calc" }), null);
  assert.equal(buildHistoryResumeCommand({ source: "grok", session_id: "grok;calc" }), null);
});

test("OpenCode resume argument stripping handles separated, equals and quoted forms", () => {
  assert.equal(
    stripOpenCodeResumeCliArgs(
      "--model provider/model --session ses_a -s=ses_b --continue ses_c -c=ses_d --fork ses_e --prompt 'hello world' --temperature=0.2",
    ),
    "--model provider/model --prompt 'hello world' --temperature=0.2",
  );
});

test("OpenCode remote handoff uses the same strict ID and argument filtering", () => {
  assert.equal(
    buildRemoteHandoffResumeCommand("opencode", "ses_abc123", openCodeProject),
    'opencode --session ses_abc123 --model provider/model --prompt "hello world"',
  );
  assert.equal(buildRemoteHandoffResumeCommand("opencode", "msg_abc123", openCodeProject), null);
});

test("other history sources keep their existing command builders", () => {
  assert.equal(
    buildHistoryResumeCommand({ source: "pi", session_id: "ses_pi" }),
    "pi --session ses_pi",
  );
  assert.equal(
    buildHistoryResumeCommand({ source: "claude", session_id: "session-claude" }),
    "claude --resume session-claude",
  );
  assert.equal(
    buildHistoryResumeCommand({ source: "kimi", session_id: "01KIMISESSIONID0000000001" }),
    "kimi --session 01KIMISESSIONID0000000001",
  );
  assert.equal(
    buildHistoryResumeCommand({ source: "grok", session_id: "grok-session" }),
    "grok --resume grok-session",
  );
});

const { buildPiResumeCommand, stripPiResumeCliArgs } = await import(pathToFileURL(outputPath).href);
const piProject = { ...openCodeProject, cli_tool: "pi", cli_args: '--session wrong --continue --resume=old -r stale --session-id older --fork copy --model "provider/model" --thinking high' };
test("Pi cold resume explicit identity, fallback, legal ID and argument dedup", () => {
  assert.equal(buildPiResumeCommand(" pi_session-123 ", piProject), 'pi --session pi_session-123 --model "provider/model" --thinking high');
  for (const id of [undefined, "", "  ", "bad;calc", "bad&calc", "bad\ncommand", "$(calc)", "-option"]) {
    assert.equal(buildPiResumeCommand(id, piProject), 'pi --continue --model "provider/model" --thinking high');
  }
  assert.equal(buildHistoryResumeCommand({ source: "pi", session_id: "bad;calc" }), null);
  assert.equal(buildRemoteHandoffResumeCommand("pi", "bad&calc"), null);
  assert.equal(stripPiResumeCliArgs('--session=old --model x -c --thinking high'), '--model x --thinking high');
  assert.equal(buildPiResumeCommand("target", { ...piProject, startup_cmd: "custom-launch --arbitrary args" }), "pi --session target");
});

// Execute the production launch classifier/builders and cold-restore branch rather than
// asserting a new helper detached from the actual restore wiring.
const launchSource = readFileSync(new URL("../src/features/terminal/lib/terminalLaunch.ts", import.meta.url), "utf8");
const launchFunctions = launchSource.slice(launchSource.indexOf("export const CODEX_COMMAND_PATTERN"), launchSource.indexOf("export function buildDirectCodexLaunchCommand"));
const launchJs = ts.transpileModule(launchFunctions, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll("export ", "");
const { detectCliResumeKind, buildCliResumeStartupCommand } = new Function("buildPiResumeCommand", "appendResumeCliArgs", "getProviderSwitchAppType", "isExactCodexProject", "isValidGrokSessionId", "isValidKimiSessionId",
  `${launchJs}; return { detectCliResumeKind, buildCliResumeStartupCommand };`)(buildPiResumeCommand, base => base, p => p.cli_tool === "codex" ? "codex" : p.cli_tool === "claude" ? "claude" : null, p => p.cli_tool === "codex", () => true, () => true);

test("Pi classifier includes stored manual identity and preserves other CLI kinds", () => {
  for (const args of [[undefined, undefined, "pi"], [undefined, piProject], ["pi.cmd --model x"], ["pi --session A", { cli_tool: "codex" }]]) {
    assert.equal(detectCliResumeKind(...args), "pi");
  }
  assert.equal(detectCliResumeKind("echo pineapple", undefined), null);
  for (const kind of ["claude", "codex", "grok", "kimi"]) assert.equal(detectCliResumeKind(kind, undefined), kind);
  assert.equal(buildCliResumeStartupCommand("pi", "target", piProject), 'pi --session target --model "provider/model" --thinking high');
});

const storeSource = readFileSync(new URL("../src/features/terminal/store/terminalStore.ts", import.meta.url), "utf8");
const coldStart = storeSource.indexOf("          const restoreProject =");
const coldEnd = storeSource.indexOf("        // 确定恢复后的 activeSessionId", coldStart);
const coldBody = storeSource.slice(coldStart, coldEnd).replace(/\n        \}\s*$/, "");
const coldJs = ts.transpileModule(`async function restore(ps, deps) {
 const { detectCliResumeKind, buildCliResumeStartupCommand, projectMap, resolvePtyLaunch, terminalProcessManager } = deps;
 const os = 'windows', newIdMap = {}, restoredSessions = [], restoredStatuses = {}, restoredListeners = {}, skippedSessions = [];
 const normalizeDirectCodexStartupCommand = x => x, normalizeShellKey = x => x;
 const getRestoredAgentTerminalMetadata = () => ({}), logError = () => {}, releaseProviderSnapshot = () => {}, releaseProjectExtensionSnapshot = () => {};
 const formatStartupInputForPty = x => x + '\\r', summarizeStartupCmd = x => x;
 const setTimeout = fn => fn();
 for (let i = 0; i < 1; i++) { ${coldBody} }
 return restoredSessions;
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const restoreCold = new Function(`${coldJs}; return restore;`)();
for (const environment of ["local", "wsl", "ssh"]) {
  for (const id of ["pi-target", undefined]) {
    test(`Pi cold restore ${environment}, identity=${id ?? "cwd continue"}: no old TUI/geometry, startup exactly once`, async () => {
      const launches = [], writes = [];
      const sessions = await restoreCold({ id: "old", projectId: "p", cwd: "cwd", cliTool: "pi", isAgentSession: false, cliSessionId: id, initialTerminalOutput: "OLD TUI", initialTerminalSize: { cols: 80, rows: 24 } }, {
        detectCliResumeKind, buildCliResumeStartupCommand, projectMap: new Map([["p", { ...piProject, cli_tool: "codex" }]]),
        resolvePtyLaunch: async options => { launches.push(options); return { startupCmd: options.startupCmd, startupHandledByLaunch: environment === "ssh", environmentType: environment, invokeArgs: {} }; },
        terminalProcessManager: { create: async () => "new", subscribeStatus: async () => () => {}, write: async (...args) => writes.push(args) },
      });
      const expected = id ? `pi --session ${id}` : "pi --continue";
      assert.equal(launches.length, 1);
      assert.equal(launches[0].cwd, "cwd");
      assert.equal(launches[0].startupCmd, expected);
      assert.equal(sessions[0].initialTerminalOutput, undefined);
      assert.equal(sessions[0].initialTerminalSize, undefined);
      assert.equal(sessions[0].deferStartupUntilInitialOutput, false);
      assert.equal(sessions[0].cliSessionId, id);
      assert.equal(sessions[0].cliTool, "pi");
      assert.equal(sessions[0].isAgentSession, true);
      assert.deepEqual(writes, environment === "ssh" ? [] : [["new", expected + "\r"]]);
    });
  }
}
test("daemon attach still precedes native cold resume; anonymous Pi excluded", () => {
  assert.ok(storeSource.indexOf("if (daemonSession)") < coldStart);
  const attachBody = storeSource.slice(storeSource.indexOf("if (daemonSession)"), coldStart);
  assert.match(attachBody, /daemonAttachPendingSessionIds.add\(ps.id\)/);
  assert.doesNotMatch(attachBody, /terminalProcessManager.create/);
  assert.match(storeSource, /if \(ps.kind === "ephemeral-pi"\) continue/);
  assert.match(readFileSync(new URL("../src/features/terminal/api/sessionStore.ts", import.meta.url), "utf8"), /session.kind !== "ephemeral-pi"/);
});
