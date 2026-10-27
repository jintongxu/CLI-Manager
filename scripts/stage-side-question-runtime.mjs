// Stage only the SDK's production package dependency closure, never repository/user config.
// Keeping package layouts intact preserves SDK import.meta.url assets and lazy imports.
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultOutput = path.join(repoRoot, "src-tauri/resources/side-question");
const SDK = "@earendil-works/pi-coding-agent";

// Resolve package directories, not exported package.json (many packages forbid that export).
async function resolvePackage(name, from) {
  for (let current = from; ; current = path.dirname(current)) {
    const candidate = path.join(current, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpath(candidate);
    if (path.dirname(current) === current) throw new Error(`Missing runtime dependency ${name} from ${from}; run npm ci`);
  }
}

export async function stageRuntime({ root = repoRoot, output = defaultOutput } = {}) {
  const temporary = `${output}.staging`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const packages = new Map();
  const copied = new Set();
  try {
    async function copyPackage(name, from) {
      const source = await resolvePackage(name, from);
      const manifest = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
      if (copied.has(source)) return;
      copied.add(source);
      // Preserve npm's hoisted/nested resolution, including multiple versions, without duplication.
      const relative = path.relative(root, source);
      if (!relative.startsWith(`node_modules${path.sep}`) || relative.includes(`..${path.sep}`)) {
        throw new Error(`Runtime dependency ${name} is outside local node_modules; use npm ci (no linked packages)`);
      }
      const destination = path.join(temporary, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, dereference: true,
        filter: (file) => !["node_modules", ".git"].includes(path.basename(file)) });
      packages.set(source, { name: manifest.name, version: manifest.version });
      const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
      for (const dependency of Object.keys(dependencies).sort()) {
        try {
          await copyPackage(dependency, source);
        } catch (error) {
          if (dependency in (manifest.optionalDependencies ?? {}) && error.message.startsWith(`Missing runtime dependency ${dependency} from `)) continue;
          throw error;
        }
      }
    }
    const sdkRoot = await resolvePackage(SDK, root);
    const sdk = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
    if (sdk.version !== "1.4.0") throw new Error(`Expected ${SDK}@1.4.0, found ${sdk.version}`);
    await copyPackage(SDK, root);
    for (const file of ["piSideQuestionAgent.mjs", "piSideQuestionAgentCore.mjs"]) {
      await cp(path.join(root, "scripts", file), path.join(temporary, file));
    }
    // This entry is deliberately free of SDK imports so unsupported Node gets a safe diagnostic.
    await writeFile(path.join(temporary, "launch.mjs"), `const [major, minor] = process.versions.node.split('.').map(Number);\nif (major < 22 || (major === 22 && minor < 19)) {\n  console.log(JSON.stringify({type:'error',error:'side_question_node_required'}));\n  process.exitCode = 1;\n} else {\n  await import('./piSideQuestionAgent.mjs');\n}\n`);
    await writeFile(path.join(temporary, "runtime-manifest.json"), JSON.stringify({ schema: 1, node: ">=22.19.0", sdk: sdk.version,
      packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + "\n");
    await rm(output, { recursive: true, force: true });
    await rename(temporary, output);
    return { output, packageCount: packages.size };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--output requires a directory");
    console.log(await stageRuntime(outputIndex >= 0 ? { output: path.resolve(process.argv[outputIndex + 1]) } : {}));
  }
  catch (error) { console.error(`Side-question runtime staging failed: ${error.message}`); process.exitCode = 1; }
}
