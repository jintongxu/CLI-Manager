import type { editor, languages } from "monaco-editor";

type Grammar = languages.IMonarchLanguage;
type Rule = languages.IMonarchLanguageRule;

/** Bounded lexical hints only: never name resolution or semantic classification.
 * Extend root/argument contexts, not string/comment states from the bundled grammar.
 */
export function enhanceMonacoGrammar(id: string, baseline: Grammar): Grammar {
  const grammar: Grammar = { ...baseline, tokenizer: { ...baseline.tokenizer } };
  const prepend = (state: string, rules: Rule[]) => {
    grammar.tokenizer[state] = [...rules, ...baseline.tokenizer[state]];
  };
  if (id === "java") {
    prepend("root", [
      [/(class|interface|enum|record)(\s+)([A-Za-z_$][\w$]*)/, ["keyword", "", "type.declaration"]],
      [/[A-Za-z_$][\w$]*(?=\s*\()/, { cases: { "@keywords": "keyword", "@default": "function" } }],
    ]);
  } else if (id === "python") {
    prepend("root", [
      [/(class)(\s+)([A-Za-z_]\w*)/, ["keyword", "white", "type.declaration"]],
      [/(def)(\s+)([A-Za-z_]\w*)/, ["keyword", "white", "function.declaration"]],
      [/@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/, "annotation"],
      [/[A-Za-z_]\w*(?=\s*\()/, { cases: { "@keywords": "keyword", "@default": "function" } }],
      [/#.*$/, "comment"],
    ]);
  } else if (id === "dockerfile") {
    grammar.ignoreCase = true;
    // Dedicated FROM context avoids mistaking ordinary RUN arguments for images/stages.
    prepend("root", [
      [/(FROM)(\s+)/, ["keyword", { token: "", next: "@fromImage" }]],
      [/(ENV|ARG)(\s+)([\w]+)/, ["keyword", "", { cases: { "@eos": "variable", "@default": { token: "variable", next: "@arguments" } } }]],
    ]);
    grammar.tokenizer.fromImage = [
      [/--platform=/, { token: "attribute.name", next: "@fromPlatform" }],
      [/\s+/, ""],
      { include: "@strings" },
      [/[^\s'\"]+/, { cases: {
        "@eos": { token: "type.image", next: "@popall" },
        "@default": { token: "type.image", switchTo: "@fromArguments" },
      } }],
    ];
    grammar.tokenizer.fromPlatform = [
      [/\s+/, { token: "", next: "@pop" }],
      { include: "@strings" },
      [/[^\s'\"]+/, { cases: {
        "@eos": { token: "attribute.name", next: "@popall" },
        "@default": "attribute.name",
      } }],
    ];
    grammar.tokenizer.fromArguments = [
      [/(AS)(\s+)([\w.-]+)/, ["keyword", "", { token: "type.stage", next: "@popall" }]],
      { include: "@arguments" },
    ];
    prepend("arguments", [
      [/[A-Za-z_][\w]*(?==)/, "variable"],
      [/--[\w-]+(?:=[\w./:-]+)?/, { cases: { "@eos": { token: "attribute.name", next: "@popall" }, "@default": "attribute.name" } }],
    ]);
  } else if (id === "shell") {
    grammar.ignoreCase = false;
    prepend("root", [
      [/^#!.*$/, "metatag"],
      [/^#.*$/, "comment"],
      [/(\s+)(#.*$)/, ["white", "comment"]],
      [/(function)(\s+)([A-Za-z_]\w*)/, ["keyword", "white", "function.declaration"]],
      [/[A-Za-z_]\w*(?=\s*\(\s*\)\s*\{)/, "function.declaration"],
      // Only syntactic command positions, not arbitrary arguments or assignment values.
      [/^(\s*)([A-Za-z_][\w./-]*)(?=\s|$)/, ["white", { cases: { "@keywords": "keyword", "@default": "function.command" } }]],
      [/([;|&]+\s*|\{\s+)([A-Za-z_][\w./-]*)(?=\s|$)/, ["delimiter", { cases: { "@keywords": "keyword", "@default": "function.command" } }]],
      [/\b[A-Za-z_]\w*(?==)/, "variable"],
      [/(<<-)(\s*)(['"]?)([\w-]+)(\3)/, ["delimiter", "white", "string", { token: "string", next: "@heredocPendingTabs.$4" }, "string"]],
      [/(<<)(\s*)(['"]?)([\w-]+)(\3)/, ["delimiter", "white", "string", { token: "string", next: "@heredocPendingBody.$4" }, "string"]],
    ]);
    // Replace the bundled whitespace comment rule too: its substring anchor otherwise
    // still consumes word-internal # after an ordinary word has been tokenized.
    grammar.tokenizer.whitespace = [[/\s+/, "white"]];
    // A leading ^ is Monarch's physical-line guard. Defer body entry until the
    // next line, leaving the introducing line in ordinary command contexts.
    for (const kind of ["Body", "Tabs"]) {
      grammar.tokenizer[`heredocPending${kind}`] = [
        [/^/, { token: "@rematch", switchTo: `@heredoc${kind}.$S2` }],
        [/'/, "string", "@heredocTailSingle"],
        [/"/, "string", "@heredocTailDouble"],
        { include: "@root" },
      ];
    }
    // Unlike the baseline's popall, closing a tail quote must retain the pending body.
    grammar.tokenizer.heredocTailSingle = [[/'/, "string", "@pop"], [/./, "string"]];
    grammar.tokenizer.heredocTailDouble = [[/"/, "string", "@pop"], [/./, "string"]];
    // Quoted/unquoted simple delimiters are supported. Body deliberately stays opaque.
    grammar.tokenizer.heredocBody = [
      [/^([\w-]+)$/, { cases: { "$1==$S2": { token: "string.heredoc", next: "@pop" }, "@default": "string.heredoc" } }],
      [/.*$/, "string.heredoc"],
    ];
    grammar.tokenizer.heredocTabs = [
      [/^\t*([\w-]+)$/, { cases: { "$1==$S2": { token: "string.heredoc", next: "@pop" }, "@default": "string.heredoc" } }],
      [/.*$/, "string.heredoc"],
    ];

  }
  return grammar;
}

export function lexicalThemeRules(dark: boolean): editor.ITokenThemeRule[] {
  const scopes = {
    "type.declaration.java": ["4EC9B0", "00665C"],
    "type.declaration.python": ["4EC9B0", "00665C"],
    "type.image.dockerfile": ["4EC9B0", "00665C"],
    "type.stage.dockerfile": ["C5A5F5", "7040A0"],
    "function.java": ["DCDCAA", "795E00"],
    "function.declaration.python": ["DCDCAA", "795E00"],
    "function.declaration.shell": ["DCDCAA", "795E00"],
    "function.command.shell": ["DCDCAA", "795E00"],
    "function.python": ["DCDCAA", "795E00"],
    "function.shell": ["DCDCAA", "795E00"],
    "annotation.java": ["C5A5F5", "7040A0"],
    "annotation.python": ["C5A5F5", "7040A0"],
    "variable.dockerfile": ["9CDCFE", "005A9C"],
    "variable.shell": ["9CDCFE", "005A9C"],
    "attribute.name.shell": ["CE9178", "8C3B15"],
    "attribute.name.dockerfile": ["CE9178", "8C3B15"],
  };
  return Object.entries(scopes).map(([token, colors]) => ({ token, foreground: colors[dark ? 0 : 1] }));
}
