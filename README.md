# Curb

Self-hosted social media scheduler. Your queue, your server, no per-channel fees.

Curb publishes through the **official APIs** of each platform — the same APIs Buffer, Hootsuite, and Later use. That matters for account safety: platforms ban accounts for *unofficial* automation (browser bots, session-cookie scripts, scraped endpoints). Posting through the documented publishing APIs with OAuth tokens the account owner granted is the sanctioned path. Curb never touches a browser, never stores your passwords, and respects each platform's rate limits.

## What works, and what each platform gates

| Platform | Works day one? | The catch |
|---|---|---|
| **Instagram** | Yes, for your own accounts | Requires a Business/Creator IG account linked to a Facebook Page. Your Meta app works in dev mode for accounts you admin. Hard limit: 50 API posts per account per 24h. Media must be fetchable from a public URL (see PUBLIC_BASE_URL). |
| **X** | Yes | X moved to pay-per-use pricing in Feb 2026: roughly $0.01 per post created. Posting 100 times a month costs about a dollar. |
| **TikTok** | Posts work immediately, but are **private (Only Me)** until your app passes TikTok's audit | The audit is free, takes ~5–10 business days, and requires a short PDF + screen recording of your posting flow. Until then you can post privately and flip videos to public by hand in the app. |
| **YouTube** | Uploads work day one, but videos from **unverified API projects are locked private** | Request an API audit/verification from Google to lift it. Default quota allows ~6 uploads/day (each upload costs 1600 of 10,000 daily units). |

The audits are the moat Buffer's pricing pays for. They're one-time, free, and absolutely passable for a single-user tool — the README sections below tell you what each one wants.

## Quick start

```bash
cp .env.example .env          # fill in as you go
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # -> APP_SECRET
npm install
npm start                     # dashboard at http://localhost:3000
```

### You need a public URL

OAuth callbacks and Instagram's media fetcher must reach your server from the internet.

**Local dev (free):** Cloudflare Tunnel

```bash
brew install cloudflared      # or grab the binary
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://xxxx.trycloudflare.com` URL into `PUBLIC_BASE_URL` in `.env` and into each platform's redirect-URI settings. Note the free quick-tunnel URL changes each run; a named tunnel or ngrok static domain keeps it stable.

**Production:** a $5 VPS (Hetzner, DigitalOcean) with a domain + Caddy or nginx for HTTPS. Set `PUBLIC_BASE_URL=https://curb.yourdomain.com`.

---

## Platform setup

### Instagram (Meta Graph API)

Prereqs: your Instagram must be a **Business or Creator** account, linked to a **Facebook Page** you manage (Instagram app → Settings → Account type and tools).

1. Go to [developers.facebook.com](https://developers.facebook.com) → My Apps → **Create App** → type "Business".
2. In the app dashboard, add the **Instagram Graph API** and **Facebook Login for Business** products.
3. Under Facebook Login → Settings, add this Valid OAuth Redirect URI:
   `{PUBLIC_BASE_URL}/auth/instagram/callback`
4. Copy the **App ID** and **App Secret** (Settings → Basic) into `.env` as `META_APP_ID` / `META_APP_SECRET`.
5. In Curb → Accounts → Connect Instagram. Log in with the Facebook account that manages the Page.

Your app stays in **Development mode** and that's fine: dev mode fully works for any account with a role on the app (you're the admin). You only need Meta's App Review if you ever let *other people* connect their accounts.

Notes:
- Videos publish as **Reels** (that's the only video type the API supports, and it's what you want anyway).
- Image specs: JPEG/PNG. Reels: MP4 (H.264/AAC), 9:16 recommended, under 15 minutes.
- Tokens are long-lived (60 days); Curb re-exchanges them automatically when under a week remains.

### TikTok (Content Posting API)

1. Go to [developers.tiktok.com](https://developers.tiktok.com) → Manage apps → **Connect an app**.
2. Add the **Login Kit** and **Content Posting API** products. Enable **Direct Post**.
3. Set the redirect URI: `{PUBLIC_BASE_URL}/auth/tiktok/callback`
4. Request scopes `user.info.basic` and `video.publish`.
5. Copy **Client Key** / **Client Secret** into `.env`.
6. Connect in Curb → Accounts.

**The audit:** unaudited apps can only post with "Only Me" visibility, capped at 5 users per 24h. To unlock public posting, submit your app for review from the developer dashboard. They want: a PDF of UX mockups showing your posting flow, a screen recording of you actually publishing through Curb to a private test account, and answers about what data you store (answer: tokens and post IDs, on your own server, single user). Takes roughly 5–10 business days. Until it passes you can still post privately and manually flip each video to "Everyone" in the TikTok app.

Notes:
- Access tokens last 24h; refresh tokens last a year. Curb refreshes automatically.
- Per-token API cap: 6 posting requests per minute (you will never hit this).

### YouTube (Data API v3)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → New project.
2. APIs & Services → Library → enable **YouTube Data API v3**.
3. OAuth consent screen → External → add yourself as a **test user**.
4. Credentials → Create credentials → **OAuth client ID** → Web application. Add redirect URI:
   `{PUBLIC_BASE_URL}/auth/youtube/callback`
5. Copy client ID/secret into `.env`, connect in Curb.

**The private-lock:** videos uploaded via API projects that haven't completed Google's verification are locked to private. For your own channel you have two options: complete the OAuth verification + API audit (free, a form describing your use), or upload as private via Curb and flip visibility in YouTube Studio. Quota: each upload costs 1600 units of the 10,000/day default, so ~6 uploads/day; you can request an increase.

### X (API v2)

1. Go to [developer.x.com](https://developer.x.com) → sign up for a developer account (pay-per-use is the default for new accounts: ~$0.01 per post created, no monthly fee).
2. Create a Project + App. In the app's **User authentication settings**: enable OAuth 2.0, type "Web App", and set the callback URI:
   `{PUBLIC_BASE_URL}/auth/x/callback`
3. Copy the OAuth 2.0 **Client ID** and **Client Secret** into `.env`.
4. Set a spending cap in the X developer console so there are never surprises.

Notes: X rotates refresh tokens on every refresh; Curb handles that. Posting respects your Premium status for character limits (Curb caps at 25,000; non-Premium accounts are limited to 280 by X itself).

---

## How scheduling works

A cron loop checks every minute for posts whose time has arrived, refreshes any stale tokens, and publishes to each selected account. Per-target results are recorded independently, so one platform failing doesn't block the others — failed targets show a "Retry failed" button with the error message on hover.

Media files live in `./media/` and are served at `/media/*`. Instagram pulls files from `{PUBLIC_BASE_URL}/media/...`; TikTok, YouTube, and X receive direct binary uploads.

Tokens are encrypted at rest (AES-256-GCM keyed off `APP_SECRET`) in a local SQLite file, `curb.db`. Back that file up if you care about your queue.

## Staying in the safe lane (read this once)

- **Never** add browser automation, cookie-based posting, or unofficial endpoints to this tool. That's the line between "scheduler" and "ban risk".
- Respect the built-in limits: 50/day Instagram, ~6/day YouTube uploads on default quota, TikTok 6 requests/min. Curb won't stop you from scheduling more than Instagram allows in a day — space things out.
- Don't share one platform app across many unrelated users without going through each platform's review; the audits exist for exactly that.
- Keep `.env` and `curb.db` off GitHub. There's a `.gitignore` for this.

## Running it 24/7

The scheduler only fires while the server is running. On a VPS:

```bash
npm install -g pm2
pm2 start src/server.js --name curb
pm2 save && pm2 startup
```

Or a systemd unit, or Docker — anything that keeps `node src/server.js` alive.
