// Instagram content publishing via Graph API.
// Two-step: create a media container (Meta fetches the file from your
// PUBLIC_BASE_URL), poll until processed, then publish.
// Hard platform limit: 50 API-published posts per account per 24h.

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path, params, method = "GET") {
  const url = `${GRAPH}/${path}` + (method === "GET" ? `?${new URLSearchParams(params)}` : "");
  const res = await fetch(url, method === "GET" ? {} : {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Instagram API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publish({ account, accessToken, post, options }) {
  const igUserId = account.external_id;
  const caption = post.body || "";

  if (!post.media_path) {
    throw new Error("Instagram requires an image or video. Text-only posts aren't supported by the API.");
  }
  const mediaUrl = `${process.env.PUBLIC_BASE_URL}/media/${post.media_path}`;

  // 1. create container
  const containerParams = { access_token: accessToken, caption };
  if (post.media_type === "video") {
    containerParams.media_type = "REELS"; // all API video posts publish as Reels
    containerParams.video_url = mediaUrl;
    if (options.shareToFeed === false) containerParams.share_to_feed = "false";
  } else {
    containerParams.image_url = mediaUrl;
  }
  const container = await graph(`${igUserId}/media`, containerParams, "POST");

  // 2. poll processing status (videos take a while)
  const deadline = Date.now() + 5 * 60 * 1000;
  while (true) {
    const status = await graph(container.id, { fields: "status_code", access_token: accessToken });
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") throw new Error("Instagram rejected the media during processing. Check format/specs (Reels: MP4, 9:16 recommended, <15 min).");
    if (Date.now() > deadline) throw new Error("Instagram media processing timed out after 5 minutes.");
    await sleep(5000);
  }

  // 3. publish
  const result = await graph(`${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: accessToken,
  }, "POST");

  return { externalPostId: result.id };
}
