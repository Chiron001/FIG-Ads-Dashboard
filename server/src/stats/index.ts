// One tested statistical helpers module (spec §8), used by the metrics/
// stats routes. Deferred methods (spec §0 — chi-square, Gini, CUSUM,
// Holt-Winters/seasonality, LTV:CAC) are intentionally absent; each has a
// // out of scope: <reason> marker at its would-be call site instead.

export * from "./descriptive";
export * from "./outliers";
export * from "./inference";
export * from "./correlation";
export * from "./regression";
export * from "./smoothing";
export * from "./concentration";
