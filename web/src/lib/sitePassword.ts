// Whole-site shared-password gate (see server/src/middleware/siteAuth.ts) --
// the entered password is stored client-side and attached as a header to
// every API request from here on, rather than a cookie/session. Simple by
// design: one shared secret to keep a link that's being passed around from
// being casually stumbled into, not a defense against a determined reader
// of the JS bundle (who could always find the check itself). localStorage,
// not sessionStorage -- once someone's entered it correctly, they shouldn't
// have to re-enter it every new tab.

const KEY = "fig_site_password";

export function getStoredPassword(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // localStorage unavailable (private browsing, etc.)
  }
}

export function setStoredPassword(password: string): void {
  try {
    localStorage.setItem(KEY, password);
  } catch {
    /* password just won't persist across reloads -- not worth surfacing an error over */
  }
}

export function clearStoredPassword(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
