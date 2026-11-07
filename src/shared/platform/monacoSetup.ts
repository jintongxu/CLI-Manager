import { enhanceMonacoGrammar } from "./monacoLexical";
import { loader } from "@monaco-editor/react";
import { getCurrentLanguage, type AppLanguage } from "../i18n/index";
import { monaco, monacoEnglishNlsMessages } from "./monacoEnglishNls";

export { monaco };
import { monacoChineseNlsMessages } from "./monacoChineseNls";
import { monacoTraditionalChineseNlsMessages } from "./monacoTraditionalChineseNls";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let configured = false;

interface MonacoNlsGlobal {
  _VSCODE_NLS_MESSAGES?: string[];
  _VSCODE_NLS_LANGUAGE?: string;
}

export function configureMonacoLocale(language: AppLanguage = getCurrentLanguage()) {
  const nls = globalThis as typeof globalThis & MonacoNlsGlobal;
  if (language === "en-US") {
    nls._VSCODE_NLS_MESSAGES = monacoEnglishNlsMessages;
    nls._VSCODE_NLS_LANGUAGE = "en";
  } else if (language === "zh-TW") {
    nls._VSCODE_NLS_MESSAGES = monacoTraditionalChineseNlsMessages;
    nls._VSCODE_NLS_LANGUAGE = "zh-tw";
  } else {
    nls._VSCODE_NLS_MESSAGES = monacoChineseNlsMessages;
    nls._VSCODE_NLS_LANGUAGE = "zh-cn";
  }
}

export function configureMonaco() {
  configureMonacoLocale();
  if (configured) return;
  configured = true;

  (self as unknown as { MonacoEnvironment: { getWorker: (_workerId: string, label: string) => Worker } }).MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new jsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new cssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
      if (label === "typescript" || label === "javascript") return new tsWorker();
      return new editorWorker();
    },
  };

  // Replace the existing lazy factories before any model is created. The bundled
  // contributions still own configuration; only these four tokenizers are extended.
  const grammars = {
    java: () => import("monaco-editor/esm/vs/basic-languages/java/java.js"),
    python: () => import("monaco-editor/esm/vs/basic-languages/python/python.js"),
    dockerfile: () => import("monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.js"),
    shell: () => import("monaco-editor/esm/vs/basic-languages/shell/shell.js"),
  };
  for (const [id, load] of Object.entries(grammars)) {
    monaco.languages.registerTokensProviderFactory(id, {
      create: async () => enhanceMonacoGrammar(id, (await load()).language),
    });
  }
  loader.config({ monaco });
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  abap: "abap",
  apex: "apex",
  azcli: "azcli",
  bat: "bat",
  cmd: "bat",
  bicep: "bicep",
  c: "c",
  h: "c",
  clj: "clojure",
  cljs: "clojure",
  coffee: "coffeescript",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  dockerfile: "dockerfile",
  ecl: "ecl",
  ex: "elixir",
  exs: "elixir",
  flow: "flow9",
  fs: "fsharp",
  fsx: "fsharp",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  hcl: "hcl",
  html: "html",
  htm: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  json: "json",
  jsonc: "json",
  jl: "julia",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lex: "lexon",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  m: "objective-c",
  mm: "objective-c",
  pas: "pascal",
  p: "pascal",
  pl: "perl",
  php: "php",
  ps1: "powershell",
  psm1: "powershell",
  proto: "proto",
  pug: "pug",
  py: "python",
  r: "r",
  cshtml: "razor",
  redis: "redis",
  rst: "restructuredtext",
  rb: "ruby",
  rs: "rust",
  sb: "sb",
  scala: "scala",
  scss: "scss",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sol: "solidity",
  sql: "sql",
  st: "st",
  swift: "swift",
  sv: "systemverilog",
  svh: "systemverilog",
  tcl: "tcl",
  twig: "twig",
  ts: "typescript",
  tsx: "typescript",
  vb: "vb",
  xml: "xml",
  xsl: "xml",
  yaml: "yaml",
  yml: "yaml",
};

export function languageFromPath(path: string, content = ""): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
  const firstLine = content.slice(0, 512).split(/\r?\n/, 1)[0];
  const interpreter = firstLine.match(/^#!\s*(?:\/[^\s]+\/)?(sh|bash|zsh|dash|ksh|python[\d.]*)(?:\s|$)/)?.[1]
    ?? firstLine.match(/^#!\s*\/[^\s]*\/env\s+(?:-S\s+)?(sh|bash|zsh|dash|ksh|python[\d.]*)(?:\s|$)/)?.[1];
  return interpreter ? (interpreter.startsWith("python") ? "python" : "shell") : "plaintext";
}
