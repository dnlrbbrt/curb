// Tells the Rookwell CRM when a post goes live, so its Daily outreach tiles count it.
//
// Optional: does nothing unless CRM_WEBHOOK_URL and CRM_WEBHOOK_TOKEN are set in .env.
// It never throws and never delays publishing: a CRM outage must not affect a post.
// The CRM dedupes by target id, so retries and the startup catch-up can't double count.
import db, { log } from "./db.js";

const url = () => process.env.CRM_WEBHOOK_URL || "";
const token = () => process.env.CRM_WEBHOOK_TOKEN || "";
export const crmEnabled = () => Boolean(url() && token());

async function send(body) {
  const res = await fetch(url(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-rookwell-token": token() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`CRM answered ${res.status}`);
}

/** Fire-and-forget: call right after a target is marked published. */
export function notifyCrmPublished({ id, platform, externalPostId }, publishedAt = Date.now()) {
  if (!crmEnabled()) return;
  send({ platform, target_id: id, published_at: publishedAt, external_post_id: externalPostId || null })
    .catch((err) => log(`CRM post count failed for ${platform} #${id}: ${err.message}`, "warn"));
}

/** Resends recently published targets (last 48h by default) so anything missed while the CRM
 *  or this server was down still gets counted. Safe to run repeatedly. */
export async function syncRecentToCrm(hours = 48) {
  if (!crmEnabled()) return;
  try {
    const rows = db.prepare(
      "SELECT id, platform, external_post_id, published_at FROM post_targets WHERE status = 'published' AND published_at >= ?"
    ).all(Date.now() - hours * 3600 * 1000);
    for (let i = 0; i < rows.length; i += 100) {
      await send({
        events: rows.slice(i, i + 100).map((r) => ({
          platform: r.platform, target_id: r.id, published_at: r.published_at, external_post_id: r.external_post_id,
        })),
      });
    }
    if (rows.length) log(`Synced ${rows.length} recent post(s) to the CRM.`);
  } catch (err) {
    log(`CRM catch-up sync failed: ${err.message}`, "warn");
  }
}
