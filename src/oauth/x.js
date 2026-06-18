// X API v2 OAuth 2.0 Authorization Code with PKCE.
// offline.access scope gives a rotating refresh token.
import crypto from "crypto";
import { saveAccount, log } from "../db.js";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const pending = new Map(); // state -> code_verifier

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function authUrl() {
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  pending.set(state, verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: `${process.env.PUBLIC_BASE_URL}/auth/x/callback`,
    scope: "tweet.read tweet.write users.read media.write offline.access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://x.com/i/oauth2/authorize?${params}`;
}

function basicAuth() {
  return "Basic " + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
}

export async function handleCallback(code, state) {
  const verifier = pending.get(state);
  pending.delete(state);
  if (!verifier) throw new Error("X OAuth state mismatch");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: `${process.env.PUBLIC_BASE_URL}/auth/x/callback`,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`X token exchange failed: ${data.error_description || data.error}`);

  const meRes = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const me = (await meRes.json()).data || {};

  saveAccount({
    platform: "x",
    externalId: me.id || "unknown",
    displayName: me.username ? `@${me.username}` : "X account",
    avatarUrl: me.profile_image_url,
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });
  const data = await res.json();
  if (data.error) {
    log(`X token refresh failed for ${account.display_name}: ${data.error_description || data.error}`, "error");
    throw new Error("X token refresh failed; reconnect the account.");
  }
  updateTokens(account.id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // X rotates refresh tokens
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
