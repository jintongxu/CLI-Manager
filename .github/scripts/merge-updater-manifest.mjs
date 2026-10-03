import { readFile, writeFile } from "node:fs/promises";

const [previousPath, generatedPath, outputPath] = process.argv.slice(2);

if (![previousPath, generatedPath, outputPath].every(Boolean)) {
  throw new Error("usage: merge-updater-manifest.mjs <previous> <generated> <output>");
}

async function readManifest(path, optional = false) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
}

function validateManifest(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (!value.platforms || typeof value.platforms !== "object" || Array.isArray(value.platforms)) {
    throw new Error(`${label} has no platforms object`);
  }
}

const previous = await readManifest(previousPath, true);
const generated = await readManifest(generatedPath);
validateManifest(generated, "generated updater manifest");
if (previous) validateManifest(previous, "previous updater manifest");

const merged = {
  ...generated,
  platforms: {
    ...(previous?.platforms ?? {}),
    ...generated.platforms,
  },
};
await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
