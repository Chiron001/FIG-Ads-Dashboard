/** Interpolates red -> amber -> green as roas goes from 0 to targetRoas to
 * 1.25x targetRoas -- "how strong is this ROAS relative to the goal",
 * pivoted on the same Target ROAS the rest of the dashboard already uses
 * for its Scale/Maintain/Review verdict, so the color means the same thing
 * everywhere it appears (the Spend Flow band, the SKU/creative bar charts). */
export function roasColor(roas: number | null | undefined, targetRoas: number): string {
  if (roas == null || targetRoas <= 0) return "#6b7280";
  const t = Math.max(0, Math.min(1, roas / (targetRoas * 1.25)));
  return t < 0.5 ? mix("#f26d6d", "#e5a94e", t / 0.5) : mix("#e5a94e", "#4ade80", (t - 0.5) / 0.5);
}

function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
