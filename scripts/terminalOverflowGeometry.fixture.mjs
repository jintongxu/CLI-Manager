// Shared by component tests; builds a standalone fixture with the real stylesheet cascade.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@tailwindcss/node";
export async function saveOverflowFixture(name, tree) {
  const classes = new Set();
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  function html(node) {
    if (node == null || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(html).join("");
    if (typeof node !== "object") return escape(node);
    const { children, className = "", ...props } = node.props ?? {};
    className.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    if (["Terminal", "X", "VendorIcon"].includes(node.type)) {
      const size = props.size ?? 14;
      const path = node.type === "X" ? "M6 6L18 18M18 6L6 18" : "M4 5H20V19H4ZM7 9L10 12L7 15M12 15H16";
      return `<svg class="${escape(className)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="${path}"/></svg>`;
    }
    const tag = /^[a-z][a-z0-9-]*$/.test(node.type) ? node.type : "div";
    const attrs = Object.entries(props).filter(([key, value]) =>
      (key.startsWith("data-") || key.startsWith("aria-") || key === "title") && value != null)
      .map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
    return `<${tag} class="${escape(className)}"${attrs}>${html(children)}</${tag}>`;
  }
  const body = html(tree);
  const root = resolve(".");
  const compiler = await compile('@import "tailwindcss"; @import "./src/styles/components.css";', { base: root, onDependency() {} });
  const dir = resolve(process.env.TERMINAL_GEOMETRY_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${name}.html`), `<!doctype html><meta charset="utf-8"><style>${compiler.build([...classes])}</style>
<style>body{padding:16px;--outline-variant:#888;--on-surface-variant:#222;--menu-fg:#222;--menu-bg:#fff}h1{font-size:16px}</style>
<h1>${name}: compiled component markup + real CSS</h1>${body}`);
}
