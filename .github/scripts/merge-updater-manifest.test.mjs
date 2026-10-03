import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "cli-manager-updater-manifest-"));
const previousPath = path.join(root, "previous.json");
const generatedPath = path.join(root, "generated.json");
const outputPath = path.join(root, "output.json");
const scriptPath = fileURLToPath(new URL("./merge-updater-manifest.mjs", import.meta.url));

await writeFile(previousPath, JSON.stringify({
  version: "1.4.0",
  platforms: {
    "linux-x86_64-deb": { url: "https://old.example/linux.deb", signature: "old" },
    "windows-x86_64-msi": { url: "https://old.example/windows.msi", signature: "old" },
  },
}));
await writeFile(generatedPath, JSON.stringify({
  version: "1.4.1",
  notes: "new",
  platforms: {
    "windows-x86_64-msi": { url: "https://new.example/windows.msi", signature: "new" },
  },
}));
await execFileAsync(process.execPath, [scriptPath, previousPath, generatedPath, outputPath]);
const merged = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(merged.version, "1.4.1");
assert.equal(merged.platforms["linux-x86_64-deb"].url, "https://old.example/linux.deb");
assert.equal(merged.platforms["windows-x86_64-msi"].url, "https://new.example/windows.msi");

await execFileAsync(process.execPath, [scriptPath, path.join(root, "missing.json"), generatedPath, outputPath]);
assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), JSON.parse(await readFile(generatedPath, "utf8")));
console.log("updater manifest merge: 5 checks passed");
