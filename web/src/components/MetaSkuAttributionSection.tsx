import { Fragment, useEffect, useState } from "react";
import type { MetaSkuAttributionResponse, MetaSkuAdRow, MetaSkuAdSetGroup, MetaSkuCampaignGroup } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchMetaSkuAttribution } from "../lib/api";
import { formatCurrency, formatMultiplier } from "../lib/format";

interface Props {
  range: DateRange;
  refreshKey: number;
}

// Small pill so a matched SKU token reads as data, not plain text -- and an
// unmatched ad is visibly "not yet tagged" rather than blending into the row.
function SkuBadge({ sku }: { sku: string | null }) {
  if (!sku) {
    return <span className="text-xs italic text-ink-muted">no SKU tag</span>;
  }
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">{sku}</span>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className={`inline-block shrink-0 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}>
      <path d="M5.5 2L11.5 8L5.5 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RoasCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-muted">—</span>;
  // Directional-attribution numbers can get extreme (see the caveat banner)
  // -- flag anything implausibly large rather than let it read as a real ratio.
  const extreme = value > 100;
  return <span className={extreme ? "text-status-warning" : undefined}>{formatMultiplier(value)}</span>;
}

export function MetaSkuAttributionSection({ range, refreshKey }: Props) {
  const [data, setData] = useState<MetaSkuAttributionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedAdSets, setExpandedAdSets] = useState<Set<string>>(new Set());
  const [onlyMatched, setOnlyMatched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMetaSkuAttribution(range.from, range.to)
      .then((res) => !cancelled && setData(res))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

  function toggleCampaign(id: string) {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAdSet(id: string) {
    setExpandedAdSets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const campaigns: MetaSkuCampaignGroup[] = (data?.campaigns ?? [])
    .map((c) => (onlyMatched ? { ...c, adSets: c.adSets.filter((s) => s.ads.some((a) => a.sku)) } : c))
    .filter((c) => !onlyMatched || c.adSets.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-xs text-ink-muted">
          {data ? (
            <>
              <span className="font-medium text-ink-primary">{data.matchedAds}</span> of {data.totalAds} ads have a SKU tag in their name
              {data.totalAds > 0 && data.matchedAds < data.totalAds && " — rename the rest to \"FIG-...\" to bring them in"}
            </>
          ) : (
            "Loading…"
          )}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <input type="checkbox" checked={onlyMatched} onChange={(e) => setOnlyMatched(e.target.checked)} className="accent-platform-meta" />
          Only show tagged ads
        </label>
      </div>

      <div className="mx-4 mb-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-ink-secondary">
        <span className="font-medium text-status-warning">Directional, not exact: </span>
        Website Revenue is that SKU's <em>entire</em> Shopify revenue for the period, not revenue this specific ad caused — if two ads
        share the same SKU tag, both show the same total (not split). Website ROAS gets extreme for very-low-spend or freshly-launched
        ads; treat it as a signal, not a precise number.
      </div>

      <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        {campaigns.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-muted">{data ? "No campaigns in this range." : "Loading…"}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Campaign / Ad Set / Ad
                </th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Spend</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Ads Revenue</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Ads ROAS</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Website Revenue</th>
                <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-muted">Website ROAS</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => {
                const campaignOpen = expandedCampaigns.has(campaign.campaignId);
                return (
                  <Fragment key={campaign.campaignId}>
                    <tr
                      onClick={() => toggleCampaign(campaign.campaignId)}
                      className="cursor-pointer border-b border-border bg-surface-2/30 font-semibold hover:bg-surface-2/60 transition-colors"
                    >
                      <td className="max-w-sm truncate px-4 py-2 text-ink-primary">
                        <Chevron open={campaignOpen} /> {campaign.campaignName ?? campaign.campaignId}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(campaign.spend)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(campaign.adsRevenue)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        <RoasCell value={campaign.adsRoas} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(campaign.websiteRevenue)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        <RoasCell value={campaign.websiteRoas} />
                      </td>
                    </tr>

                    {campaignOpen &&
                      campaign.adSets.map((adSet: MetaSkuAdSetGroup) => {
                        const adSetOpen = expandedAdSets.has(adSet.adSetId);
                        return (
                          <Fragment key={adSet.adSetId}>
                            <tr
                              onClick={() => toggleAdSet(adSet.adSetId)}
                              className="cursor-pointer border-b border-border hover:bg-surface-2/40 transition-colors"
                            >
                              <td className="max-w-sm truncate py-2 pl-8 pr-4 text-ink-primary">
                                <Chevron open={adSetOpen} /> {adSet.adSetName ?? adSet.adSetId}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(adSet.spend)}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(adSet.adsRevenue)}</td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                <RoasCell value={adSet.adsRoas} />
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(adSet.websiteRevenue)}</td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                <RoasCell value={adSet.websiteRoas} />
                              </td>
                            </tr>

                            {adSetOpen &&
                              adSet.ads.map((ad: MetaSkuAdRow) => (
                                <tr key={ad.adId} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                                  <td className="max-w-sm py-2 pl-14 pr-4">
                                    <div className="truncate text-ink-secondary" title={ad.adName ?? ad.adId}>
                                      {ad.adName ?? ad.adId}
                                    </div>
                                    <SkuBadge sku={ad.sku} />
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(ad.spend)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(ad.adsRevenue)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">
                                    <RoasCell value={ad.adsRoas} />
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">{formatCurrency(ad.websiteRevenue)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">
                                    <RoasCell value={ad.websiteRoas} />
                                  </td>
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
