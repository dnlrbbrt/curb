// TikTok Login Kit + Content Posting API OAuth.
// Access tokens last 24h; refresh tokens last 365 days. Refresh aggressively.
import crypto from "crypto";
import { saveAccount, log } from "../db.js";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const states = new Set();

export function authUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  states.add(state);
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: "code",
    scope: "user.info.basic,video.publish",
    redirect_uri: `${process.env.PUBLIC_BASE_URL}/auth/tiktok/callback`,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

export async function handleCallback(code, state) {
  if (!states.delete(state)) throw new Error("TikTok OAuth state mismatch");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${process.env.PUBLIC_BASE_URL}/auth/tiktok/callback`,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`TikTok token exchange failed: ${data.error_description || data.error}`);

  // fetch display name + avatar
  const userRes = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
    { headers: { Authorization: `Bearer ${data.access_token}` } }
  );
  const user = (await userRes.json()).data?.user || {};

  saveAccount({
    platform: "tiktok",
    externalId: data.open_id,
    displayName: user.display_name || data.open_id,
    avatarUrl: user.avatar_url,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    meta: { scope: data.scope },
  });
}

export async function refreshIfNeeded(account, updateTokens) {
  // refresh when under 30 minutes of life remain
  if (account.token_expires_at && account.token_expires_at - Date.now() > 30 * 60 * 1000) {
    return account.access_token;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });
  const data = await res.json();
  if (data.error) {
    log(`TikTok token refresh failed for ${account.display_name}: ${data.error_description || data.error}`, "error");
    throw new Error("TikTok token refresh failed; reconnect the account.");
  }
  updateTokens(account.id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
