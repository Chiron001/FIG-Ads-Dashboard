import { Router } from "express";
import crypto from "node:crypto";
import { env } from "../config/env";
import { asyncHandler } from "../util/asyncHandler";

// One-time OAuth handshake to obtain the Admin API access token
// SHOPIFY_ADMIN_ACCESS_TOKEN is set to. Shopify retired creating new "legacy
// custom apps" (a store-admin-issued static token, no OAuth) as of
// 2026-01-01 -- a Dev-Dashboard app + this flow is now the only way to get
// that token for a single-store internal tool like this one.
//
// Deliberately NOT a persistent integration: the resulting token is shown
// once on the callback page for manual copy into .env / Railway env vars,
// then this route is done -- nothing is stored server-side, and the actual
// data-fetching connector (server/src/connectors/shopify.ts) never touches
// these routes or SHOPIFY_CLIENT_ID/SECRET at all. Matches the rest of this
// project's pattern of a single long-lived static credential per platform,
// not a live multi-tenant OAuth session.
export const shopifyOauthRouter = Router();

const SCOPES = "read_orders,read_products";

// In-memory nonce store, single Node process, short TTL -- sufficient for a
// one-off manual admin action (this is never a multi-user flow), and avoids
// a throwaway DB table for something used once and then never again.
const pendingStates = new Map<string, number>(); // state -> expiresAt (ms)
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt < now) pendingStates.delete(state);
  }
}

/** Shopify's documented verification: drop hmac from the query, sort the
 * rest alphabetically by key, join as key=value pairs with "&", HMAC-SHA256
 * that string with the client secret, compare hex digests (timing-safe). */
function verifyHmac(query: Record<string, unknown>, clientSecret: string): boolean {
  const { hmac, ...rest } = query as Record<string, string>;
  if (typeof hmac !== "string") return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("&");

  const computed = crypto.createHmac("sha256", clientSecret).update(message).digest("hex");
  const computedBuf = Buffer.from(computed, "hex");
  const receivedBuf = Buffer.from(hmac, "hex");
  if (computedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(computedBuf, receivedBuf);
}

function html(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shopify OAuth</title>
<style>body{font-family:ui-monospace,monospace;background:#0b0b0f;color:#e6e6e6;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.5}
code,pre{background:#1a1a22;padding:12px;border-radius:8px;display:block;overflow-wrap:break-word;white-space:pre-wrap}
a{color:#7dd3fc}</style></head><body>${body}</body></html>`;
}

// GET /shopify/oauth/install -- start the handshake, redirects to Shopify's
// authorization screen. Visit this URL once in a browser; nothing to POST.
shopifyOauthRouter.get(
  "/install",
  asyncHandler(async (req, res) => {
    const { storeDomain, clientId } = env.shopify;
    if (!storeDomain || !clientId) {
      return res
        .status(500)
        .send(html("<h1>Not configured</h1><p>Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_CLIENT_ID in .env.</p>"));
    }

    cleanupExpiredStates();
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now() + STATE_TTL_MS);

    // req.protocol is "http" behind Railway's proxy unless trust proxy is
    // set -- build the redirect_uri from the request Host header instead,
    // forcing https (this app is never served over plain http).
    const redirectUri = `https://${req.get("host")}/shopify/oauth/callback`;

    const authorizeUrl =
      `https://${storeDomain}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authorizeUrl);
  })
);

// GET /shopify/oauth/callback -- Shopify redirects here after the merchant
// approves. Verifies the request, exchanges the code for an access token,
// and displays it once for manual copy -- never stored server-side.
shopifyOauthRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { storeDomain, clientId, clientSecret } = env.shopify;
    if (!storeDomain || !clientId || !clientSecret) {
      return res
        .status(500)
        .send(html("<h1>Not configured</h1><p>Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET in .env.</p>"));
    }

    const query = req.query as Record<string, string>;
    const { code, shop, state } = query;

    if (!code || !shop || !state) {
      return res.status(400).send(html("<h1>Bad request</h1><p>Missing code/shop/state on callback -- did you land here directly instead of via /shopify/oauth/install?</p>"));
    }
    if (shop !== storeDomain) {
      return res.status(400).send(html(`<h1>Shop mismatch</h1><p>Callback was for <code>${shop}</code>, expected <code>${storeDomain}</code>.</p>`));
    }

    cleanupExpiredStates();
    if (!pendingStates.has(state)) {
      return res.status(400).send(html("<h1>Invalid or expired state</h1><p>Start over at <a href=\"/shopify/oauth/install\">/shopify/oauth/install</a> -- this link may have already been used, or it's more than 10 minutes old.</p>"));
    }
    pendingStates.delete(state); // one-time use

    if (!verifyHmac(query, clientSecret)) {
      return res.status(400).send(html("<h1>HMAC verification failed</h1><p>This request didn't come from Shopify (or SHOPIFY_CLIENT_SECRET is wrong).</p>"));
    }

    const tokenRes = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenBody = (await tokenRes.json()) as { access_token?: string; scope?: string; error?: string; error_description?: string };

    if (!tokenRes.ok || !tokenBody.access_token) {
      return res
        .status(502)
        .send(html(`<h1>Token exchange failed</h1><pre>${JSON.stringify(tokenBody, null, 2)}</pre>`));
    }

    res.send(
      html(`
        <h1>&#9989; Connected to ${shop}</h1>
        <p>Granted scopes: <code>${tokenBody.scope}</code></p>
        <p>Copy this into <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code> (in <code>.env</code> locally and as a Railway env var) --
           this is shown once and not stored anywhere by this server:</p>
        <pre>${tokenBody.access_token}</pre>
        <p>This token doesn't expire on its own for a single-store custom-distribution app install; no need to repeat this flow unless it's revoked.</p>
      `)
    );
  })
);
