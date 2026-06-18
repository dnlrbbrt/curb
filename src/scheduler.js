// The heartbeat. Runs every minute, finds due posts, refreshes tokens,
// dispatches to the right publisher, records the result per target.
import cron from "node-cron";
import db, { getAccount, updateAccountTokens, log } from "./db.js";
import * as metaAuth from "./oauth/meta.js";
import * as tiktokAuth from "./oauth/tiktok.js";
import * as googleAuth from "./oauth/google.js";
import * as xAuth from "./oauth/x.js";
import * as instagram from "./publishers/instagram.js";
import * as tiktok from "./publishers/tiktok.js";
import * as youtube from "./publishers/youtube.js";
import * as x from "./publishers/x.js";

const refreshers = { instagram: metaAuth, tiktok: tiktokAuth, youtube: googleAuth, x: xAuth };
const publishers = { instagram, tiktok, youtube, x };

let running = false;

export function startScheduler() {
  cron.schedule("* * * * *", tick);
  log("Scheduler started (checks every minute)");
}

export async function tick() {
  if (running) return; // don't overlap if a video upload runs long
  running = true;
  try {
    const due = db.prepare(
      "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= ?"
    ).all(Date.now());

    for (const post of due) {
      db.prepare("UPDATE posts SET status = 'publishing' WHERE id = ?").run(post.id);
      await publishPost(post);
    }
  } catch (err) {
    log(`Scheduler tick error: ${err.message}`, "error");
  } finally {
    running = false;
  }
}

export async function publishPost(post) {
  const targets = db.prepare(
    "SELECT * FROM post_targets WHERE post_id = ? AND status IN ('pending','failed')"
  ).all(post.id);

  for (const target of targets) {
    db.prepare("UPDATE post_targets SET status = 'publishing', error = NULL WHERE id = ?").run(target.id);
    try {
      const account = getAccount(target.account_id);
      if (!account) throw new Error("Account was disconnected.");

      const accessToken = await refreshers[target.platform].refreshIfNeeded(account, updateAccountTokens);
      const options = JSON.parse(target.options || "{}");
      const result = await publishers[target.platform].publish({ account, accessToken, post, options });

      db.prepare(
        "UPDATE post_targets SET status = 'published', external_post_id = ?, published_at = ? WHERE id = ?"
      ).run(result.externalPostId || null, Date.now(), target.id);
      log(`Published post #${post.id} to ${target.platform} (${account.display_name})`);
    } catch (err) {
      db.prepare("UPDATE post_targets SET status = 'failed', error = ? WHERE id = ?").run(err.message, target.id);
      log(`Post #${post.id} failed on ${target.platform}: ${err.message}`, "error");
    }
  }

  // roll up post status
  const all = db.prepare("SELECT status FROM post_targets WHERE post_id = ?").all(post.id);
  const published = all.filter((t) => t.status === "published").length;
  const status = published === all.length ? "done" : published > 0 ? "partial" : "failed";
  db.prepare("UPDATE posts SET status = ? WHERE id = ?").run(status, post.id);
}
