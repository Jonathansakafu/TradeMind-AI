import { Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

// `variant="inline"` renders a labeled row (sidebar); default renders a
// compact icon-only button (headers, settings cards).
function ThemeToggle({ variant = "icon", className = "" }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  if (variant === "inline") {
    return (
      <button
        onClick={toggleTheme}
        className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition ${className}`}
      >
        {isDark ? <Moon size={18} /> : <Sun size={18} />}
        {isDark ? "Dark mode" : "Light mode"}
        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
          Tap to switch
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:border-green-500/50 transition ${className}`}
    >
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

export default ThemeToggle;
