import "dotenv/config";

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
};

export { required, optional };
