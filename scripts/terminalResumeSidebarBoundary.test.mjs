import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "terminal-resume-sidebar-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
await build({
  entryPoints: ["src/features/projects/api/saveSessionToSidebar.ts"],
  outfile: join(dir, "save.mjs"), bundle: true, format: "esm", platform: "node",
  plugins: [{ name: "terminal-kind", setup(b) {
    b.onResolve({ filter: /terminal\/state$/ }, () => ({ path: "kind", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export const detectCliResumeKind = (cmd) => cmd?.startsWith('pi') ? 'pi' : 'claude';",
      loader: "js",
    }));
  } }],
});
const { canSaveSessionToSidebar, buildSavedSessionProjectInput } = await import(pathToFileURL(join(dir, "save.mjs")));
test("Pi cold-resume classification does not change the sidebar-save supported kinds", () => {
  const session = { id: "pty", cwd: "D:/project", startupCmd: "pi", cliSessionId: "session-one" };
  assert.equal(canSaveSessionToSidebar(session, null), false);
  assert.deepEqual(buildSavedSessionProjectInput({ name: "saved", session, project: null }), { ok: false, reason: "no_kind" });
  const claude = { ...session, startupCmd: "claude" };
  assert.equal(canSaveSessionToSidebar(claude, null), true);
  const saved = buildSavedSessionProjectInput({ name: "saved", session: claude, project: null });
  assert.equal(saved.ok, true);
  assert.equal(saved.input.cli_tool, "claude");
  assert.equal(saved.input.cli_args, " --resume session-one");
});
