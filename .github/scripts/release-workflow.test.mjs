import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../workflows/release.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");
const build = workflow.split(/(?=^  [\w-]+:\n)/m)
  .find((job) => job.startsWith("  build:\n"));
assert.ok(build, "release must contain the desktop build job");
const steps = build.split(/(?=^      - )/m).slice(1);

// 从真实工作流定位资源生产者与 Cargo 消费者，缺少步骤时直接报告前置条件缺失。
function stepIndex(pattern, description) {
  const index = steps.findIndex((step) => pattern.test(step));
  assert.notEqual(index, -1, description);
  return index;
}

const web = stepIndex(/run: npm run web:build\b/, "web assets must be built before direct Cargo checks");
const agent = stepIndex(/name: Download bundled SSH Agent\b/, "signed Agent assets must be downloaded");
const verifyAgent = stepIndex(/name: Verify bundled SSH Agent files\b/, "downloaded Agent assets must be verified");
const proxy = stepIndex(/run: npm run test:codex-proxy:e2e\b/, "the real Windows proxy test must remain enabled");
const devProxy = stepIndex(/run: npm run test:tauri-dev-proxy\b/, "the Windows dev proxy test must remain enabled");
const bundle = stepIndex(/uses: tauri-apps\/tauri-action@/, "the signed Tauri build must remain enabled");

assert.ok(agent < verifyAgent, "verify Agent assets after download");
for (const consumer of [proxy, devProxy]) {
  assert.ok(web < consumer, "direct Cargo checks require generated web assets");
  assert.ok(verifyAgent < consumer, "direct Cargo checks require verified bundle resources");
  assert.ok(consumer < bundle, "Windows checks must gate signed packaging");
  assert.match(steps[consumer], /if: matrix\.platform == 'windows-latest'/);
}
assert.match(steps[web], /if: matrix\.platform == 'windows-latest'/);
assert.doesNotMatch(
  [web, agent, verifyAgent, proxy, devProxy].map((index) => steps[index]).join("\n"),
  /continue-on-error:\s*true/,
  "resource preparation and Windows checks must fail the release on error",
);
assert.match(workflow, /node \.github\/scripts\/release-workflow\.test\.mjs/);

// Windows-only repair runs must use the signed Tauri build too; a local build disables updater artifacts.
const windowsWorkflow = readFileSync(new URL("../workflows/windows-release-upload.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");
const windowsSteps = windowsWorkflow.split(/(?=^      - )/m).slice(1);
function windowsStepIndex(pattern, description) {
  const index = windowsSteps.findIndex((step) => pattern.test(step));
  assert.notEqual(index, -1, description);
  return index;
}
const r2 = windowsStepIndex(/name: Configure R2 release\b/, "Windows updater repair must configure the release origin");
const signedWindowsBuild = windowsStepIndex(/uses: tauri-apps\/tauri-action@/, "Windows updater repair must use the signed Tauri action");
const preserveManifest = windowsStepIndex(/name: Preserve existing updater manifest\b/, "Windows updater repair must preserve existing platforms");
const mergeManifest = windowsStepIndex(/name: Merge updater manifest platforms\b/, "Windows updater repair must merge generated and existing platforms");
const uploadManifest = windowsStepIndex(/name: Upload merged updater manifest\b/, "Windows updater repair must upload the merged updater manifest");
const portable = windowsStepIndex(/name: Upload Windows portable asset to release\b/, "Windows updater repair must keep the portable upload");
const r2Sync = windowsStepIndex(/name: Prepare R2 updater assets\b/, "Windows updater repair must synchronize the updater manifest");
assert.ok(r2 < preserveManifest, "configure the updater origin before inspecting the release");
assert.ok(preserveManifest < signedWindowsBuild, "preserve existing platforms before rebuilding Windows");
assert.ok(signedWindowsBuild < mergeManifest, "merge after the signed updater manifest exists");
assert.ok(mergeManifest < uploadManifest, "write the merged updater manifest before uploading it");
assert.ok(uploadManifest < portable, "upload the merged manifest before the portable asset");
assert.ok(portable < r2Sync, "synchronize R2 after every GitHub updater asset exists");
assert.match(windowsSteps[mergeManifest], /merge-updater-manifest\.mjs/);
assert.match(windowsSteps[signedWindowsBuild], /TAURI_SIGNING_PRIVATE_KEY:/);
assert.match(windowsSteps[signedWindowsBuild], /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:/);
assert.match(windowsSteps[signedWindowsBuild], /includeUpdaterJson: true/);
assert.match(windowsSteps[r2Sync], /test -f dist\/github-release\/latest\.json/);
assert.match(windowsSteps[r2Sync], /latest\/latest\.json/);
assert.doesNotMatch(windowsWorkflow, /tauri:build:local/, "Windows updater repair must not use the local config that disables updater artifacts");

// Linux 构建矩阵：新增 runner 时依赖安装必须同样生效，且只能产出 deb（AppImage / rpm 已停止发布）。
const linuxDeps = stepIndex(/name: Install Linux dependencies\b/, "Linux bundle dependencies must be installed");
assert.match(steps[linuxDeps], /if: startsWith\(matrix\.platform, 'ubuntu'\)/);
assert.match(build, /- platform: ubuntu-22\.04-arm\b/, "Linux arm64 must be built on an arm runner");
for (const entry of build.matchAll(/- platform: (ubuntu-[\w.-]+)\n\s+args: "([^"]*)"/g)) {
  assert.match(entry[2], /--bundles deb/, `${entry[1]} must bundle deb only`);
}
console.log("release workflow resource prerequisites: checks passed");
