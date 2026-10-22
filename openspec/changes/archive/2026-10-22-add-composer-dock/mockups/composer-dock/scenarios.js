/* Composer Dock board: data + renderers. Static mockup, no app code. */
const ic = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n] || ""}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ── realistic data (this very session's work) ───────────────── */
const PROCS = [
  { pid: 60105, cmd: "node scripts/step5-sound-capture.mjs", el: "5m 53s", kind: "task" },
  { pid: 23483, cmd: "vite --port 31914 --strictPort --host 127.0.0.1", el: "59s", kind: "server" },
];
const FILES = [
  { k: "edit", dir: "packages/client/src/components/chat/", name: "CommandInput.tsx", add: 64, del: 20 },
  { k: "new", dir: "packages/client/src/components/chat/", name: "ComposerDock.tsx", add: 48, del: 0 },
  { k: "edit", dir: "packages/client/src/", name: "App.tsx", add: 8, del: 13 },
  { k: "bash", dir: "docs/screens/", name: "composer-dock.png", bin: true },
];
const TASKS = [
  { sec: "2. Composer dock" },
  { id: "2.1", t: "Add ComposerDock shell and the lane primitive", done: true },
  { id: "2.2", t: "Move the OpenSpec group into the Plan lane", done: true },
  { id: "2.3", t: "Move the Git group and changed files into the Changes lane", next: true },
  { id: "2.4", t: "Processes lane from the bridge PGID scan" },
  { sec: "3. Card toolbar" },
  { id: "3.1", t: "Merge the model and thinking chips into one" },
  { id: "3.2", t: "Round action button in the toolbar row" },
];
/* Subagents: SubagentState (id, type, description, status, modelName, entries). `created` = admitted
   but waiting for a fan-out slot (subagent-fanout-admission). No per-subagent stop exists in the protocol. */
const SUBAGENTS = [
  { name: "Explore", desc: "Map the composer stack wiring in App.tsx", role: "@fast", steps: 14, el: "1m 12s", status: "running" },
  { name: "react-expert", desc: "Review the CommandInput hook split", role: "@coding", steps: 6, el: "48s", status: "running" },
  { name: "Audit", desc: "Security pass on the dock diff", role: "@review", steps: 0, el: "", status: "created" },
];
/* Foreground: unresolved bash toolCalls (useInflightBashTools). Stop = the composer Stop (aborts the turn). */
const COMMANDS = [{ cmd: "npm test -- packages/client/src/components/chat", el: "34s" }];
const YOLO = {
  scoped: { sentence: "YOLO is on: agent and dashboard file access in its folders is auto-allowed. Open Access to end it.", time: "12m left" },
  unscoped: { sentence: "YOLO is on everywhere until the server stops: agent and dashboard file access is auto-allowed in every folder. Open Access to end it.", time: "\u221e", sr: "no expiry", heavy: true },
};
const QUEUE = ["Also update the AGENTS.md rows for CommandInput and App.", "Then run the client tests and fix whatever breaks."];
const WT = { branch: "os/redesign-composer-dock", base: "develop", ahead: 2, behind: 0 };
const CHANGE = { name: "redesign-composer-dock", segs: ["done", "done", "done", "cur", "todo"], done: 12, total: 39, primary: "Apply" };

const BASE = {
  title: "Command Prompt improvement", working: false, status: "", draft: "",
  processes: [], subagents: [], commands: [], yolo: null, changes: null, openspec: null, queue: [], plugins: [],
  ctx: 46, model: "claude-opus-5-5", level: "xhigh", delivery: "steer",
  open: null, menu: null, action: "send-disabled",
};
const S = (o) => ({ ...BASE, ...o });

/* ── lane models (one shape, two layouts) ────────────────────── */
const KIND_ICON = { task: "Console", server: "ServerNetwork", "sub-session": "RobotOutline" };
const FILE_ICON = { edit: "FileEditOutline", new: "FilePlusOutline", bash: "ConsoleLine" };
const SEG = ["Proposal", "Design", "Specs", "Tasks", "Archive"];
const delta = (a, d) => `<span class="add">+${a}</span> <span class="del">−${d}</span>`;
const disabledWhy = "Disabled while the agent is working";

function laneModels(s) {
  const L = [];
  const nS = s.subagents.length, nC = s.commands.length, nB = s.processes.length, nAll = nS + nC + nB;
  if (nAll) {
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const parts = [nS && plural(nS, "subagent", "subagents"), nC && plural(nC, "command", "commands"), nB && `${nB} background`].filter(Boolean);
    const longest = s.processes[0]?.el || s.subagents[0]?.el || s.commands[0]?.el;
    const sec = (t, n) => (parts.length > 1 ? `<p class="lsec">${t} \u00b7 ${n}</p>` : "");
    const subRows = s.subagents.map((a) => `<div class="lrow"><span class="ri">${ic("RobotOutline")}</span><span class="aname">${esc(a.name)}</span><span class="path" title="${esc(a.desc)}">${esc(a.desc)}</span>${a.status === "created" ? `<span class="wait-pill">${ic("TimerSandEmpty")}<span class="hide-xs">waiting for a slot</span><span class="show-xs-inline">waiting</span></span>` : `<span class="el hide-narrow">${esc(a.role)} \u00b7 ${a.steps} steps</span><span class="el">${a.el}</span>`}<button class="d-btn ghost" aria-label="Open subagent ${esc(a.name)}: ${esc(a.desc)}">${ic("OpenInNew")}<span class="hide-xs">Open</span></button></div>`).join("");
    const cmdRows = s.commands.map((c) => `<div class="lrow"><span class="ri">${ic("PlayCircleOutline")}</span><span class="cmd" title="${esc(c.cmd)}">${esc(c.cmd)}</span><span class="el">${c.el}</span><button class="d-btn ghost" title="Scroll to this tool call. Stop the turn with the composer Stop." aria-label="Show command in chat: ${esc(c.cmd)}">${ic("TextSearch")}<span class="hide-xs">Show</span></button></div>`).join("");
    const bgRows = s.processes.map((p) => `<div class="lrow"><span class="ri">${ic(KIND_ICON[p.kind])}</span><span class="pid">${p.pid}</span><span class="cmd" title="${esc(p.cmd)}">${esc(p.cmd)}</span><span class="el">${p.el}</span><button class="d-btn ghost kill" title="Force-kill process tree" aria-label="Kill process ${p.pid}, ${esc(p.cmd)}">${ic("Power")}<span class="hide-xs">Kill</span></button></div>`).join("");
    L.push({
      key: "processes", label: "Processes", icon: nS ? "RobotOutline" : "Console",
      title: parts.length > 1 ? `${nAll} running` : nB ? plural(nB, "background process", "background processes") : parts[0],
      meta: parts.length > 1 ? `${parts.join(" \u00b7 ")}<span class="hide-narrow"> \u00b7 longest ${longest}</span>` : `running \u00b7 longest ${longest}`,
      sum: `${nAll}`, sumAria: `${nAll} running: ${parts.join(", ")}`,
      live: `${parts.join(", ")} running`,
      body: (nS ? sec("Subagents", nS) + subRows : "") + (nC ? sec("Commands", nC) + cmdRows : "") + (nB ? sec("Background", nB) + bgRows : ""),
    });
  }
  if (s.changes) {
    const c = s.changes, f = c.files || [];
    const add = f.reduce((a, x) => a + (x.add || 0), 0), del = f.reduce((a, x) => a + (x.del || 0), 0);
    const wt = c.worktree;
    const filesTxt = f.length ? `${f.length} file${f.length > 1 ? "s" : ""} ${delta(add, del)}` : `${ic("Check")} no local changes`;
    L.push({
      key: "changes", label: "Changes", icon: wt ? "SourceBranch" : "FileDocumentEditOutline",
      title: wt ? `<span class="mono">${esc(wt.branch)}</span>` : `${f.length} files changed`,
      titleText: wt ? wt.branch : `${f.length} files changed`,
      meta: wt ? `<span class="hide-narrow">← ${esc(wt.base)} · </span>${filesTxt}${wt.ahead ? ` · ↑${wt.ahead}<span class="sr-only"> commits ahead</span>` : ""}` : delta(add, del),
      sum: f.length ? `${f.length}<span class="hide-xs"> ${delta(add, del)}</span>` : "clean", sumAria: `${f.length} changed files`,
      actions: `${f.length ? `<button class="d-btn">${ic("FileDocumentEditOutline")}Review</button>` : ""}${wt ? `<button class="d-btn ghost hide-xs">${ic("ArrowUpBold")}Push</button><button class="d-btn ghost icon" aria-label="More worktree actions">${ic("DotsHorizontal")}</button>` : ""}`,
      expandable: f.length > 0,
      body: f.map((x) => `<button class="lrow" title="Open diff: ${esc(x.dir + x.name)}"><span class="ri">${ic(FILE_ICON[x.k])}</span><span class="path"><span class="dir hide-xs">${esc(x.dir)}</span>${esc(x.name)}</span><span class="origin hide-xs">${x.k === "new" ? "new" : x.k === "bash" ? "via bash" : "edit"}</span><span class="f-delta">${x.bin ? '<span class="el">binary</span>' : delta(x.add, x.del)}</span></button>`).join("")
        + (c.other ? `<div class="lfoot">${ic("AlertCircleOutline")}<span>${c.other} other changes in this working tree are not from this session.</span><a href="#" class="lnk">Show</a></div>` : ""),
    });
  }
  if (s.openspec) {
    const o = s.openspec;
    if (!o.attached) {
      L.push({
        key: "plan", label: "OpenSpec", icon: "ClipboardTextOutline", title: "OpenSpec", meta: "", expandable: false,
        sum: "OpenSpec", sumAria: "OpenSpec",
        actions: `<button class="chip-menu dashed" aria-haspopup="listbox">${ic("Paperclip")}<span>Attach change…</span>${ic("MenuDown")}</button><button class="d-btn ghost">${ic("LightbulbOutline")}Explore</button><button class="d-btn ghost icon" aria-label="More OpenSpec actions">${ic("DotsHorizontal")}</button>`,
      });
    } else {
      const a = o.attached;
      const bar = `<span class="lc hide-narrow" role="group" aria-label="Lifecycle">${a.segs.map((st, i) => `<button class="lc-seg ${st}" aria-label="${SEG[i]}: ${st === "done" ? "done" : st === "cur" ? "current" : "to do"}" ${st === "cur" && s.working ? `aria-disabled="true" aria-description="${disabledWhy}"` : ""}>${SEG[i][0]}</button>`).join("")}</span>`;
      const prim = `<button class="d-btn primary" ${s.working ? `aria-disabled="true" aria-description="${disabledWhy}" title="${disabledWhy}"` : ""}>${ic("Play")}${a.primary}</button>`;
      L.push({
        key: "plan", label: "OpenSpec", icon: "FormatListChecks",
        title: `<span class="mono">${esc(a.name)}</span>`, titleText: a.name,
        meta: `${a.done}/${a.total} tasks`, sum: `${a.done}/${a.total}`, sumAria: `Tasks ${a.done} of ${a.total}`,
        actions: `${bar}${prim}<button class="d-btn ghost icon" aria-label="More OpenSpec actions: open proposal, verify, refresh, detach">${ic("DotsHorizontal")}</button>`,
        expandable: true,
        body: TASKS.map((t) => t.sec ? `<p class="lsec">${t.sec}</p>` : `<div class="lrow task ${t.done ? "done" : ""}"><span class="ck">${ic(t.done ? "CheckboxMarked" : "CheckboxBlankOutline")}</span><span class="sr-only">${t.done ? "done" : "to do"}</span><span class="num">${t.id}</span><span class="t" title="${esc(t.t)}">${esc(t.t)}</span>${t.next ? '<span class="next-pill">next</span>' : ""}</div>`).join("")
          + `<div class="lfoot"><span>23 more open tasks.</span><a href="#" class="lnk">Open tasks.md</a></div>`,
      });
    }
  }
  if (s.queue.length) {
    const n = s.queue.length;
    L.push({
      key: "queue", label: "Queue", icon: "PlaylistPlus",
      title: `${n} queued follow-up${n > 1 ? "s" : ""}`, meta: "sent when this turn ends",
      sum: `${n}`, sumAria: `${n} queued follow-ups`,
      actions: n > 1 ? `<button class="d-btn ghost">Clear all</button>` : "",
      body: s.queue.map((q, i) => `<div class="lrow"><span class="pid">${i + 1}</span><span class="path" title="${esc(q)}">${esc(q)}</span><button class="d-btn ghost icon" aria-label="Edit follow-up ${i + 1}">${ic("PencilOutline")}</button><button class="d-btn ghost icon" aria-label="Move follow-up ${i + 1} to the front" ${i === 0 ? 'aria-disabled="true"' : ""}>${ic("ArrowUp")}</button><button class="d-btn ghost icon kill" aria-label="Remove follow-up ${i + 1}">${ic("Close")}</button></div>`).join(""),
    });
  }
  if (s.plugins.length) {
    L.push({
      key: "context", label: "Context", icon: "Gauge", expandable: false, plugin: true,
      title: s.plugins.map((p) => `<span role="group" aria-label="${p.label}" class="pg"><span class="lane-title">${p.label}</span> <span class="lane-meta">${p.html}</span></span>`).join(" · "),
      meta: "", sum: `<span class="hide-xs">${s.plugins[0].label}</span>`, sumAria: s.plugins[0].label,
    });
  }
  return L;
}

/* ── layouts ─────────────────────────────────────────────────── */
/* YOLO line: dock footer, outside the scroll region (never scrolled away, never collapsed, never a
   chip). One line; the sentence clips first, the time never does. Not inside any live region. */
function yoloLine(s) {
  if (!s.yolo) return "";
  const y = YOLO[s.yolo];
  return `<div class="dock-yolo ${y.heavy ? "heavy" : ""}" data-testid="yolo-composer-strip"><a class="yolo-link" href="#" title="${esc(y.sentence)}">${ic("ShieldAlertOutline")}<span class="yolo-txt">${esc(y.sentence)}</span></a><span class="yolo-time">${y.sr ? `<span aria-hidden="true">${y.time}</span><span class="sr-only">${y.sr}</span>` : y.time}</span></div>`;
}
function dockShell(inner, s, L) {
  const live = L.filter((l) => l.live).map((l) => l.live).join(". ");
  return `<section class="dock" aria-label="Session context">${inner ? `<div class="dock-scroll">${inner}</div>` : ""}${yoloLine(s)}<div class="sr-only" role="status">${live}</div></section>`;
}
function dockRows(s, fid) {
  const L = laneModels(s);
  if (!L.length) return s.yolo ? dockShell("", s, L) : "";
  const lanes = L.map((l) => {
    const exp = l.expandable !== false && !!l.body;
    const open = exp && s.open === l.key;
    const bid = `${fid}-${l.key}-body`;
    const head = exp
      ? `<button class="lane-toggle" aria-expanded="${open}" aria-controls="${bid}" data-act="lane" data-frame="${fid}" data-lane="${l.key}">${ic(l.icon, "lane-icon")}<span class="lane-title">${l.title}</span><span class="lane-meta">${l.meta}</span></button>`
      : `<div class="lane-label">${ic(l.icon, "lane-icon")}<span class="lane-title">${l.title}</span>${l.meta ? `<span class="lane-meta">${l.meta}</span>` : ""}</div>`;
    return `<div class="lane" role="group" aria-label="${l.label}" data-open="${open}">
      <div class="lane-head ${exp ? "has-toggle" : ""}">${head}${l.actions ? `<div class="lane-actions">${l.actions}</div>` : ""}${ic("ChevronDown", `lane-chev ${exp ? "" : "ph"}`)}</div>
      ${exp ? `<div class="lane-body" id="${bid}">${l.body}</div>` : ""}</div>`;
  }).join("");
  return dockShell(lanes, s, L);
}

function dockCompact(s, fid) {
  const L = laneModels(s);
  if (!L.length) return s.yolo ? dockShell("", s, L) : "";
  const cur = L.find((l) => l.key === s.open);
  const chips = L.map((l) => `<button class="sum-chip" aria-expanded="${s.open === l.key}" aria-controls="${fid}-sheet" aria-label="${l.sumAria}" data-act="lane" data-frame="${fid}" data-lane="${l.key}">${ic(l.icon)}<span aria-hidden="true">${l.sum}</span></button>`).join("");
  const sheet = cur ? `<div class="dock-sheet" id="${fid}-sheet" role="group" aria-label="${cur.label}">
      <div class="sheet-head"><span class="grow" title="${esc(cur.titleText || "")}">${cur.title}${cur.meta ? ` <span class="lane-meta">· ${cur.meta}</span>` : ""}</span>${cur.actions || ""}</div>
      ${cur.body ? `<div class="lane-body">${cur.body}</div>` : ""}</div>` : "";
  return dockShell(`<div class="dock-sum">${chips}</div>${sheet}`, s, L);
}

/* ── card ─────────────────────────────────────────────────────── */
function plusMenu() {
  return `<div class="menu left" role="menu" aria-label="Add">
    <button role="menuitem">${ic("ImageOutline", "mi-ico")}Attach image</button>
    <button role="menuitem">${ic("FileOutline", "mi-ico")}Attach file<span class="kbd">@</span></button>
    <button role="menuitem">${ic("Monitor", "mi-ico")}Preview in editor<span class="kbd">/view</span></button>
    <div class="sep" role="separator"></div>
    <button role="menuitem">${ic("Console", "mi-ico")}Open inline terminal</button>
    <div class="show-xs"><div class="sep" role="separator"></div><p class="mh">Delivery</p>
    <button role="menuitemradio" aria-checked="true">${ic("Flag", "mi-ico")}Steer<span class="kbd">⏎</span></button>
    <button role="menuitemradio" aria-checked="false">${ic("PlaylistPlus", "mi-ico")}Queue<span class="kbd">⌥⏎</span></button></div></div>`;
}
function deliveryMenu(s) {
  const it = (k, icon, t, sub, kbd) => `<button role="menuitemradio" aria-checked="${s.delivery === k}">${ic(icon, "mi-ico")}<span><span>${t}</span><span class="mi-sub">${sub}</span></span><span class="kbd">${kbd}</span></button>`;
  return `<div class="menu left" role="menu" aria-label="Delivery mode">
    ${it("steer", "Flag", "Steer", "Interrupts at the next tool boundary", "⏎")}
    ${it("queue", "PlaylistPlus", "Queue", "Delivered when the turn ends", "⌥⏎")}</div>`;
}
function modelPop(s) {
  const m = (id, on) => `<button role="menuitemradio" aria-checked="${!!on}"><span class="mono">${id}</span></button>`;
  return `<div class="menu right" role="dialog" aria-modal="false" aria-label="Model and thinking level" style="min-width:280px">
    <p class="mh">Favorites</p>${m("claude-opus-5-5", true)}${m("gpt-6")}
    <p class="mh">anthropic</p>${m("claude-sonnet-5-5")}${m("claude-haiku-5-5")}
    <div class="sep" role="separator"></div>
    <p class="mh" id="lvl-h">Thinking</p>
    <div class="lvls" role="radiogroup" aria-labelledby="lvl-h">${["off", "minimal", "low", "medium", "high", "xhigh"].map((l) => `<button role="radio" aria-checked="${l === s.level}">${l}</button>`).join("")}</div></div>`;
}
function actionCluster(s) {
  switch (s.action) {
    case "send": return `<button class="act" aria-label="Send">${ic("SendVariant")}</button>`;
    case "stop": return `<span class="stop-grp" role="group" aria-label="Stop options"><button class="after-turn" title="Finish this turn, then end cleanly" aria-label="Stop after turn">${ic("StopCircleOutline")}<span class="hide-mid">after turn</span></button><button class="act" aria-label="Stop">${ic("Stop")}</button></span>`;
    case "after-req": return `<span class="stop-grp"><span class="after-turn req" role="status">${ic("StopCircleOutline")}<span class="hide-mid">stopping after this turn…</span></span><button class="act" aria-label="Stop">${ic("Stop")}</button></span>`;
    case "force": return `<button class="act force" aria-label="Force stop, kill the process" title="Force stop, kill the process">${ic("AlertOctagon")}</button>`;
    case "killing": return `<button class="act killing" disabled aria-label="Killing process…">${ic("Stop")}</button>`;
    case "cancel": return `<button class="act" aria-label="Cancel">${ic("Close")}</button>`;
    default: return `<button class="act" disabled aria-label="Send">${ic("SendVariant")}</button>`;
  }
}
function ring(pct) {
  const r = 6, C = 2 * Math.PI * r, v = (pct / 100) * C;
  /* Context ring: kept at every width (session-header-reorg D8-R1 drops the header gauge, so this is the
     only context indicator). Not focusable; the token count rides aria-valuetext + pointer title. */
  return `<span class="ring ${pct >= 80 ? "hot" : ""}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${pct}% used, ${pct * 10}k of 1M tokens" aria-label="Context used" title="Context: ${pct}% used · ${pct * 10}k of 1M tokens">
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle class="trk" cx="8" cy="8" r="${r}" fill="none" stroke-width="2.5"/><circle class="val" cx="8" cy="8" r="${r}" fill="none" stroke-width="2.5" stroke-dasharray="${v.toFixed(1)} ${C.toFixed(1)}" stroke-linecap="round"/></svg><span class="hide-narrow">${pct}%</span></span>`;
}
function card(s, fid) {
  const tid = `${fid}-ta`;
  return `<div class="card">
    <label class="sr-only" for="${tid}">Message</label>
    <textarea id="${tid}" rows="1" placeholder="Message, /command, !shell, or @file…">${esc(s.draft)}</textarea>
    <div class="tb">
      <span class="pop-anchor"><button class="tb-btn plus icon" aria-label="Add" aria-haspopup="menu" aria-expanded="${s.menu === "plus"}" data-act="menu" data-frame="${fid}" data-menu="plus">${ic("Plus")}</button>${s.menu === "plus" ? plusMenu() : ""}</span>
      <span class="pop-anchor hide-xs"><button class="tb-btn" aria-haspopup="menu" aria-expanded="${s.menu === "delivery"}" aria-label="Delivery mode: ${s.delivery === "steer" ? "Steer" : "Queue"}" data-act="menu" data-frame="${fid}" data-menu="delivery">${ic(s.delivery === "steer" ? "Flag" : "PlaylistPlus")}<span class="hide-narrow">${s.delivery === "steer" ? "Steer" : "Queue"}</span>${ic("ChevronDown")}</button>${s.menu === "delivery" ? deliveryMenu(s) : ""}</span>
      <button class="tb-btn slot hide-narrow" title="Slot reserved by add-supervised-tool-approval" aria-label="Access mode: Full access">${ic("ShieldCheckOutline")}<span class="hide-mid">Full access</span>${ic("ChevronDown")}</button>
      <button class="tb-btn slot icon" title="composer-toolbar-action slot (voice plugin)" aria-label="Dictate">${ic("Microphone")}</button>
      <span class="sp"></span>
      ${s.working ? `<span class="status-word hide-narrow"><span class="dot" aria-hidden="true"></span>${esc(s.status)}</span>` : ""}
      ${"" /* context ring removed: reorganize-session-header D8-R2 owns the one ring, in the header */}
      <span class="pop-anchor"><button class="model-chip" aria-haspopup="dialog" aria-expanded="${s.menu === "model"}" aria-label="Model ${s.model}, thinking ${s.level}" data-act="menu" data-frame="${fid}" data-menu="model"><span class="m">${s.model}</span><span class="sep hide-xs" aria-hidden="true">·</span><span class="lvl hide-xs">${s.level}</span>${ic("ChevronDown")}</button>${s.menu === "model" ? modelPop(s) : ""}</span>
      ${actionCluster(s)}
    </div></div>`;
}

/* ── pane frames ──────────────────────────────────────────────── */
function paneHead(s, proposed) {
  return `<div class="pane-head"><span>${esc(s.title)}</span><span class="sp"></span>${proposed ? `<button class="hbtn" aria-label="Chat view options" title="ChatViewMenu, moved here from the context strip">${ic("EyeOutline")}<span class="hide-xs">View</span></button>` : ""}</div>`;
}
const TRANSCRIPT = `<div class="transcript"><div class="tg">${ic("Check", "ok")}<span>22 tool calls · 79s</span></div><p>I'll move the session context into one dock above the input, then fold the Git and OpenSpec groups into it.</p></div>`;

function widthClass(w) {
  const c = [];
  if (w < 880) c.push("w-mid");
  if (w < 640) c.push("w-narrow");
  if (w < 420) c.push("w-xs");
  if (w <= 390) c.push("vp-mobile");
  return c.join(" ");
}
function proposedPane(s, fid, w, f = {}) {
  if (f.cardOnly) return `<div class="frame prop cardonly ${f.tall ? "tall" : ""} ${widthClass(w)}" style="width:${w}px" data-fid="${fid}">${card(s, fid)}</div>`;
  const dock = w < 520 ? dockCompact(s, fid) : dockRows(s, fid);
  return `<div class="pane frame prop ${widthClass(w)}" style="width:${w}px" data-fid="${fid}">${paneHead(s, true)}${TRANSCRIPT}<div class="bottom">${dock}${card(s, fid)}</div></div>`;
}
function asBuiltPane(s, w) {
  return `<div class="pane frame built" style="width:${w}px">${paneHead(s, false)}${TRANSCRIPT}
  <div class="ab-strip"><span class="ab-ico" title="OpenSpec refresh">${ic("Refresh")}</span><span class="ab-ico" title="Chat view">${ic("EyeOutline")}</span>
    <span class="ab-tg" role="group" aria-label="OpenSpec"><span class="ab-tg-l">OpenSpec</span><span class="ab-tg-c"><span class="ab-it mono">redesign-composer-dock ${ic("MenuDown")}</span><span class="ab-lc"><span class="d">P</span><span class="d">D</span><span class="d">S</span><span class="c">12/39</span><span>A</span></span><span class="ab-it">Apply</span><span class="ab-it">⋯</span></span></span>
    <span class="ab-tg" role="group" aria-label="Git"><span class="ab-tg-l">Git</span><span class="ab-tg-c"><span class="ab-it">os/redesign-composer-dock&nbsp;<span>← develop</span>&nbsp;<span class="o">● 4</span>&nbsp;↑2</span><span class="ab-it">Push</span><span class="ab-it">⋯</span></span></span>
    <span class="ab-tg dashed" role="group" aria-label="Quota"><span class="ab-tg-l">Quota</span><span class="ab-tg-c"><span class="ab-it">5h 42% · 7d 18%</span></span></span></div>
  <div class="ab-status">${ic("CircleMedium")}Running bash…</div>
  <div class="ab-queue"><div class="qc"><div class="qh"><span><span class="dot"></span>Follow-up — delivered when the agent finishes the turn · 1 of 2</span><span class="qb">${ic("ChevronUp")}${ic("ChevronDown")}${ic("PencilOutline")}${ic("ArrowUp")}${ic("Close")}</span></div><div class="qt">${esc(QUEUE[0])}</div></div></div>
  ${s.yolo ? `<div class="ab-yolo">${ic("ShieldAlertOutline")}<span>${esc(YOLO[s.yolo].sentence)}</span><b>${YOLO[s.yolo].time}</b></div>` : ""}
  <div class="ab-card"><div class="ab-in"><div class="ta">Message, /command, !shell, or @file...</div><span class="ab-split"><span class="at">${ic("StopCircleOutline")}after turn</span><span class="st">${ic("Stop")}</span></span></div>
    <div class="ab-hair"></div>
    <div class="ab-set"><span class="pl">${ic("Plus")}</span><span class="mc">anthropic/claude-opus-5-5 ▾</span><span class="tl">${ic("LightbulbOutline")}xhigh</span><span class="ab-dc"><span class="on">${ic("Flag")}Steer</span><span>${ic("PlaylistPlus")}Queue</span></span><span class="ab-term">${ic("Console")}Terminal</span></div></div>
  <div class="ab-else"><b>Not in this stack:</b> the 2 background processes and the running command are on the sidebar SessionCard PROCESS subcard; the 3 subagents are only cards in the transcript; the 4 changed files are on the separate <code>/diff</code> route.</div></div>`;
}

/* ── scenarios ───────────────────────────────────────────────── */
const FULL = S({
  working: true, status: "Running bash…", action: "stop",
  processes: PROCS, subagents: SUBAGENTS, commands: COMMANDS, yolo: "scoped",
  changes: { worktree: WT, files: FILES, other: 3 },
  openspec: { attached: CHANGE }, queue: QUEUE,
  plugins: [{ label: "Quota", html: "5h 42% · 7d 18%" }], open: null,
});

const SCENARIOS = [
  {
    id: "s1", title: "Streaming, everything at once", built: true,
    lead: "Worktree session, change attached, 3 subagents + 1 running command + 2 background processes, 4 changed files, 2 queued follow-ups, the Quota plugin, YOLO on. As-built shows the 5-layer stack; proposed shows the dock at rest (all lanes collapsed, the default) and with Processes opened.",
    finds: [
      ["D1", "One surface: dock lanes = Processes · Changes (Git group + changed files) · OpenSpec (strip group + tasks) · Queue · Context (plugin <code>composer-context-group</code>). Gestalt common region + proximity."],
      ["D2", "Lane header = one stretched disclosure button (whole row is the target, Fitts); actions are siblings above it, never nested. Chevron is decorative."],
      ["D3", "Accordion: at most one lane open; bodies cap at 232 px and scroll; dock caps at 46% of the pane so the transcript keeps the space."],
      ["D4", "<code>StatusBar</code> (Running bash…) folds into the toolbar's right cluster as a status word beside a <code>--status-working</code> dot; ChatViewMenu moves to the pane header."],
      ["D5", "Process <b>Kill</b> (force-kills that process tree) is worded differently from the composer <b>Stop</b> (aborts the turn). Same word for two effects breaks Nielsen #4."],
      ["D6", "Ticking elapsed times are NOT in a live region; one sr-only <code>role=status</code> per dock announces only count changes. It is a sibling of the lanes, never an ancestor of the YOLO line."],
      ["D19", "Default: every lane collapsed. Opening is the user's act; nothing auto-expands (Nielsen #3 user control, no layout jumps mid-turn)."],
      ["D20", "Processes = subagents + running commands + background processes, grouped. Header <code>6 running · 3 subagents · 1 command · 2 background</code>. Subagent rows: name, task, role · steps, elapsed, <b>Open</b> (popout route); <code>created</code> = <b>waiting for a slot</b> (fan-out admission). Command rows: <b>Show</b> scrolls to the tool card; the turn stops with the composer Stop. No per-subagent stop exists in the protocol."],
      ["D21", "Subagent rows arrive through a subagents-plugin contribution, not core state, so the dock survives <code>decouple-plugins-from-core</code> Phase 3. A background row whose <code>sessionRef</code> matches a listed subagent is dropped (no double listing)."],
      ["D22", "The sidebar SessionCard PROCESS subcard stays: it is hideable per folder (configurable-session-card-sections), and it is the cross-session glance; the dock is the selected session's detail."],
    ],
    frames: [
      { cap: "streaming · at rest (all collapsed)", state: FULL },
      { cap: "streaming · Processes opened", state: { ...FULL, open: "processes" } },
    ],
  },
  {
    id: "s2", title: "OpenSpec lane open (Plan)",
    lead: "Idle, draft typed. The attached change is the lane title; the toggle meta carries 12/39, so the lifecycle bar's Tasks segment drops back to its letter. Open proposal / Detach / Refresh move from the change-chip menu into ⋯.",
    finds: [
      ["D7", "The task list needs <code>tasks.md</code> content: the OpenSpec poller only ships counts. Read it on expand via the existing <code>onReadArtifact</code> path; show the next 4 open tasks + the 2 last done."],
      ["D8", "Apply stays the single filled primary in the whole dock (spec: at most one filled primary). While working it is <code>aria-disabled</code> + focusable + reason."],
    ],
    frames: [{ cap: "idle · OpenSpec open · draft typed", state: S({ ...FULL, working: false, action: "send", draft: "Continue with 2.3, then show me the diff.", processes: [PROCS[1]], queue: [], open: "plan" }) }],
  },
  {
    id: "s3", title: "Changes lane open, main checkout",
    lead: "No worktree (main checkout): the lane title is the file count, not a branch. Each row opens that file's diff; Review opens the whole diff view. Files created by bash are marked 'via bash'; changes this session can't claim are a footer line.",
    finds: [
      ["D9", "Source: server <code>/api/session/:id/diff</code> (git numstat, <code>origin</code>, <code>otherChanges</code>), refetched on <code>turn_end</code> and on expand. Client <code>turnFileDeltas</code> undercounts when history is partially loaded and misses bash-created files."],
      ["D10", "+/− are signs AND colour (WCAG 1.4.1); green/red use <code>--accent-*-text</code>, never the fill accents."],
      ["D11", "Undo is NOT shown: it needs <code>add-workspace-checkpointing</code>. The lane's action slot is where it would land."],
    ],
    frames: [{ cap: "idle · unattached · Changes open", state: S({ changes: { files: FILES, other: 3 }, openspec: { attached: null }, open: "changes" }) }],
  },
  {
    id: "s4", title: "Quiet session",
    lead: "Lanes render only when they have content. An unattached session with no processes, changes or queue shows a single OpenSpec row; a folder without OpenSpec shows no dock at all, and the card stands alone.",
    finds: [["D12", "The resting footprint shrinks versus today (no strip row + StatusBar row): one 40 px row, or nothing."]],
    frames: [
      { cap: "unattached, nothing else", state: S({ openspec: { attached: null } }) },
      { cap: "no OpenSpec, nothing else: no dock", state: S({}) },
    ],
  },
  {
    id: "s5", title: "Narrow split pane and phone",
    lead: "Below a 520 px container the lanes collapse into one summary row of chips; a chip opens its lane as a sheet (same accordion). Fold rules follow the container, not the viewport (the existing composer rule).",
    finds: [
      ["D13", "Toolbar folds: the access slot and status word hide below 640 px; Steer ▾ moves into ＋ below 420 px. No context ring in the composer: reorganize-session-header D8-R2 puts the one ring in the header."],
      ["D14", "At phone width every target is 44 px (contract a11y #2)."],
    ],
    frames: [
      { cap: "480 px split pane · Processes open", state: { ...FULL, open: "processes" }, width: 480 },
      { cap: "375 px phone · all closed", state: { ...FULL, open: null }, width: 375 },
      { cap: "375 px phone · Changes open", state: { ...FULL, open: "changes", working: false, action: "send-disabled" }, width: 375 },
    ],
  },
  {
    id: "s6", title: "YOLO line in the dock",
    lead: "YoloComposerStrip becomes the dock's footer: warning-tinted, directly above the card, one line, never collapsible, never a chip, never scrolled away (it sits outside the dock's scroll region). The sentence clips first; the remaining time never clips and is not part of the link's name. With nothing else to show, the dock holds only this line.",
    finds: [
      ["D23", "access-grant-yolo invariants kept: strip directly above the composer; full description = link text + title; time sibling outside the link; no live-region role on it or any ancestor; no wrap at 375/768/1500 in en + hu; unscoped = heavier border + bold, still warning (never error)."],
      ["D24", "Folder home (DirectoryHomeView) renders the same dock, so its composer shows the YOLO line in the same place."],
    ],
    frames: [
      { cap: "scoped · lanes collapsed", state: { ...FULL, working: false, action: "send-disabled", status: "" } },
      { cap: "unscoped, no expiry · quiet session", state: S({ yolo: "unscoped" }) },
      { cap: "375 px · compact chips + YOLO line", state: { ...FULL, yolo: "unscoped" }, width: 375 },
      { cap: "375 px · YOLO only", state: S({ yolo: "scoped" }), width: 375 },
    ],
  },
  {
    id: "s7", title: "Card: menus and merged model chip",
    lead: "＋ absorbs Terminal (one less chip in the row). Steer|Queue becomes a dropdown with the keyboard contract spelled out. Model and thinking merge into one chip opening a non-modal popover (contract a11y #5 exception).",
    finds: [
      ["D15", "Hick's law: the toolbar goes from 6 visible controls (＋ · model · thinking · Steer · Queue · Terminal) to 3 (＋ · Steer ▾ · model·level), plus the plugin slots."],
      ["D16", "Two dashed placeholders mark slots other changes own: access mode (<code>add-supervised-tool-approval</code>) and the mic (<code>composer-toolbar-action</code>, voice plugin)."],
    ],
    frames: [
      { cap: "＋ menu open", state: S({ menu: "plus" }), cardOnly: true, tall: true, width: 560 },
      { cap: "delivery menu open", state: S({ menu: "delivery" }), cardOnly: true, tall: true, width: 560 },
      { cap: "model · thinking popover open", state: S({ menu: "model" }), cardOnly: true, tall: true, width: 560 },
      { cap: "＋ menu at phone width (Steer folds in)", state: S({ menu: "plus" }), cardOnly: true, tall: true, width: 375 },
    ],
  },
  {
    id: "s8", title: "Action button states",
    lead: "The action leaves the input row for the toolbar's bottom-right corner (like the image). The textarea grows upward, so the button stays at the draft's bottom edge. The send/stop escalation (idle → aborting → killing) is unchanged.",
    finds: [
      ["D17", "Neutral inverted fill (<code>--text-primary</code> on <code>--bg-primary</code>) replaces <code>bg-blue-600</code>/<code>bg-red-600</code>, which are raw-palette debt. Force-stop uses the warning severity triple plus a different glyph (shape, not colour)."],
      ["D18", "This reverses the spec line 'the settings row SHALL NOT contain the action button' (redesign-composer-session-strip). It becomes a MODIFIED requirement."],
    ],
    frames: ["send-disabled", "send", "stop", "after-req", "force", "killing", "cancel"].map((a) => ({
      cap: a, width: 900, cardOnly: true, state: S({ action: a, working: ["stop", "after-req", "force", "killing"].includes(a), status: "Thinking…", draft: a === "send" ? "Run the tests." : "" }),
    })),
  },
];
