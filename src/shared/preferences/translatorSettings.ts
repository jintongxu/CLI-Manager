import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_TRANSLATOR_PROMPT =
  "You are a professional, native-level translator. Translate the text below into {lang}.\n\n\
Requirements:\n\
1. Accuracy & Fluency: Convey the original meaning faithfully without omitting, exaggerating, or explaining. The translation must sound natural, idiomatic, and culturally appropriate to native speakers.\n\
2. Structure & Formatting: Preserve all original formatting, paragraph breaks, bullet points, numbered lists, URLs, code blocks, and LaTeX formulas ($...$ or $$...$$).\n\
3. Untranslatable Tokens: Keep proper nouns, brand names, technical identifiers, variables, and code syntax unchanged.\n\
4. Output Constraints: Output ONLY the translated text. Do NOT wrap in quotes, do NOT include headings, and do NOT add any preamble, conversational filler, or explanatory notes.\n\n\
<source_text>\n{text}\n</source_text>";

export interface TranslatorGlobalShortcuts {
  enabled: boolean;
  input: string;
  selection: string;
  screenshot: string;
}

export const DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS: TranslatorGlobalShortcuts = {
  enabled: true,
  input: "Alt+T",
  selection: "Ctrl+Alt+T",
  screenshot: "Alt+S",
};

export function migrateTranslatorGlobalShortcuts(value: unknown): TranslatorGlobalShortcuts {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS };
  }
  const raw = value as Partial<TranslatorGlobalShortcuts>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    input: typeof raw.input === "string" ? raw.input.trim() : DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS.input,
    selection:
      typeof raw.selection === "string" ? raw.selection.trim() : DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS.selection,
    screenshot:
      typeof raw.screenshot === "string" ? raw.screenshot.trim() : DEFAULT_TRANSLATOR_GLOBAL_SHORTCUTS.screenshot,
  };
}

export function syncTranslatorGlobalShortcutsToNative(cfg: TranslatorGlobalShortcuts): void {
  if (typeof window === "undefined") return;
  const bindings = cfg.enabled
    ? { input: cfg.input, selection: cfg.selection, screenshot: cfg.screenshot }
    : { input: "", selection: "", screenshot: "" };
  void invoke("translator_set_hotkeys", { bindings }).catch(() => {});
}
