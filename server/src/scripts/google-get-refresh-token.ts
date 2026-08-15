import dotenv from "dotenv";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";

// One-time interactive helper: exchanges a manual Google OAuth login for a
// long-lived GOOGLE_ADS_REFRESH_TOKEN. Not part of the running app — run it
// once per environment/account, paste the printed refresh token into .env.
//
// Requires GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET already in .env,
// and the OAuth client's "Web application" type with this exact redirect
// URI registered in Google Cloud Console:
//   http://localhost:8080/oauth2callback
//
// Run with: npm run google:auth --workspace server

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const REDIRECT_URI = "http://localhost:8080/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/adwords";
const PORT = 8080;

const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET in .env — fill those in first (Cloud Console -> Auth Platform -> Clients)."
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // required to get a refresh token back
    prompt: "consent", // forces a refresh token even if this account has authorized before
  }).toString();

async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString(),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(body)}`);
  }
  return body as { access_token: string; refresh_token?: string; expires_in: number };
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

    if (!tokens.refresh_token) {
      console.warn(
        "\nNo refresh_token in the response. This Google account has likely already granted this app access before. Revoke it at https://myaccount.google.com/permissions and re-run this script (prompt=consent should prevent this, but Google occasionally still omits it)."
      );
    } else {
      console.log("\nGOOGLE_ADS_REFRESH_TOKEN=" + tokens.refresh_token);
      console.log("\nPaste that line into .env, replacing the empty GOOGLE_ADS_REFRESH_TOKEN=.");
    }
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

  // Best-effort auto-open; the printed URL above is the fallback either way.
  if (process.platform === "win32") {
    exec(`start "" "${authUrl}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${authUrl}"`);
  } else {
    exec(`xdg-open "${authUrl}"`);
  }
});
