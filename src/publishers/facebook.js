// Facebook Page publishing through Meta's official Graph API.
// Media URLs are signed and short-lived; Facebook fetches them during publish.
import { mediaUrl as signedMediaUrl } from "../media.js";

const GRAPH = "https://graph.facebook.com/v27.0";

async function create(path, params) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Facebook API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

export async function publish({ account, accessToken, post }) {
  const pageId = account.external_id;
  const mediaUrl = post.media_path ? signedMediaUrl(post.media_path, 2 * 3600) : null;
  const common = { access_token: accessToken };

  if (post.media_type === "image" && mediaUrl) {
    const data = await create(`${pageId}/photos`, {
      ...common,
      url: mediaUrl,
      caption: post.body || "",
    });
    return { externalPostId: data.post_id || data.id };
  }

  if (post.media_type === "video" && mediaUrl) {
    const data = await create(`${pageId}/videos`, {
      ...common,
      file_url: mediaUrl,
      description: post.body || "",
    });
    return { externalPostId: data.id };
  }

  const data = await create(`${pageId}/feed`, {
    ...common,
    message: post.body || "",
  });
  return { externalPostId: data.id };
}
