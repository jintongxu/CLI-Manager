import React from "react";
import { createRoot } from "react-dom/client";
import { MarkdownContent } from "../../src/shared/ui/MarkdownContent";
import { useSettingsStore } from "../../src/shared/preferences/settingsStore";
import "../../src/App.css";

// Real renderer and production CSS entry; only the host geometry/palette is fixture-owned.
const long = "long_value_".repeat(100);
const content = [
  "# 阅读排版 Markdown",
  "中文段落与 **重点**、`inline code` 和 [外部链接](https://example.com?q=1#part)。搜索 目标。",
  "## 二级标题",
  "- 列表项目\n  - 嵌套列表\n- 第二项\n\n1. 有序列表\n2. 后续项目",
  "> 引用说明：低对比边线，中文依然清晰。",
  "```javascript\nconst value = '" + long + "';\nconsole.log(value, 42);\n```",
  "```python\ndef greet(name):\n    message = 'hello'\n    count = 42\n    return message * count\n# " + long + "\n```",
  "```unknown-fixture\n" + long + "\nsecond unknown line\n```",
  "```\n" + long + "\nplain second line\n```",
  "```\nsingle line without language\n```",
  "| 左列 | 对齐右列 |\n| :--- | ---: |\n| " + long + " | 数值 |\n| 第二行 | 42 |",
  "行内数学 $x^2$。\n\n$$\n\\sum_{i=1}^{n} i\n$$",
  "[段内导航](#二级标题)\n\n<script>window.unsafeMarkdown = true</script>",
].join("\n\n");

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const surface = params.get("surface") ?? "default";
const light = theme === "light";
document.documentElement.dataset.theme = theme;
useSettingsStore.setState({ resolvedTheme: theme, language: "en-US" });
const palette = {
  "--term-panel-bg": light ? "#ffffff" : "#101216",
  "--term-panel-fg": light ? "#24292f" : "#e6edf3",
  "--term-panel-dim": light ? "#57606a" : "#9da7b3",
  "--term-panel-border": light ? "#d0d7de" : "#30363d",
  "--term-panel-card": light ? "#f6f8fa" : "#161b22",
  "--term-panel-card-inner": light ? "#f6f8fa" : "#161b22",
  "--term-panel-cyan": light ? "#0969da" : "#79c0ff",
  "--terminal-theme-background": light ? "#ffffff" : "#101216",
  "--terminal-theme-foreground": light ? "#24292f" : "#e6edf3",
  "--terminal-theme-muted": light ? "#57606a" : "#9da7b3",
  "--terminal-theme-accent": light ? "#0969da" : "#79c0ff",
  "--file-editor-muted": light ? "#57606a" : "#9da7b3",
  "--file-editor-border": light ? "#d0d7de" : "#30363d",
};
const hostClass = surface === "file" ? "ui-file-editor-markdown-preview"
  : surface === "subagent" ? "subagent-transcript-shell"
  : surface === "terminal" ? "terminal-markdown-preview" : "";
const terminal = ["terminal", "file", "subagent"].includes(surface);
createRoot(document.getElementById("root")!).render(
  <main className={hostClass} style={{ ...palette, width: 480, padding: 24, boxSizing: "border-box", height: "100%", overflowY: "auto" } as React.CSSProperties}>
    <MarkdownContent content={content} query="目标" compact={surface === "compact"}
      variant={terminal ? "terminal" : "default"} terminalCodeTheme={theme}
      className={surface === "subagent" ? "subagent-transcript-markdown" : undefined}
      linkBehavior="open" />
  </main>,
);
