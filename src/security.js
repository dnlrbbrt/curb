// Owner authentication, CSRF defence, security headers, login rate limiting.
import crypto from "crypto";
import { config } from "./config.js";

const hmacKey = (label) => crypto.createHmac("sha256", process.env.APP_SECRET).update(label).digest();
const SESSION_KEY = hmacKey("curb-session-v1");
const MEDIA_KEY = hmacKey("curb-media-v1");

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const COOKIE_NAME = config.secureCookies ? "__Host-curb" : "curb_session";

const sign = (key, data) => crypto.createHmac("sha256", key).update(data).digest("base64url");
const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// ── sessions (stateless signed cookie: sid.expiry.signature) ──
function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSessionCookie() {
  const sid = crypto.randomBytes(18).toString("base64url");
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${sid}.${exp}`;
  const value = `${payload}.${sign(SESSION_KEY, payload)}`;
  return cookieString(value, SESSION_TTL_MS / 1000);
}

export function clearSessionCookie() {
  return cookieString("", 0);
}

function cookieString(value, maxAgeSec) {
  return [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax", // Lax (not Strict) so the top-level OAuth redirect back from the provider still carries the session
    `Max-Age=${Math.floor(maxAgeSec)}`,
    config.secureCookies ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function readSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return null;
  const [sid, exp, sig] = raw.split(".");
  if (!sid || !exp || !sig) return null;
  const expected = sign(SESSION_KEY, `${sid}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return { sid };
}

export function attachSession(req, res, next) {
  req.session = readSession(req);
  next();
}

export function requireAuth(req, res, next) {
  if (req.session) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not signed in" });
  if (req.method === "GET" || req.method === "HEAD") return res.redirect("/login");
  return res.status(401).send("Not signed in");
}

// ── login ──
const failures = new Map(); // ip -> { count, resetAt }
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

export function loginLimited(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (f.resetAt < Date.now()) { failures.delete(ip); return false; }
  return f.count >= MAX_FAILURES;
}

export function checkPassword(ip, candidate) {
  const ok = safeEqual(candidate || "", process.env.OWNER_PASSWORD);
  if (ok) { failures.delete(ip); return true; }
  const f = failures.get(ip);
  if (!f || f.resetAt < Date.now()) failures.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else f.count++;
  return false;
}

// ── CSRF: state-changing requests must come from our own origin ──
export function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  let ok = false;
  const expectedHost = new URL(config.publicBaseUrl).host;
  if (origin) {
    if (origin === "null") {
      ok = req.get("sec-fetch-site") === "same-origin" && req.get("host") === expectedHost;
    } else {
      try { ok = new URL(origin).host === expectedHost; } catch { ok = false; }
    }
  }
  if (!ok) {
    console.warn("[warn] CSRF request rejected", {
      method: req.method,
      path: req.originalUrl,
      origin: origin || null,
      host: req.get("host"),
      forwardedHost: req.get("x-forwarded-host"),
      secFetchSite: req.get("sec-fetch-site"),
      expectedHost,
    });
    return res.status(403).json({ error: "Cross-site request blocked" });
  }
  next();
}

// ── security headers ──
export function securityHeaders(req, res, next) {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "media-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
  if (config.secureCookies) res.set("Strict-Transport-Security", "max-age=31536000");
  next();
}

// ── signed, expiring media URLs (what Meta fetches for Instagram) ──
export function signMedia(file, ttlSec = 2 * 3600) {
  const exp = Date.now() + ttlSec * 1000;
  return { exp, sig: sign(MEDIA_KEY, `${file}.${exp}`) };
}

export function verifyMedia(file, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(MEDIA_KEY, `${file}.${Number(exp)}`);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
