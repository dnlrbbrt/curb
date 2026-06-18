import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "..", "curb.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,            -- instagram | tiktok | youtube | x
  external_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  access_token TEXT NOT NULL,        -- encrypted
  refresh_token TEXT,                -- encrypted
  token_expires_at INTEGER,          -- unix ms, null = long-lived
  meta TEXT DEFAULT '{}',            -- platform-specific (e.g. fb page id)
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  UNIQUE(platform, external_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT DEFAULT '',
  media_path TEXT,                   -- relative path under /media
  media_type TEXT,                   -- image | video | null
  scheduled_at INTEGER NOT NULL,     -- unix ms
  status TEXT DEFAULT 'scheduled',   -- scheduled | publishing | done | partial | failed
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS post_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  options TEXT DEFAULT '{}',         -- per-platform options (title, privacy, ig type...)
  status TEXT DEFAULT 'pending',     -- pending | publishing | published | failed
  external_post_id TEXT,
  error TEXT,
  published_at INTEGER
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER DEFAULT (strftime('%s','now') * 1000),
  level TEXT DEFAULT 'info',
  message TEXT
);
`);

// ── token encryption (AES-256-GCM, key derived from APP_SECRET) ──
const KEY = crypto.scryptSync(process.env.APP_SECRET || "dev-secret", "curb-salt", 32);

export function encrypt(text) {
  if (text == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(blob) {
  if (blob == null) return null;
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function log(message, level = "info") {
  db.prepare("INSERT INTO activity (level, message) VALUES (?, ?)").run(level, message);
  console.log(`[${level}] ${message}`);
}

export function saveAccount({ platform, externalId, displayName, avatarUrl, accessToken, refreshToken, expiresAt, meta }) {
  db.prepare(`
    INSERT INTO accounts (platform, external_id, display_name, avatar_url, access_token, refresh_token, token_expires_at, meta)
    VALUES (@platform, @externalId, @displayName, @avatarUrl, @accessToken, @refreshToken, @expiresAt, @meta)
    ON CONFLICT(platform, external_id) DO UPDATE SET
      display_name = @displayName,
      avatar_url = @avatarUrl,
      access_token = @accessToken,
      refresh_token = COALESCE(@refreshToken, accounts.refresh_token),
      token_expires_at = @expiresAt,
      meta = @meta
  `).run({
    platform,
    externalId,
    displayName: displayName || null,
    avatarUrl: avatarUrl || null,
    accessToken: encrypt(accessToken),
    refreshToken: refreshToken ? encrypt(refreshToken) : null,
    expiresAt: expiresAt || null,
    meta: JSON.stringify(meta || {}),
  });
  log(`Connected ${platform} account: ${displayName || externalId}`);
}

export function getAccount(id) {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...row,
    access_token: decrypt(row.access_token),
    refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null,
    meta: JSON.parse(row.meta || "{}"),
  };
}

export function updateAccountTokens(id, { accessToken, refreshToken, expiresAt }) {
  db.prepare(`
    UPDATE accounts SET
      access_token = ?,
      refresh_token = COALESCE(?, refresh_token),
      token_expires_at = ?
    WHERE id = ?
  `).run(encrypt(accessToken), refreshToken ? encrypt(refreshToken) : null, expiresAt || null, id);
}

export default db;
