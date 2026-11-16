// TikTok Direct Post via Content Posting API.
// Required sequence per TikTok guidelines:
//   1. query creator info (mandatory before every post)
//   2. init the post with FILE_UPLOAD source
//   3. PUT the video bytes to the returned upload_url
//   4. poll publish status
// NOTE: until your TikTok app passes its audit, posts are forced to
// SELF_ONLY (private) visibility. That's TikTok policy, not a bug.

import { fileSize, readRange } from "../media.js";

const API = "https://open.tiktokapis.com/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tk(endpoint, accessToken, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.error && data.error.code !== "ok") {
    throw new Error(`TikTok API: ${data.error.message || data.error.code}`);
  }
  return data.data;
}

export async function publish({ accessToken, post, options }) {
  if (post.media_type !== "video") {
    throw new Error("TikTok publishing in Curb supports video only.");
  }
  const size = fileSize(post.media_path);

  // 1. creator info (required by TikTok's integration guidelines)
  const creator = await tk("/post/publish/creator_info/query/", accessToken);
  const allowed = creator.privacy_level_options || [];
  let privacy = options.privacy || "PUBLIC_TO_EVERYONE";
  if (!allowed.includes(privacy)) privacy = allowed[0] || "SELF_ONLY";

  // 2. init — single chunk for files <= 64MB, otherwise chunked
  const CHUNK = 64 * 1024 * 1024;
  const totalChunks = size <= CHUNK ? 1 : Math.floor(size / CHUNK);
  const init = await tk("/post/publish/video/init/", accessToken, {
    post_info: {
      title: (post.body || "").slice(0, 2200),
      privacy_level: privacy,
      disable_comment: !!options.disableComment,
      disable_duet: !!options.disableDuet,
      disable_stitch: !!options.disableStitch,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: size,
      chunk_size: totalChunks === 1 ? size : CHUNK,
      total_chunk_count: totalChunks,
    },
  });

  // 3. upload bytes
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK;
    const end = i === totalChunks - 1 ? size - 1 : start + CHUNK - 1; // last chunk absorbs the remainder
    await putChunk(init.upload_url, await readRange(post.media_path, start, end + 1), start, end, size);
  }

  // 4. poll status
  const deadline = Date.now() + 5 * 60 * 1000;
  while (true) {
    const status = await tk("/post/publish/status/fetch/", accessToken, {
      publish_id: init.publish_id,
    });
    if (status.status === "PUBLISH_COMPLETE") {
      return { externalPostId: status.publicaly_available_post_id?.[0] || init.publish_id };
    }
    if (status.status === "FAILED") {
      throw new Error(`TikTok publish failed: ${status.fail_reason || "unknown reason"}`);
    }
    if (Date.now() > deadline) throw new Error("TikTok publish status polling timed out.");
    await sleep(5000);
  }
}

async function putChunk(uploadUrl, bytes, start, end, total) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
    body: bytes,
  });
  if (!res.ok && res.status !== 201) {
    throw new Error(`TikTok upload chunk failed: HTTP ${res.status}`);
  }
}
