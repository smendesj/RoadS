"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { createThemeStore, type Theme } from "@/lib/theme-store";

type ThemeContextValue = { theme: Theme; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeStore = createThemeStore(() => window.localStorage);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getServerSnapshot);

  // Reads the store rather than `theme`: while hydrating, `theme` is the server's "light", and
  // acting on it would strip the dark class the head script already put on the page.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeStore.getSnapshot() === "dark");
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle: themeStore.toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
