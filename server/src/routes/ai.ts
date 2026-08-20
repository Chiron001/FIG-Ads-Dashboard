import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { getAnthropicApiKey } from "./settings";
import type { AiAskRequest, AiAskResponse, AiQueryHistoryEntry, AiQueryHistoryResponse } from "@fig/shared";

// The dashboard's "ask anything" home page -- see AiAskRequest's header
// comment in shared/src/index.ts for the framing. Grounds every answer in a
// real statistical snapshot of the account (queried fresh on every request,
// not cached) rather than letting the model guess or hallucinate numbers.
export const aiRouter = Router();

const HISTORY_LIMIT = 25;
// Fixed trailing window for the snapshot -- "ask anything" has no date
// picker of its own (that's what the rest of the dashboard is for), so this
// picks one reasonable, always-fresh default: the last 30 days.
const SNAPSHOT_WINDOW_DAYS = 30;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface PlatformSnapshot {
  platform: string;
  spend: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
}

interface ProductSnapshot {
  title: string | null;
  sku: string | null;
  revenue: number;
  unitsSold: number;
}

interface Snapshot {
  from: string;
  to: string;
  platforms: PlatformSnapshot[];
  shopify: {
    orders: number;
    revenue: number;
    aov: number | null;
    unitsSold: number;
    sessions: number | null;
    cvr: number | null;
  };
  topProductsByRevenue: ProductSnapshot[];
  trend: {
    /** Last 7 days vs. the 7 days before that, blended across all platforms. */
    spendLast7: number;
    spendPrior7: number;
    revenueLast7: number;
    revenuePrior7: number;
  };
}

function safeDivide(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

async function buildSnapshot(): Promise<Snapshot> {
  const pool = getPool();
  const from = isoDaysAgo(SNAPSHOT_WINDOW_DAYS);
  const to = isoDaysAgo(0);
  const last7From = isoDaysAgo(7);
  const prior7From = isoDaysAgo(14);
  const prior7To = isoDaysAgo(8);

  const [{ rows: platformRows }, { rows: orderRows }, { rows: lineItemRows }, { rows: productRows }, { rows: last7Rows }, { rows: prior7Rows }] =
    await Promise.all([
      pool.query(
        `select platform::text as platform,
                coalesce(sum(spend),0)::float8 as spend,
                coalesce(sum(clicks),0)::float8 as clicks,
                coalesce(sum(conversions),0)::float8 as conversions,
                coalesce(sum(revenue),0)::float8 as revenue
         from fact_ad_performance
         where date between $1 and $2
         group by platform`,
        [from, to]
      ),
      pool.query(
        `select count(*)::float8 as orders, coalesce(sum(total_price),0)::float8 as revenue
         from fact_shopify_orders
         where date between $1 and $2`,
        [from, to]
      ),
      pool.query(
        `select coalesce(sum(quantity),0)::float8 as units_sold
         from fact_shopify_line_items
         where date between $1 and $2`,
        [from, to]
      ),
      pool.query(
        `select max(title) as title, max(sku) as sku,
                coalesce(sum(line_total),0)::float8 as revenue,
                coalesce(sum(quantity),0)::float8 as units_sold
         from fact_shopify_line_items
         where date between $1 and $2 and product_id is not null
         group by product_id
         order by revenue desc
         limit 8`,
        [from, to]
      ),
      pool.query(
        `select coalesce(sum(spend),0)::float8 as spend, coalesce(sum(revenue),0)::float8 as revenue
         from fact_ad_performance where date between $1 and $2`,
        [last7From, to]
      ),
      pool.query(
        `select coalesce(sum(spend),0)::float8 as spend, coalesce(sum(revenue),0)::float8 as revenue
         from fact_ad_performance where date between $1 and $2`,
        [prior7From, prior7To]
      ),
    ]);

  const platforms: PlatformSnapshot[] = platformRows.map((r) => ({
    platform: r.platform,
    spend: r.spend,
    clicks: r.clicks,
    conversions: r.conversions,
    revenue: r.revenue,
    roas: safeDivide(r.revenue, r.spend),
    cpa: safeDivide(r.spend, r.conversions),
  }));

  const orderRow = orderRows[0];
  const unitsSold = lineItemRows[0].units_sold;

  return {
    from,
    to,
    platforms,
    shopify: {
      orders: orderRow.orders,
      revenue: orderRow.revenue,
      aov: safeDivide(orderRow.revenue, orderRow.orders),
      unitsSold,
      sessions: null,
      cvr: null,
    },
    topProductsByRevenue: productRows.map((r) => ({
      title: r.title,
      sku: r.sku,
      revenue: r.revenue,
      unitsSold: r.units_sold,
    })),
    trend: {
      spendLast7: last7Rows[0].spend,
      spendPrior7: prior7Rows[0].spend,
      revenueLast7: last7Rows[0].revenue,
      revenuePrior7: prior7Rows[0].revenue,
    },
  };
}

const SYSTEM_PROMPT = `You are the internal analytics assistant built into FIG Living's ads dashboard. You answer questions from the marketing/growth team about ad performance and store performance.

Rules:
- Ground every number you cite in the JSON snapshot provided in the user message. Never invent a number that isn't derivable from it.
- If the snapshot doesn't contain what's needed to answer precisely, say so plainly and name which dashboard page would have it (e.g. "Meta Ads -> SKU Attribution", "Shopify -> Product Quadrants", "Google Ads -> SKU Attribution").
- Be statistical and precise: cite actual figures (spend, ROAS, CPA, revenue, deltas, % changes), not vague language like "performing well".
- Keep answers tight and text-only -- no markdown tables, no asking the user to look at a chart. This product deliberately keeps its home page chart-free; the rest of the dashboard is where a reader drills into a number.
- Currency is INR (₹). All snapshot figures are for the trailing 30-day window stated in the snapshot, unless the snapshot itself labels a figure otherwise (e.g. the 7-day trend block).
- Never mention that you were given a "snapshot" or JSON -- speak as if you simply know the account's current numbers.`;

// GET /ai/history -- newest first, capped at 25.
aiRouter.get(
  "/history",
  asyncHandler(async (_req, res) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `select id::text as id, question, created_at as "createdAt" from ai_query_log order by created_at desc limit $1`,
      [HISTORY_LIMIT]
    );
    const entries: AiQueryHistoryEntry[] = rows.map((r) => ({
      id: r.id,
      question: r.question,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));
    const response: AiQueryHistoryResponse = { entries };
    res.json(response);
  })
);

// POST /ai/ask -- body: { question }.
aiRouter.post(
  "/ask",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as AiAskRequest;
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return res.status(400).json({ error: "question is required" });

    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
      return res.status(400).json({ error: "not_configured", message: "Add an Anthropic API key in Settings to use the AI assistant." });
    }

    const snapshot = await buildSnapshot();
    const client = new Anthropic({ apiKey });
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Account snapshot (JSON):\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}`,
          },
        ],
      });
    } catch (err) {
      // Surface a business-readable message, not the raw Anthropic SDK
      // error JSON -- most commonly an invalid/revoked key (401), which
      // reads here as exactly that rather than a generic server error.
      if (err instanceof Anthropic.APIError && err.status === 401) {
        return res.status(400).json({ error: "invalid_key", message: "That Anthropic API key was rejected. Check it in Settings and try again." });
      }
      return res.status(502).json({ error: "ai_unavailable", message: "The AI assistant couldn't be reached right now. Try again in a moment." });
    }

    const answer = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const pool = getPool();
    await pool.query(`insert into ai_query_log (question) values ($1)`, [question]);

    const response: AiAskResponse = { answer: answer || "No answer returned.", generatedAt: new Date().toISOString() };
    res.json(response);
  })
);
