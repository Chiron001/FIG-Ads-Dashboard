import { useEffect, useMemo, useState } from "react";
import type { AdditionalCost, AdditionalCostType, IntegrationStatus, ShopifyOrderSummary, MetricsSummaryResponse } from "@fig/shared";
import type { DateRange } from "../lib/dateRanges";
import { fetchSettings, updateSettings, fetchShopifySummary, fetchSummary } from "../lib/api";
import { formatCurrency, formatNumber } from "../lib/format";
import { InfoNote } from "./InfoNote";

interface Props {
  range: DateRange;
}

const COST_TYPE_LABELS: Record<AdditionalCostType, string> = {
  percent_of_revenue: "% of Revenue",
  flat_per_order: "Flat, per Order",
  flat_total: "Flat, whole range",
};
const COST_TYPE_OPTIONS = Object.keys(COST_TYPE_LABELS) as AdditionalCostType[];

function newCostId(): string {
  return `cost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function costsEqual(a: AdditionalCost[], b: AdditionalCost[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsSection({ range }: Props) {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [cogsRatePct, setCogsRatePct] = useState("35"); // draft, kept as a string so a half-typed "3" doesn't get clobbered
  const [savedCogsRate, setSavedCogsRate] = useState(0.35);
  const [costs, setCosts] = useState<AdditionalCost[]>([]);
  const [savedCosts, setSavedCosts] = useState<AdditionalCost[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<ShopifyOrderSummary | null>(null);
  const [adSpend, setAdSpend] = useState<MetricsSummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSettings()
      .then((res) => {
        if (cancelled) return;
        setIntegrations(res.integrations);
        setAnthropicConfigured(res.settings.anthropicApiKeyConfigured);
        setCogsRatePct(String(Math.round(res.settings.cogsRate * 1000) / 10));
        setSavedCogsRate(res.settings.cogsRate);
        setCosts(res.settings.additionalCosts);
        setSavedCosts(res.settings.additionalCosts);
      })
      .catch((err) => !cancelled && setError(String(err.message ?? err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // EBITDA preview data -- reuses the same "blended Google+Meta spend vs.
  // real Shopify revenue" pairing the Shopify page's own ROAS/ACOS uses,
  // the one deliberate spot in the app where blending platforms is the
  // actual question being asked.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchShopifySummary(range.from, range.to), fetchSummary(range.from, range.to, ["google", "meta"])])
      .then(([summaryRes, adSpendRes]) => {
        if (cancelled) return;
        setSummary(summaryRes.summary);
        setAdSpend(adSpendRes);
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setAdSpend(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  const cogsRateDraft = useMemo(() => {
    const n = Number(cogsRatePct);
    return Number.isFinite(n) ? n / 100 : NaN;
  }, [cogsRatePct]);

  const dirty = cogsRateDraft !== savedCogsRate || !costsEqual(costs, savedCosts);

  function updateCost(id: string, patch: Partial<AdditionalCost>) {
    setCosts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addCost() {
    setCosts((cs) => [...cs, { id: newCostId(), name: "", type: "percent_of_revenue", value: 0 }]);
  }

  function removeCost(id: string) {
    setCosts((cs) => cs.filter((c) => c.id !== id));
  }

  async function handleSave() {
    setError(null);
    setSaveMessage(null);
    if (!Number.isFinite(cogsRateDraft) || cogsRateDraft < 0 || cogsRateDraft >= 100) {
      setError("COGS % must be a number between 0 and 99.");
      return;
    }
    if (costs.some((c) => !c.name.trim())) {
      setError("Every additional cost needs a name.");
      return;
    }
    setSaving(true);
    try {
      const res = await updateSettings({ cogsRate: cogsRateDraft, additionalCosts: costs });
      setSavedCogsRate(res.settings.cogsRate);
      setSavedCosts(res.settings.additionalCosts);
      setCosts(res.settings.additionalCosts);
      setSaveMessage("Saved.");
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setSaving(false);
    }
  }

  // Separate save action from the COGS/Additional Costs form above -- the
  // key is write-only and should take effect the moment it's saved, not get
  // bundled into that form's dirty-tracking/discard flow.
  async function saveApiKey(value: string) {
    setKeyError(null);
    setKeyMessage(null);
    setSavingKey(true);
    try {
      const res = await updateSettings({ anthropicApiKey: value });
      setAnthropicConfigured(res.settings.anthropicApiKeyConfigured);
      setIntegrations(res.integrations);
      setApiKeyDraft("");
      setKeyMessage(res.settings.anthropicApiKeyConfigured ? "Saved. The AI home page is now live." : "Cleared.");
    } catch (err) {
      setKeyError(String((err as Error).message ?? err));
    } finally {
      setSavingKey(false);
    }
  }

  function discardChanges() {
    setCogsRatePct(String(Math.round(savedCogsRate * 1000) / 10));
    setCosts(savedCosts);
    setError(null);
    setSaveMessage(null);
  }

  // Revenue - COGS - Ad Spend - Additional Costs, using the DRAFT cogsRate/
  // costs (not just what's saved) so editing a value updates this live,
  // before Save is even clicked -- the point of showing it at all.
  const preview = useMemo(() => {
    if (!summary || !adSpend || !Number.isFinite(cogsRateDraft)) return null;
    const revenue = summary.revenue;
    const cogs = revenue * cogsRateDraft;
    const spend = adSpend.blended.spend;
    const additionalTotal = costs.reduce((sum, c) => {
      if (c.type === "percent_of_revenue") return sum + revenue * c.value;
      if (c.type === "flat_per_order") return sum + summary.orders * c.value;
      return sum + c.value; // flat_total
    }, 0);
    return { revenue, cogs, spend, additionalTotal, ebitda: revenue - cogs - spend - additionalTotal };
  }, [summary, adSpend, cogsRateDraft, costs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <InfoNote label="About this page">
          App-wide config, shared by everyone with the site password -- not per-user. API integration keys are never
          shown here, even to admins: only whether each one is connected and which env var(s) it needs, since this
          page is reachable by everyone the password is shared with.
        </InfoNote>
        Settings -- API integrations, Products COGS, and EBITDA cost inputs
      </div>

      {error && <div className="rounded-md border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">{error}</div>}

      {/* --- API Integrations ------------------------------------------- */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <h3 className="font-display text-base text-ink-primary">API Integrations</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          Connection status only -- the actual keys/tokens live in Railway's environment variables, never here.
        </p>
        <div className="mt-3 divide-y divide-border">
          {(integrations ?? []).map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink-primary">{i.label}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {i.envVars.map((v) => (
                    <span key={v} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  i.connected ? "bg-status-good/15 text-status-good" : "bg-surface-2 text-ink-muted"
                }`}
              >
                {i.connected ? "Connected" : "Not connected"}
              </span>
            </div>
          ))}
          {!integrations && loading && <div className="py-4 text-center text-sm text-ink-muted">Loading…</div>}
        </div>
      </div>

      {/* --- AI Assistant (Anthropic API key) ----------------------------- */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base text-ink-primary">AI Assistant</h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              anthropicConfigured ? "bg-status-good/15 text-status-good" : "bg-surface-2 text-ink-muted"
            }`}
          >
            {anthropicConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          Powers the Home page's "ask anything" box. Paste an Anthropic API key here -- it's stored in the database,
          never shown again once saved, and never returned to the browser after this.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            placeholder={anthropicConfigured ? "Replace the saved key…" : "sk-ant-…"}
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-0 px-2.5 py-1.5 font-mono text-sm text-ink-primary placeholder:font-sans placeholder:text-ink-muted"
          />
          <button
            type="button"
            onClick={() => saveApiKey(apiKeyDraft)}
            disabled={savingKey || !apiKeyDraft.trim()}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-0 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingKey ? "Saving…" : "Save key"}
          </button>
          {anthropicConfigured && (
            <button type="button" onClick={() => saveApiKey("")} className="shrink-0 text-xs text-ink-muted underline hover:text-status-critical">
              Clear
            </button>
          )}
        </div>
        {keyError && <p className="mt-2 text-xs text-status-critical">{keyError}</p>}
        {keyMessage && !keyError && <p className="mt-2 text-xs text-status-good">{keyMessage}</p>}
      </div>

      {/* --- Products COGS ------------------------------------------------ */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <h3 className="font-display text-base text-ink-primary">Products COGS</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          Cost of goods sold as a % of selling price -- no real per-product cost data exists yet, so POAS (Products,
          Product Quadrants) and the EBITDA preview below both use this one flat assumption across every product.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-secondary">
          COGS
          <input
            type="number"
            min={0}
            max={99}
            step={0.5}
            value={cogsRatePct}
            onChange={(e) => setCogsRatePct(e.target.value)}
            className="w-20 rounded-md border border-border bg-surface-0 px-2 py-1.5 text-right tabular-nums text-ink-primary"
          />
          <span className="text-ink-muted">% of revenue</span>
        </label>
      </div>

      {/* --- Additional Costs (EBITDA) ------------------------------------ */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="font-display text-base text-ink-primary">Additional Costs (EBITDA)</h3>
          <InfoNote label="How each type works">
            % of Revenue -- multiplied by revenue for the selected range (e.g. payment gateway fees). Flat, per Order
            -- multiplied by order count (e.g. packaging, pick-and-pack). Flat, whole range -- a fixed amount
            regardless of the range's length (e.g. monthly software/tooling) -- a modeling simplification, not
            pro-rated by days.
          </InfoNote>
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          Costs beyond COGS and ad spend, factored into the EBITDA preview below (e.g. shipping, packaging, payment
          gateway fees, fixed overhead).
        </p>

        <div className="mt-3 space-y-2">
          {costs.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Name (e.g. Shipping)"
                value={c.name}
                onChange={(e) => updateCost(c.id, { name: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-0 px-2 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted"
              />
              <select
                value={c.type}
                onChange={(e) => updateCost(c.id, { type: e.target.value as AdditionalCostType })}
                className="rounded-md border border-border bg-surface-0 px-2 py-1.5 text-sm text-ink-primary"
              >
                {COST_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {COST_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="any"
                  value={c.type === "percent_of_revenue" ? c.value * 100 : c.value}
                  onChange={(e) => {
                    const raw = Number(e.target.value) || 0;
                    updateCost(c.id, { value: c.type === "percent_of_revenue" ? raw / 100 : raw });
                  }}
                  className="w-24 rounded-md border border-border bg-surface-0 px-2 py-1.5 text-right tabular-nums text-ink-primary"
                />
                <span className="w-4 shrink-0 text-xs text-ink-muted">{c.type === "percent_of_revenue" ? "%" : "₹"}</span>
              </div>
              <button
                type="button"
                onClick={() => removeCost(c.id)}
                aria-label={`Remove ${c.name || "this cost"}`}
                className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-status-critical/10 hover:text-status-critical"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
          {costs.length === 0 && <p className="text-xs text-ink-muted">No additional costs yet.</p>}
        </div>

        <button
          type="button"
          onClick={addCost}
          className="mt-3 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-2"
        >
          + Add cost
        </button>
      </div>

      {/* --- Save bar ------------------------------------------------------ */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface-0 transition-[transform,opacity] duration-[var(--duration-micro)] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty && !saving && (
          <button type="button" onClick={discardChanges} className="text-xs text-ink-muted underline hover:text-ink-secondary">
            Discard changes
          </button>
        )}
        {saveMessage && !dirty && <span className="text-xs text-status-good">{saveMessage}</span>}
      </div>

      {/* --- EBITDA preview -------------------------------------------- */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="font-display text-base text-ink-primary">Estimated EBITDA preview</h3>
          <InfoNote tone="warning" label="How this is modeled">
            Revenue − COGS − combined Google+Meta ad spend − Additional Costs, for the date range currently selected
            in the top bar. Reflects unsaved edits above so you can see the effect before saving. Modeled, not
            accounting-grade -- COGS and Additional Costs are assumptions, not real per-order cost data.
          </InfoNote>
        </div>
        {preview ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div>
              <div className="text-xs text-ink-muted">Revenue</div>
              <div className="font-hero-num tabular-nums text-ink-primary">{formatCurrency(preview.revenue)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">− COGS</div>
              <div className="font-hero-num tabular-nums text-ink-secondary">{formatCurrency(preview.cogs)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">− Ad Spend</div>
              <div className="font-hero-num tabular-nums text-ink-secondary">{formatCurrency(preview.spend)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">− Additional Costs</div>
              <div className="font-hero-num tabular-nums text-ink-secondary">{formatCurrency(preview.additionalTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">= EBITDA</div>
              <div className={`font-hero-num tabular-nums ${preview.ebitda >= 0 ? "text-status-good" : "text-status-critical"}`}>
                {formatCurrency(preview.ebitda)}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-ink-muted">Loading…</div>
        )}
        {preview && summary && (
          <p className="mt-2 text-xs text-ink-muted">Based on {formatNumber(summary.orders)} orders in the selected range.</p>
        )}
      </div>
    </div>
  );
}
