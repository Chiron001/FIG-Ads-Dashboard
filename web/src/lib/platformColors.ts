import type { Platform } from "@fig/shared";

// Literal hex, mirroring the --color-platform-* tokens in index.css.
// Duplicated intentionally: Recharts passes `stroke`/`fill` as raw SVG
// attributes, and CSS custom properties don't reliably resolve there
// across browsers the way they do in a `style` prop — so chart code needs
// real hex, not var(--color-platform-google). Keep both in sync if the
// palette ever changes.
export const PLATFORM_COLORS: Record<Platform, string> = {
  google: "#3987e5",
  meta: "#d95926",
  amazon: "#199e70",
  myntra: "#c98500",
};
