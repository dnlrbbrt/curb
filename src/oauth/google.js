// Google OAuth for YouTube Data API v3.
// Requests offline access so we get a refresh token for unattended publishing.
import { saveAccount, log } from "../db.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function authUrl() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.PUBLIC_BASE_URL}/auth/youtube/callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent", // force refresh_token issuance every connect
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function handleCallback(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${process.env.PUBLIC_BASE_URL}/auth/youtube/callback`,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Google token exchange failed: ${data.error_description || data.error}`);

  // identify the channel
  const chRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${data.access_token}` } }
  );
  const ch = (await chRes.json()).items?.[0];
  if (!ch) throw new Error("No YouTube channel found on this Google account.");

  saveAccount({
    platform: "youtube",
    externalId: ch.id,
    displayName: ch.snippet.title,
    avatarUrl: ch.snippet.thumbnails?.default?.url,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    meta: {},
  });
}

export async function refreshIfNeeded(account, updateTokens) {
  if (account.token_expires_at && account.token_expires_at - Date.now() > 5 * 60 * 1000) {
    return account.access_token;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (data.error) {
    log(`YouTube token refresh failed for ${account.display_name}: ${data.error_description || data.error}`, "error");
    throw new Error("YouTube token refresh failed; reconnect the account.");
  }
  updateTokens(account.id, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
