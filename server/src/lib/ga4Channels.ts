import type { ChannelBucket } from "@fig/shared";

// GA4's own default channel grouping (sessionDefaultChannelGroup) has 16
// possible values -- confirmed live against the real property (see
// npm run ga4:test --workspace server). Collapsed here into the 5 buckets
// the Predictive Analysis forecast actually segments by, so re-bucketing
// later never needs a re-sync (fact_ga4_channel_daily stores the raw group).
//
// "Cross-network" is GA4's label for Performance Max / cross-channel paid
// campaigns -- paid, not organic, despite the name. Falls back to
// "referral_email_other" for any channel group not in this map (a future
// GA4 group this list doesn't know about yet), rather than throwing or
// silently dropping that revenue out of every bucket.
const GA4_CHANNEL_TO_BUCKET: Record<string, ChannelBucket> = {
  "Paid Search": "paid",
  "Paid Social": "paid",
  "Paid Shopping": "paid",
  "Paid Other": "paid",
  "Display": "paid",
  "Cross-network": "paid",
  "Organic Search": "organic",
  "Organic Social": "organic",
  "Organic Shopping": "organic",
  "Organic Video": "organic",
  "Direct": "direct",
  "Referral": "referral_email_other",
  "Email": "referral_email_other",
  "Mobile Push Notifications": "referral_email_other",
  "AI Assistant": "referral_email_other",
  "Unassigned": "unassigned",
};

export function collapseGA4Channel(rawChannelGroup: string): ChannelBucket {
  return GA4_CHANNEL_TO_BUCKET[rawChannelGroup] ?? "referral_email_other";
}
