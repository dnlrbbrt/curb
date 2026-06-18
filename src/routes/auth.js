import { Router } from "express";
import * as meta from "../oauth/meta.js";
import * as tiktok from "../oauth/tiktok.js";
import * as google from "../oauth/google.js";
import * as x from "../oauth/x.js";

const router = Router();

const providers = {
  instagram: { auth: meta.authUrl, cb: (q) => meta.handleCallback(q.code) },
  tiktok: { auth: tiktok.authUrl, cb: (q) => tiktok.handleCallback(q.code, q.state) },
  youtube: { auth: google.authUrl, cb: (q) => google.handleCallback(q.code) },
  x: { auth: x.authUrl, cb: (q) => x.handleCallback(q.code, q.state) },
};

const envCheck = {
  instagram: ["META_APP_ID", "META_APP_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
};

router.get("/auth/:platform/start", (req, res) => {
  const p = providers[req.params.platform];
  if (!p) return res.status(404).send("Unknown platform");
  const missing = envCheck[req.params.platform].filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(400).send(
      `Missing credentials in .env: ${missing.join(", ")}. See the README section for ${req.params.platform}.`
    );
  }
  res.redirect(p.auth());
});

router.get("/auth/:platform/callback", async (req, res) => {
  const p = providers[req.params.platform];
  if (!p) return res.status(404).send("Unknown platform");
  if (req.query.error) {
    return res.redirect(`/?connect=denied&platform=${req.params.platform}`);
  }
  try {
    await p.cb(req.query);
    res.redirect(`/?connect=ok&platform=${req.params.platform}`);
  } catch (err) {
    res.redirect(`/?connect=error&platform=${req.params.platform}&msg=${encodeURIComponent(err.message)}`);
  }
});

export default router;
