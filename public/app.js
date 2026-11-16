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
  facebook: { chip: "f", cls: "p-facebook", limit: 63206 },
  tiktok: { chip: "TT", cls: "p-tiktok", limit: 2200 },
  youtube: { chip: "YT", cls: "p-youtube", limit: 5000 },
  x: { chip: "X", cls: "p-x", limit: 280 },
};
const PLATFORM_PATHS = {
  instagram: "M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.67 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.69-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16m0-2.16C8.75 0 8.34.01 7.05.07 2.7.27.27 2.7.07 7.05.01 8.34 0 8.75 0 12s.01 3.66.07 4.95c.2 4.35 2.63 6.78 6.98 6.98C8.34 23.99 8.75 24 12 24s3.66-.01 4.95-.07c4.34-.2 6.78-2.63 6.98-6.98.06-1.29.07-1.7.07-4.95s-.01-3.66-.07-4.95C23.73 2.7 21.3.27 16.95.07 15.66.01 15.25 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zm0 10.16A4 4 0 1 1 12 8a4 4 0 0 1 0 8zm6.41-11.84a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z",
  facebook: "M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.98h-1.513c-1.49 0-1.956.932-1.956 1.888v2.253h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z",
  tiktok: "M12.53.02h4.14c.29 2.47 1.7 4.67 3.88 5.9 1.08.61 2.3.95 3.45 1.02v4.04c-2.07-.07-4.1-.68-5.83-1.76v8.26c0 4.16-3.37 7.53-7.53 7.53S3.11 21.64 3.11 17.48s3.37-7.53 7.53-7.53c.43 0 .86.04 1.27.11v4.22a3.34 3.34 0 1 0 2.74 3.29V.02h-2.12z",
  youtube: "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.55 3.6 12 3.6 12 3.6s-7.55 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.85.5 9.4.5 9.4.5s7.55 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z",
  x: "M18.9 2h3.7l-8.1 9.3L24 22h-7.4l-5.8-7.5L4.2 22H.5l8.7-10L0 2h7.6l5.2 6.9L18.9 2zm-1.3 18h2.1L6.5 3.9H4.2L17.6 20z",
};

function platformIcon(platform) {
  const meta = PLATFORM[platform] || { chip: "?", cls: "" };
  const path = PLATFORM_PATHS[platform];
  const icon = platform === "tiktok"
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="tt-cyan" d="${path}" transform="translate(-.9 0)"/><path class="tt-red" d="${path}" transform="translate(.9 0)"/><path class="tt-core" d="${path}"/></svg>`
    : path ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>` : meta.chip;
  return `<span class="pchip ${meta.cls}" title="${escapeHtml(platform)}" aria-label="${escapeHtml(platform)}">${icon}</span>`;
}

let accounts = [];
let selectedTargets = new Map(); // accountId -> { platform }
let media = null; // { path, type }
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

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
  const upcoming = posts.filter((p) => ["scheduled", "publishing"].includes(p.status));
  const past = posts.filter((p) => !["scheduled", "publishing"].includes(p.status)).reverse();

  renderCalendar(posts);
  renderRail($("#queue-rail"), upcoming, true);
  renderRail($("#history-rail"), past, false);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderCalendar(posts) {
  const title = $("#calendar-title");
  const days = $("#calendar-days");
  if (!title || !days) return;
  title.textContent = calendarMonth.toLocaleDateString([], { month: "long", year: "numeric" });
  days.innerHTML = "";

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + dayCount) / 7);
  const byDay = new Map();
  for (const post of posts) {
    const date = new Date(post.scheduled_at);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    const key = dateKey(date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(post);
  }

  const today = dateKey(new Date());
  for (let i = 0; i < weeks * 7; i++) {
    const dayNumber = i - offset + 1;
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    if (dayNumber < 1 || dayNumber > dayCount) {
      cell.classList.add("calendar-day-outside");
      cell.setAttribute("aria-hidden", "true");
      days.appendChild(cell);
      continue;
    }
    const date = new Date(year, month, dayNumber);
    const key = dateKey(date);
    const postsForDay = (byDay.get(key) || []).sort((a, b) => a.scheduled_at - b.scheduled_at);
    if (key === today) cell.classList.add("calendar-day-today");
    cell.innerHTML = `<div class="calendar-day-number"><span>${dayNumber}</span>${postsForDay.length ? `<span class="calendar-count">${postsForDay.length}</span>` : ""}</div>`;
    for (const post of postsForDay) {
      const time = new Date(post.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const platforms = [...new Set(post.targets.map((t) => t.platform))];
      const marks = platforms.map(platformIcon).join("");
      const event = document.createElement("div");
      event.className = `calendar-event calendar-event-${post.status}`;
      event.title = `${time} · ${post.body || "(no caption)"} · ${platforms.join(", ")}`;
      event.innerHTML = `<time>${time}</time><span class="calendar-event-text">${escapeHtml(post.body || "Untitled post")}</span><span class="calendar-event-platforms">${marks}</span>`;
      cell.appendChild(event);
    }
    days.appendChild(cell);
  }
}

$("#calendar-prev").addEventListener("click", () => { calendarMonth.setMonth(calendarMonth.getMonth() - 1); loadQueue(); });
$("#calendar-next").addEventListener("click", () => { calendarMonth.setMonth(calendarMonth.getMonth() + 1); loadQueue(); });
$("#calendar-today").addEventListener("click", () => { calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); loadQueue(); });

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
    return `<span class="tchip ${cls}"${err}>${platformIcon(t.platform)}${escapeHtml(t.display_name || t.platform)}${t.status === "failed" ? " — failed (hover for why)" : ""}</span>`;
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
      ${platformIcon(a.platform)}
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
    t.innerHTML = `${platformIcon(a.platform)}<img src="${a.avatar_url || avatarFallback(a.display_name)}" alt=""><span class="tname">${escapeHtml(a.display_name || "")}</span>`;
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
  if (plats.includes("facebook")) {
    el.insertAdjacentHTML("beforeend", `
      <div class="popts">
        <span class="side-label">Facebook</span>
        <div class="compose-note">Publishes to the selected Facebook Page as a Page post. Text, image and video are supported.</div>
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
function setScheduleFields(d) {
  d = new Date(d);
  d.setSeconds(0, 0);
  $("#schedule-date").value = toDateInput(d);
  $("#schedule-clock").value = toTimeInput(d);
  updateSchedulePreview();
}
function toDateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInput(d) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function scheduleTimestamp() {
  if (!$("#schedule-date").value || !$("#schedule-clock").value) return NaN;
  return new Date(`${$("#schedule-date").value}T${$("#schedule-clock").value}`).getTime();
}
function updateSchedulePreview() {
  const stamp = scheduleTimestamp();
  $("#schedule-preview").textContent = Number.isFinite(stamp)
    ? `Scheduled for ${new Date(stamp).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "Choose a date and time.";
}
$("#schedule-date").addEventListener("input", updateSchedulePreview);
$("#schedule-clock").addEventListener("input", updateSchedulePreview);
$("#btn-now").addEventListener("click", () => setScheduleFields(Date.now() + 60 * 1000));
$$("[data-schedule-offset]").forEach((button) => button.addEventListener("click", () => setScheduleFields(Date.now() + Number(button.dataset.scheduleOffset))));
$("[data-schedule-tomorrow]").addEventListener("click", () => {
  const chosen = new Date();
  const current = scheduleTimestamp();
  if (Number.isFinite(current)) {
    const selected = new Date(current);
    chosen.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  } else {
    chosen.setHours(9, 0, 0, 0);
  }
  chosen.setDate(chosen.getDate() + 1);
  setScheduleFields(chosen);
});

$("#btn-schedule").addEventListener("click", async () => {
  const err = $("#compose-error");
  err.textContent = "";
  const body = $("#post-body").value;
  const when = scheduleTimestamp();
  const plats = selectedPlatforms();

  if (!selectedTargets.size) return (err.textContent = "Pick at least one account to post to.");
  if (!Number.isFinite(when)) return (err.textContent = "Choose a date and time, or use Publish soon.");
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
      scheduledAt: when,
      targets,
    }),
  });
  const data = await res.json().catch(() => ({ error: "Could not schedule the post." }));
  if (data.error) return (err.textContent = data.error);

  // reset and jump to the queue
  const scheduledDate = new Date(when);
  calendarMonth = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), 1);
  $("#post-body").value = "";
  $("#schedule-date").value = "";
  $("#schedule-clock").value = "";
  updateSchedulePreview();
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
$(".connect-card [data-platform]") && $$(".connect-card [data-platform]").forEach((el) => { el.outerHTML = platformIcon(el.dataset.platform); });
show("queue");
