export type Theme = "light" | "dark";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "roads-theme";

// Dark is the default: light only when someone chose it and the choice is stored.
export const DEFAULT_THEME: Theme = "dark";

// Runs in <head> before the first paint, so the dark default (or a stored choice) is on screen from
// the start instead of flashing light until React hydrates. Only an explicit stored "light" stays light.
export const THEME_INIT_SCRIPT = `try{if(window.localStorage.getItem("${STORAGE_KEY}")!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

// The chosen theme lives in localStorage, an external system, so React reads it through
// useSyncExternalStore: the server render and hydration start on the dark default, then switch to
// the stored choice. A choice made this session is also kept in memory, so toggling still works when
// storage is blocked (private window).
export function createThemeStore(getStorage: () => ThemeStorage) {
  let chosen: Theme | null = null;
  const listeners = new Set<() => void>();

  function getSnapshot(): Theme {
    if (chosen) return chosen;
    try {
      const stored = getStorage().getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // localStorage unavailable (private window, blocked storage) — fall back to the default.
    }
    return DEFAULT_THEME;
  }

  function set(theme: Theme) {
    chosen = theme;
    try {
      getStorage().setItem(STORAGE_KEY, theme);
    } catch {
      // best-effort only; a failed write here shouldn't break the toggle itself.
    }
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot,
    getServerSnapshot: (): Theme => DEFAULT_THEME,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set,
    toggle: () => set(getSnapshot() === "dark" ? "light" : "dark"),
  };
}
