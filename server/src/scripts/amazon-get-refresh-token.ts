import dotenv from "dotenv";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";

// One-time interactive helper: exchanges a manual Amazon (Login with
// Amazon) login for a long-lived AMAZON_REFRESH_TOKEN, then lists the
// advertising profiles available to it so AMAZON_PROFILE_ID doesn't have
// to be hunted down by hand. Not part of the running app.
//
// Requires AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET already in .env, and
// that Client ID's LWA security profile must have this exact Allowed
// Return URL registered (developer.amazon.com -> Login with Amazon ->
// your profile -> Web Settings):
//   http://localhost:8080/oauth2callback
//
// Also requires Amazon Ads API access to have been approved for this
// Client ID (spec §10-3) -- the refresh token will mint fine either way,
// but the profiles call in step 2 will fail with a 401/403 until approved.
//
// Run with: npm run amazon:auth --workspace server

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const REDIRECT_URI = "http://localhost:8080/oauth2callback";
const SCOPE = "advertising::campaign_management";
const PORT = 8080;

const clientId = process.env.AMAZON_CLIENT_ID;
const clientSecret = process.env.AMAZON_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing AMAZON_CLIENT_ID / AMAZON_CLIENT_SECRET in .env — fill those in first (developer.amazon.com -> Login with Amazon)."
  );
  process.exit(1);
}

const authUrl =
  "https://www.amazon.com/ap/oa?" +
  new URLSearchParams({
    client_id: clientId,
    scope: SCOPE,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
  }).toString();

async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${JSON.stringify(body)}`);
  return body as { access_token: string; refresh_token: string; expires_in: number };
}

// Profiles are region-specific (spec §4c: AMAZON_REGION na|eu|fe). We don't
// know the region yet at this point, so we just try all three endpoints
// and report which one(s) return profiles — that tells us AMAZON_REGION
// directly instead of guessing.
const REGION_ENDPOINTS: Record<string, string> = {
  na: "https://advertising-api.amazon.com",
  eu: "https://advertising-api-eu.amazon.com",
  fe: "https://advertising-api-fe.amazon.com",
};

async function listProfiles(accessToken: string) {
  for (const [region, base] of Object.entries(REGION_ENDPOINTS)) {
    try {
      const res = await fetch(`${base}/v2/profiles`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Amazon-Advertising-API-ClientId": clientId!,
        },
      });
      if (!res.ok) {
        console.log(`  [${region}] ${res.status} ${res.statusText} — ${await res.text()}`);
        continue;
      }
      const profiles = await res.json();
      if (Array.isArray(profiles) && profiles.length > 0) {
        console.log(`\n  Region "${region}" (${base}) — AMAZON_REGION=${region}`);
        console.log(JSON.stringify(profiles, null, 2));
      } else {
        console.log(`  [${region}] reachable, but no profiles returned.`);
      }
    } catch (err) {
      console.log(`  [${region}] request failed: ${(err as Error).message}`);
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${error}`);
    console.error(`OAuth error: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing ?code in callback.");
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    res
      .writeHead(200, { "Content-Type": "text/plain" })
      .end("Done — refresh token printed in your terminal. You can close this tab.");

    console.log("\nAMAZON_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("\nPaste that line into .env, replacing the empty AMAZON_REFRESH_TOKEN=.");

    console.log("\nLooking up available advertising profiles (this also tells us AMAZON_REGION)...");
    await listProfiles(tokens.access_token);
    console.log(
      "\nIf every region above showed an error, Amazon Ads API access likely hasn't been approved for this Client ID yet (spec §10-3) — the refresh token above is still valid, just re-run this script's profile lookup later once access is approved."
    );
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Token exchange failed — see terminal.");
    console.error(err);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 250);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} for the OAuth callback.\n`);
  console.log("Opening your browser. If it doesn't open, visit this URL manually:\n");
  console.log(authUrl + "\n");

  if (process.platform === "win32") {
    exec(`start "" "${authUrl}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${authUrl}"`);
  } else {
    exec(`xdg-open "${authUrl}"`);
  }
});
