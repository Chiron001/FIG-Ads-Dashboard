import dotenv from "dotenv";
import path from "node:path";

// `npm run dev --workspace server` (and prod `node dist/index.js` run from
// server/) sets cwd to /server, not the repo root — dotenv's default
// cwd-relative lookup misses the root .env entirely and every var silently
// reads as undefined. Resolve explicitly instead of trusting cwd.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) {
    // Intentionally not thrown at import time for every var — connectors
    // check their own required vars in authenticate() so the server can
    // still boot with some platforms unconfigured. This helper is for
    // truly load-bearing config only (e.g. DB).
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const env = {
  port: Number(optional("PORT") ?? 4000),
  nodeEnv: optional("NODE_ENV") ?? "development",
  tz: optional("TZ") ?? "Asia/Kolkata",

  supabase: {
    url: optional("SUPABASE_URL"),
    serviceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
    databaseUrl: optional("DATABASE_URL"),
  },

  google: {
    clientId: optional("GOOGLE_ADS_CLIENT_ID"),
    clientSecret: optional("GOOGLE_ADS_CLIENT_SECRET"),
    developerToken: optional("GOOGLE_ADS_DEVELOPER_TOKEN"),
    refreshToken: optional("GOOGLE_ADS_REFRESH_TOKEN"),
    customerId: optional("GOOGLE_ADS_CUSTOMER_ID"),
    // Only needed when customerId is a client account under a manager (MCC)
    // account — Google Ads API requires the manager's id explicitly in that
    // case, even if the authenticated user has access to the client account.
    loginCustomerId: optional("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
  },

  meta: {
    accessToken: optional("META_ACCESS_TOKEN"),
    adAccountId: optional("META_AD_ACCOUNT_ID"),
  },

  amazon: {
    clientId: optional("AMAZON_CLIENT_ID"),
    clientSecret: optional("AMAZON_CLIENT_SECRET"),
    refreshToken: optional("AMAZON_REFRESH_TOKEN"),
    profileId: optional("AMAZON_PROFILE_ID"),
    region: optional("AMAZON_REGION"),
  },

  shopify: {
    // e.g. "fig-living.myshopify.com" -- no https://, no trailing slash.
    storeDomain: optional("SHOPIFY_STORE_DOMAIN"),
    adminAccessToken: optional("SHOPIFY_ADMIN_ACCESS_TOKEN"),
    // Only needed for the one-time OAuth handshake (/shopify/oauth/install +
    // /shopify/oauth/callback) that produces adminAccessToken above --
    // Shopify retired creating new "legacy custom apps" (a direct static
    // token, no OAuth) as of 2026-01-01, so a Dev-Dashboard app + this
    // one-time flow is now the only way to get that token. Not used by the
    // actual data-fetching connector at all, only by the OAuth routes.
    clientId: optional("SHOPIFY_CLIENT_ID"),
    clientSecret: optional("SHOPIFY_CLIENT_SECRET"),
  },

  // Campaign-table economics (Break-even ROAS, Profit, Verdict). The UI
  // reads these once as a starting point and lets the analyst override
  // live -- these are just the server-side defaults.
  grossMargin: Number(optional("GROSS_MARGIN") ?? 0.6),
  targetRoas: Number(optional("TARGET_ROAS") ?? 5.5),
};

export { required, optional };
