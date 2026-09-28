import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemeContext } from "./theme-context";

// mode is what the user picked: "light" | "dark" | "auto". theme is what's
// actually shown ("light" | "dark") -- every existing consumer (status
// bar, snapshot capture) keeps reading theme. Auto = dark at night so a
// bright screen doesn't glare in the dark (user request, 2026-09-28).
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 7;

function isNight(date = new Date()) {
  const h = date.getHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

function resolve(mode) {
  if (mode === "auto") return isNight() ? "dark" : "light";
  return mode;
}

function getInitialMode() {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch { /* storage unavailable */ }
  return "dark";
}

const NEXT_MODE = { dark: "light", light: "auto", auto: "dark" };

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(getInitialMode);
  const [theme, setThemeState] = useState(() => resolve(getInitialMode()));

  useEffect(() => {
    try { localStorage.setItem("theme", mode); } catch { /* ignore */ }
    const apply = () => setThemeState(resolve(mode));
    apply();
    if (mode !== "auto") return;
    // Re-check every minute so Auto flips at 7pm/7am without a reload.
    const timer = setInterval(apply, 60 * 1000);
    return () => clearInterval(timer);
  }, [mode]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const toggleTheme = useCallback(() => setMode((m) => NEXT_MODE[m] || "dark"), []);

  // Without this, a new object (and new toggleTheme closure) was created
  // every render, re-rendering every consumer regardless of whether theme
  // actually changed.
  const value = useMemo(() => ({ theme, mode, toggleTheme, setMode }), [theme, mode, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
