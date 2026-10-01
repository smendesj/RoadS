// The last-activity stamp lives in localStorage so every open tab shares one idle clock.
const KEY = "roads-last-activity";

export function readActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

export function touchActivity() {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked — idle logout simply can't track this browser.
  }
}

export function clearActivity() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing to clear.
  }
}
