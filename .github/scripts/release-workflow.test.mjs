import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const releaseWorkflow = readFileSync(new URL("../workflows/release.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");
const windowsWorkflow = readFileSync(new URL("../workflows/windows-release-upload.yml", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");

assert.match(releaseWorkflow, /^name: Windows Release$/m);
assert.match(releaseWorkflow, /tags:\n\s+- "V\*"/);
assert.match(releaseWorkflow, /workflow_dispatch:/);
assert.match(releaseWorkflow, /default: V1\.4\.5/);
assert.match(releaseWorkflow, /workflow_call:/);
assert.match(releaseWorkflow, /permissions:\n  contents: write/);
assert.match(releaseWorkflow, /runs-on: windows-latest/);
assert.match(releaseWorkflow, /uses: actions\/checkout@v4/);
assert.match(releaseWorkflow, /uses: dtolnay\/rust-toolchain@stable/);
assert.match(releaseWorkflow, /run: npm ci/);
assert.match(releaseWorkflow, /uses: tauri-apps\/tauri-action@v0/);
assert.match(releaseWorkflow, /TAURI_SIGNING_PRIVATE_KEY:/);
assert.match(releaseWorkflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:/);
assert.match(releaseWorkflow, /includeUpdaterJson: true/);
assert.match(releaseWorkflow, /args: --bundles nsis,msi/);
assert.match(releaseWorkflow, /releaseDraft: false/);
assert.match(releaseWorkflow, /run: \.\\scripts\\package-portable\.ps1/);
assert.match(releaseWorkflow, /uses: softprops\/action-gh-release@v2/);
assert.doesNotMatch(releaseWorkflow, /R2_PUBLIC_BASE_URL|r2-release-config|aws s3 cp/);
assert.doesNotMatch(releaseWorkflow, /tauri:build:local/);

assert.match(windowsWorkflow, /^name: Windows Release \(manual\)$/m);
assert.match(windowsWorkflow, /workflow_dispatch:/);
assert.match(windowsWorkflow, /default: V1\.4\.5/);
assert.match(windowsWorkflow, /uses: \.\/\.github\/workflows\/release\.yml/);
assert.match(windowsWorkflow, /secrets: inherit/);
assert.doesNotMatch(windowsWorkflow, /R2_PUBLIC_BASE_URL|r2-release-config|aws s3 cp/);

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
assert.equal(config.version, "1.4.5");
assert.equal(config.bundle.createUpdaterArtifacts, true);
assert.deepEqual(config.plugins.updater.endpoints, [
  "https://github.com/jintongxu/CLI-Manager/releases/latest/download/latest.json",
]);
assert.ok(config.plugins.updater.pubkey, "updater public key must be committed");

console.log("GitHub-only Windows release workflow: checks passed");
