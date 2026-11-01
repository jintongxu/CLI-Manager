import type { TranslationKey } from "../../../shared/i18n/index";

/** 目标语言顺序与展示名对齐 Kivio 的翻译语言列表；语言解析仍在后端。 */
export const TRANSLATOR_TARGET_LANGUAGES = [
  "auto",
  "zh",
  "zh-Hant",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "it",
  "ru",
  "ar",
  "hi",
  "th",
  "vi",
  "id",
  "ms",
  "tr",
  "nl",
  "pl",
  "uk",
  "sv",
  "da",
  "no",
  "fi",
] as const;

export type TranslatorTargetLanguage = (typeof TRANSLATOR_TARGET_LANGUAGES)[number];

const LANGUAGE_LABEL_KEYS: Record<TranslatorTargetLanguage, TranslationKey> = {
  auto: "translator.lang.auto",
  zh: "translator.lang.zh",
  "zh-Hant": "translator.lang.zh-Hant",
  en: "translator.lang.en",
  ja: "translator.lang.ja",
  ko: "translator.lang.ko",
  fr: "translator.lang.fr",
  de: "translator.lang.de",
  es: "translator.lang.es",
  pt: "translator.lang.pt",
  it: "translator.lang.it",
  ru: "translator.lang.ru",
  ar: "translator.lang.ar",
  hi: "translator.lang.hi",
  th: "translator.lang.th",
  vi: "translator.lang.vi",
  id: "translator.lang.id",
  ms: "translator.lang.ms",
  tr: "translator.lang.tr",
  nl: "translator.lang.nl",
  pl: "translator.lang.pl",
  uk: "translator.lang.uk",
  sv: "translator.lang.sv",
  da: "translator.lang.da",
  no: "translator.lang.no",
  fi: "translator.lang.fi",
};

export function translatorLanguageLabelKey(language: string): TranslationKey {
  return LANGUAGE_LABEL_KEYS[language as TranslatorTargetLanguage] ?? "translator.lang.en";
}
