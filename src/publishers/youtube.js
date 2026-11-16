// YouTube upload via Data API v3 resumable upload.
// Quota note: each upload costs 1600 of the default 10,000 daily units,
// so roughly 6 uploads/day until you request a quota increase.

import { fileSize, readRange } from "../media.js";

// Chunks must be multiples of 256 KiB for YouTube's resumable protocol.
const CHUNK = 16 * 1024 * 1024;

export async function publish({ accessToken, post, options }) {
  if (post.media_type !== "video") {
    throw new Error("YouTube publishing requires a video file.");
  }
  const size = fileSize(post.media_path);

  const body = post.body || "";
  const title = options.title || body.split("\n")[0].slice(0, 100) || "Untitled";

  const metadata = {
    snippet: {
      title,
      description: options.description ?? body,
      tags: options.tags || [],
      categoryId: options.categoryId || "22", // People & Blogs default
    },
    status: {
      privacyStatus: options.privacy || "public",
      selfDeclaredMadeForKids: !!options.madeForKids,
    },
  };

  // 1. start resumable session
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/*",
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(`YouTube upload init failed: ${err.error?.message || `HTTP ${initRes.status}`}`);
  }
  const uploadUrl = initRes.headers.get("location");

  // 2. upload in chunks (never holds the whole video in memory)
  let data = null;
  for (let start = 0; start < size; start += CHUNK) {
    const end = Math.min(start + CHUNK, size);
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${size}`,
        "Content-Type": "video/*",
      },
      body: await readRange(post.media_path, start, end),
    });
    if (uploadRes.status === 308) continue; // chunk accepted, more to send
    data = await uploadRes.json().catch(() => ({}));
    if (data.error) throw new Error(`YouTube upload failed: ${data.error.message}`);
    if (!uploadRes.ok) throw new Error(`YouTube upload failed: HTTP ${uploadRes.status}`);
  }
  if (!data?.id) throw new Error("YouTube upload finished without returning a video id.");

  return { externalPostId: data.id };
}
