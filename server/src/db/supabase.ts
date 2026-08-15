import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let client: SupabaseClient | null = null;

/**
 * Lazily-created Supabase client. Returns null (rather than throwing) when
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set yet, so the server can
 * still boot during early scaffolding before Supabase is provisioned.
 * Callers that require a live DB (routes, ETL) should check for null and
 * fail loudly at the call site.
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;

  const { url, serviceRoleKey } = env.supabase;
  if (!url || !serviceRoleKey) {
    return null;
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}
