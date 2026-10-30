import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/shared/ui/MarkdownContent.tsx", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);

test("shared Markdown renderer enables KaTeX math without enabling raw HTML", () => {
  assert.match(source, /import rehypeKatex from "rehype-katex"/);
  assert.match(source, /import remarkMath from "remark-math"/);
  assert.match(source, /import "katex\/dist\/katex\.min\.css"/);
  assert.match(source, /remarkPlugins=\{remarkPlugins\}/);
  assert.match(source, /rehypePlugins=\{rehypePlugins\}/);
  assert.match(source, /skipHtml/);
});

test("math packages are direct dependencies with lockfile entries", () => {
  assert.equal(packageJson.dependencies["remark-math"], "^6.0.0");
  assert.equal(packageJson.dependencies["rehype-katex"], "^7.0.1");
  assert.equal(packageJson.dependencies.katex, "^0.16.47");

  const rootDependencies = packageLock.packages[""].dependencies;
  assert.equal(rootDependencies["remark-math"], "^6.0.0");
  assert.equal(rootDependencies["rehype-katex"], "^7.0.1");
  assert.equal(rootDependencies.katex, "^0.16.47");
});

test("code metrics belong to shared CSS and neither code branch wraps long lines", () => {
  const css = readFileSync(new URL("../src/styles/components/history-scroll-markdown.css", import.meta.url), "utf8");
  assert.match(source, /className="ui-markdown-code-highlight"/);
  assert.match(source, /customStyle=\{\{ margin: 0, padding: 0, background: "transparent" \}\}/);
  assert.match(source, /wrapLongLines=\{false\}/);
  assert.match(css, /\.ui-markdown-code-block pre \{[\s\S]*?min-width: 0;[\s\S]*?overflow-x: auto;/);
  assert.match(css, /white-space: pre !important/);
  assert.match(source, /getTableTextAlign\(align \?\? style\?\.textAlign\)/);
});

test("copy preserves original fenced code, safe fence selection and local feedback", () => {
  assert.match(source, /code\.matchAll\(/);
  assert.match(source, /Math\.max\(3, maxBackticks \+ 1\)/);
  assert.match(source, /await copyTextToClipboard\(markdown\)/);
  assert.match(source, /setCopyState\("copied"\)/);
  assert.match(source, /setCopyState\("failed"\)/);
  assert.match(source, /HIGHLIGHT_TEXT_MAX_LENGTH = 24_000/);
  assert.match(source, /HIGHLIGHT_PARTS_MAX = 400/);
  assert.match(source, /class MarkdownRenderBoundary extends Component/);
  assert.match(source, /supportsRegExpLookbehind \? \[remarkGfm, remarkMath\] : \[\]/);
});

test("Markdown reader theme owns opaque contrast surfaces without replacing Prism's working AST", () => {
  const css = readFileSync(new URL("../src/styles/components/history-scroll-markdown.css", import.meta.url), "utf8");
  assert.match(source, /PrismAsyncLight as SyntaxHighlighter/);
  assert.match(source, /registerLanguage\("javascript", javascript\)/);
  assert.match(source, /registerLanguage\("python", python\)/);
  assert.match(source, /data-code-theme=\{readingTheme\}/);
  assert.match(source, /string: \{ \.\.\.oneLight.string, color: "#246b32" \}/);
  assert.match(source, /number: \{ \.\.\.oneLight.number, color: "#925000" \}/);
  for (const theme of ["light", "dark"]) assert.ok(css.includes(`.ui-markdown[data-code-theme="${theme}"]`));
  assert.match(css, /--md-reading-bg: var\(--bg-primary\)/);
  assert.match(css, /--md-code-bg: color-mix\(in srgb, var\(--bg-primary\)/);
  assert.match(css, /--md-quote-bg: color-mix\(in srgb, var\(--bg-primary\)/);
  for (const token of ["reading-bg", "heading", "code-bg", "code-header-bg", "quote-bg", "table-header-bg"]) {
    assert.match(css, new RegExp(`--md-${token}:`));
  }
});

test("real browser fixture verifies dev/build actual token colors, contrast and scroll movement", () => {
  const fixture = readFileSync(new URL("./markdownVisualBrowser.fixture.mjs", import.meta.url), "utf8");
  assert.match(fixture, /createViteServer/);
  assert.match(fixture, /mode === "dev"/);
  assert.match(fixture, /keyword.*string.*number/);
  assert.match(fixture, /token.contrast >= 4.5/);
  assert.match(fixture, /new Set\(Object.values\(tokens\).map\(token => token.color\)\).size, 3/);
  assert.match(fixture, /el.scrollLeft > 0/);
  assert.match(fixture, /requestfailed/);
});
