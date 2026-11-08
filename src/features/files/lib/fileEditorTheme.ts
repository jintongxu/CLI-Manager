import { lexicalThemeRules } from "../../../shared/platform/monacoLexical";
import { monaco } from "../../../shared/platform/monacoSetup";

function mixHex(first: string, second: string, amount: number): string {
  const a = first.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const b = second.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [255, 255, 255];
  return `#${a.map((channel, index) => Math.round(channel + ((b[index] ?? 0) - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function getFileEditorTheme(background: string): string {
  const backgroundHex = background.trim().toLowerCase() || "#1e1e2e";
  const dark = isDarkHexColor(backgroundHex);
  const catppuccin = backgroundHex === "#1e1e2e";
  const foreground = catppuccin ? "#cdd6f4" : dark ? "#f0eef4" : "#172033";
  const themeName = `cli-manager-file-editor-${backgroundHex.slice(1)}`;
  monaco.editor.defineTheme(themeName, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    colors: {
      "editor.background": backgroundHex,
      "editorGutter.background": backgroundHex,
      "editor.foreground": foreground,
      "editorOverviewRuler.background": backgroundHex,
      "editorWidget.background": catppuccin ? "#313244" : dark ? "#22252e" : mixHex(backgroundHex, foreground, 0.07),
      "editorHoverWidget.background": catppuccin ? "#313244" : dark ? "#22252e" : mixHex(backgroundHex, foreground, 0.07),
      "editorLineNumber.foreground": catppuccin ? "#6c7086" : dark ? "#555766" : mixHex(backgroundHex, foreground, 0.48),
      "editorLineNumber.activeForeground": foreground,
      "editor.lineHighlightBackground": catppuccin ? "#313244" : dark ? "#ffffff08" : mixHex(backgroundHex, foreground, 0.05),
      "editor.selectionBackground": catppuccin ? "#585b704c" : dark ? "#7aa2f74c" : mixHex(backgroundHex, "#4b78c2", 0.22),
      "editor.inactiveSelectionBackground": catppuccin ? "#585b702e" : dark ? "#7aa2f72e" : mixHex(backgroundHex, "#4b78c2", 0.14),
      "editorCursor.foreground": catppuccin ? "#f5e0dc" : dark ? "#f0eef4" : foreground,
      "editorIndentGuide.background": catppuccin ? "#45475a" : dark ? "#ffffff0f" : mixHex(backgroundHex, foreground, 0.12),
      "editorIndentGuide.activeBackground": catppuccin ? "#585b70" : dark ? "#ffffff24" : mixHex(backgroundHex, foreground, 0.26),
      "editorBracketHighlight.foreground1": catppuccin ? "#89b4fa" : dark ? "#7aa2f7" : "#00665c",
      "editorBracketHighlight.foreground2": catppuccin ? "#94e2d5" : dark ? "#22d3ee" : "#795e00",
      "editorBracketHighlight.foreground3": catppuccin ? "#cba6f7" : dark ? "#c084fc" : "#8c3b15",
      "scrollbarSlider.background": dark ? "#ffffff29" : mixHex(backgroundHex, foreground, 0.24),
      "scrollbarSlider.hoverBackground": mixHex(backgroundHex, foreground, 0.38),
      "scrollbarSlider.activeBackground": mixHex(backgroundHex, foreground, 0.48),
      "minimap.background": backgroundHex,
    },
    rules: lexicalThemeRules(dark, catppuccin ? "catppuccin" : "wu"),
  });
  return themeName;
}

export function isDarkHexColor(color: string): boolean {
  const raw = color.trim().replace(/^#/, "");
  const hex = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return true;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.5;
}
