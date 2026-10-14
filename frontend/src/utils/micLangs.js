// Languages for voice typing and the "Hey TradeMind" assistant, and the
// one the trader last chose (Ask AI's language chip).
export const MIC_LANGS = [
  { code: "en", locale: "en-US", label: "English" },
  { code: "sw", locale: "sw-TZ", label: "Kiswahili" },
  { code: "fr", locale: "fr-FR", label: "Français" },
  { code: "ar", locale: "ar-SA", label: "العربية" },
  { code: "zh", locale: "zh-CN", label: "中文" },
  { code: "ko", locale: "ko-KR", label: "한국어" },
  { code: "ja", locale: "ja-JP", label: "日本語" },
];
export const MIC_LANG_KEY = "tm.micLang";

export function savedMicLang(appLang = "en") {
  try {
    const s = localStorage.getItem(MIC_LANG_KEY);
    if (MIC_LANGS.some((l) => l.code === s)) return s;
  } catch { /* storage blocked */ }
  return MIC_LANGS.some((l) => l.code === appLang) ? appLang : "en";
}

export const micLocale = (code) => (MIC_LANGS.find((l) => l.code === code) || MIC_LANGS[0]).locale;
