/* Session list · Group by — interactive mockup. Vanilla JS, no deps.
 * Mirrors design.md: pure classify → partition(stored order) → hysteresis → render → FLIP. */
"use strict";

const HOLD_MS = 3000;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ───────── glyphs: same shape vocabulary as statusShapeIcon ───────── */
const G = {
  "needs-you": '<circle cx="8" cy="8" r="5" fill="currentColor"/>',
  error: '<circle cx="8" cy="8" r="5.6" fill="currentColor"/><path d="M6 6l4 4M10 6l-4 4" stroke="var(--bg-tertiary)" stroke-width="1.7" stroke-linecap="round"/>',
  working: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 3.4a4.6 4.6 0 0 1 0 9.2z" fill="currentColor"/>',
  review: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  idle: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  ended: '<circle cx="8" cy="8" r="2" fill="currentColor" opacity=".5"/>',
  main: '<path d="M5 3v10M5 10c0-3.5 6-2.5 6-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="11" cy="3.8" r="1.4" fill="currentColor"/>',
  worktrees: '<rect x="2.5" y="5" width="8" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5V4a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 13.5 4v5A1.5 1.5 0 0 1 12 10.5h-1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
};
const svg = (k, s = 12) => `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true">${G[k]}</svg>`;

/* ───────── lanes ───────── */
const LANES = {
  status: [
    { id: "needs-you", label: "Needs you", c: "var(--status-needs-you)", g: "needs-you" },
    { id: "error", label: "Failed", c: "var(--status-error)", g: "error" },
    { id: "working", label: "Working", c: "var(--status-working)", g: "working" },
    { id: "review", label: "To review", c: "var(--status-unread)", g: "review" },
    { id: "idle", label: "Idle", c: "var(--status-idle)", g: "idle" },
  ],
  location: [
    { id: "main", label: "Main checkout", c: "var(--text-tertiary)", g: "main" },
    { id: "worktrees", label: "Worktrees", c: "var(--text-tertiary)", g: "worktrees" },
  ],
};
const MODES = [["none", "None", "One list, newest first"], ["status", "Status", "Needs you · Working · Idle"], ["location", "Location", "Main checkout · Worktrees"]];
const modeLabel = (m) => MODES.find((x) => x[0] === m)[1];

/** Mirrors deriveStatusShape + unread overlay (design D2). */
function statusLane(s) {
  if (s.status === "ended") return null;
  if (s.error) return "error";
  if (s.ask) return "needs-you";
  if (s.status === "streaming") return "working";
  if (s.unread) return "review";
  return "idle";
}
const locationLane = (s) => (s.status === "ended" ? null : s.wt ? "worktrees" : "main");
const cardShape = (s) => (s.status === "ended" ? "ended" : statusLane(s));
const shapeColor = { "needs-you": "var(--status-needs-you)", error: "var(--status-error)", working: "var(--status-working)", review: "var(--status-unread)", idle: "var(--status-idle)", ended: "var(--text-muted)" };

/* ───────── fixtures (names from the live dashboard) ───────── */
function freshData() {
  const S = (id, name, o) => ({ id, name, status: "idle", ask: false, unread: false, error: false, wt: null, ago: "2m", ...o });
  return {
    folders: [
      { key: "/Users/robson/Project/pi-agent-dashboard", name: "pi-agent-dashboard", branch: "develop", sessions: [
        S("s1", "Image loading from tmp", { status: "streaming", tool: "read", change: "surface-denial-remedy-in-previews" }),
        S("s2", "fix-ship-tsconfig-base", { status: "streaming", tool: "bash" }),
        S("s3", "Unified memory model", { status: "streaming", tool: "edit", change: "context-manager-kernel" }),
        S("s4", "Fix edit", { status: "streaming", tool: "Thinking…" }),
        S("s5", "Music production", { unread: true, ago: "6m" }),
        S("s6", "deck3d-cinematic-worlds", { wt: "os/deck3d-cinematic-worlds", ago: "14m" }),
        S("s7", "add-acp-session-driver", { ago: "31m", change: "add-acp-session-driver" }),
        S("s8", "fix-terminal-session-dashboard-reload", { wt: "os/fix-terminal-session-dashboard-reload", ask: true, ago: "1m" }),
        S("s9", "fix-terminal-session-dashboard-reload", { status: "streaming", tool: "write" }),
        S("s10", "add-music-production-skills", { wt: "os/add-music-production-skills", status: "streaming", tool: "bash" }),
        S("e1", "kb eval fixtures", { status: "ended", ago: "3h" }),
        S("e2", "ship-it: unify-folder-status-capsule", { status: "ended", wt: "os/unify-folder-status-capsule", ago: "1d" }),
        S("e3", "tidy i18n keys", { status: "ended", ago: "2d" }),
      ] },
      { key: "/Users/robson/Documents", name: "Documents", branch: null, sessions: [
        S("d1", "video-feliratozas", { status: "streaming", tool: "bash" }),
        S("d2", "invoice sorting", { unread: true, ago: "9m" }),
      ] },
    ],
  };
}

/* ───────── state (prefs = what the server would own) ───────── */
const LS = "mock-session-list-group-by:v1";
// Sandboxed iframes (dashboard canvas) throw on localStorage access \u2014 fall back to memory.
const store = (() => {
  try { const s = window.localStorage; s.getItem(LS); return s; }
  catch { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; }
})();
let saved = null;
try { saved = JSON.parse(store.getItem(LS) || "null"); } catch { saved = null; }
const prefs = saved?.prefs
  ? { ...saved.prefs, collapsedLanes: new Set(saved.prefs.collapsedLanes), collapsedFolders: new Set(saved.prefs.collapsedFolders) }
  : { defaultGroupBy: "none", folderGroupBy: {}, collapsedLanes: new Set(), collapsedFolders: new Set() };
let data = freshData();
const order = {}; // folderKey -> ids (server sessionOrder)
for (const f of data.folders) order[f.key] = f.sessions.map((s) => s.id);
const ui = { selectedId: "s4", search: "", endedExpanded: new Set(), menuFor: null, dragging: null };
const held = new Map(); // id -> until (hysteresis, design D3)
const lastLane = new Map(); // id -> lane shown last render

function persist() {
  store.setItem(LS, JSON.stringify({ prefs: { ...prefs, collapsedLanes: [...prefs.collapsedLanes], collapsedFolders: [...prefs.collapsedFolders] } }));
}
const effectiveMode = (key) => prefs.folderGroupBy[key] ?? prefs.defaultGroupBy ?? "none";
const findSession = (id) => { for (const f of data.folders) { const s = f.sessions.find((x) => x.id === id); if (s) return [s, f]; } return [null, null]; };

/* ───────── pure partition (stored order preserved per lane) ───────── */
function sortByOrder(list, ord) {
  const idx = new Map(ord.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9));
}

/** Hysteresis: leaving Working for review/idle is held HOLD_MS; everything else immediate. */
function displayedLane(s, mode, live) {
  const raw = mode === "status" ? statusLane(s) : locationLane(s);
  if (mode !== "status" || !live) return { lane: raw, holding: false };
  const prev = lastLane.get(s.id);
  if (prev === "working" && (raw === "review" || raw === "idle")) {
    const now = Date.now();
    if (!held.has(s.id)) { held.set(s.id, now + HOLD_MS); setTimeout(render, HOLD_MS + 20); }
    if (now < held.get(s.id)) return { lane: "working", holding: true };
  }
  held.delete(s.id);
  return { lane: raw, holding: false };
}

function partition(folder, mode, ctx) {
  const ord = ctx.order[folder.key];
  const alive = sortByOrder(folder.sessions.filter((s) => s.status !== "ended"), ord);
  const ended = sortByOrder(folder.sessions.filter((s) => s.status === "ended"), ord);
  if (mode === "none") return { lanes: [{ id: "_all", sessions: alive.map((s) => ({ s })) }], ended };
  const buckets = new Map(LANES[mode].map((l) => [l.id, []]));
  for (const s of alive) {
    const d = displayedLane(s, mode, ctx.live);
    buckets.get(d.lane).push({ s, holding: d.holding });
  }
  const lanes = LANES[mode].map((l) => ({ ...l, sessions: buckets.get(l.id) })).filter((l) => l.sessions.length);
  return { lanes, ended };
}

/* ───────── render ───────── */
function cardHtml(s, { selected, holding, live }) {
  const shape = cardShape(s);
  const act = s.status === "ended" ? `<span>ended · ${esc(s.ago)} ago</span>`
    : s.error ? `<span class="act">${svg("error", 10)} Failed: tool error</span>`
    : s.ask ? `<span class="act">${svg("needs-you", 10)} Needs you</span>`
    : s.status === "streaming" ? `<span class="act">${svg("working", 10)} ${esc(s.tool || "Thinking…")}</span>`
    : s.unread ? `<span class="act">${svg("review", 10)} New reply</span>`
    : `<span>Idle</span>`;
  const cls = ["card", s.status === "ended" && "ended", s.status === "streaming" && !s.ask && "streaming", s.unread && s.status !== "streaming" && "unread", s.ask && "needs", selected && "selected", holding && "holding"].filter(Boolean).join(" ");
  const dest = holding ? `;--dest:${shapeColor[statusLane(s)]}` : "";
  return `<div class="${cls}" style="--c:${shapeColor[shape]}${dest}" ${live ? `data-id="${s.id}" draggable="true" tabindex="0" role="button" aria-pressed="${!!selected}"` : ""}
      aria-label="${esc(s.name)}, ${esc(shape)}${s.wt ? ", worktree" : ""}">
    <span class="dot">${svg(shape, 12)}</span>
    <span class="title">${esc(s.name)}</span>
    <span class="ago">${s.status === "ended" ? "" : esc(s.ago)}</span>
    <div class="meta">${act}${s.wt ? `<span class="pill" title="git worktree">${svg("worktrees", 10)} ${esc(s.wt)}</span>` : ""}${s.change && !s.wt ? `<span class="pill" title="attached change">${esc(s.change)}</span>` : ""}</div>
  </div>`;
}

function capsuleHtml(list) {
  const c = { "needs-you": 0, error: 0, working: 0, idle: 0 };
  for (const s of list) { const l = statusLane(s); if (!l) continue; c[l === "review" ? "idle" : l]++; }
  const seg = (k) => (c[k] ? `<i style="color:${shapeColor[k]}" title="${k}">${svg(k, 10)}<span style="color:var(--text-secondary)">${c[k]}</span></i>` : "");
  return `<span class="capsule">${seg("needs-you")}${seg("error")}${seg("working")}${seg("idle")}</span>`;
}

function laneHtml(folder, lane, mode, ctx) {
  const key = `${folder.key}::${lane.id}`;
  const collapsed = ctx.collapsedLanes.has(key);
  const hasSel = collapsed && lane.sessions.some(({ s }) => s.id === ctx.selectedId);
  const sub = mode === "location" && lane.id === "main" && folder.branch ? `· ${esc(folder.branch)}` : "";
  const rollup = collapsed && mode === "location" ? capsuleHtml(lane.sessions.map((x) => x.s)) : "";
  const cid = `lc-${cssId(key)}`;
  return `<section class="lane${collapsed ? " collapsed" : ""}" style="--lane-c:${lane.c}" data-lane="${esc(key)}" aria-label="${esc(lane.label)}">
    <button class="lane-head" ${ctx.live ? `data-lane-toggle="${esc(key)}"` : "tabindex=-1"} aria-expanded="${!collapsed}" aria-controls="${cid}">
      <span class="lane-chev" aria-hidden="true">▾</span>
      <span class="lane-glyph">${svg(lane.g, 12)}</span>
      <span class="lane-label">${esc(lane.label)}</span><span class="lane-sub">${sub}</span>
      ${hasSel ? '<span class="sel-dot" title="Contains the selected session"></span><span class="sr-only">contains selected session</span>' : ""}
      ${rollup}
      <span class="lane-count" aria-label="${lane.sessions.length} sessions">${lane.sessions.length}</span>
    </button>
    <div class="lane-cards" id="${cid}" data-dropzone="${esc(key)}" ${collapsed ? "hidden" : ""}>
      ${lane.sessions.map(({ s, holding }) => cardHtml(s, { selected: s.id === ctx.selectedId, holding, live: ctx.live })).join("")}
    </div>
  </section>`;
}
const cssId = (k) => k.replace(/[^a-z0-9]+/gi, "-");

function menuHtml(folder) {
  const explicit = prefs.folderGroupBy[folder.key];
  const item = (val, label, desc) => {
    const checked = val === "_default" ? explicit === undefined : explicit === val;
    return `<button class="mi" role="menuitemradio" aria-checked="${checked}" data-set-mode="${val}" data-folder="${esc(folder.key)}"><span class="radio"></span>${label}<span class="desc">${desc}</span></button>`;
  };
  return `<div class="popover menu" role="menu" aria-label="Folder actions for ${esc(folder.name)}">
    <div class="menu-group-label" id="gbl">Group sessions by</div>
    <div role="group" aria-labelledby="gbl">
      ${item("_default", `Use default <span style="color:var(--text-muted)">(${modeLabel(prefs.defaultGroupBy)})</span>`, "")}
      ${MODES.map(([v, l, d]) => item(v, l, d)).join("")}
    </div>
    <div class="menu-sep" role="separator"></div>
    <button class="mi stub" role="menuitem" aria-disabled="true">Pin directory</button>
    <button class="mi stub" role="menuitem" aria-disabled="true">Manage worktrees…</button>
    <button class="mi stub" role="menuitem" aria-disabled="true">Project setup…</button>
  </div>`;
}

function folderHtml(folder, ctx) {
  const mode = ctx.modeOf(folder.key);
  const collapsed = ctx.collapsedFolders.has(folder.key);
  const q = ctx.search.trim().toLowerCase();
  const alive = folder.sessions.filter((s) => s.status !== "ended");
  const inherited = prefs.folderGroupBy[folder.key] === undefined;
  const chip = mode !== "none"
    ? `<button class="mode-chip" ${ctx.live ? `data-menu="${esc(folder.key)}"` : "tabindex=-1"} aria-haspopup="menu" title="Grouping — click to change">${svg(mode === "status" ? "working" : "main", 10)} ${modeLabel(mode)}${inherited ? ' <span class="inh">· default</span>' : ""}</button>`
    : "";
  let body;
  if (q) {
    // Search flattens lanes (spec: Lanes flatten under search and filters)
    const hits = sortByOrder(folder.sessions.filter((s) => s.name.toLowerCase().includes(q)), ctx.order[folder.key]);
    body = hits.length
      ? `<div class="list plain">${hits.map((s) => cardHtml(s, { selected: s.id === ctx.selectedId, live: ctx.live })).join("")}</div>`
      : `<div class="list" style="color:var(--text-muted);font-style:italic;font-size:12px;padding:6px 8px">No sessions match your search</div>`;
  } else {
    const { lanes, ended } = partition(folder, mode, ctx);
    const plain = mode === "none" || lanes.length <= 1; // ≤1 non-empty lane → no lane chrome
    const all = lanes.flatMap((l) => l.sessions);
    body = plain
      ? `<div class="list plain" data-dropzone="${esc(folder.key)}::${lanes[0]?.id ?? "_all"}">${all.map(({ s, holding }) => cardHtml(s, { selected: s.id === ctx.selectedId, holding, live: ctx.live })).join("")}</div>`
      : `<div class="list" style="padding-left:0">${lanes.map((l) => laneHtml(folder, l, mode, ctx)).join("")}</div>`;
    if (ended.length) {
      const open = ctx.endedExpanded.has(folder.key);
      body += `<button class="ended-toggle" ${ctx.live ? `data-ended="${esc(folder.key)}"` : "tabindex=-1"} aria-expanded="${open}">${open ? "Hide" : "Show"} ${ended.length} ended</button>`;
      if (open) body += `<div class="list plain" data-dropzone="${esc(folder.key)}::_ended">${ended.map((s) => cardHtml(s, { selected: s.id === ctx.selectedId, live: ctx.live })).join("")}</div>`;
    }
  }
  return `<div class="folder${collapsed ? " collapsed" : ""}" data-folder-key="${esc(folder.key)}">
    <div class="nub"></div>
    <div class="plate">
      <div class="fh">
        <button class="fh-toggle" ${ctx.live ? `data-folder-toggle="${esc(folder.key)}"` : "tabindex=-1"} aria-expanded="${!collapsed}">
          <span class="chev ${collapsed ? "collapsed-chev" : ""}" aria-hidden="true">▾</span>
          <span class="fname">${esc(folder.name)}</span><span class="fcount">${alive.length}</span>
        </button>
        ${capsuleHtml(alive)}
        <button class="icon-btn" ${ctx.live ? `data-menu="${esc(folder.key)}"` : "tabindex=-1"} aria-haspopup="menu" aria-expanded="${ui.menuFor === folder.key && ctx.live}" aria-label="Folder actions">⋯</button>
      </div>
      ${collapsed ? (chip ? `<div class="fsub"><span class="fpath"></span>${chip}</div>` : "") : `<div class="fsub"><span class="fpath">${esc(folder.key.replace("/Users/robson", "~"))}</span>${chip}</div>`}
      ${ctx.live && ui.menuFor === folder.key ? menuHtml(folder) : ""}
      ${ctx.staticMenu === folder.key ? menuHtml(folder) : ""}
    </div>
    <div class="body">${body}</div>
  </div>`;
}

const liveCtx = () => ({ live: true, order, selectedId: ui.selectedId, search: ui.search, endedExpanded: ui.endedExpanded,
  collapsedLanes: prefs.collapsedLanes, collapsedFolders: prefs.collapsedFolders, modeOf: effectiveMode });

/* FLIP (design D5): snapshot rects → render → invert → play */
function render() {
  const root = $("#folders");
  const before = new Map([...root.querySelectorAll(".card[data-id]")].map((el) => [el.dataset.id, el.getBoundingClientRect()]));
  const prevLanes = new Map(lastLane);
  const focusedMenuItem = document.activeElement?.dataset?.setMode;
  root.innerHTML = data.folders.map((f) => folderHtml(f, liveCtx())).join("");
  // record lanes shown this render (hysteresis input) + announce selected-card moves
  for (const f of data.folders) {
    const mode = effectiveMode(f.key);
    for (const el of root.querySelectorAll(`[data-folder-key="${CSS.escape(f.key)}"] .card[data-id]`)) {
      const laneEl = el.closest(".lane");
      const lane = laneEl ? laneEl.dataset.lane.split("::")[1] : (mode === "status" ? statusLane(findSession(el.dataset.id)[0]) : null);
      lastLane.set(el.dataset.id, lane);
    }
    // sessions inside collapsed lanes are not in DOM — track them too
    if (mode !== "none") for (const s of f.sessions) if (!root.querySelector(`.card[data-id="${s.id}"]`)) {
      const d = displayedLane(s, mode, false); lastLane.set(s.id, d.lane);
    }
  }
  const sel = ui.selectedId;
  if (sel && prevLanes.get(sel) && prevLanes.get(sel) !== lastLane.get(sel) && lastLane.get(sel)) {
    const lane = [...LANES.status, ...LANES.location].find((l) => l.id === lastLane.get(sel));
    announce(`${findSession(sel)[0].name} moved to ${lane?.label ?? lastLane.get(sel)}`);
    const el = root.querySelector(`.card[data-id="${sel}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  }
  if (!reduceMotion() && !ui.dragging) {
    for (const el of root.querySelectorAll(".card[data-id]")) {
      const a = before.get(el.dataset.id); if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      el.style.transition = "none"; el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { el.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)"; el.style.transform = ""; });
    }
  }
  if (focusedMenuItem) root.querySelector(`[data-set-mode="${focusedMenuItem}"]`)?.focus();
  renderSettings();
}

function announce(msg) { const r = $("#liveRegion"); r.textContent = ""; setTimeout(() => (r.textContent = msg), 30); }
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }

function renderSettings() {
  $("#defaultSeg").innerHTML = MODES.map(([v, l]) => `<button role="radio" aria-checked="${prefs.defaultGroupBy === v}" data-default="${v}">${l}</button>`).join("");
}

/* ───────── interactions (delegated on #folders only) ───────── */
const root = $("#folders");
root.addEventListener("click", (e) => {
  const t = e.target.closest("[data-set-mode],[data-menu],[data-lane-toggle],[data-folder-toggle],[data-ended],.card[data-id]");
  if (!t) return;
  if (t.dataset.setMode) {
    const k = t.dataset.folder;
    if (t.dataset.setMode === "_default") delete prefs.folderGroupBy[k]; else prefs.folderGroupBy[k] = t.dataset.setMode;
    persist(); ui.menuFor = null; render(); root.querySelector(`[data-menu="${CSS.escape(k)}"].icon-btn`)?.focus(); return;
  }
  if (t.dataset.menu) { ui.menuFor = ui.menuFor === t.dataset.menu ? null : t.dataset.menu; render();
    root.querySelector('.menu [aria-checked="true"]')?.focus(); return; }
  if (t.dataset.laneToggle) { const k = t.dataset.laneToggle; prefs.collapsedLanes.has(k) ? prefs.collapsedLanes.delete(k) : prefs.collapsedLanes.add(k); persist(); render();
    root.querySelector(`[data-lane-toggle="${CSS.escape(k)}"]`)?.focus(); return; }
  if (t.dataset.folderToggle) { const k = t.dataset.folderToggle; prefs.collapsedFolders.has(k) ? prefs.collapsedFolders.delete(k) : prefs.collapsedFolders.add(k); persist(); render();
    root.querySelector(`[data-folder-toggle="${CSS.escape(k)}"]`)?.focus(); return; }
  if (t.dataset.ended) { const k = t.dataset.ended; ui.endedExpanded.has(k) ? ui.endedExpanded.delete(k) : ui.endedExpanded.add(k); render(); return; }
  if (t.dataset.id) { ui.selectedId = t.dataset.id; const [s] = findSession(t.dataset.id); if (s.unread) { s.unread = false; } render(); }
});
root.addEventListener("keydown", (e) => {
  const menu = e.target.closest(".menu");
  if (menu) {
    const items = [...menu.querySelectorAll(".mi:not(.stub)")];
    const i = items.indexOf(e.target);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { const k = ui.menuFor; ui.menuFor = null; render(); root.querySelector(`[data-menu="${CSS.escape(k)}"].icon-btn`)?.focus(); }
    return;
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".card[data-id]")) { e.preventDefault(); e.target.click(); }
});
document.addEventListener("click", (e) => {
  if (ui.menuFor && !e.target.closest(".menu,[data-menu]")) { ui.menuFor = null; render(); }
  const pop = $("#settingsPop");
  if (!pop.hidden && !e.target.closest("#settingsPop,#settingsBtn")) { pop.hidden = true; $("#settingsBtn").setAttribute("aria-expanded", "false"); }
});

/* drag: within-lane reorder, cross-lane deny, ended→lane = drag-to-resume (design D4) */
const zoneOf = (el) => el?.closest("[data-dropzone]")?.dataset.dropzone;
root.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".card[data-id]"); if (!card) return;
  ui.dragging = { id: card.dataset.id, zone: zoneOf(card), denied: false };
  card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", card.dataset.id);
});
root.addEventListener("dragover", (e) => {
  const d = ui.dragging; if (!d) return;
  const zone = zoneOf(e.target); if (!zone) return;
  const sameFolder = zone.split("::")[0] === d.zone.split("::")[0];
  const fromEnded = d.zone.endsWith("::_ended");
  root.querySelectorAll(".drop-deny").forEach((x) => x.classList.remove("drop-deny"));
  if (sameFolder && (zone === d.zone || fromEnded)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
  else { d.denied = true; e.target.closest(".lane")?.classList.add("drop-deny"); e.dataTransfer.dropEffect = "none"; }
});
root.addEventListener("drop", (e) => {
  const d = ui.dragging; if (!d) return; e.preventDefault();
  const zoneEl = e.target.closest("[data-dropzone]"); const zone = zoneEl.dataset.dropzone;
  const fkey = zone.split("::")[0];
  const cards = [...zoneEl.querySelectorAll(".card[data-id]")].filter((c) => c.dataset.id !== d.id);
  const before = cards.find((c) => e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
  const laneIds = cards.map((c) => c.dataset.id);
  const at = before ? laneIds.indexOf(before.dataset.id) : laneIds.length;
  const newLane = [...laneIds.slice(0, at), d.id, ...laneIds.slice(at)];
  if (d.zone.endsWith("::_ended")) {
    const [s] = findSession(d.id); s.status = "idle"; s.ago = "now";
    // drag-to-resume keeps the dropped slot: place right before `before` in the flat order
    const ord = order[fkey].filter((x) => x !== d.id);
    const pos = before ? ord.indexOf(before.dataset.id) : ord.indexOf(laneIds[laneIds.length - 1]) + 1;
    ord.splice(Math.max(0, pos), 0, d.id); order[fkey] = ord;
    toast(`Resumed “${s.name}” — kept where you dropped it.`);
  } else {
    order[fkey] = mergeLaneOrder(order[fkey], newLane);
  }
  ui.dragging.denied = false;
});
root.addEventListener("dragend", () => {
  const d = ui.dragging; ui.dragging = null;
  if (d?.denied) {
    const mode = effectiveMode(d.zone.split("::")[0]);
    toast(mode === "location"
      ? "Lanes show where a session runs — it can’t be dragged between them. Reorder within a lane."
      : "Lanes follow session status — it moves on its own. Reorder within a lane.");
  }
  render();
});
/** Slot-preserving merge (design D4): lane ids refill the slots they already occupied. */
function mergeLaneOrder(stored, newLane) {
  const set = new Set(newLane);
  const slots = []; stored.forEach((id, i) => set.has(id) && slots.push(i));
  const out = [...stored]; slots.forEach((slot, i) => (out[slot] = newLane[i]));
  const missing = newLane.slice(slots.length); // ids absent from stored order
  return [...out, ...missing];
}

/* ───────── sidebar chrome ───────── */
$("#search").addEventListener("input", (e) => { ui.search = e.target.value; render(); });
$("#themeBtn").addEventListener("click", () => {
  const h = document.documentElement; h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark"; renderGallery();
});
$("#settingsBtn").addEventListener("click", () => {
  const p = $("#settingsPop"); p.hidden = !p.hidden; $("#settingsBtn").setAttribute("aria-expanded", String(!p.hidden));
  if (!p.hidden) p.querySelector('[aria-checked="true"]')?.focus();
});
$("#defaultSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-default]"); if (!b) return;
  prefs.defaultGroupBy = b.dataset.default; persist(); render(); $(`[data-default="${b.dataset.default}"]`).focus();
});
$("#defaultSeg").addEventListener("keydown", (e) => {
  const i = MODES.findIndex((m) => m[0] === prefs.defaultGroupBy);
  const n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!n) return;
  e.preventDefault(); prefs.defaultGroupBy = MODES[(i + n + 3) % 3][0]; persist(); render(); $(`[data-default="${prefs.defaultGroupBy}"]`).focus();
});

/* ───────── simulation ───────── */
const mut = (id, fn) => { const [s] = findSession(id); fn(s); render(); };
const SCEN = [
  ["Fix edit · turn ends → To review (after 3 s hold)", () => mut("s4", (s) => { s.status = "idle"; s.unread = true; s.ago = "now"; })],
  ["Fix edit · pause < 3 s (must not move)", () => { mut("s4", (s) => { s.status = "idle"; s.unread = true; }); setTimeout(() => mut("s4", (s) => { s.status = "streaming"; s.unread = false; s.tool = "edit"; }), 1500); }],
  ["Fix edit · start working again", () => mut("s4", (s) => { s.status = "streaming"; s.unread = false; s.tool = "edit"; })],
  ["Unified memory · asks you (instant)", () => mut("s3", (s) => { s.ask = true; })],
  ["Unified memory · you answered", () => mut("s3", (s) => { s.ask = false; s.status = "streaming"; })],
  ["fix-ship-tsconfig · tool error", () => mut("s2", (s) => { s.error = true; s.status = "idle"; })],
  ["Selected card · turn ends", () => mut(ui.selectedId, (s) => { if (s.status !== "ended") { s.status = "idle"; s.unread = true; } })],
  ["Spawn new session (moveToFront)", () => { const f = data.folders[0]; const id = `n${Date.now() % 1e5}`;
    f.sessions.push({ id, name: "new session", status: "streaming", tool: "Thinking…", ask: false, unread: false, error: false, wt: null, ago: "now" });
    order[f.key].unshift(id); render(); }],
  ["Reset data + prefs", () => { store.removeItem(LS); location.reload(); }],
];
$("#scenarioBtns").innerHTML = SCEN.map(([l], i) => `<button data-scen="${i}">${esc(l)}</button>`).join("");
$("#scenarioBtns").addEventListener("click", (e) => { const b = e.target.closest("[data-scen]"); if (b) SCEN[+b.dataset.scen][1](); });
let simT;
$("#autoSim").addEventListener("change", (e) => {
  clearInterval(simT); if (!e.target.checked) return;
  simT = setInterval(() => {
    const alive = data.folders.flatMap((f) => f.sessions).filter((s) => s.status !== "ended");
    const s = alive[Math.floor(Math.random() * alive.length)];
    const r = Math.random();
    if (s.ask) s.ask = r < 0.5;
    else if (s.error) { s.error = false; s.status = "streaming"; }
    else if (s.status === "streaming") { if (r < 0.15) s.ask = true; else { s.status = "idle"; s.unread = true; } }
    else { s.status = "streaming"; s.unread = false; s.tool = ["bash", "read", "edit", "Thinking…"][Math.floor(r * 4)]; }
    render();
  }, 2500);
});

/* ───────── gallery (frozen fixtures, same renderer) ───────── */
function renderGallery() {
  const f0 = freshData().folders[0];
  const ord = { [f0.key]: f0.sessions.map((s) => s.id) };
  const base = { live: false, order: ord, selectedId: "s4", search: "", endedExpanded: new Set(), collapsedLanes: new Set(), collapsedFolders: new Set() };
  const withMode = (m, extra = {}) => ({ ...base, modeOf: () => m, ...extra });
  const onlyMain = { ...f0, sessions: f0.sessions.filter((s) => !s.wt) };
  const tiles = [
    ["None — today", "Unchanged DOM when mode is none. One list, stored order.", f0, withMode("none")],
    ["Status", "Five lanes max, fixed order = capsule order. Empty lanes hidden (no Failed lane here).", f0, withMode("status")],
    ["Location", "Two fixed lanes. Neutral color — location is not a status.", f0, withMode("location")],
    ["Single non-empty lane → no headers", "Location mode but no worktree sessions: renders like None; chip still tells you the mode.", onlyMain, withMode("location")],
    ["Collapsed lanes", "Idle collapsed with the selected card inside → blue marker, not auto-expanded. Location rollup shows mixed status.", f0,
      withMode("status", { collapsedLanes: new Set([`${f0.key}::idle`, `${f0.key}::working`]), selectedId: "s7" })],
    ["Search flattens", "Query “fix” — lanes drop away, ended matches included, stored order.", f0, withMode("status", { search: "fix" })],
    ["Folder menu", "Group-by radio set at the top of ⋯; Use default names the current default.", f0, withMode("status", { staticMenu: f0.key })],
  ];
  $("#gallery").innerHTML = tiles.map(([h, p, f, ctx]) =>
    `<div class="tile"><h3>${esc(h)}</h3><p>${esc(p)}</p><div class="folders" inert style="${ctx.staticMenu ? "min-height:380px" : ""}">${folderHtml(f, ctx)}</div></div>`).join("");
}

/* ───────── rationale ───────── */
const RAT = [
  ["Status lanes reuse deriveStatusShape (filled/half/outline/✕) + the capsule's severity order", "Consistency & standards (Nielsen #4); one visual language per concept", "nngroup.com/articles/ten-usability-heuristics"],
  ["“Needs you” lane first", "Serial position effect — top of list gets attention first; Von Restorff (purple stands out)", "lawsofux.com/serial-position-effect · lawsofux.com/von-restorff-effect"],
  ["Lane rail segment tinted by lane; cards stay inside the folder container", "Law of Common Region / Proximity (Gestalt) — membership without extra borders", "lawsofux.com/law-of-common-region"],
  ["Lane label text in --text-secondary; status color only on glyph + rail", "WCAG 1.4.1 Use of Color; 1.4.3 contrast (amber on white fails as text)", "w3.org/WAI/WCAG22/Understanding/use-of-color"],
  ["No lane headers when ≤1 lane non-empty; empty lanes hidden", "Aesthetic & minimalist design (Nielsen #8)", "nngroup.com/articles/aesthetic-minimalist-design"],
  ["Mode chip on folder header (only when ≠ none), “· default” when inherited", "Visibility of system status (Nielsen #1) — layout change must be explained where it shows", "nngroup.com/articles/visibility-system-status"],
  ["Four choices in menu, radio semantics, default named inline", "Hick's Law (few options); recognition over recall (Nielsen #6)", "lawsofux.com/hicks-law"],
  ["3 s hold before a card leaves Working; hold shown as a shrinking amber underline", "User control / predictability (Nielsen #3); Doherty threshold — don't move targets during interaction", "lawsofux.com/doherty-threshold"],
  ["Lane moves animate 220 ms (FLIP); none under reduced motion", "NN/g animation duration 100–500 ms; WCAG 2.3.3 Animation from Interactions", "nngroup.com/articles/animation-duration · w3.org/WAI/WCAG22/Understanding/animation-from-interactions"],
  ["Selected card moving lanes → aria-live announcement + scroll into view", "WCAG 4.1.3 Status Messages; Nielsen #1", "w3.org/WAI/WCAG22/Understanding/status-messages"],
  ["Cross-lane drop: dashed red outline + no-drop cursor + explanatory toast", "Error prevention (#5) + help users recognize errors (#9)", "nngroup.com/articles/slips"],
  ["Lane headers: button, aria-expanded/aria-controls, ≥26 px tall", "WCAG 4.1.2 Name, Role, Value; 2.5.8 Target Size (Minimum 24×24)", "w3.org/WAI/WCAG22/Understanding/target-size-minimum"],
  ["Global default lives in Settings, reachable also from the folder menu label", "Jakob's Law — settings where users expect them; Nielsen #6", "lawsofux.com/jakobs-law"],
];
$("#rationale").innerHTML = `<table class="rat"><thead><tr><th>Decision</th><th>Rule</th><th>Source</th></tr></thead><tbody>${RAT.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join("")}</tbody></table>`;

render();
renderGallery();
