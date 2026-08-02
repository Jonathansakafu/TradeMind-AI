import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "sw", label: "Kiswahili" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
];

// variant="inline" renders a labeled row (matches ThemeToggle's inline
// variant, used together with it in Settings' Appearance card).
function LanguageToggle({ className = "" }) {
  const { i18n } = useTranslation();

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-slate-500 dark:text-slate-400 ${className}`}>
      <Languages size={18} />
      <span>Language</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="ml-auto bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-green-500 transition"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>{lang.label}</option>
        ))}
      </select>
    </div>
  );
}

export default LanguageToggle;
