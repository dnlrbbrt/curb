// Curb dashboard — vanilla JS, no build step.

// If the session expires, any API call comes back 401 -> go to the login page.
const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _fetch(...args);
  if (res.status === 401) location.href = "/login";
  return res;
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PLATFORM = {
  instagram: { chip: "IG", cls: "p-instagram", limit: 2200 },
  tiktok: { chip: "TT", cls: "p-tiktok", limit: 2200 },
  youtube: { chip: "YT", cls: "p-youtube", limit: 5000 },
  x: { chip: "X", cls: "p-x", limit: 280 },
};

let accounts = [];
let selectedTargets = new Map(); // accountId -> { platform }
let media = null; // { path, type }

// ── navigation ──
function show(view) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "queue") loadQueue();
  if (view === "accounts") loadAccounts();
  if (view === "activity") loadActivity();
  if (view === "compose") renderTargets();
}
$$(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
$$("[data-goto]").forEach((b) => b.addEventListener("click", () => show(b.dataset.goto)));

// ── clock ──
setInterval(() => {
  $("#clock").textContent = new Date().toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}, 1000);

// ── queue ──
async function loadQueue() {
  const posts = await fetch("/api/posts").then((r) => r.json());
  const now = Date.now();
  const upcoming = posts.filter((p) => ["scheduled", "publishing"].includes(p.status));
  const past = posts.filter((p) => !["scheduled", "publishing"].includes(p.status)).reverse();

  renderRail($("#queue-rail"), upcoming, true);
  renderRail($("#history-rail"), past, false);
}

function renderRail(el, posts, withNowMarker) {
  el.innerHTML = "";
  if (!posts.length) {
    el.innerHTML = `<div class="empty">${withNowMarker ? "Nothing scheduled. Your queue is an invitation." : "Nothing published yet."}</div>`;
    return;
  }
  let lastDay = "";
  let nowPlaced = !withNowMarker;
  const now = Date.now();

  for (const p of posts) {
    if (!nowPlaced && p.scheduled_at > now) {
      el.appendChild(Object.assign(document.createElement("div"), { className: "now-marker" }));
      nowPlaced = true;
    }
    const day = new Date(p.scheduled_at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    if (day !== lastDay) {
      const d = document.createElement("div");
      d.className = "rail-day";
      d.textContent = day;
      el.appendChild(d);
      lastDay = day;
    }
    el.appendChild(postCard(p));
  }
  if (!nowPlaced) {
    el.appendChild(Object.assign(document.createElement("div"), { className: "now-marker" }));
  }
}

function postCard(p) {
  const item = document.createElement("div");
  item.className = `rail-item s-${p.status}`;
  const time = new Date(p.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const chips = p.targets.map((t) => {
    const meta = PLATFORM[t.platform];
    const cls = t.status === "published" ? "t-published" : t.status === "failed" ? "t-failed" : t.status === "publishing" ? "t-publishing" : "";
    const err = t.error ? ` title="${escapeHtml(t.error)}"` : "";
    return `<span class="tchip ${cls}"${err}><span class="pchip ${meta.cls}">${meta.chip}</span>${escapeHtml(t.display_name || t.platform)}${t.status === "failed" ? " — failed (hover for why)" : ""}</span>`;
  }).join("");

  const thumb = p.media_path
    ? p.media_type === "video"
      ? `<video class="rail-thumb" src="/media/${escapeHtml(p.media_path)}" muted></video>`
      : `<img class="rail-thumb" src="/media/${escapeHtml(p.media_path)}" alt="">`
    : "";

  const canRetry = p.targets.some((t) => t.status === "failed") || p.status === "scheduled";
  item.innerHTML = `
    <div class="rail-time">${time}</div>
    ${thumb}
    <div class="rail-body">
      <div class="rail-text">${escapeHtml(p.body || "")}</div>
      <div class="rail-meta">${chips}</div>
    </div>
    <div class="rail-actions">
      ${canRetry ? `<button class="btn btn-mini" data-now="${p.id}">${p.status === "scheduled" ? "Post now" : "Retry failed"}</button>` : ""}
      <button class="btn btn-mini" data-del="${p.id}">Delete</button>
    </div>`;

  item.querySelector("[data-del]")?.addEventListener("click", async () => {
    if (!confirm("Delete this post?")) return;
    await fetch(`/api/posts/${p.id}`, { method: "DELETE" });
    loadQueue();
  });
  item.querySelector("[data-now]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Publishing…";
    await fetch(`/api/posts/${p.id}/publish-now`, { method: "POST" });
    setTimeout(loadQueue, 2500);
  });
  return item;
}

// poll the queue while anything is publishing
setInterval(() => {
  if (!$("#view-queue").classList.contains("hidden")) loadQueue();
}, 15000);

// ── accounts ──
async function loadAccounts() {
  accounts = await fetch("/api/accounts").then((r) => r.json());
  const el = $("#account-list");
  el.innerHTML = accounts.length ? "" : `<div class="empty">No accounts connected. Pick a platform below — each one walks you through its own login.</div>`;
  for (const a of accounts) {
    const meta = PLATFORM[a.platform];
    const row = document.createElement("div");
    row.className = "account-row";
    const exp = a.token_expires_at
      ? `token renews · expires ${new Date(a.token_expires_at).toLocaleDateString()}`
      : "long-lived token";
    row.innerHTML = `
      <span class="pchip ${meta.cls}">${meta.chip}</span>
      <img src="${a.avatar_url || avatarFallback(a.display_name)}" alt="">
      <span class="aname">${escapeHtml(a.display_name || "")}</span>
      <span class="aexp">${exp}</span>
      <button class="btn btn-mini" data-dc="${a.id}">Disconnect</button>`;
    row.querySelector("[data-dc]").addEventListener("click", async () => {
      if (!confirm(`Disconnect ${a.display_name}? Its queued posts to this account will be removed.`)) return;
      await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
      loadAccounts();
    });
    el.appendChild(row);
  }
}

function avatarFallback(name) {
  const c = (name || "?").replace(/^@/, "")[0] || "?";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' rx='18' fill='#211e18'/><text x='18' y='24' text-anchor='middle' fill='#8a857a' font-family='sans-serif' font-size='16'>${c}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ── compose: targets ──
async function renderTargets() {
  accounts = await fetch("/api/accounts").then((r) => r.json());
  const el = $("#target-list");
  el.innerHTML = accounts.length ? "" : `<div class="empty empty-compact">Connect an account first (Accounts tab).</div>`;
  for (const a of accounts) {
    const meta = PLATFORM[a.platform];
    const t = document.createElement("div");
    t.className = "target" + (selectedTargets.has(a.id) ? " selected" : "");
    t.setAttribute("role", "checkbox");
    t.setAttribute("tabindex", "0");
    t.innerHTML = `<span class="pchip ${meta.cls}">${meta.chip}</span><img src="${a.avatar_url || avatarFallback(a.display_name)}" alt=""><span class="tname">${escapeHtml(a.display_name || "")}</span>`;
    const toggle = () => {
      if (selectedTargets.has(a.id)) selectedTargets.delete(a.id);
      else selectedTargets.set(a.id, { platform: a.platform });
      t.classList.toggle("selected");
      renderPlatformOptions();
      updateCharCounts();
    };
    t.addEventListener("click", toggle);
    t.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
    el.appendChild(t);
  }
  renderPlatformOptions();
  updateCharCounts();
}

function selectedPlatforms() {
  return [...new Set([...selectedTargets.values()].map((t) => t.platform))];
}

function renderPlatformOptions() {
  const el = $("#platform-options");
  el.innerHTML = "";
  const plats = selectedPlatforms();

  if (plats.includes("youtube")) {
    el.insertAdjacentHTML("beforeend", `
      <div class="popts">
        <span class="side-label">YouTube</span>
        <label class="field"><span class="field-label">Video title</span>
          <input type="text" id="yt-title" maxlength="100" placeholder="Defaults to first line of caption"></label>
        <label class="field"><span class="field-label">Visibility</span>
          <select id="yt-privacy">
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select></label>
      </div>`);
  }
  if (plats.includes("tiktok")) {
    el.insertAdjacentHTML("beforeend", `
      <div class="popts">
        <span class="side-label">TikTok</span>
        <label class="field"><span class="field-label">Who can watch</span>
          <select id="tt-privacy">
            <option value="PUBLIC_TO_EVERYONE">Everyone</option>
            <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
            <option value="SELF_ONLY">Only me</option>
          </select></label>
        <div class="compose-note">Until your TikTok app passes its audit, TikTok forces "Only me" no matter what you pick here.</div>
      </div>`);
  }
  if (plats.includes("instagram")) {
    el.insertAdjacentHTML("beforeend", `
      <div class="popts">
        <span class="side-label">Instagram</span>
        <div class="compose-note">Needs an image or video. Videos publish as Reels. Max 50 API posts per account per day.</div>
      </div>`);
  }
}

// ── compose: character counts ──
$("#post-body").addEventListener("input", updateCharCounts);
function updateCharCounts() {
  const len = $("#post-body").value.length;
  const el = $("#char-counts");
  const plats = selectedPlatforms();
  el.innerHTML = plats.length
    ? plats.map((p) => `<span class="${len > PLATFORM[p].limit ? "over" : ""}">${PLATFORM[p].chip} ${len}/${PLATFORM[p].limit}</span>`).join("")
    : `<span>${len} characters</span>`;
}

// ── compose: media ──
const dropZone = $("#drop-zone");
const mediaInput = $("#media-input");
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) uploadMedia(e.dataTransfer.files[0]);
});
mediaInput.addEventListener("change", () => { if (mediaInput.files[0]) uploadMedia(mediaInput.files[0]); });

async function uploadMedia(file) {
  $("#drop-label").textContent = `Uploading ${file.name}…`;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/media", { method: "POST", body: form });
  const data = await res.json().catch(() => ({ error: "Upload failed." }));
  if (data.error) {
    $("#drop-label").textContent = data.error;
    return;
  }
  media = data;
  $("#drop-label").textContent = "Drop a different file to replace";
  const prev = $("#media-preview");
  prev.classList.remove("hidden");
  prev.innerHTML = (data.type === "video"
    ? `<video src="/media/${escapeHtml(data.path)}" controls muted></video>`
    : `<img src="/media/${escapeHtml(data.path)}" alt="">`)
    + `<button class="btn btn-mini" id="btn-clear-media">Remove</button>`;
  $("#btn-clear-media").addEventListener("click", () => {
    media = null;
    prev.classList.add("hidden");
    prev.innerHTML = "";
    $("#drop-label").textContent = "Drop an image or video here, or click to browse";
  });
}

// ── compose: schedule ──
$("#btn-now").addEventListener("click", () => {
  const d = new Date(Date.now() + 60 * 1000);
  d.setSeconds(0, 0);
  $("#schedule-time").value = toLocalInput(d);
});
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

$("#btn-schedule").addEventListener("click", async () => {
  const err = $("#compose-error");
  err.textContent = "";
  const body = $("#post-body").value;
  const when = $("#schedule-time").value;
  const plats = selectedPlatforms();

  if (!selectedTargets.size) return (err.textContent = "Pick at least one account to post to.");
  if (!when) return (err.textContent = "Pick a date and time, or hit Now.");
  if ((plats.includes("instagram") || plats.includes("tiktok") || plats.includes("youtube")) && !media) {
    return (err.textContent = "Instagram, TikTok and YouTube need an image or video attached.");
  }
  if ((plats.includes("tiktok") || plats.includes("youtube")) && media?.type !== "video") {
    return (err.textContent = "TikTok and YouTube need a video file.");
  }
  for (const p of plats) {
    if (body.length > PLATFORM[p].limit) return (err.textContent = `Caption is over the ${PLATFORM[p].chip} limit (${PLATFORM[p].limit}).`);
  }

  const targets = [...selectedTargets.entries()].map(([accountId, t]) => {
    const options = {};
    if (t.platform === "youtube") {
      options.title = $("#yt-title")?.value || undefined;
      options.privacy = $("#yt-privacy")?.value || "public";
      options.description = body;
    }
    if (t.platform === "tiktok") options.privacy = $("#tt-privacy")?.value || "PUBLIC_TO_EVERYONE";
    return { accountId, platform: t.platform, options };
  });

  const res = await fetch("/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body,
      mediaPath: media?.path || null,
      mediaType: media?.type || null,
      scheduledAt: new Date(when).getTime(),
      targets,
    }),
  });
  const data = await res.json().catch(() => ({ error: "Could not schedule the post." }));
  if (data.error) return (err.textContent = data.error);

  // reset and jump to the queue
  $("#post-body").value = "";
  $("#schedule-time").value = "";
  media = null;
  $("#media-preview").classList.add("hidden");
  $("#media-preview").innerHTML = "";
  $("#drop-label").textContent = "Drop an image or video here, or click to browse";
  selectedTargets.clear();
  show("queue");
});

// ── activity ──
async function loadActivity() {
  const rows = await fetch("/api/activity").then((r) => r.json());
  $("#activity-list").innerHTML = rows.length
    ? rows.map((r) => `<div class="activity-row l-${r.level}"><span class="at">${new Date(r.at).toLocaleString()}</span><span>${escapeHtml(r.message)}</span></div>`).join("")
    : `<div class="empty">Nothing yet. Activity shows up as posts publish.</div>`;
}

// ── connect result toast (from OAuth redirect) ──
const params = new URLSearchParams(location.search);
if (params.get("connect")) {
  history.replaceState({}, "", "/");
  if (params.get("connect") === "ok") show("accounts");
  else if (params.get("connect") === "error") {
    show("accounts");
    alert(`Couldn't connect ${params.get("platform")}: ${params.get("msg")}`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#btn-logout").addEventListener("click", async () => {
  await _fetch("/logout", { method: "POST" });
  location.href = "/login";
});

// boot
show("queue");
