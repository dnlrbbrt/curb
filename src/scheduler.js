// The heartbeat. Runs every minute, finds due posts, refreshes tokens,
// dispatches to the right publisher, records the result per target.
//
// Every state change that decides "who publishes this" is an atomic
// compare-and-set UPDATE, so the scheduler and "Post now" can never both
// publish the same post/target.
import cron from "node-cron";
import fs from "fs";
import db, { getAccount, updateAccountTokens, log } from "./db.js";
import { mediaDir, isValidMediaName, deleteMediaFile } from "./media.js";
import * as metaAuth from "./oauth/meta.js";
import * as tiktokAuth from "./oauth/tiktok.js";
import * as googleAuth from "./oauth/google.js";
import * as xAuth from "./oauth/x.js";
import * as instagram from "./publishers/instagram.js";
import * as facebook from "./publishers/facebook.js";
import * as tiktok from "./publishers/tiktok.js";
import * as youtube from "./publishers/youtube.js";
import * as x from "./publishers/x.js";

const refreshers = { instagram: metaAuth, facebook: metaAuth, tiktok: tiktokAuth, youtube: googleAuth, x: xAuth };
const publishers = { instagram, facebook, tiktok, youtube, x };

let running = false;

export function startScheduler() {
  recoverInterrupted();
  cron.schedule("* * * * *", tick);
  cron.schedule("17 3 * * *", cleanupOrphanMedia);
  log("Scheduler started (checks every minute)");
}

/** Atomically move a post into 'publishing'. Returns false if someone else already has it. */
function claimPost(id, fromStatuses) {
  const marks = fromStatuses.map(() => "?").join(",");
  return db.prepare(`UPDATE posts SET status = 'publishing' WHERE id = ? AND status IN (${marks})`)
    .run(id, ...fromStatuses).changes === 1;
}

/** Used by "Post now" / "Retry failed". Returns the post, or a reason it can't run. */
export function startPublishNow(id) {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!post) return { error: "Post not found", status: 404 };
  if (!claimPost(id, ["scheduled", "failed", "partial"])) {
    return { error: "This post is already publishing or has finished.", status: 409 };
  }
  publishPost({ ...post, status: "publishing" }).catch((err) => log(`Publish error: ${err.message}`, "error"));
  return { ok: true };
}

/** After a crash/restart, nothing should stay 'publishing' forever. We do NOT auto-retry:
 *  the platform may have accepted the post, and retrying could duplicate it. */
export function recoverInterrupted() {
  const t = db.prepare(
    "UPDATE post_targets SET status = 'failed', error = ? WHERE status = 'publishing'"
  ).run("Interrupted by a server restart. Check the platform first — it may already be live — then retry.");
  const stuck = db.prepare("SELECT id FROM posts WHERE status = 'publishing'").all();
  for (const p of stuck) rollup(p.id);
  if (t.changes || stuck.length) log(`Recovered ${stuck.length} interrupted post(s); marked ${t.changes} target(s) failed.`, "warn");
}

export async function tick() {
  if (running) return; // don't overlap if a video upload runs long
  running = true;
  try {
    const due = db.prepare(
      "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= ?"
    ).all(Date.now());

    for (const post of due) {
      if (!claimPost(post.id, ["scheduled"])) continue;
      await publishPost(post);
    }
  } catch (err) {
    log(`Scheduler tick error: ${err.message}`, "error");
  } finally {
    running = false;
  }
}

function rollup(postId) {
  const all = db.prepare("SELECT status FROM post_targets WHERE post_id = ?").all(postId);
  const published = all.filter((t) => t.status === "published").length;
  const status = !all.length ? "failed" : published === all.length ? "done" : published > 0 ? "partial" : "failed";
  db.prepare("UPDATE posts SET status = ? WHERE id = ?").run(status, postId);
}

export async function publishPost(post) {
  const targets = db.prepare(
    "SELECT * FROM post_targets WHERE post_id = ? AND status IN ('pending','failed')"
  ).all(post.id);

  for (const target of targets) {
    const claimed = db.prepare(
      "UPDATE post_targets SET status = 'publishing', error = NULL WHERE id = ? AND status IN ('pending','failed')"
    ).run(target.id).changes === 1;
    if (!claimed) continue;

    try {
      const account = getAccount(target.account_id);
      if (!account) throw new Error("Account was disconnected.");
      const publisher = publishers[target.platform];
      if (!publisher) throw new Error(`Unsupported platform: ${target.platform}`);

      const accessToken = await refreshers[target.platform].refreshIfNeeded(account, updateAccountTokens);
      const options = JSON.parse(target.options || "{}");
      const result = await publisher.publish({ account, accessToken, post, options });

      db.prepare(
        "UPDATE post_targets SET status = 'published', external_post_id = ?, published_at = ? WHERE id = ?"
      ).run(result.externalPostId || null, Date.now(), target.id);
      log(`Published post #${post.id} to ${target.platform} (${account.display_name})`);
    } catch (err) {
      db.prepare("UPDATE post_targets SET status = 'failed', error = ? WHERE id = ?").run(String(err.message).slice(0, 500), target.id);
      log(`Post #${post.id} failed on ${target.platform}: ${err.message}`, "error");
    }
  }
  rollup(post.id);
}

/** Uploads that were never attached to a post (abandoned compose) are removed after 24h. */
export function cleanupOrphanMedia() {
  try {
    const used = new Set(db.prepare("SELECT media_path FROM posts WHERE media_path IS NOT NULL").all().map((r) => r.media_path));
    const cutoff = Date.now() - 24 * 3600 * 1000;
    let removed = 0;
    for (const name of fs.readdirSync(mediaDir)) {
      if (!isValidMediaName(name) || used.has(name)) continue;
      if (fs.statSync(`${mediaDir}/${name}`).mtimeMs < cutoff) { deleteMediaFile(name); removed++; }
    }
    if (removed) log(`Removed ${removed} unused upload(s).`);
  } catch (err) {
    log(`Media cleanup failed: ${err.message}`, "warn");
  }
}
