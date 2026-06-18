import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import db from "../db.js";
import { publishPost } from "../scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaDir = path.join(__dirname, "..", "..", "media");

const upload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
});

const router = Router();

// ── accounts ──
router.get("/accounts", (req, res) => {
  const rows = db.prepare(
    "SELECT id, platform, display_name, avatar_url, token_expires_at, created_at FROM accounts ORDER BY platform"
  ).all();
  res.json(rows);
});

router.delete("/accounts/:id", (req, res) => {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── media ──
router.post("/media", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received" });
  const isVideo = /\.(mp4|mov|m4v|webm)$/i.test(req.file.filename);
  res.json({ path: req.file.filename, type: isVideo ? "video" : "image" });
});

// ── posts ──
router.get("/posts", (req, res) => {
  const posts = db.prepare("SELECT * FROM posts ORDER BY scheduled_at ASC").all();
  const targets = db.prepare(`
    SELECT pt.*, a.display_name, a.avatar_url FROM post_targets pt
    LEFT JOIN accounts a ON a.id = pt.account_id
  `).all();
  res.json(posts.map((p) => ({
    ...p,
    targets: targets.filter((t) => t.post_id === p.id),
  })));
});

router.post("/posts", (req, res) => {
  const { body, mediaPath, mediaType, scheduledAt, targets } = req.body;
  if (!targets?.length) return res.status(400).json({ error: "Pick at least one account to post to." });
  if (!scheduledAt) return res.status(400).json({ error: "Pick a date and time." });

  const accountExists = db.prepare("SELECT 1 FROM accounts WHERE id = ?");
  for (const t of targets) {
    if (!accountExists.get(t.accountId)) {
      return res.status(400).json({ error: "One of the selected accounts no longer exists. Refresh and try again." });
    }
  }

  const create = db.transaction(() => {
    const info = db.prepare(
      "INSERT INTO posts (body, media_path, media_type, scheduled_at) VALUES (?, ?, ?, ?)"
    ).run(body || "", mediaPath || null, mediaType || null, scheduledAt);
    const insertTarget = db.prepare(
      "INSERT INTO post_targets (post_id, account_id, platform, options) VALUES (?, ?, ?, ?)"
    );
    for (const t of targets) {
      insertTarget.run(info.lastInsertRowid, t.accountId, t.platform, JSON.stringify(t.options || {}));
    }
    return info.lastInsertRowid;
  });
  res.json({ id: create() });
});

router.delete("/posts/:id", (req, res) => {
  db.prepare("DELETE FROM post_targets WHERE post_id = ?").run(req.params.id);
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// retry failed targets / post now
router.post("/posts/:id/publish-now", async (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found" });
  db.prepare("UPDATE posts SET status = 'publishing' WHERE id = ?").run(post.id);
  res.json({ ok: true }); // respond immediately; publishing continues in background
  publishPost(post).catch(() => {});
});

// ── activity ──
router.get("/activity", (req, res) => {
  res.json(db.prepare("SELECT * FROM activity ORDER BY at DESC LIMIT 100").all());
});

export default router;
