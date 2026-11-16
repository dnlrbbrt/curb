// X API v2: chunked media upload + POST /2/tweets.
// Pricing note: X is pay-per-use as of Feb 2026 (~$0.01 per post created).

import { fileSize, readRange } from "../media.js";

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
  const total = fileSize(post.media_path);
  const isVideo = post.media_type === "video";
  const mediaType = isVideo ? "video/mp4" : guessImageMime(post.media_path);
  const category = isVideo ? "tweet_video" : mediaType === "image/gif" ? "tweet_gif" : "tweet_image";
  const base = "https://api.x.com/2/media/upload";
  const auth = { Authorization: `Bearer ${accessToken}` };

  // Initialize the chunked upload.
  let res = await fetch(`${base}/initialize`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ total_bytes: total, media_type: mediaType, media_category: category }),
  });
  let data = await jsonOrThrow(res, "initialize");
  const mediaId = data.data?.id;
  if (!mediaId) throw new Error(`X media INIT failed: ${JSON.stringify(data)}`);

  // APPEND in 4MB chunks
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < total; i += CHUNK, seg++) {
    const form = new FormData();
    form.append("segment_index", String(seg));
    form.append("media", new Blob([await readRange(post.media_path, i, Math.min(i + CHUNK, total))]), "segment");
    res = await fetch(`${base}/${encodeURIComponent(mediaId)}/append`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    if (!res.ok) await jsonOrThrow(res, "append");
  }

  // Finalize and wait for video processing when X reports it.
  res = await fetch(`${base}/${encodeURIComponent(mediaId)}/finalize`, {
    method: "POST",
    headers: auth,
  });
  data = await jsonOrThrow(res, "finalize");
  let processing = data.data?.processing_info || data.processing_info;

  // poll video processing
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new Error(`X media processing failed: ${processing.error?.message || "unknown"}`);
    }
    await sleep((processing.check_after_secs || 3) * 1000);
    res = await fetch(`${base}?media_id=${encodeURIComponent(mediaId)}`, { headers: auth });
    data = await jsonOrThrow(res, "status");
    processing = data.data?.processing_info || data.processing_info;
  }
  return mediaId;
}

async function jsonOrThrow(res, action) {
  const body = await res.text();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    data = { detail: body };
  }
  if (!res.ok || data.errors?.length || data.error) {
    const msg = data.errors?.[0]?.detail || data.errors?.[0]?.message || data.detail || data.error || `HTTP ${res.status}`;
    throw new Error(`X media ${action} failed: ${msg}`);
  }
  return data;
}

function guessImageMime(p) {
  const ext = p.split(".").pop().toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] || "image/jpeg";
}
