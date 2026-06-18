// YouTube upload via Data API v3 resumable upload.
// Quota note: each upload costs 1600 of the default 10,000 daily units,
// so roughly 6 uploads/day until you request a quota increase.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function publish({ accessToken, post, options }) {
  if (post.media_type !== "video") {
    throw new Error("YouTube publishing requires a video file.");
  }
  const filePath = path.join(__dirname, "..", "..", "media", post.media_path);
  const size = fs.statSync(filePath).size;

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

  // 2. upload the file
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(size),
      "Content-Type": "video/*",
    },
    body: fs.readFileSync(filePath),
  });
  const data = await uploadRes.json();
  if (data.error) throw new Error(`YouTube upload failed: ${data.error.message}`);

  return { externalPostId: data.id };
}
