import { useEffect, useState } from "react";
import type { Platform, CampaignRow, AnomaliesResponse, DiagnosticsResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchAnomalies, fetchDiagnostics } from "../lib/api";
import { formatCurrency, formatNumber, formatPercent, formatDateLabel } from "../lib/format";
import { formatCVRWithCI, formatBudgetCeiling, CONFIDENCE_LABELS, CONFIDENCE_TONE } from "../lib/statsFormat";
import { normalizeStatus } from "../lib/campaignStatus";
import { Modal } from "./Modal";

interface Props {
  platform: Platform;
  range: DateRange;
  grossMargin: number;
  campaign: CampaignRow;
  onClose: () => void;
}

const TONE_TEXT: Record<string, string> = {
  good: "text-status-good",
  warning: "text-status-warning",
  critical: "text-status-critical",
  muted: "text-ink-muted",
};

export function CampaignDetailPanel({ platform, range, grossMargin, campaign, onClose }: Props) {
  const [tab, setTab] = useState<"anomalies" | "diagnostics">("anomalies");
  const [anomalies, setAnomalies] = useState<AnomaliesResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAnomalies(platform, range.from, range.to, campaign.campaignId),
      fetchDiagnostics(platform, range.from, range.to, campaign.campaignId, grossMargin),
    ])
      .then(([a, d]) => {
        if (cancelled) return;
        setAnomalies(a);
        setDiagnostics(d);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [platform, range.from, range.to, campaign.campaignId, grossMargin]);

  const status = normalizeStatus(campaign.status);

  return (
    <Modal title={campaign.campaignName ?? campaign.campaignId} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        <span>{status.label}</span>
        <span>·</span>
        <span>Spend {formatCurrency(campaign.spend)}</span>
        <span>·</span>
        <span>Revenue {formatCurrency(campaign.revenue)}</span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">CVR (95% CI)</div>
          <div className="mt-1 text-lg font-semibold text-ink-primary tabular-nums">{formatCVRWithCI(campaign.cvr, campaign.cvrCI)}</div>
          {campaign.cvrCI && (
            <div className={`mt-0.5 text-xs ${TONE_TEXT[CONFIDENCE_TONE[campaign.cvrCI.confidence]]}`}>
              {CONFIDENCE_LABELS[campaign.cvrCI.confidence]} (n={formatNumber(campaign.clicks)} clicks)
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Reliability (ROAS)</div>
          <div className="mt-1 text-lg font-semibold text-ink-primary">{campaign.reliability.label ?? "N/A"}</div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {campaign.reliability.cv != null ? `CV ${formatPercent(campaign.reliability.cv, 1)}` : "not enough daily history"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Skew flags</div>
          <div className="mt-1 text-sm text-ink-primary">
            {campaign.roasSkewed || campaign.cpaSkewed ? (
              <>
                {campaign.roasSkewed && <div>ROAS — trust median</div>}
                {campaign.cpaSkewed && <div>CPA — trust median</div>}
              </>
            ) : (
              <span className="text-ink-muted">None detected</span>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 flex gap-1 border-b border-border">
        {(["anomalies", "diagnostics"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? "border-platform-google text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-ink-muted">Loading…</div>
      ) : tab === "anomalies" ? (
        <AnomaliesTab data={anomalies} />
      ) : (
        <DiagnosticsTab data={diagnostics} />
      )}
    </Modal>
  );
}

function AnomaliesTab({ data }: { data: AnomaliesResponse | null }) {
  if (!data) return <div className="text-sm text-ink-muted">Couldn't load anomaly data.</div>;
  if (!data.metGate) {
    return (
      <div className="rounded-md border border-border bg-surface-0 px-3 py-3 text-sm text-ink-muted">
        Not enough daily history yet ({data.n} day{data.n === 1 ? "" : "s"}, need 8+) to detect anomalies reliably.
      </div>
    );
  }
  if (data.spend.length === 0 && data.cpa.length === 0) {
    return <div className="rounded-md border border-border bg-surface-0 px-3 py-3 text-sm text-ink-muted">No anomalies detected in this range.</div>;
  }
  return (
    <div className="space-y-3">
      {data.spend.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Spend anomalies</div>
          {data.spend.map((a, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-1.5 text-xs text-ink-secondary mb-1">
              <span className="text-status-warning">⚠</span>
              <span className="font-medium text-ink-primary">{formatDateLabel(a.date)}</span>
              <span>
                {formatCurrency(a.value)} — {a.direction === "high" ? "unusually high" : "unusually low"} (
                {formatCurrency(a.fenceDistance)} outside the normal range)
              </span>
            </div>
          ))}
        </div>
      )}
      {data.cpa.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">CPA anomalies</div>
          {data.cpa.map((a, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-1.5 text-xs text-ink-secondary mb-1">
              <span className="text-status-warning">⚠</span>
              <span className="font-medium text-ink-primary">{formatDateLabel(a.date)}</span>
              <span>
                {formatCurrency(a.value)} CPA — {a.direction === "high" ? "unusually high" : "unusually low"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsTab({ data }: { data: DiagnosticsResponse | null }) {
  if (!data) return <div className="text-sm text-ink-muted">Couldn't load diagnostics.</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CorrelationCard title="Spend vs ROAS" subtitle="diminishing-returns signal" summary={data.spendVsRoas} />
        <CorrelationCard title="CTR vs CVR" subtitle="" summary={data.ctrVsCvr} />
      </div>

      <div className="rounded-lg border border-border bg-surface-0 px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Diminishing-returns / budget ceiling</div>
        {!data.diminishingReturns ? (
          <div className="mt-1.5 text-sm text-ink-muted">Insufficient history for a curve (need 14+ days).</div>
        ) : !data.diminishingReturns.reliable ? (
          <div className="mt-1.5 text-sm text-ink-muted">
            Spend is not the main driver here (R²={data.diminishingReturns.r2.toFixed(2)}) — model unreliable, no conclusions drawn.
          </div>
        ) : data.diminishingReturns.budgetCeiling == null ? (
          <div className="mt-1.5 text-sm text-ink-muted">No diminishing-returns shape detected — spend doesn't show a clear budget ceiling here.</div>
        ) : (
          <div className="mt-1.5">
            <div className="text-lg font-semibold text-ink-primary tabular-nums">{formatBudgetCeiling(data.diminishingReturns.budgetCeiling)}</div>
            <div className="text-xs text-ink-muted">
              recommended spend ceiling — beyond this, marginal ROAS falls below break-even (R²={data.diminishingReturns.r2.toFixed(2)}, n=
              {data.diminishingReturns.n})
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CorrelationCard({
  title,
  subtitle,
  summary,
}: {
  title: string;
  subtitle: string;
  summary: { r: number; n: number; strength: string; label: string } | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-0 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {title}
        {subtitle && <span className="normal-case text-ink-muted"> — {subtitle}</span>}
      </div>
      {!summary ? (
        <div className="mt-1.5 text-sm text-ink-muted">Not enough data (need 10+ days).</div>
      ) : (
        <>
          <div className="mt-1.5 text-lg font-semibold text-ink-primary tabular-nums">
            r = {summary.r.toFixed(2)} <span className="text-sm font-normal text-ink-secondary capitalize">({summary.strength})</span>
          </div>
          <div className="text-xs text-ink-muted">
            n={summary.n} · {summary.label}
          </div>
        </>
      )}
    </div>
  );
}
