// Canonical types shared between /server and /web.
//
// This file is intentionally a stub during Phase 1 (scaffold). The full
// canonical data model (CanonicalRow / fact_ad_performance shape,
// AdsConnector interface, SyncLogEntry, etc.) is built in Phase 3 alongside
// the DB migrations, per the build order in the spec — schema first,
// non-negotiable.

export type Platform = "google" | "meta" | "amazon" | "myntra";

export interface HealthStatus {
  ok: boolean;
  service: string;
  time: string; // ISO timestamp, IST
}
