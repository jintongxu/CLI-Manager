import { monaco } from "../../../shared/platform/monacoSetup";

function normalizeHexColor(color: string, fallback: string): string {
  const raw = color.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.split("").map((char) => `${char}${char}`).join("").toLowerCase()}`;
  }
  return fallback;
}

function mixHex(first: string, second: string, amount: number): string {
  const a = first.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const b = second.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [255, 255, 255];
  return `#${a.map((channel, index) => Math.round(channel + ((b[index] ?? 0) - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function getFileEditorTheme(background: string): string {
  const backgroundHex = normalizeHexColor(background, "#1e1e1e");
  const dark = isDarkHexColor(backgroundHex);
  const foreground = dark ? "#f4f7fb" : "#172033";
  const themeName = `cli-manager-file-editor-${backgroundHex.slice(1)}`;
  monaco.editor.defineTheme(themeName, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    colors: {
      "editor.background": backgroundHex,
      "editorGutter.background": backgroundHex,
      "editor.foreground": foreground,
      "editorLineNumber.foreground": mixHex(backgroundHex, foreground, 0.48),
      "editorLineNumber.activeForeground": foreground,
      "editor.lineHighlightBackground": mixHex(backgroundHex, foreground, dark ? 0.07 : 0.05),
      "editor.selectionBackground": mixHex(backgroundHex, dark ? "#78a9ff" : "#4b78c2", dark ? 0.38 : 0.22),
      "editor.inactiveSelectionBackground": mixHex(backgroundHex, dark ? "#78a9ff" : "#4b78c2", dark ? 0.22 : 0.14),
      "editorIndentGuide.background": mixHex(backgroundHex, foreground, 0.12),
      "editorIndentGuide.activeBackground": mixHex(backgroundHex, foreground, 0.26),
      "editorWidget.background": mixHex(backgroundHex, foreground, dark ? 0.12 : 0.07),
      "editorHoverWidget.background": mixHex(backgroundHex, foreground, dark ? 0.12 : 0.07),
      "scrollbarSlider.background": mixHex(backgroundHex, foreground, 0.24),
      "scrollbarSlider.hoverBackground": mixHex(backgroundHex, foreground, 0.38),
      "scrollbarSlider.activeBackground": mixHex(backgroundHex, foreground, 0.48),
      "minimap.background": mixHex(backgroundHex, foreground, 0.025),
    },
    rules: [],
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
