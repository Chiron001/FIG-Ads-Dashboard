import { useState } from "react";
import type { Platform, CampaignRow, CompareCampaignsResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchCompareCampaigns } from "../lib/api";
import { formatNumber, formatPercent } from "../lib/format";
import { Modal } from "./Modal";

interface Props {
  platform: Platform;
  range: DateRange;
  campaigns: CampaignRow[];
  onClose: () => void;
}

export function CompareCampaignsPanel({ platform, range, campaigns, onClose }: Props) {
  const options = campaigns.filter((c) => c.clicks > 0);
  const [campaignAId, setCampaignAId] = useState(options[0]?.campaignId ?? "");
  const [campaignBId, setCampaignBId] = useState(options[1]?.campaignId ?? "");
  const [result, setResult] = useState<CompareCampaignsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCompare() {
    if (!campaignAId || !campaignBId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCompareCampaigns(platform, range.from, range.to, campaignAId, campaignBId);
      setResult(res);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Compare two campaigns" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">Campaign A</label>
          <select
            value={campaignAId}
            onChange={(e) => setCampaignAId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-sm text-ink-primary"
          >
            {options.map((c) => (
              <option key={c.campaignId} value={c.campaignId}>
                {c.campaignName ?? c.campaignId}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">Campaign B</label>
          <select
            value={campaignBId}
            onChange={(e) => setCampaignBId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-sm text-ink-primary"
          >
            {options.map((c) => (
              <option key={c.campaignId} value={c.campaignId}>
                {c.campaignName ?? c.campaignId}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleCompare}
          disabled={loading || campaignAId === campaignBId || !campaignAId || !campaignBId}
          className="w-full rounded-md bg-platform-google/90 px-3 py-2 text-sm font-medium text-white hover:bg-platform-google disabled:opacity-50 transition-colors"
        >
          {loading ? "Comparing…" : "Compare"}
        </button>

        {campaignAId === campaignBId && <div className="text-xs text-ink-muted">Pick two different campaigns.</div>}
        {error && <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">{error}</div>}

        {result && (
          <div className="rounded-lg border border-border bg-surface-0 px-4 py-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="truncate font-medium text-ink-primary">{result.campaignA.campaignName ?? result.campaignA.campaignId}</div>
                <div className="text-ink-secondary tabular-nums">
                  CVR {formatPercent(result.campaignA.cvr)} ({formatNumber(result.campaignA.conversions)} / {formatNumber(result.campaignA.clicks)})
                </div>
              </div>
              <div>
                <div className="truncate font-medium text-ink-primary">{result.campaignB.campaignName ?? result.campaignB.campaignId}</div>
                <div className="text-ink-secondary tabular-nums">
                  CVR {formatPercent(result.campaignB.cvr)} ({formatNumber(result.campaignB.conversions)} / {formatNumber(result.campaignB.clicks)})
                </div>
              </div>
            </div>
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm font-medium ${
                result.confidence === "insufficient"
                  ? "bg-surface-2 text-ink-muted"
                  : result.significant
                    ? "bg-status-good/15 text-status-good"
                    : "bg-status-warning/15 text-status-warning"
              }`}
            >
              {result.verdict}
              {result.confidence === "sufficient" && <span className="ml-1 font-normal opacity-80">(z={result.z.toFixed(2)})</span>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
