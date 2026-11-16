// Instagram and Facebook Pages via Meta Graph API.
// User tokens are exchanged for long-lived tokens; Facebook Page publishing
// uses the Page access token returned by /me/accounts.
import { saveAccount, log } from "../db.js";
import { createState, consumeState } from "./state.js";
import { config } from "../config.js";

const GRAPH = "https://graph.facebook.com/v27.0";

export function authUrl(platform, sid) {
  const { state } = createState(platform, sid);
  const scopes = platform === "facebook"
    ? ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"]
    : ["instagram_basic", "instagram_content_publish", "pages_show_list", "business_management"];
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${config.publicBaseUrl}/auth/${platform}/callback`,
    scope: scopes.join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/v27.0/dialog/oauth?${params}`;
}

export async function handleCallback(platform, code, state, sid) {
  consumeState(state, platform, sid);
  if (!code) throw new Error("Meta returned no authorization code.");
  // 1. code -> short-lived token
  let res = await fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: `${config.publicBaseUrl}/auth/${platform}/callback`,
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
  res = await fetch(`${GRAPH}/me/accounts?` + new URLSearchParams({
    fields: "id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url}",
    access_token: userToken,
  }));
  const pages = await res.json();
  if (pages.error) throw new Error(`Meta pages lookup failed: ${pages.error.message}`);

  let connected = 0;
  for (const page of pages.data || []) {
    if (platform === "facebook") {
      if (!page.access_token) continue;
      saveAccount({
        platform: "facebook",
        externalId: page.id,
        displayName: page.name,
        avatarUrl: page.picture?.data?.url || null,
        accessToken: page.access_token,
        refreshToken: null,
        expiresAt: null,
        meta: { pageName: page.name },
      });
      connected++;
    } else {
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
  }
  if (!connected) {
    if (platform === "facebook") {
      throw new Error("No Facebook Pages available. Your Facebook account needs a Page task that allows it to create content.");
    }
    throw new Error("No Instagram professional account found. Make sure your Instagram is a Business or Creator account and is linked to a Facebook Page you manage.");
  }
  log(`${platform === "facebook" ? "Facebook" : "Instagram"}: connected ${connected} account(s)`);
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
    log(`Meta token refresh failed for ${account.display_name}: ${data.error.message}`, "warn");
    return account.access_token;
  }
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
  updateTokens(account.id, { accessToken: data.access_token, expiresAt });
  return data.access_token;
}
