import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, extname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build, createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Node host API: caller supplies installed Puppeteer + Chrome, no machine paths in repo. */
export async function verifyMarkdownVisual({ puppeteer, executablePath, screenshotDir, mode = "build", diagnose = false } = {}) {
  assert.ok(["dev", "build"].includes(mode), "mode must be dev or build");
  assert.ok(puppeteer && executablePath, "Pass puppeteer and executablePath explicitly");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const outDir = await mkdtemp(join(tmpdir(), "markdown-visual-"));
  let server;
  let browser;
  try {
    if (mode === "build") await build({
      root, configFile: false, logLevel: "error", plugins: [react(), tailwindcss()],
      build: { outDir, emptyOutDir: true, rollupOptions: {
        input: resolve(root, "scripts/fixtures/markdownVisual.tsx"),
        output: { entryFileNames: "fixture.js", assetFileNames: "[name][extname]" },
      } },
    });
    const html = '<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/markdownVisual.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
    if (mode === "dev") {
      server = await createViteServer({ root, configFile: false, logLevel: "error", plugins: [react(), tailwindcss(), {
        name: "markdown-fixture-html", configureServer(server) { server.middlewares.use(async (req, res, next) => {
          if (new URL(req.url, "http://localhost").pathname !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml(req.url, html.replace('<link rel="stylesheet" href="/markdownVisual.css">', "").replace("/fixture.js", "/scripts/fixtures/markdownVisual.tsx")));
        }); }
      }], server: { host: "127.0.0.1", port: 0 } });
      await server.listen();
    } else server = createServer(async (req, res) => {
      try {
        const path = new URL(req.url, "http://localhost").pathname;
        if (path === "/") {
          res.setHeader("Content-Type", "text/html");
          res.end(html);
          return;
        }
        const file = resolve(outDir, `.${path}`);
        assert.ok(file.startsWith(outDir));
        res.setHeader("Content-Type", extname(file) === ".css" ? "text/css" : "text/javascript");
        res.end(await readFile(file));
      } catch { res.statusCode = 404; res.end(); }
    });
    if (mode === "build") await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(mode === "dev" ? server.httpServer : server).address().port}`;
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 1000 });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    const consoleMessages = [], networkErrors = [];
    page.on("console", msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
    page.on("requestfailed", req => networkErrors.push({ url: req.url(), error: req.failure() }));
    page.on("response", res => { if (res.status() >= 400) networkErrors.push({ url: res.url(), status: res.status() }); });
    const results = [];
    for (const theme of ["light", "dark"]) {
      for (const surface of ["default", "terminal", "file", "subagent", "compact"]) {
        await page.goto(`${origin}/?theme=${theme}&surface=${surface}`, { waitUntil: "networkidle0" });
        await page.waitForSelector(".ui-markdown-code-block pre code");
        // Wait for AST settlement; computed colors and contrast below decide success.
        await page.waitForFunction(() => [...document.querySelectorAll(".ui-markdown-code-highlight")].slice(0, 2).every(pre => pre.querySelector(".token")), { timeout: 5000 }).catch(error => { if (!diagnose) throw error; });
        const metrics = await page.evaluate(() => {
          const root = document.querySelector(".ui-markdown");
          const css = selector => {
            const el = root.querySelector(selector);
            const c = getComputedStyle(el);
            return { color: c.color, background: c.backgroundColor, font: c.fontSize, line: c.lineHeight,
              padding: c.padding, border: c.borderColor, radius: c.borderRadius, overflow: c.overflowX };
          };
          const pres = [...root.querySelectorAll(".ui-markdown-code-block pre")].map(el => ({
            width: el.clientWidth, scroll: el.scrollWidth, style: getComputedStyle(el).whiteSpace,
            font: getComputedStyle(el).fontSize, line: getComputedStyle(el).lineHeight,
            padding: getComputedStyle(el).padding, overflow: getComputedStyle(el).overflowX,
            inline: el.getAttribute("style"),
          }));
          const table = root.querySelector(".ui-markdown-table-wrap");
          const rgb = color => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const contrast = (a, b) => {
            const lum = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
          };
          const rootBg = getComputedStyle(root).backgroundColor;
          const codeBg = css(".ui-markdown-code-block").background;
          return {
            contrasts: { heading: contrast(css("h2").color, rootBg), body: contrast(css(".ui-markdown-p").color, rootBg),
              label: contrast(css(".ui-markdown-code-header").color, css(".ui-markdown-code-header").background),
              quote: contrast(css("blockquote").color, css("blockquote").background),
              tableHeader: contrast(css("th").color, css("th").background) },
            tokens: [...root.querySelectorAll(".ui-markdown-code-highlight")].slice(0, 2).map(pre => Object.fromEntries(["keyword", "string", "number"].map(kind => {
              const expected = kind === "keyword" ? ["const", "def"] : kind === "string" ? ["'long_value_", "'hello'"] : ["42"];
              const el = [...pre.querySelectorAll(".token")].find(el => expected.some(text => el.textContent.startsWith(text)));
              return [kind, el ? { text: el.textContent.slice(0, 40), color: getComputedStyle(el).color, inline: el.getAttribute("style"), contrast: contrast(getComputedStyle(el).color, codeBg) } : null];
            }))),
            body: css(".ui-markdown-code-block"),
            canvas: getComputedStyle(root).backgroundColor,
            root: { width: root.clientWidth, scroll: root.scrollWidth, height: root.clientHeight, maxHeight: getComputedStyle(root).maxHeight },
            host: { width: root.parentElement.clientWidth, scroll: root.parentElement.scrollWidth },
            pres, table: { width: table.clientWidth, scroll: table.scrollWidth },
            heading: css("h2"), paragraph: css(".ui-markdown-p"), header: css(".ui-markdown-code-header"),
            inline: css(".ui-markdown-inline-code"), quote: css("blockquote"), quoteText: css("blockquote .ui-markdown-p"),
            th: css("th"), td: css("td"),
            math: root.querySelectorAll(".katex").length, marks: root.querySelectorAll("mark").length,
            unsafe: Boolean(window.unsafeMarkdown || root.querySelector("script")),
            rightAlign: getComputedStyle(root.querySelector("th:last-child")).textAlign,
            single: [...root.children].some(el => el.classList.contains("ui-markdown-inline-code")),
            labels: [...root.querySelectorAll(".ui-markdown-code-header > span")].map(el => el.textContent),
          };
        });
        const id = `${mode}-${surface}-${theme}`;
        if (diagnose) { results.push({ id, ...metrics }); continue; }
        for (const tokens of metrics.tokens) {
          assert.ok(Object.values(tokens).every(Boolean), `${id}: actual keyword/string/number text must be tokenized`);
          assert.equal(new Set(Object.values(tokens).map(token => token.color)).size, 3, `${id}: keyword/string/number must have three distinct computed colors`);
          for (const token of Object.values(tokens)) assert.ok(token.contrast >= 4.5, `${id}: ${token.text} contrast ${token.contrast}`);
        }
        for (const [part, ratio] of Object.entries(metrics.contrasts)) assert.ok(ratio >= 4.5, `${id}: ${part} contrast ${ratio}`);
        assert.notEqual(metrics.header.background, metrics.body.background, `${id}: separate code header/body`);
        assert.notEqual(metrics.body.background, metrics.canvas, `${id}: separate code/reading canvas`);
        assert.notEqual(metrics.quote.background, metrics.canvas, `${id}: separate quote canvas`);
        assert.notEqual(metrics.heading.color, metrics.paragraph.color, `${id}: heading emphasis`);
        assert.equal(metrics.pres.length, 4, id);
        for (const pre of metrics.pres) {
          assert.ok(pre.scroll > pre.width + 100, `${id}: long line must scroll`);
          assert.equal(pre.style, "pre", id);
          assert.equal(pre.overflow, "auto", id);
          assert.equal(pre.font, metrics.pres[0].font, id);
          assert.equal(pre.line, metrics.pres[0].line, id);
          assert.equal(pre.padding, metrics.pres[0].padding, id);
        }
        assert.deepEqual(metrics.labels, ["javascript", "python", "unknown-fixture", "text"]);
        assert.ok(metrics.table.scroll > metrics.table.width + 100, id);
        const scrolled = await page.evaluate(() => {
          const elements = [...document.querySelectorAll('.ui-markdown-code-block pre, .ui-markdown-table-wrap')];
          return elements.map(el => { el.scrollLeft = 100; const moved = el.scrollLeft > 0; el.scrollLeft = 0; return moved; });
        });
        assert.ok(scrolled.every(Boolean), `${id}: overflowing code and table must actually scroll`);
        assert.ok(metrics.root.scroll <= metrics.root.width + 1, `${id}: root overflow`);
        assert.ok(metrics.host.scroll <= metrics.host.width + 1, `${id}: parent overflow`);
        assert.equal(metrics.rightAlign, "right", id);
        assert.ok(metrics.math >= 2 && metrics.marks > 0 && !metrics.unsafe && metrics.single, id);
        assert.notEqual(metrics.heading.color, "rgb(0, 0, 0)", id);
        assert.notEqual(metrics.header.background, "rgba(0, 0, 0, 0)", id);
        assert.equal(metrics.quoteText.color, metrics.quote.color, `${id}: quote text follows muted palette`);
        if (["terminal", "file", "subagent"].includes(surface)) {
          const foreground = theme === "light" ? "rgb(36, 41, 47)" : "rgb(230, 237, 243)";
          assert.notEqual(metrics.heading.color, foreground, id);
          assert.equal(metrics.th.color, foreground, id);
          assert.equal(metrics.td.color, foreground, id);
        }
        await page.$eval("main", el => { el.style.width = "280px"; });
        assert.ok(await page.$eval(".ui-markdown", el => el.scrollWidth <= el.clientWidth + 1), `${id}: narrow root overflow`);
        assert.ok(await page.$eval("main", el => el.scrollWidth <= el.clientWidth + 1), `${id}: narrow parent overflow`);
        await page.$eval("main", el => { el.style.width = "480px"; });
        if (surface === "compact") {
          assert.equal(metrics.root.maxHeight, "220px");
          assert.ok(metrics.root.height <= 220);
        }
        // Real copy button, original fenced content and both feedback states.
        await page.evaluate(() => {
          window.copiedMarkdown = null;
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
            writeText: async text => { window.copiedMarkdown = text; },
          } });
        });
        await page.click(".ui-markdown-code-copy");
        await page.waitForFunction(() => document.querySelector(".ui-markdown-code-copy").textContent === "✓");
        const copied = await page.evaluate(() => window.copiedMarkdown);
        assert.equal(copied, "```javascript\nconst value = '" + "long_value_".repeat(100) + "';\nconsole.log(value, 42);\n```");
        await page.evaluate(() => {
          navigator.clipboard.writeText = async () => { throw Error("fixture denial"); };
          document.execCommand = () => { throw Error("fixture denial"); };
          document.querySelector(".ui-markdown-code-copy").click();
        });
        await page.waitForFunction(() => document.querySelector(".ui-markdown-code-copy").textContent === "!");
        // Same-document navigation stays in the current Markdown root.
        await page.$eval('.ui-markdown-link[href^="#"]', el => el.click());
        assert.equal(new URL(page.url()).hash, "", id);
        await page.$eval(".ui-markdown-code-copy", el => el.focus());
        assert.ok(await page.$eval(".ui-markdown-code-copy", el => parseFloat(getComputedStyle(el).outlineWidth) >= 2), id);
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${id}.png`), fullPage: true });
        results.push({ id, ...metrics });
      }
    }
    console.log(JSON.stringify({ mode, errors, consoleMessages, networkErrors, results }, null, 2));
    assert.deepEqual(errors, []);
    assert.deepEqual(networkErrors, []);
    assert.deepEqual(consoleMessages.filter(message => message.type === "error"), []);
    return results;
  } finally {
    await browser?.close();
    if (server) { if (mode === "dev") await server.close(); else await new Promise(resolve => server.close(resolve)); }
    await rm(outDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [puppeteerPath, executablePath, screenshotDir, mode = "build", diagnostic] = process.argv.slice(2);
  assert.ok(puppeteerPath && executablePath, "Usage: node scripts/markdownVisualBrowser.fixture.mjs <puppeteer module> <chrome executable> [screenshot directory] [dev|build] [diagnose]");
  const { default: puppeteer } = await import(pathToFileURL(resolve(puppeteerPath)).href);
  await verifyMarkdownVisual({ puppeteer, executablePath, screenshotDir, mode, diagnose: diagnostic === "diagnose" });
}
