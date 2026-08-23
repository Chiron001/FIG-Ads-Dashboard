import { Router } from "express";
import { getPool } from "../db/pool";
import { asyncHandler } from "../util/asyncHandler";
import { env } from "../config/env";
import type { AppSettings, AdditionalCost, AdditionalCostType, IntegrationStatus, SettingsResponse, Ga4Config } from "@fig/shared";

export const settingsRouter = Router();

const COST_TYPES: AdditionalCostType[] = ["percent_of_revenue", "flat_per_order", "flat_total"];

// Raw key value, for server-side use only (routes/ai.ts) -- never routed
// through fetchSettings/AppSettings, which deliberately only ever exposes
// the anthropicApiKeyConfigured boolean to the client. Falls back to the
// ANTHROPIC_API_KEY env var if the DB value isn't set, so a real .env
// deployment still works without the Settings page.
export async function getAnthropicApiKey(): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(`select anthropic_api_key from app_settings where id = true`);
  return (rows[0]?.anthropic_api_key as string | null) ?? process.env.ANTHROPIC_API_KEY ?? null;
}

async function fetchSettings(): Promise<AppSettings> {
  const pool = getPool();
  const { rows } = await pool.query(`select cogs_rate, additional_costs, anthropic_api_key, updated_at from app_settings where id = true`);
  const row = rows[0];
  return {
    cogsRate: row?.cogs_rate ?? 0.35,
    additionalCosts: (row?.additional_costs ?? []) as AdditionalCost[],
    anthropicApiKeyConfigured: Boolean(row?.anthropic_api_key),
    updatedAt: row?.updated_at instanceof Date ? row.updated_at.toISOString() : (row?.updated_at ?? new Date().toISOString()),
  };
}

// Connected/not-connected ONLY, and the env var name(s) an admin would need
// to set -- never the actual key/token values. This page is reachable by
// everyone the site password is shared with, so real credentials never
// cross the wire here (see shared/src/index.ts's header comment on
// IntegrationStatus).
function integrationStatuses(anthropicConfigured: boolean): IntegrationStatus[] {
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
    {
      id: "anthropic",
      label: "AI Assistant (Anthropic)",
      // Set from this Settings page (below), not .env -- so it's a DB flag,
      // not an env var check like the others.
      connected: anthropicConfigured,
      envVars: ["(set from the field below, not an env var)"],
    },
    {
      id: "ga4",
      label: "GA4 (Google Analytics Data API)",
      connected: Boolean(env.ga4.propertyId && env.ga4.serviceAccountKey),
      envVars: ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_KEY_BASE64"],
    },
  ];
}

function ga4Config(): Ga4Config {
  return {
    configured: Boolean(env.ga4.propertyId && env.ga4.serviceAccountKey),
    propertyId: env.ga4.propertyId ?? null,
    serviceAccountEmail: env.ga4.serviceAccountKey?.client_email ?? null,
  };
}

// GET /settings
settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const settings = await fetchSettings();
    const response: SettingsResponse = { settings, integrations: integrationStatuses(settings.anthropicApiKeyConfigured), ga4: ga4Config() };
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

// PATCH /settings -- body: { cogsRate?, additionalCosts?, anthropicApiKey? }.
// Any subset; only the fields present are updated, matching the app's other
// "editable starting-point config" endpoints (e.g. TARGET_ROAS/GROSS_MARGIN)
// in spirit -- though those two stay session-only by design, this one
// persists. anthropicApiKey is write-only: accepted here, never echoed back
// in the response body (see fetchSettings/AppSettings -- only the boolean
// anthropicApiKeyConfigured is ever returned). Passing an empty string clears
// it, matching how a user would "remove" a key from a text field.
settingsRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { cogsRate?: unknown; additionalCosts?: unknown; anthropicApiKey?: unknown };
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

    if (body.anthropicApiKey !== undefined) {
      if (typeof body.anthropicApiKey !== "string") {
        return res.status(400).json({ error: "anthropicApiKey must be a string" });
      }
      const trimmed = body.anthropicApiKey.trim();
      await pool.query(`update app_settings set anthropic_api_key = $1, updated_at = now() where id = true`, [trimmed.length > 0 ? trimmed : null]);
    }

    const settings = await fetchSettings();
    const response: SettingsResponse = { settings, integrations: integrationStatuses(settings.anthropicApiKeyConfigured), ga4: ga4Config() };
    res.json(response);
  })
);
