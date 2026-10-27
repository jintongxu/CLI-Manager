import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { stageRuntime } from "./stage-side-question-runtime.mjs";

const scratch = () => mkdtemp(path.join(os.tmpdir(), "cli-manager-side-question-"));

test("Tauri build and standalone bundle stage the runtime; portable packaging requires it", async () => {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.match(config.build.beforeBuildCommand, /stage-side-question-runtime\.mjs/);
  assert.match(config.build.beforeBundleCommand, /stage-side-question-runtime\.mjs/);
  // Directory map (not a flattening glob) preserves nested npm package layouts.
  assert.equal(config.bundle.resources["resources/side-question/"], "resources/side-question/");
  const portable = await readFile(new URL("./package-portable.ps1", import.meta.url), "utf8");
  assert.match(portable, /resources\/side-question\/runtime-manifest\.json/);
  assert.match(portable, /Copy-Item -LiteralPath \$resourcesDir.*-Recurse/);
});

test("staging resolves only production closure, nested versions and optional absence", async () => {
  const root = await scratch();
  try {
    const put = async (relative, value) => {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, typeof value === "string" ? value : JSON.stringify(value));
    };
    await put("scripts/piSideQuestionAgent.mjs", "// fixture");
    await put("scripts/piSideQuestionAgentCore.mjs", "// fixture");
    await put("node_modules/@earendil-works/pi-coding-agent/package.json", {
      name: "@earendil-works/pi-coding-agent", version: "1.4.0", dependencies: { shared: "1", child: "1" },
      devDependencies: { secret: "1" }, optionalDependencies: { absent: "1" },
    });
    await put("node_modules/shared/package.json", { name: "shared", version: "1" });
    await put("node_modules/child/package.json", { name: "child", version: "1", dependencies: { shared: "2" } });
    await put("node_modules/child/node_modules/shared/package.json", { name: "shared", version: "2" });
    await put("node_modules/secret/package.json", { name: "secret", version: "1" });
    const output = path.join(root, "staged");
    const result = await stageRuntime({ root, output });
    assert.equal(result.packageCount, 4);
    const manifest = JSON.parse(await readFile(path.join(output, "runtime-manifest.json"), "utf8"));
    assert.equal(manifest.packages.some((item) => item.name === "secret"), false);
    assert.equal(JSON.parse(await readFile(path.join(output, "node_modules/child/node_modules/shared/package.json"))).version, "2");
    await rm(path.join(root, "node_modules/shared"), { recursive: true });
    await assert.rejects(stageRuntime({ root, output }), /Missing runtime dependency shared/);
    // A failed staging attempt must not replace the previously complete runtime.
    const launch = await readFile(path.join(output, "launch.mjs"), "utf8");
    // The unsupported-version branch exits before SDK import, including old Node 22 minors.
    for (const version of ["20.20.0", "22.18.0"]) {
      const process = { versions: { node: version } };
      const frames = [];
      await runInNewContext(`(async () => { ${launch} })()`, { process, console: { log: (frame) => frames.push(JSON.parse(frame)) } });
      assert.equal(process.exitCode, 1);
      assert.equal(frames[0].error, "side_question_node_required");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real SDK runtime relocates outside checkout and imports without network or credentials", { timeout: 120_000 }, async () => {
  const root = await scratch();
  try {
    const original = path.join(root, "build-output");
    await stageRuntime({ output: original });
    const relocated = path.join(root, "installed application", "resources", "side-question");
    await mkdir(path.dirname(relocated), { recursive: true });
    await rename(original, relocated);
    const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", HOME: root, USERPROFILE: root,
      PI_CODING_AGENT_DIR: path.join(root, "empty-agent-home") };
    const invoke = (payload) => {
      const child = spawnSync(process.execPath, [path.join(relocated, "launch.mjs")], {
        cwd: root, env, input: JSON.stringify(payload) + "\n", encoding: "utf8", timeout: 30_000,
      });
      assert.equal(child.status, 0, child.stderr || String(child.error));
      return JSON.parse(child.stdout.trim());
    };
    const pong = invoke({ type: "ping", requestId: "relocation" });
    assert.equal(pong.type, "pong");
    assert.equal(pong.inMemorySessionApi, true);
    assert.equal(pong.createAgentSession, true);
    const session = path.join(root, "fixture.jsonl");
    await writeFile(session, [
      { type: "session", version: 3, id: "fixture", cwd: root, timestamp: "2026-01-01T00:00:00Z" },
      { type: "message", id: "m1", parentId: null, timestamp: "2026-01-01T00:00:01Z", message: {
        role: "user", content: [{ type: "text", text: "relocated snapshot" }], timestamp: 1 } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const context = invoke({ type: "context", sourceSessionId: "fixture", sessionPath: session });
    assert.equal(context.available, true);
    assert.match(context.text, /relocated snapshot/);
    const manifest = JSON.parse(await readFile(path.join(relocated, "runtime-manifest.json"), "utf8"));
    assert.equal(manifest.sdk, "1.4.0");
    assert.equal(manifest.packages.some((item) => item.name === "react" || item.name === "vite"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
