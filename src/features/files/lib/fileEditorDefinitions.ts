import { invoke } from "@tauri-apps/api/core";
import type { editor, languages, Position } from "monaco-editor";
import * as TreeSitter from "web-tree-sitter";
import { monaco } from "../../../shared/platform/monacoSetup";
import type { ActiveProjectFile } from "../api/fileExplorerStore";

export interface ProjectSymbol {
  name: string;
  path: string;
  kind: "class" | "interface" | "enum" | "record" | "method" | "function";
  line: number;
  column: number;
}

const languageForPath = (path: string) => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "bash";
  return null;
};

const grammarUrls = {
  java: new URL("@vscode/tree-sitter-wasm/wasm/tree-sitter-java.wasm", import.meta.url).href,
  python: new URL("@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm", import.meta.url).href,
  bash: new URL("@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm", import.meta.url).href,
};

let parserReady: Promise<void> | null = null;
const parsers = new Map<string, TreeSitter.Parser>();

async function getParser(language: keyof typeof grammarUrls): Promise<TreeSitter.Parser> {
  if (!parserReady) {
    parserReady = TreeSitter.Parser.init({ locateFile: () => new URL("web-tree-sitter/web-tree-sitter.wasm", import.meta.url).href });
  }
  await parserReady;
  const existing = parsers.get(language);
  if (existing) return existing;
  const parser = new TreeSitter.Parser();
  const languageObject = await TreeSitter.Language.load(grammarUrls[language]);
  parser.setLanguage(languageObject);
  parsers.set(language, parser);
  return parser;
}

function symbolKind(nodeType: string): ProjectSymbol["kind"] | null {
  if (nodeType.includes("class_declaration")) return "class";
  if (nodeType.includes("interface_declaration")) return "interface";
  if (nodeType.includes("enum_declaration")) return "enum";
  if (nodeType.includes("record_declaration")) return "record";
  if (nodeType === "method_declaration" || nodeType === "method_definition") return "method";
  if (nodeType === "function_definition" || nodeType === "function_declaration") return "function";
  return null;
}

function symbolsFromTree(path: string, tree: TreeSitter.Tree): ProjectSymbol[] {
  const symbols: ProjectSymbol[] = [];
  const visit = (node: TreeSitter.Node) => {
    const kind = symbolKind(node.type);
    if (kind) {
      const nameNode = node.childForFieldName("name")
        ?? node.namedChildren.find((child) => child.type === "identifier" || child.type.endsWith("_name"));
      if (nameNode) symbols.push({ name: nameNode.text, path, kind, line: nameNode.startPosition.row + 1, column: nameNode.startPosition.column + 1 });
    }
    node.namedChildren.forEach(visit);
  };
  visit(tree.rootNode);
  return symbols;
}

async function parseFile(file: Pick<ActiveProjectFile, "path" | "content">): Promise<ProjectSymbol[]> {
  const language = languageForPath(file.path);
  if (!language) return [];
  const parser = await getParser(language);
  const tree = parser.parse(file.content);
  if (!tree) return [];
  try {
    return symbolsFromTree(file.path, tree);
  } finally {
    tree.delete();
  }
}

export class ProjectSymbolIndex {
  private symbols: ProjectSymbol[] = [];
  private rootPath = "";
  private generation = 0;
  private readyPromise: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  async build(rootPath: string, openFiles: ActiveProjectFile[]): Promise<void> {
    const generation = ++this.generation;
    this.readyPromise = this.buildInternal(rootPath, openFiles, generation);
    await this.readyPromise;
  }

  private async buildInternal(rootPath: string, openFiles: ActiveProjectFile[], generation: number): Promise<void> {
    this.rootPath = rootPath;
    const searchResults = await Promise.all([
      ".java", ".py", ".sh", ".bash", ".zsh",
    ].map((query) => invoke<Array<{ path: string; name: string; kind: string; sizeBytes: number; modifiedMs?: number | null }>>("file_search", { rootPath, query })));
    const entries = [...new Map(searchResults.flat().map((entry) => [entry.path, entry])).values()];
    const candidates = entries.filter((entry) => entry.kind === "file" && languageForPath(entry.path));
    const parsed: ProjectSymbol[] = [];
    for (const entry of candidates) {
      try {
        const open = openFiles.find((file) => file.path === entry.path);
        const content = open?.content ?? (await invoke<{ content: string }>("file_read_project_text", { rootPath, relativePath: entry.path })).content;
        parsed.push(...await parseFile({ path: entry.path, content }));
      } catch (error) {
        console.warn("[file-editor] symbol index skipped file", entry.path, error);
      }
      if (generation !== this.generation) return;
    }
    this.symbols = parsed;
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.generation += 1;
    this.symbols = [];
    this.rootPath = "";
    this.listeners.forEach((listener) => listener());
  }

  replaceOpenFile(file: ActiveProjectFile): void {
    this.symbols = this.symbols.filter((symbol) => symbol.path !== file.path);
    void parseFile(file).then((symbols) => {
      this.symbols.push(...symbols);
      this.listeners.forEach((listener) => listener());
    });
  }

  async ready(): Promise<void> {
    try { await this.readyPromise; } catch (error) { console.warn("[file-editor] symbol index unavailable", error); }
  }
  find(name: string): ProjectSymbol[] { return this.symbols.filter((symbol) => symbol.name === name); }
  forPath(path: string): ProjectSymbol[] {
    return this.symbols.filter((symbol) => symbol.path === path).sort((a, b) => a.line - b.line || a.column - b.column);
  }
  get root(): string { return this.rootPath; }
}

function wordAt(model: editor.ITextModel, position: Position): string | null { return model.getWordAtPosition(position)?.word ?? null; }
function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function locationFor(symbol: ProjectSymbol, currentModel: editor.ITextModel): languages.Location {
  const modelPath = normalizedPath(currentModel.uri.path);
  const symbolPath = normalizedPath(symbol.path);
  const isCurrentModel = modelPath.endsWith(symbolPath) || modelPath.endsWith(`/${symbolPath}`);
  const uri = isCurrentModel
    ? currentModel.uri
    : monaco.Uri.parse(`file:///${symbol.path.replace(/\\/g, "/")}`);
  return { uri, range: { startLineNumber: symbol.line, startColumn: symbol.column, endLineNumber: symbol.line, endColumn: symbol.column + symbol.name.length } };
}

export function registerFileDefinitionProviders(index: ProjectSymbolIndex) {
  return ["java", "python", "shell"].map((language) => monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, position) {
      try { await index.ready(); } catch { return null; }
      const name = wordAt(model, position);
      if (!name) return null;
      const matches = index.find(name);
      return matches.length ? matches.map((symbol) => locationFor(symbol, model)) : null;
    },
  }));
}

export function definitionAtSync(index: ProjectSymbolIndex, model: editor.ITextModel, position: Position): ProjectSymbol | null {
  const name = wordAt(model, position);
  return name ? index.find(name)[0] ?? null : null;
}

export async function definitionAt(index: ProjectSymbolIndex, model: editor.ITextModel, position: Position): Promise<ProjectSymbol | null> {
  try { await index.ready(); } catch { return null; }
  return definitionAtSync(index, model, position);
}
