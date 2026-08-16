/** Static formula/description text for the "explain this number" drawer
 * (KpiExplainDrawer.tsx) -- keyed by the exact label a KpiTile is given
 * across the app. Deliberately NOT wired to fetch the raw rows behind a
 * number (that would mean threading raw campaign/order data through every
 * section that renders a KpiTile just to power a tooltip-adjacent feature) --
 * this is the formula + a one-line "why", which is what actually answers
 * "how is this computed" for an analyst. A label with no entry here still
 * opens the drawer with just its value; nothing breaks on an unknown key. */
export interface MetricExplainer {
  formula: string;
  description: string;
}

export const METRIC_EXPLAINERS: Record<string, MetricExplainer> = {
  Spend: { formula: "Sum of daily spend", description: "Total media cost the platform reports for this date range, in INR." },
  Impressions: { formula: "Sum of daily impressions", description: "How many times ads were shown." },
  Clicks: { formula: "Sum of daily clicks", description: "How many times an ad was clicked." },
  Orders: { formula: "Sum of daily conversions", description: "Platform-attributed conversions for this range -- not the same as Shopify's ground-truth order count." },
  Conversions: { formula: "Sum of daily conversions", description: "Platform-attributed conversions for this range." },
  Revenue: { formula: "Sum of daily attributed revenue", description: "Revenue the platform itself attributes to its ads -- its own claim, not Shopify's ground truth." },
  ROAS: { formula: "Revenue ÷ Spend", description: "Return on ad spend, using the platform's own attributed revenue." },
  "Marginal ROAS": {
    formula: "(Revenue − prior Revenue) ÷ (Spend − prior Spend)",
    description: "Return on the next rupee of spend vs. the immediately preceding equal-length period. Null if spend didn't increase.",
  },
  CTR: { formula: "Clicks ÷ Impressions", description: "Click-through rate." },
  CPC: { formula: "Spend ÷ Clicks", description: "Average cost per click." },
  CPM: { formula: "Spend ÷ Impressions × 1000", description: "Average cost per 1,000 impressions." },
  ACOS: { formula: "Spend ÷ Revenue", description: "Advertising cost of sale -- the inverse of ROAS, expressed as a percentage of revenue." },
  CVR: { formula: "Conversions ÷ Clicks", description: "Conversion rate." },
  CPA: { formula: "Spend ÷ Conversions", description: "Average cost per acquisition." },
  AOV: { formula: "Revenue ÷ Orders", description: "Average order value." },
  Discounts: { formula: "Sum of daily order discounts", description: "Total discount value applied across Shopify orders in this range." },
  Sessions: { formula: "Shopify Analytics session total (live)", description: "Site-wide sessions for the range, fetched live via ShopifyQL -- not stored." },
  "Google Sessions": { formula: "Sessions where utm_source classifies as Google", description: "Directional, not platform-verified -- classified from each session's utm_source tag." },
  "Meta Sessions": { formula: "Sessions where utm_source classifies as Meta", description: "Directional, not platform-verified -- classified from each session's utm_source tag." },
  "Units Sold": { formula: "Sum of line-item quantity", description: "Total units sold across Shopify orders in this range." },
  "Ads Revenue": { formula: "Sum of platform-attributed revenue", description: "Meta's own attributed revenue for ads matched to this row." },
  "Ads ROAS": { formula: "Ads Revenue ÷ Spend", description: "Return on ad spend using Meta's own attribution." },
  "Website Revenue": {
    formula: "Sum of Shopify revenue for the matched SKU(s)",
    description: "The SKU's entire Shopify revenue for the period -- not necessarily revenue this specific ad caused. See the directional-attribution caveat on this section.",
  },
  "Website ROAS": { formula: "Website Revenue ÷ Spend", description: "Return on ad spend using Shopify's ground-truth order revenue instead of the platform's own claim." },
};
