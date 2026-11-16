import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import db from "../db.js";
import { startPublishNow } from "../scheduler.js";
import {
  mediaDir, isAllowedExt, isValidMediaName, typeOf, sniffMatchesExtension, deleteMediaFile, mediaFile,
} from "../media.js";

const upload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (!isAllowedExt(file.originalname)) {
      return cb(Object.assign(new Error("Unsupported file type. Use JPG, PNG, GIF, WEBP, MP4, MOV, M4V or WEBM."), { status: 400 }));
    }
    cb(null, true);
  },
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 }, // 1 GB
});

const router = Router();
const bad = (res, msg) => res.status(400).json({ error: msg });
const toId = (v) => (/^\d{1,12}$/.test(String(v)) ? Number(v) : null);

// ── accounts ──
router.get("/accounts", (req, res) => {
  const rows = db.prepare(
    "SELECT id, platform, display_name, avatar_url, token_expires_at, created_at FROM accounts ORDER BY platform"
  ).all();
  res.json(rows);
});

router.delete("/accounts/:id", (req, res) => {
  const id = toId(req.params.id);
  if (!id) return bad(res, "Invalid account id.");
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id); // cascades to its post targets
  res.json({ ok: true });
});

// ── media ──
router.post("/media", upload.single("file"), (req, res) => {
  if (!req.file) return bad(res, "No file received");
  if (!sniffMatchesExtension(req.file.path, req.file.filename)) {
    deleteMediaFile(req.file.filename);
    return bad(res, "That file's contents don't match its extension.");
  }
  res.json({ path: req.file.filename, type: typeOf(req.file.filename) });
});

// ── posts ──
router.get("/posts", (req, res) => {
  const posts = db.prepare("SELECT * FROM posts ORDER BY scheduled_at ASC").all();
  const targets = db.prepare(`
    SELECT pt.*, a.display_name, a.avatar_url FROM post_targets pt
    LEFT JOIN accounts a ON a.id = pt.account_id
  `).all();
  const byPost = new Map();
  for (const t of targets) {
    if (!byPost.has(t.post_id)) byPost.set(t.post_id, []);
    byPost.get(t.post_id).push(t);
  }
  res.json(posts.map((p) => ({ ...p, targets: byPost.get(p.id) || [] })));
});

// Per-platform option allowlists: anything else the browser sends is dropped.
const bool = (v) => v === true;
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

const OPTIONS = {
  instagram: (o) => ({ shareToFeed: o.shareToFeed === false ? false : true }),
  tiktok: (o) => ({
    privacy: oneOf(o.privacy, ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"], "SELF_ONLY"),
    disableComment: bool(o.disableComment),
    disableDuet: bool(o.disableDuet),
    disableStitch: bool(o.disableStitch),
  }),
  youtube: (o) => ({
    title: str(o.title, 100) || undefined,
    description: str(o.description, 5000),
    privacy: oneOf(o.privacy, ["public", "unlisted", "private"], "private"),
    tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === "string").slice(0, 30).map((t) => t.slice(0, 50)) : [],
    categoryId: /^\d{1,3}$/.test(String(o.categoryId)) ? String(o.categoryId) : undefined,
    madeForKids: bool(o.madeForKids),
  }),
  x: () => ({}),
};

const CAPTION_LIMIT = { instagram: 2200, tiktok: 2200, youtube: 5000, x: 25000 };

router.post("/posts", (req, res) => {
  const b = req.body && typeof req.body === "object" ? req.body : {};

  const body = typeof b.body === "string" ? b.body : "";
  const scheduledAt = Number(b.scheduledAt);
  const now = Date.now();
  if (!Number.isFinite(scheduledAt) || scheduledAt < now - 24 * 3600 * 1000 || scheduledAt > now + 5 * 365 * 86400000) {
    return bad(res, "Pick a valid date and time (within the next 5 years).");
  }

  if (!Array.isArray(b.targets) || !b.targets.length) return bad(res, "Pick at least one account to post to.");
  if (b.targets.length > 20) return bad(res, "Too many accounts selected.");

  // media: only names we generated, that exist on disk. Type is derived from the file, never trusted from the client.
  let mediaPath = null;
  let mediaType = null;
  if (b.mediaPath) {
    if (!isValidMediaName(b.mediaPath)) return bad(res, "Invalid media reference.");
    try { mediaFile(b.mediaPath); } catch { return bad(res, "Uploaded media was not found. Upload it again."); }
    mediaPath = b.mediaPath;
    mediaType = typeOf(mediaPath);
  }

  const getAccount = db.prepare("SELECT id, platform FROM accounts WHERE id = ?");
  const seen = new Set();
  const targets = [];
  for (const t of b.targets) {
    const accountId = toId(t?.accountId);
    if (!accountId) return bad(res, "Invalid account selected.");
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    const account = getAccount.get(accountId);
    if (!account) return bad(res, "One of the selected accounts no longer exists. Refresh and try again.");

    // platform comes from our database, not from the browser
    const opts = OPTIONS[account.platform](t.options && typeof t.options === "object" ? t.options : {});
    if (body.length > CAPTION_LIMIT[account.platform]) {
      return bad(res, `Caption is over the ${account.platform} limit (${CAPTION_LIMIT[account.platform]}).`);
    }
    if (["instagram", "tiktok", "youtube"].includes(account.platform) && !mediaPath) {
      return bad(res, "Instagram, TikTok and YouTube need an image or video attached.");
    }
    if (["tiktok", "youtube"].includes(account.platform) && mediaType !== "video") {
      return bad(res, "TikTok and YouTube need a video file.");
    }
    if (account.platform === "x" && !body.trim() && !mediaPath) return bad(res, "An X post needs text or media.");
    targets.push({ accountId, platform: account.platform, options: opts });
  }

  const create = db.transaction(() => {
    const info = db.prepare(
      "INSERT INTO posts (body, media_path, media_type, scheduled_at) VALUES (?, ?, ?, ?)"
    ).run(body, mediaPath, mediaType, Math.floor(scheduledAt));
    const insertTarget = db.prepare(
      "INSERT INTO post_targets (post_id, account_id, platform, options) VALUES (?, ?, ?, ?)"
    );
    for (const t of targets) insertTarget.run(info.lastInsertRowid, t.accountId, t.platform, JSON.stringify(t.options));
    return info.lastInsertRowid;
  });
  res.json({ id: create() });
});

router.delete("/posts/:id", (req, res) => {
  const id = toId(req.params.id);
  if (!id) return bad(res, "Invalid post id.");
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!post) return res.json({ ok: true });
  if (post.status === "publishing") {
    return res.status(409).json({ error: "This post is publishing right now. Try again in a minute." });
  }
  db.transaction(() => {
    db.prepare("DELETE FROM post_targets WHERE post_id = ?").run(id);
    db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  })();
  if (post.media_path && !db.prepare("SELECT 1 FROM posts WHERE media_path = ?").get(post.media_path)) {
    deleteMediaFile(post.media_path);
  }
  res.json({ ok: true });
});

// retry failed targets / post now
router.post("/posts/:id/publish-now", (req, res) => {
  const id = toId(req.params.id);
  if (!id) return bad(res, "Invalid post id.");
  const result = startPublishNow(id);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true }); // publishing continues in the background
});

// ── activity ──
router.get("/activity", (req, res) => {
  res.json(db.prepare("SELECT * FROM activity ORDER BY at DESC LIMIT 100").all());
});

export default router;
