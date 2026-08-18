// Light/dark theme -- persisted client-side (a genuine exception to this
// app's usual "no localStorage, resets on reload" convention for UI state:
// unlike a filter or a picked platform, a display preference like this is
// expected to survive a reload the way it does in every OS/native app).
export type Theme = "dark" | "light";

const KEY = "fig_theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // localStorage unavailable (private browsing, etc.) -- dark stays the default
  }
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* preference just won't persist across reloads -- not worth surfacing an error over */
  }
}

/** Sets the `data-theme` attribute the CSS in index.css keys off of.
 * Called synchronously in main.tsx before React mounts (so the very first
 * paint -- including the password gate, which renders before anything
 * theme-aware -- already reflects the stored preference, no flash of the
 * wrong theme), and again whenever the toggle changes it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}
