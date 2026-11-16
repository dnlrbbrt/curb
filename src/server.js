import "dotenv/config";
import "./config.js"; // validates env first; exits if APP_SECRET / OWNER_PASSWORD / PUBLIC_BASE_URL are unsafe
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import { startScheduler } from "./scheduler.js";
import { log } from "./db.js";
import {
  attachSession, requireAuth, csrfGuard, securityHeaders, loginLimited, checkPassword,
  createSessionCookie, clearSessionCookie, verifyMedia,
} from "./security.js";
import { mediaDir, isValidMediaName, MIME, extOf } from "./media.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const app = express();

app.disable("x-powered-by");
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(v) ? Number(v) : v === "true" ? true : v);
}

app.use(securityHeaders);
app.use(attachSession);

// ── media: owner session OR a signed, expiring URL (what Instagram's fetcher uses) ──
app.get("/media/:file", (req, res) => {
  const { file } = req.params;
  const allowed = req.session || verifyMedia(file, req.query.exp, req.query.sig);
  if (!allowed || !isValidMediaName(file)) return res.status(404).end(); // same answer either way: no enumeration
  res.set({
    "Content-Type": MIME[extOf(file)],
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
  });
  res.sendFile(path.join(mediaDir, file), { dotfiles: "deny", headers: {} }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// ── login / logout (the only public routes besides signed media) ──
app.get("/login", (req, res) => {
  if (req.session) return res.redirect("/");
  const html = fs.readFileSync(path.join(publicDir, "login.html"), "utf8")
    .replace("<!--ERROR-->", req.query.error === "limit"
      ? '<p class="login-error">Too many attempts. Wait 15 minutes.</p>'
      : req.query.error ? '<p class="login-error">Wrong password.</p>' : "");
  res.type("html").send(html);
});

app.get("/styles.css", (req, res) => res.sendFile(path.join(publicDir, "styles.css")));

app.post("/login", csrfGuard, express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
  if (loginLimited(req.ip)) return res.redirect("/login?error=limit");
  if (!checkPassword(req.ip, req.body?.password)) {
    log(`Failed login from ${req.ip}`, "warn");
    return res.redirect("/login?error=1");
  }
  res.set("Set-Cookie", createSessionCookie());
  res.redirect("/");
});

app.post("/logout", csrfGuard, (req, res) => {
  res.set("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

// ── everything below requires the owner ──
app.use(csrfGuard);
app.use(requireAuth);
app.use(express.json({ limit: "256kb" }));
app.use(express.static(publicDir, { index: "index.html", dotfiles: "deny", extensions: false }));
app.use(authRoutes);
app.use("/api", apiRoutes);

// JSON errors, never HTML stack traces; internals stay in the log.
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File is too large (limit 1 GB)." });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  log(`Request error: ${err.message}`, "error");
  res.status(500).json({ error: "Something went wrong. Check the Activity tab or server log." });
});

app.listen(config.port, config.host, () => {
  log(`Curb running at http://${config.host}:${config.port} (public URL ${config.publicBaseUrl})`);
  if (config.host !== "127.0.0.1" && !config.secureCookies) {
    log("Listening on a non-loopback address over plain HTTP. Put HTTPS in front (see README).", "warn");
  }
  startScheduler();
});
