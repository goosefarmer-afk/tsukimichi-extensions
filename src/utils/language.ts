import { type LANGUAGE_KEY, LANGUAGES, type Language } from "@tsukimichi/common";

export function getLanguageKey(iso6391: string): LANGUAGE_KEY | undefined {
  return Object.values(LANGUAGES).find(
    (l) => l.iso6391 === iso6391 || l.key.toLowerCase() === iso6391.toLowerCase(),
  )?.key;
}

export function getLanguageInfo(langCode: string): Language | null {
  return LANGUAGES[langCode as LANGUAGE_KEY] || null;
}

export function getLanguagesByRegion(baseLanguage: string): Language[] {
  return Object.values(LANGUAGES).filter(
    (language) => language.iso6391 === baseLanguage || language.key === baseLanguage,
  );
}

export function isRegionalVariant(langCode: string): boolean {
  return langCode.includes("-") && langCode !== "zh-Hans" && langCode !== "zh-Hant";
}

export function getBaseLanguage(langCode: string): string {
  if (langCode.startsWith("zh-")) return "zh";
  return langCode.split("-")?.[0] || langCode;
}
