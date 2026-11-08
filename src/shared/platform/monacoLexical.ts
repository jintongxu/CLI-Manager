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
      [/(package|import)(\s+)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/, ["keyword", "", "namespace"]],
      [/(class|interface|enum|record)(\s+)([A-Za-z_$][\w$]*)/, ["keyword", "", "type.declaration"]],
      [/(new|extends|implements|instanceof)(\s+)([A-Z_$][\w$]*(?:\.[A-Z_$][\w$]*)*)/, ["keyword", "", "type.identifier"]],
      [/@[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/, "annotation"],
      [/\b[A-Z_$][\w$]*(?=\s+[a-z_$][\w$]*\s*[=;,)])/, "type.identifier"],
      [/[A-Za-z_$][\w$]*(?=\s*\()/, { cases: { "@keywords": "keyword", "@default": "function" } }],
      [/[a-z_$][\w$]*(?=\s*[,)=;])/, "variable.java"],
    ]);
  } else if (id === "python") {
    prepend("root", [
      [/(class)(\s+)([A-Za-z_]\w*)/, ["keyword", "white", "type.declaration"]],
      [/(def)(\s+)([A-Za-z_]\w*)/, ["keyword", "white", "function.declaration"]],
      [/@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/, "annotation"],
      [/\b[A-Z_]\w*(?=\s*\.)/, "type.identifier"],
      [/[A-Za-z_]\w*(?=\s*\()/, { cases: { "@keywords": "keyword", "@default": "function" } }],
      [/[a-z_]\w*(?=\s*=)/, "variable.python"],
      [/#.*$/, "comment"],
    ]);
  } else if (id === "dockerfile") {
    grammar.ignoreCase = true;
    // Dedicated FROM context avoids mistaking ordinary RUN arguments for images/stages.
    prepend("root", [
      [/(FROM)(\s+)/, ["keyword", { token: "", next: "@fromImage" }]],
      [/(ENV|ARG)(\s+)([\w]+)/, ["keyword", "", { cases: { "@eos": "variable", "@default": { token: "variable", next: "@arguments" } } }]],
      [/(COPY|ADD|RUN|CMD|ENTRYPOINT|EXPOSE|VOLUME|WORKDIR|USER)(\s+)/, ["keyword", ""]],
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
      [/\$\{?[A-Za-z_]\w*\}?/, "variable"],
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

export function lexicalThemeRules(dark: boolean, palette: "wu" | "catppuccin" = "wu"): editor.ITokenThemeRule[] {
  const scopes = {
    "type.declaration.java": ["C084FC", "00665C"],
    "type.declaration.python": ["C084FC", "00665C"],
    "type.image.dockerfile": ["C084FC", "00665C"],
    "type.stage.dockerfile": ["C084FC", "7040A0"],
    "function.java": ["60A5FA", "795E00"],
    "function.declaration.python": ["60A5FA", "795E00"],
    "function.declaration.shell": ["60A5FA", "795E00"],
    "function.command.shell": ["60A5FA", "795E00"],
    "function.python": ["60A5FA", "795E00"],
    "function.shell": ["60A5FA", "795E00"],
    "annotation.java": ["F472B6", "7040A0"],
    "annotation.python": ["F472B6", "7040A0"],
    "variable.dockerfile": ["F0EEF4", "005A9C"],
    "variable.shell": ["F0EEF4", "005A9C"],
    "variable.java": ["F0EEF4", "005A9C"],
    "variable.python": ["F0EEF4", "005A9C"],
    "attribute.name.shell": ["22D3EE", "8C3B15"],
    "attribute.name.dockerfile": ["22D3EE", "8C3B15"],
  };
  const base = dark
    ? (palette === "catppuccin" ? [
      ["keyword", "cba6f7"], ["keyword.control", "cba6f7"], ["comment", "6c7086", "italic"],
      ["string", "a6e3a1"], ["string.escape", "94e2d5"], ["number", "fab387"],
      ["type", "f9e2af"], ["type.identifier", "f9e2af"], ["identifier", "cdd6f4"],
      ["delimiter", "bac2de"], ["delimiter.bracket", "bac2de"], ["operator", "89dceb"], ["constant", "f9e2af"],
    ] : [
      ["keyword", "8B7CF6"],
      ["keyword.control", "8B7CF6"],
      ["comment", "92929A", "italic"],
      ["string", "34D399"],
      ["string.escape", "22D3EE"],
      ["number", "FACC15"],
      ["type", "C084FC"],
      ["type.identifier", "C084FC"],
      ["identifier", "F0EEF4"],
      ["delimiter", "A1A1AA"],
      ["delimiter.bracket", "A1A1AA"],
      ["operator", "A1A1AA"],
      ["constant", "FACC15"],
    ])
    : [];
  const baseRules: editor.ITokenThemeRule[] = base.map(([token, foreground, fontStyle]) => ({
    token,
    foreground,
    ...(fontStyle ? { fontStyle } : {}),
  }));
  const catppuccinScopes: Record<string, string> = {
    "type.declaration.java": "f9e2af",
    "type.declaration.python": "f9e2af",
    "type.image.dockerfile": "f9e2af",
    "type.stage.dockerfile": "cba6f7",
    "function.java": "89b4fa",
    "function.declaration.python": "89b4fa",
    "function.declaration.shell": "89b4fa",
    "function.command.shell": "89b4fa",
    "function.python": "89b4fa",
    "function.shell": "89b4fa",
    "annotation.java": "f5c2e7",
    "annotation.python": "f5c2e7",
    "attribute.name.shell": "94e2d5",
    "attribute.name.dockerfile": "94e2d5",
    "variable.java": "cdd6f4",
    "variable.python": "cdd6f4",
  };
  const scopedRules: editor.ITokenThemeRule[] = Object.entries(scopes).map(([token, colors]) => ({
    token,
    foreground: palette === "catppuccin" ? catppuccinScopes[token] ?? colors[dark ? 0 : 1] : colors[dark ? 0 : 1],
  }));
  return [...baseRules, ...scopedRules];
}
