/* Session-header reorganisation board: SURFACES[] + proposed renderers.
   As-built evidence = live :8000 crops in asbuilt/ (base light, 2026-10-21).
   Proposed = token-only recipes in header.css. Real fixture data only.
   Composer-side items (strip, refresh, Attach, context ring) are owned by the
   sibling explore board mockups/composer-dock/ and are only referenced here. */

let _n = 0;
const nid = (p) => `${p}-${++_n}`;

/* ── fixtures (real values from the live session + repo) ───────────── */
const LIVE = { name: "Reorganize header", tags: ["ux"], pi: "1.3.0", running: "5m 32s", started: "15:09",
  files: { add: 1, del: 26, n: 1 }, ctx: { used: "127.0k", win: "1.0M", pct: 13 }, cost: "$0.99" };
const ENDED = { name: "Command Prompt improvement", tags: [], pi: "1.3.0", ended: true, ran: "42m", files: null,
  ctx: { used: "312.4k", win: "1.0M", pct: 31 }, cost: "$4.12" };
const LONG = { ...LIVE, name: "Fix composer liveness on reload after the bridge reconnects mid-turn" };
const FLOOR = { ...LIVE, pi: "1.2.0", belowFloor: "1.3.0", modules: true };
const HOT = { ...LIVE, ctx: { used: "846.2k", win: "1.0M", pct: 85 } };

const MODES = [
  ["closed", "MessageOutline", "Chat"],
  ["split", "ViewSplitVertical", "Split"],
  ["full", "FileDocumentOutline", "Editor"],
];

/* ── shared pieces ─────────────────────────────────────────────────── */
function layoutSwitch(mode, cls = "") {
  const g = nid("lsw");
  return `<div class="lsw ${cls}" role="radiogroup" aria-label="Editor layout" data-testid="layout-mode-switch">${MODES.map(([m, icon, label]) =>
    `<button type="button" role="radio" aria-checked="${m === mode}" tabindex="${m === mode ? 0 : -1}" title="${label}" data-testid="layout-mode-${m}" id="${g}-${m}">${ic(icon)}<span class="lbl">${label}</span></button>`).join("")}</div>`;
}
function layoutTabs(mode) {
  return `<div class="ltabs" role="radiogroup" aria-label="Editor layout" data-testid="layout-mode-switch">${MODES.map(([m, icon, label]) =>
    `<button type="button" role="radio" aria-checked="${m === mode}" tabindex="${m === mode ? 0 : -1}" data-testid="layout-mode-${m}">${ic(icon)}${label}</button>`).join("")}</div>`;
}
function backBtn() {
  return `<button type="button" class="ibtn" aria-label="Go back" title="Go back" data-testid="back-button">${ic("ArrowLeft")}</button>`;
}
/* ChatViewMenu trigger: composer-dock D4 moves it from the composer strip into the pane header. */
function viewBtn() {
  return `<button type="button" class="sbtn view" aria-haspopup="menu" aria-label="Chat view options" title="Chat view options">${ic("Cog")}<span class="lbl">View</span></button>`;
}
function seekBtn() {
  return `<button type="button" class="ibtn" aria-label="Reveal in sidebar" title="Reveal in sidebar" data-testid="session-header-seek-card">${ic("DockLeft")}</button>`;
}
function titleBtn(s, open) {
  return `<button type="button" class="title-btn" aria-haspopup="menu" aria-expanded="${!!open}" title="${esc(s.name)}" data-testid="session-title-menu"><span class="t">${esc(s.name)}</span>${ic("ChevronDown")}</button>`;
}
const tier = (p) => (p > 90 ? "t-red" : p > 70 ? "t-orange" : p > 50 ? "t-green" : p > 30 ? "t-blue" : "");
/* Context ring: same geometry + tokens as mockups/composer-dock ring() so both boards agree. */
function ring(s, { pct = true } = {}) {
  const p = s.ctx.pct, r = 6, C = 2 * Math.PI * r, v = (p / 100) * C;
  return `<span class="ring ${tier(p)}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="Context used" tabindex="0" title="Context: ${p}% used · ${s.ctx.used} of ${s.ctx.win} tokens">
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle class="trk" cx="8" cy="8" r="${r}" fill="none" stroke-width="2.5"/><circle class="val" cx="8" cy="8" r="${r}" fill="none" stroke-width="2.5" stroke-dasharray="${v.toFixed(1)} ${C.toFixed(1)}" stroke-linecap="round"/></svg>${pct ? `<span>${p}%</span>` : ""}</span>`;
}
function meta(s, { withRing = false } = {}) {
  const tags = s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const clock = s.ended
    ? `<span class="clock" title="Session ended. It ran for ${s.ran}.">${ic("ClockOutline")}ended · ran ${s.ran}</span>`
    : `<span class="clock" title="Started ${s.started}. Running for ${s.running}.">${ic("ClockOutline")}running ${s.running}</span>`;
  const pi = s.belowFloor
    ? `<span class="wpill" role="status" data-testid="pi-below-floor-warning">${ic("AlertOutline")}pi ${esc(s.pi)} is below the required ${esc(s.belowFloor)} — upgrade pi</span>`
    : `<span class="lowprio" title="pi version">pi ${esc(s.pi)}</span>`;
  return `<div class="meta">${tags}<button type="button" class="addtag" aria-label="Add tag">+ tag</button>${pi}${clock}${withRing ? ring(s) : ""}</div>`;
}
function filesBtn(s) {
  if (!s.files) return "";
  const f = s.files;
  return `<button type="button" class="sbtn files" title="View changed files" data-testid="changed-files-chip">${ic("FileCompare")}<span class="lbl">Changed Files</span>
    <span class="cpill add">+${f.add}</span><span class="cpill del">−${f.del}</span><span class="cnt">· ${f.n}</span></button>`;
}
function actions(s) {
  const mods = s.modules ? `<button type="button" class="sbtn" title="Extension modules" data-testid="open-extension-modules">${ic("ViewGridOutline")}Modules</button>` : "";
  const resume = s.ended ? `<button type="button" class="tbtn green" data-testid="header-resume-button" title="Resume session (continue same session)">${ic("PlayCircleOutline")}Resume</button>
    <button type="button" class="tbtn blue" data-testid="header-fork-button" title="Fork session (new session from this point)">${ic("SourceFork")}Fork</button>` : "";
  return `<div class="grp">${mods}${filesBtn(s)}${resume}</div>`;
}
function titleMenu(left = 56, top = 44) {
  return `<div class="menu" role="menu" aria-label="Session" style="left:${left}px;top:${top}px">
    <button type="button" class="mi" role="menuitem">${ic("PencilOutline")}<span>Rename</span><span class="k">F2</span></button>
    <button type="button" class="mi" role="menuitem">${ic("DockLeft")}<span>Reveal in sidebar<span class="d">Expand and scroll to this session's card</span></span></button>
    <button type="button" class="mi" role="menuitem">${ic("TagOutline")}<span>Edit tags</span></button>
    <hr />
    <button type="button" class="mi" role="menuitem" data-testid="refresh-chat">${ic("History")}<span>Reload transcript<span class="d">Re-fetch every event from the server. Use it when the chat looks stale.</span></span></button>
  </div>`;
}
function ctxRow(s) {
  return `<div class="ctxrow"><span>${s.ctx.used}</span><span class="bar" aria-hidden="true"><span style="width:${s.ctx.pct}%"></span></span><span>${s.ctx.win}</span></div>`;
}
function panes(mode) {
  if (mode === "split") return `<div class="panes"><div class="pane">CHAT</div><div class="pane ed">EDITOR</div></div>`;
  if (mode === "full") return `<div class="panes"><div class="pane ed" style="border-left:0">EDITOR</div></div>`;
  return `<div class="panes"><div class="pane">CHAT</div><div class="rail" aria-hidden="true"><span>EDITOR</span></div></div>`;
}
/* reference strip of the composer-dock toolbar (owned by that board) */
function dockRef(s) {
  return `<div class="dockref"><span class="dr-tag">composer-dock board</span><span class="sp"></span>${ring(s)}<span class="dr-model">claude-opus-5-5 · xhigh</span></div>`;
}

/* ── desktop variants ─────────────────────────────────────────────── */
function hdrA(s, { mode = "closed", menu = false, seek = true, withRing = true, row = false, dock = false } = {}) {
  return `<div class="stage${menu ? " has-menu" : ""}"><div class="sh"><div class="row">
    <div class="hl">${backBtn()}<div class="tb"><span class="tw">${titleBtn(s, menu)}${seek ? seekBtn() : ""}</span>${meta(s, { withRing })}</div></div>
    <div class="mid"></div>
    <div class="acts">${actions(s)}${s.files || s.ended || s.modules ? `<span class="vsep" aria-hidden="true"></span>` : ""}${layoutSwitch(mode)}${viewBtn()}</div>
  </div></div>${row ? ctxRow(s) : ""}${panes(mode)}${dock ? dockRef(s) : ""}${menu ? titleMenu() : ""}</div>`;
}
function hdrB(s, { mode = "closed" } = {}) {
  return `<div class="stage"><div class="sh"><div class="row">
    <div class="hl">${backBtn()}<div class="tb"><span class="tw">${titleBtn(s)}${seekBtn()}</span>${meta(s, { withRing: true })}</div></div>
    <div class="mid"></div>
    <div class="acts">${actions(s)}${viewBtn()}</div>
  </div>${layoutTabs(mode)}</div>${panes(mode)}</div>`;
}
function hdrC(s, { mode = "closed" } = {}) {
  return `<div class="stage"><div class="sh"><div class="row">
    <div class="hl">${backBtn()}${layoutSwitch(mode, "keep")}<div class="tb" style="margin-left:8px"><span class="tw">${titleBtn(s)}${seekBtn()}</span>${meta(s, { withRing: true })}</div></div>
    <div class="mid"></div>
    <div class="acts">${actions(s)}${viewBtn()}</div>
  </div></div>${panes(mode)}</div>`;
}
const narrow = (html) => `<div class="stage w560">${html.replace(/^<div class="stage[^"]*">/, "<div>")}</div>`;

/* ── mobile variants (390 px) ─────────────────────────────────────── */
function modeIcon(mode) { return mode === "split" ? "ViewSplitHorizontal" : MODES.find(([m]) => m === mode)[1]; }
function modeLabel(mode) { return MODES.find(([m]) => m === mode)[2]; }
function mobRing(s) {
  const p = s.ctx.pct, r = 6, C = 2 * Math.PI * r, v = (p / 100) * C;
  return `<button type="button" class="ring ${tier(p)}" aria-haspopup="dialog" aria-label="Context: ${p}% used, ${s.ctx.used} of ${s.ctx.win} tokens" title="Context: ${p}% used · ${s.ctx.used} of ${s.ctx.win} tokens">
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle class="trk" cx="8" cy="8" r="${r}" fill="none" stroke-width="2.5"/><circle class="val" cx="8" cy="8" r="${r}" fill="none" stroke-width="2.5" stroke-dasharray="${v.toFixed(1)} ${C.toFixed(1)}" stroke-linecap="round"/></svg></button>`;
}
function mobA(s, { mode = "closed", menu = false, ringInHeader = true } = {}) {
  const m = menu ? `<div class="menu" role="menu" aria-label="Editor layout" style="right:52px;top:46px;min-width:220px">
      ${MODES.map(([k, icon, label]) => `<button type="button" class="mi" role="menuitemradio" aria-checked="${k === mode}">${ic(k === "split" ? "ViewSplitHorizontal" : icon)}<span>${label}${k === "split" ? `<span class="d">Chat above, editor below</span>` : ""}</span>${k === mode ? `<span class="ck">${ic("Check")}</span>` : ""}</button>`).join("")}
    </div>` : "";
  return `<div class="stage w390${menu ? " has-menu" : ""}"><div class="mh"><div class="row">${backBtn()}
      <span class="t" title="${esc(s.name)}">${esc(s.name)}</span>
      ${ringInHeader ? mobRing(s) : ""}
      <button type="button" class="modebtn" aria-haspopup="menu" aria-expanded="${menu}" aria-label="Layout: ${modeLabel(mode)}" title="Layout: ${modeLabel(mode)}" data-testid="layout-mode-switch">${ic(modeIcon(mode))}${ic("MenuDown", "i dn")}</button>
      <button type="button" class="ibtn" aria-haspopup="dialog" aria-label="Chat view options" title="Chat view options">${ic("Cog")}</button>
      <button type="button" class="ibtn" aria-label="Session actions" title="Session actions">${ic("DotsVertical")}</button>
    </div></div>${panes("closed")}${ringInHeader ? "" : dockRef(s)}${m}</div>`;
}

/* ── icon meaning table ───────────────────────────────────────────── */
function iconTable() {
  const row = (glyph, today, where, prop) => `<tr><td>${ic(glyph)}</td><td>${today}</td><td class="sub">${where}</td><td>${prop}</td></tr>`;
  return `<table class="dtable"><thead><tr><th>Glyph</th><th>Meaning today</th><th>Where</th><th>Proposed</th></tr></thead><tbody>
    ${row("CrosshairsGps", "Seek: reveal this session's card", "Session header (blue chip)", `Icon button ${ic("DockLeft")} next to the title + item <b>Reveal in sidebar</b> in the title menu. No crosshair.`)}
    ${row("Target", "Focus mode (minimal sidebar)", "Sidebar header toggle", "Unchanged here. It still looks like the Goals icon (follow-up, outside this change).")}
    ${row("Target", "Goals", "Folder card GOALS tile", "Unchanged (follow-up: Focus and Goals share one glyph).")}
    ${row("Refresh", "Refresh chat: purge replay cache, re-subscribe, resync pending prompt", "Session header, bare icon", `Item <b>Reload transcript</b> in the title menu (desktop) and kebab (mobile), icon ${ic("History")}, with a one-line description.`)}
    ${row("Refresh", "Refresh OpenSpec data for this folder", "Composer strip, bare icon before View", "Not in this change: the composer-dock board folds it into the OpenSpec lane ⋯ menu.")}
    ${row("ClockOutline", "Header: time since session start. Card: time since last activity", "Header and session card, both unlabelled", "Header says <b>running 5m 32s</b> / <b>ended · ran 42m</b>. The card keeps its relative time.")}
  </tbody></table>`;
}

/* ── surfaces ─────────────────────────────────────────────────────── */
const SURFACES = [
  {
    id: "desktop", icon: "ViewSplitVertical", title: "Desktop header",
    lead: "Approved direction A: Chat/Split/Editor on the right edge, bigger; View right after it; title menu; Reveal-in-sidebar icon + menu item; Reload transcript in the menu; labelled clock; context ring in the meta line (R2) instead of the full-width bar row. Attach leaves the header; Changed files stays. B and C stay below for comparison.",
    cites: [
      ["Cursor 2.0→2.3", "top-left Agent/Editor switch drew misclick complaints and was removed for custom layouts (forum.cursor.com/t/148681, cursor.com/changelog/2-3)"],
      ["Zed #54771", "Classic/Agentic layout lives in the title-bar user menu + palette actions"],
      ["VS Code", "Customize Layout sits next to the layout toggles; 1.109 context ring in the chat input"],
      ["Primer PageHeader", "leading action + title left, trailing actions right"],
      ["NN/g icon usability", "icons need text labels; one icon, one meaning"],
      ["ui-contract", "segmented = tint-blue selected toggle; menu / flyout; row overflow; 32 px targets from sm"],
    ],
    finds: [
      ["F1", "Attach / attached-change chip duplicates the composer `Attach change…`; the composer-dock OpenSpec lane keeps Attach, so the header drops it (approved)."],
      ["F2", "Two ⟳ glyphs with different scopes: header `refresh-chat` vs composer `statusbar-refresh-btn`. The header one becomes Reload transcript; the composer one is the dock's job."],
      ["F3", "`5m 32s` (since start) beside the card's `8s` (since last activity): two unlabelled clocks. A 1 s `setInterval` also re-renders the whole header."],
      ["F4", "Seek `mdiCrosshairsGps` reads as the sidebar Focus toggle and the GOALS tile (`mdiTarget`)."],
      ["F5", "Every label is 10 px (`text-[10px]`): below the 12 px interactive floor in ui-contract. The switch segments are under 20 px tall."],
      ["F9", "Coordination with composer-dock: its D4 moves the `ChatViewMenu` (View) into this header; its Changes lane shows `N files +A −D` with Review, which overlaps the header Changed files chip."],
    ],
    built: () => imgs([["asbuilt/desktop-chat.png", "Chat mode, live :8000, 1,600 × 900, base light"], ["asbuilt/desktop-split.png", "Split mode: header spans both panes; the switch sits over the chat pane"]]),
    states: [
      ["A · Chat", () => hdrA(LIVE, { mode: "closed" }), "Right zone: Changed files · Chat/Split/Editor · View (immediately after the switch, as `add-composer-dock` specifies). View and the layout switch sit together, like VS Code's Customize Layout next to its layout toggles. Meta line ends with the context ring `13%`; hover or focus gives `127.0k of 1.0M tokens`. No bar row."],
      ["A · Split", () => hdrA(LIVE, { mode: "split" }), "Split/Editor appear right under the control that opened them."],
      ["A · title menu open", () => hdrA(LIVE, { mode: "closed", menu: true }), "Rename, Reveal in sidebar, Edit tags, Reload transcript. Every item is labelled; the risky one has a description."],
      ["A · ended session", () => hdrA(ENDED, { mode: "closed" }), "Resume + Fork stay as the primary actions. The clock reads `ended · ran 42m` instead of disappearing."],
      ["A · warning + modules", () => hdrA(FLOOR, { mode: "closed" }), "The pi-below-floor warning replaces the `pi 1.2.0` text in the meta line, next to the version it is about. Plugin footer segments and the vault chip use the empty middle zone."],
      ["B · view tabs under the title (not chosen)", () => hdrB(LIVE, { mode: "closed" }), "Kept for comparison: an extra 36 px row."],
      ["C · switch in the leading corner (not chosen)", () => hdrC(LIVE, { mode: "closed" }), "Kept for comparison: takes the most-read spot and pushes the title right."],
    ],
  },
  {
    id: "context", icon: "ClockOutline", title: "Context usage: bar → ring",
    lead: "Approved R2: the full-width bar row (`127.0k ▬▬▬ 1.0M`) and the mobile info strip are replaced by one ring in the header. Desktop: ring + % at the end of the meta line. Mobile: arc-only ring button in the header row; tap shows the numbers. The composer shows no ring.",
    cites: [
      ["VS Code 1.109", "context-window ring; hover shows tokens and a breakdown"],
      ["Cursor", "small context circle; hover for %, click for a breakdown (forum.cursor.com/t/159913)"],
      ["WAI-ARIA", "`role=meter` with `aria-valuenow`; the % text keeps colour from being the only cue (WCAG 1.4.1)"],
    ],
    finds: [
      ["F10", "The context bar takes a full-width row under the header for one number."],
      ["F12", "Measured: the composer-dock ring (arc `--text-secondary` on track `--border-strong`) is 1.82:1 dark, 2.17:1 light, 2.92:1 nord, and its hot `--accent-orange` is 2.80:1 on the light page: below the 3:1 WCAG 1.4.11 floor. Here: track `--border-secondary`, arc `--text-secondary` (5.83 / 6.06 / 6.39:1), hot `--accent-orange-text` (4.51 / 3.71 / 4.51:1 on the track)."],
      ["F11", "Cross-board: composer-dock puts a ring in the composer toolbar (its D13 also hides it below 420 px). With R2 the composer must drop that ring, and its open question 1 (ring vs header gauge) resolves to: header only."],
    ],
    built: () => imgs([["asbuilt/context-row.png", "Desktop context row under the header, live :8000"], ["asbuilt/mobile-header.png", "Mobile: bar inside the info strip"]]),
    states: [
      ["R2 · approved: ring in the header meta line", () => hdrA(LIVE, { mode: "closed" }), "Ring geometry from the composer-dock board; tokens changed so the arc reads against its track (F12). `role=meter`, % as text, tooltip with the token counts."],
      ["R2 · near the limit (85%)", () => hdrA(HOT, { mode: "closed" }), "Tiers by the shown %: neutral 0–30, blue 31–50, green 51–70, orange 71–90, red 91+. Every tier is at least 3:1 on the page and on the track in all 18 palette/mode combinations; the % stays as text."],
      ["R2 · 560 px", () => narrow(hdrA(LIVE, { mode: "split" })), "The ring is not low priority: it stays when the pi version hides."],
      ["Mobile · ring in the header row", () => mobA(LIVE, { mode: "closed" }), "One 48 px row (was 53 + 46 px). Arc-only ring, 44 px target; tap opens the numbers (`13% · 127.0k of 1.0M tokens · $0.99`), so the cost from the old info strip is still one tap away."],
      ["Mobile · near the limit (85%)", () => mobA(HOT, { mode: "closed" }), "Orange arc; the accessible name carries the %."],
      ["R1 · not chosen: ring in the composer", () => hdrA(LIVE, { mode: "closed", withRing: false, dock: true }), "Kept for comparison: the dashed strip marks the composer-dock toolbar."],
    ],
  },
  {
    id: "narrow", icon: "ArrowCollapseLeft", title: "Desktop, narrow content (560 px)",
    lead: "The header spans the whole content area. At about 1,100 px viewports with the sidebar open, the content area is close to 560 px. The container query collapses low-priority items before the title truncates.",
    cites: [["ui-contract", "row overflow: text truncates first (basis 6ch), chips never clipped"], ["NN/g", "icon-only segments need a tooltip and an accessible name"]],
    finds: [["F6", "Measured at a 1,100 px viewport (content 600 px) with a long title: the title wraps word by word, the header grows to about 170 px, and the Chat/Split/Editor switch shrinks to a 1 px sliver. `pi 1.3.0`, `+ tag`, `Changed Files` and the clock wrap too. No truncation, no priority order."]],
    built: () => imgs([["asbuilt/narrow-long-title.png", "Live :8000 at 1,100 × 800, title text swapped in the DOM to a real 66-character change name (client-side only)"]]),
    states: [
      ["A · 560 px", () => narrow(hdrA(LIVE, { mode: "split", dock: false })), "Meta drops under the title and hides `pi 1.3.0`; tags and `+ tag` stay. Changed Files keeps its counts and its accessible name. View and the switch segments become icon-only, each with an accessible name and a tooltip."],
      ["A · 560 px · long title", () => narrow(hdrA(LONG, { mode: "split", dock: false })), "Same 66-character name as the as-built crop: one line, ellipsis, full name in the tooltip."],
    ],
  },
  {
    id: "mobile", icon: "MessageOutline", title: "Mobile header (390 px)",
    lead: "Measured at 390 × 844: the title gets 76 px (`Reorgani…`), header 53 px + info strip 46 px = 99 px of chrome. Approved: mode as one icon menu; info strip drops model, thinking and tool.",
    cites: [["Material 3 app bar", "\"one action, two if necessary\" + overflow"], ["Primer PageHeader", "narrow: leading/trailing actions hide"], ["WCAG 2.5.8 / ui-contract", "44 px targets below sm"]],
    finds: [
      ["F7", "Labelled 3-segment switch takes about 150 px of a 390 px row; title truncates to 9 characters."],
      ["F8", "Duplicates: paperclip (composer), model + thinking (composer toolbar), `⚡ bash` (`Running bash…` above the composer), OpenSpec actions in ⋯ (composer)."],
    ],
    built: () => imgs([["asbuilt/mobile-header.png", "Mobile header + info strip, live :8000, 390 × 844"], ["asbuilt/mobile-composer.png", "Same screen, composer: Attach change… and model already here"]]),
    states: [
      ["A · Chat", () => mobA(LIVE, { mode: "closed" }), "back · title · context ring · current-mode icon · View · ⋯. Title gets about 160 px. No info strip: model and thinking are in the composer, context is the header ring (S2), cost moves into the ring's tap popover."],
      ["A · mode menu open", () => mobA(LIVE, { mode: "closed", menu: true }), "menuitemradio rows, 44 px, check mark on the current mode. On a phone Split stacks, so it gets the horizontal-split icon and a one-line description."],
    ],
  },
  {
    id: "icons", icon: "CrosshairsGps", title: "Icon meanings",
    lead: "One glyph, one meaning per place. The crosshair and refresh collisions explain the confusion you reported.",
    cites: [["NN/g bad icons", "\"The visual already has a different, established meaning\""]],
    finds: [["F4", "Seek, Focus mode and Goals look alike at 16 px (crop below)."]],
    built: () => imgs([["asbuilt/icon-collisions.png", "Seek (header) · Focus toggle (sidebar) · Goals tile · header ⟳ · composer ⟳"]]),
    states: [["Proposed mapping", () => `<div class="stage" style="padding:12px">${iconTable()}</div>`, ""]],
  },
];

function imgs(list) {
  return `<div class="imgs">${list.map(([src, cap]) => `<figure><figcaption>${esc(cap)}</figcaption><img src="${src}" alt="${esc(cap)}" /></figure>`).join("")}</div>`;
}
