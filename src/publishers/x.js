// X API v2: chunked media upload (INIT/APPEND/FINALIZE) + POST /2/tweets.
// Pricing note: X is pay-per-use as of Feb 2026 (~$0.01 per post created).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publish({ accessToken, post }) {
  let mediaId = null;
  if (post.media_path) {
    mediaId = await uploadMedia(accessToken, post);
  }

  const payload = { text: (post.body || "").slice(0, 25000) };
  if (mediaId) payload.media = { media_ids: [mediaId] };
  if (!payload.text && !mediaId) throw new Error("X post needs text or media.");

  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.errors || data.error) {
    const msg = data.errors?.[0]?.message || data.detail || data.error;
    throw new Error(`X post failed: ${msg}`);
  }
  return { externalPostId: data.data.id };
}

async function uploadMedia(accessToken, post) {
  const filePath = path.join(__dirname, "..", "..", "media", post.media_path);
  const buf = fs.readFileSync(filePath);
  const isVideo = post.media_type === "video";
  const mediaType = isVideo ? "video/mp4" : guessImageMime(post.media_path);
  const category = isVideo ? "tweet_video" : "tweet_image";
  const base = "https://api.x.com/2/media/upload";
  const auth = { Authorization: `Bearer ${accessToken}` };

  // INIT
  let res = await fetch(base, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      command: "INIT",
      total_bytes: String(buf.length),
      media_type: mediaType,
      media_category: category,
    }),
  });
  let data = await res.json();
  const mediaId = data.data?.id || data.media_id_string;
  if (!mediaId) throw new Error(`X media INIT failed: ${JSON.stringify(data)}`);

  // APPEND in 4MB chunks
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < buf.length; i += CHUNK, seg++) {
    const form = new FormData();
    form.append("command", "APPEND");
    form.append("media_id", mediaId);
    form.append("segment_index", String(seg));
    form.append("media", new Blob([buf.subarray(i, i + CHUNK)]));
    res = await fetch(base, { method: "POST", headers: auth, body: form });
    if (!res.ok && res.status !== 204) {
      throw new Error(`X media APPEND failed: HTTP ${res.status}`);
    }
  }

  // FINALIZE
  res = await fetch(base, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ command: "FINALIZE", media_id: mediaId }),
  });
  data = await res.json();
  let processing = data.data?.processing_info || data.processing_info;

  // poll video processing
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new Error(`X media processing failed: ${processing.error?.message || "unknown"}`);
    }
    await sleep((processing.check_after_secs || 3) * 1000);
    res = await fetch(`${base}?command=STATUS&media_id=${mediaId}`, { headers: auth });
    data = await res.json();
    processing = data.data?.processing_info || data.processing_info;
  }
  return mediaId;
}

function guessImageMime(p) {
  const ext = p.split(".").pop().toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] || "image/jpeg";
}
