import { Sun, Moon, SunMoon } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

const LABELS = {
  dark: "Dark mode",
  light: "Light mode",
  auto: "Auto (dark 7pm–7am)",
};
const ICONS = { dark: Moon, light: Sun, auto: SunMoon };

// Cycles Dark -> Light -> Auto. `variant="inline"` renders a labeled row
// (sidebar, Settings); default renders a compact icon-only button.
function ThemeToggle({ variant = "icon", className = "" }) {
  const { mode, toggleTheme } = useTheme();
  const Icon = ICONS[mode] || Moon;

  if (variant === "inline") {
    return (
      <button
        onClick={toggleTheme}
        className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition ${className}`}
      >
        <Icon size={18} />
        {LABELS[mode]}
        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
          Tap to switch
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={`Theme: ${LABELS[mode]} — tap to switch`}
      title={LABELS[mode]}
      className={`p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:border-green-500/50 transition ${className}`}
    >
      <Icon size={16} />
    </button>
  );
}

export default ThemeToggle;
