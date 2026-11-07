import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real pure modules while resolving their extensionless TypeScript imports.
export function loadFilePreviewModules() {
  function load(path, dependencies = {}) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(`(function(require, module, exports) { ${output}\n})`)(
      (name) => {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
      }, module, module.exports,
    );
    return module.exports;
  }
  const terminalProject = load("src/features/terminal/api/terminalProject.ts", {
    "../../projects/api/worktreeMetadata": {},
  });
  const operations = load("src/features/files/lib/fileExplorerOperations.ts");
  const previewHelpers = load("src/features/files/lib/fileEditorPreview.ts", {
    "../../terminal/api/terminalProject": terminalProject,
    "./fileExplorerOperations": operations,
  });
  return { terminalProject, previewHelpers };
}
