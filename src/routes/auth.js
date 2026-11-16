// OAuth connect flows. Mounted behind owner authentication, so only the signed-in
// owner can start a connection, and callbacks are bound to that same session.
import { Router } from "express";
import * as meta from "../oauth/meta.js";
import * as tiktok from "../oauth/tiktok.js";
import * as google from "../oauth/google.js";
import * as x from "../oauth/x.js";
import { log } from "../db.js";

const router = Router();

const providers = {
  instagram: { auth: meta.authUrl, cb: (q, sid) => meta.handleCallback(q.code, q.state, sid) },
  tiktok: { auth: tiktok.authUrl, cb: (q, sid) => tiktok.handleCallback(q.code, q.state, sid) },
  youtube: { auth: google.authUrl, cb: (q, sid) => google.handleCallback(q.code, q.state, sid) },
  x: { auth: x.authUrl, cb: (q, sid) => x.handleCallback(q.code, q.state, sid) },
};

const envCheck = {
  instagram: ["META_APP_ID", "META_APP_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
};

const provider = (name) => (Object.hasOwn(providers, name) ? providers[name] : null);

router.get("/auth/:platform/start", (req, res) => {
  const p = provider(req.params.platform);
  if (!p) return res.status(404).send("Unknown platform");
  const missing = envCheck[req.params.platform].filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(400).send(
      `Missing credentials in .env: ${missing.join(", ")}. See the README section for ${req.params.platform}.`
    );
  }
  res.redirect(p.auth(req.session.sid));
});

router.get("/auth/:platform/callback", async (req, res) => {
  const name = req.params.platform;
  const p = provider(name);
  if (!p) return res.status(404).send("Unknown platform");
  if (req.query.error) {
    return res.redirect(`/?connect=denied&platform=${name}`);
  }
  try {
    await p.cb(req.query, req.session.sid);
    res.redirect(`/?connect=ok&platform=${name}`);
  } catch (err) {
    log(`Connecting ${name} failed: ${err.message}`, "error");
    res.redirect(`/?connect=error&platform=${name}&msg=${encodeURIComponent(String(err.message).slice(0, 200))}`);
  }
});

export default router;
