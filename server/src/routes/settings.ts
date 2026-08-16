import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { env } from "../config/env";
import type { AppSettings, AdditionalCost, AdditionalCostType, IntegrationStatus, SettingsResponse } from "@fig/shared";

export const settingsRouter = Router();

const COST_TYPES: AdditionalCostType[] = ["percent_of_revenue", "flat_per_order", "flat_total"];

async function fetchSettings(): Promise<AppSettings> {
  const pool = getPool();
  const { rows } = await pool.query(`select cogs_rate, additional_costs, updated_at from app_settings where id = true`);
  const row = rows[0];
  return {
    cogsRate: row?.cogs_rate ?? 0.35,
    additionalCosts: (row?.additional_costs ?? []) as AdditionalCost[],
    updatedAt: row?.updated_at instanceof Date ? row.updated_at.toISOString() : (row?.updated_at ?? new Date().toISOString()),
  };
}

// Connected/not-connected ONLY, and the env var name(s) an admin would need
// to set -- never the actual key/token values. This page is reachable by
// everyone the site password is shared with, so real credentials never
// cross the wire here (see shared/src/index.ts's header comment on
// IntegrationStatus).
function integrationStatuses(): IntegrationStatus[] {
  return [
    {
      id: "google",
      label: "Google Ads",
      connected: Boolean(env.google.clientId && env.google.clientSecret && env.google.developerToken && env.google.refreshToken && env.google.customerId),
      envVars: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"],
    },
    {
      id: "meta",
      label: "Meta Ads",
      connected: Boolean(env.meta.accessToken && env.meta.adAccountId),
      envVars: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"],
    },
    {
      id: "amazon",
      label: "Amazon Ads",
      connected: Boolean(env.amazon.clientId && env.amazon.clientSecret && env.amazon.refreshToken && env.amazon.profileId),
      envVars: ["AMAZON_CLIENT_ID", "AMAZON_CLIENT_SECRET", "AMAZON_REFRESH_TOKEN", "AMAZON_PROFILE_ID", "AMAZON_REGION"],
    },
    {
      id: "myntra",
      label: "Myntra Ads",
      connected: false,
      envVars: ["(on hold -- not yet integrated)"],
    },
    {
      id: "shopify",
      label: "Shopify",
      connected: Boolean(env.shopify.storeDomain && env.shopify.adminAccessToken),
      envVars: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"],
    },
    {
      id: "database",
      label: "Database (Supabase Postgres)",
      connected: Boolean(env.supabase.databaseUrl),
      envVars: ["DATABASE_URL"],
    },
  ];
}

// GET /settings
settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const response: SettingsResponse = { settings: await fetchSettings(), integrations: integrationStatuses() };
    res.json(response);
  })
);

function isValidCost(c: unknown): c is AdditionalCost {
  if (!c || typeof c !== "object") return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    typeof r.type === "string" &&
    COST_TYPES.includes(r.type as AdditionalCostType) &&
    typeof r.value === "number" &&
    Number.isFinite(r.value)
  );
}

// PATCH /settings -- body: { cogsRate?, additionalCosts? }. Either or both;
// only the fields present are updated, matching the app's other "editable
// starting-point config" endpoints (e.g. TARGET_ROAS/GROSS_MARGIN) in spirit
// -- though those two stay session-only by design, this one persists.
settingsRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { cogsRate?: unknown; additionalCosts?: unknown };
    const pool = getPool();

    if (body.cogsRate !== undefined) {
      const rate = Number(body.cogsRate);
      if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
        return res.status(400).json({ error: "cogsRate must be a number between 0 and 1 (e.g. 0.35 for 35%)" });
      }
      await pool.query(`update app_settings set cogs_rate = $1, updated_at = now() where id = true`, [rate]);
    }

    if (body.additionalCosts !== undefined) {
      if (!Array.isArray(body.additionalCosts) || !body.additionalCosts.every(isValidCost)) {
        return res.status(400).json({
          error: "additionalCosts must be an array of {id, name, type, value}, type one of percent_of_revenue/flat_per_order/flat_total",
        });
      }
      await pool.query(`update app_settings set additional_costs = $1::jsonb, updated_at = now() where id = true`, [JSON.stringify(body.additionalCosts)]);
    }

    const response: SettingsResponse = { settings: await fetchSettings(), integrations: integrationStatuses() };
    res.json(response);
  })
);
