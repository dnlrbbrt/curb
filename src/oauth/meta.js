// Instagram via Meta Graph API.
// Flow: Facebook Login -> short-lived user token -> long-lived token (60 days)
// -> find Pages -> find linked Instagram professional accounts.
import { saveAccount, log } from "../db.js";
import { createState, consumeState } from "./state.js";
import { config } from "../config.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export function authUrl(sid) {
  const { state } = createState("instagram", sid);
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${config.publicBaseUrl}/auth/instagram/callback`,
    scope: [
      "instagram_basic",
      "instagram_content_publish",
      "pages_show_list",
      "business_management",
    ].join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function handleCallback(code, state, sid) {
  consumeState(state, "instagram", sid);
  if (!code) throw new Error("Meta returned no authorization code.");
  // 1. code -> short-lived token
  let res = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: `${config.publicBaseUrl}/auth/instagram/callback`,
    code,
  }));
  let data = await res.json();
  if (data.error) throw new Error(`Meta token exchange failed: ${data.error.message}`);

  // 2. short-lived -> long-lived (~60 days)
  res = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: data.access_token,
  }));
  data = await res.json();
  if (data.error) throw new Error(`Meta long-lived exchange failed: ${data.error.message}`);
  const userToken = data.access_token;
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;

  // 3. find Pages the user manages
  res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${userToken}`);
  const pages = await res.json();
  if (pages.error) throw new Error(`Meta pages lookup failed: ${pages.error.message}`);

  let connected = 0;
  for (const page of pages.data || []) {
    const ig = page.instagram_business_account;
    if (!ig) continue;
    saveAccount({
      platform: "instagram",
      externalId: ig.id,
      displayName: `@${ig.username}`,
      avatarUrl: ig.profile_picture_url,
      accessToken: userToken, // long-lived user token works for IG publishing
      refreshToken: null,
      expiresAt,
      meta: { pageId: page.id, pageName: page.name },
    });
    connected++;
  }
  if (!connected) {
    throw new Error(
      "No Instagram professional account found. Make sure your Instagram is a Business or Creator account and is linked to a Facebook Page you manage."
    );
  }
  log(`Instagram: connected ${connected} account(s)`);
}

// Re-exchange the long-lived token before it expires (call from scheduler).
export async function refreshIfNeeded(account, updateTokens) {
  if (!account.token_expires_at) return account.access_token;
  const daysLeft = (account.token_expires_at - Date.now()) / 86400000;
  if (daysLeft > 7) return account.access_token;
  const res = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: account.access_token,
  }));
  const data = await res.json();
  if (data.error) {
    log(`Instagram token refresh failed for ${account.display_name}: ${data.error.message}`, "warn");
    return account.access_token;
  }
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
  updateTokens(account.id, { accessToken: data.access_token, expiresAt });
  return data.access_token;
}
