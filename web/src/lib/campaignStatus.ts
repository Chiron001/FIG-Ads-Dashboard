export interface StatusDisplay {
  label: string;
  tone: "good" | "warning" | "critical" | "muted";
}

// Google (ENABLED/PAUSED/REMOVED) and Meta (effective_status: ACTIVE/PAUSED/
// ARCHIVED/DELETED/WITH_ISSUES/PENDING_REVIEW/...) use different
// vocabularies -- normalize both into the same small set of display tones
// rather than showing raw platform strings inconsistently across sections.
export function normalizeStatus(raw: string | null): StatusDisplay {
  if (!raw) return { label: "Unknown", tone: "muted" };
  const s = raw.toUpperCase();

  if (s === "ENABLED" || s === "ACTIVE") return { label: "Active", tone: "good" };
  if (s.includes("PAUSED")) return { label: "Paused", tone: "warning" };
  if (s === "ARCHIVED") return { label: "Archived", tone: "muted" };
  if (s === "REMOVED" || s === "DELETED") return { label: "Removed", tone: "muted" };
  if (s === "WITH_ISSUES" || s === "DISAPPROVED") return { label: "Needs attention", tone: "critical" };
  if (s === "PENDING_REVIEW" || s === "IN_PROCESS" || s === "PENDING_BILLING_INFO") return { label: "Pending", tone: "warning" };

  return { label: raw, tone: "muted" };
}
