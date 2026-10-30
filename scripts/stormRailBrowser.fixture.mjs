import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preprocessCSS, resolveConfig } from "vite";

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/** Use the production nav/button classes without inventing a pane-chrome ancestor. */
export async function verifyStormRail(page) {
  const renderer = read("src/features/terminal/hooks/useTerminalToolbarRenderer.tsx");
  const navClass = renderer.match(/<nav\s+className="([^"]+)"/)[1];
  assert.ok(navClass.includes("ui-terminal-action-sidebar"));
  assert.ok(!navClass.includes("ui-terminal-pane-chrome"));
  const buttonClass = renderer.match(/className="([^"]*ui-action-files[^"]*)"/)[1];
  const config = await resolveConfig({ configFile: false }, "build");
  const css = await preprocessCSS(
    '@import "./themes.css";\n@import "./components.css";',
    new URL("../src/styles/rail-fixture.css", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    config,
  );
  const button = (id, attrs = "", cls = buttonClass) => `<button id="${id}" class="${cls}" ${attrs}><svg><path d="M0 0h8v8"/></svg>files</button>`;
  const contents = button("normal") + button("active", 'data-active="true"')
    + button("disabled", "disabled") + button("data-disabled", 'data-disabled="true"')
    + button("aria-disabled", 'aria-disabled="true"')
    + button("disabled-active", 'disabled data-active="true"')
    + button("git", "", buttonClass.replace("ui-action-files", "ui-action-git"));
  await page.setContent(`<html data-theme="dark" data-dark-palette="tokyo-night-storm"><head><style>${css.code}</style></head><body>
    <nav class="${navClass}" data-dock-side="right">${contents}</nav>
    <nav class="${navClass}" data-dock-side="left">${button("left")}</nav>
    <section>${button("panel")}</section></body></html>`);
  const color = id => page.$eval(`#${id}`, element => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, shadow: style.boxShadow, outline: style.outlineWidth };
  });
  const normal = await color("normal");
  assert.equal(normal.color, "rgb(224, 175, 104)");
  assert.equal(await page.$eval("#normal svg", el => getComputedStyle(el).color), normal.color);
  assert.equal((await color("git")).color, "rgb(187, 154, 247)");
  const active = await color("active");
  assert.equal(active.color, normal.color);
  assert.notEqual(active.background, normal.background);
  assert.match(active.shadow, /inset/);
  for (const id of ["disabled", "data-disabled", "aria-disabled", "disabled-active", "left"]) {
    assert.equal((await color(id)).color, "rgb(169, 177, 214)", id);
  }
  assert.notEqual((await color("panel")).color, normal.color);
  await page.hover("#normal");
  const hover = await color("normal");
  assert.notEqual(hover.color, normal.color);
  assert.notEqual(hover.background, normal.background);
  await page.hover("#disabled");
  assert.equal((await color("disabled")).color, "rgb(169, 177, 214)");
  await page.keyboard.press("Tab");
  await page.$eval("#normal", el => el.focus());
  assert.ok(parseFloat((await color("normal")).outline) >= 2);
  await page.$eval("nav", el => el.dataset.showText = "true");
  assert.equal((await color("git")).color, "rgb(187, 154, 247)");
  await page.$eval("html", el => el.dataset.darkPalette = "other");
  assert.notEqual((await color("normal")).color, normal.color);
  return { normal, active, hover, verified: ["production classes", "independent nav", "SVG inheritance", "hover", "active", "three disabled kinds", "left dock", "panel isolation", "keyboard focus", "text mode", "other palette"] };
}
