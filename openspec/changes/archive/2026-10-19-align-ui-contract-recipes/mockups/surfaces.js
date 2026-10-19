/* In-context surfaces for the three components this change FIXES in code:
   settings rail (SettingsPanel.tsx), session actions menu (SessionActionsPanel.tsx)
   and the shared dialog (client-utils/Dialog.tsx). AS-BUILT reproduces shipped
   classes verbatim as inline styles; PROPOSED composes recipes.css only. */

/* ── S1 settings page ───────────────────────────────────────────── */
const RAIL = [
  ["Dashboard", [["CogOutline", "General"], ["Palette", "Appearance"], ["ViewDashboardOutline", "Session cards"]]],
  ["Network", [["Server", "Services", "err"], ["ShieldKeyOutline", "Vault"], ["LinkVariant", "Remote access", "warn"]]],
  ["Extensions", [["PackageVariantClosed", "Plugins"]]],
];
const PLUGINS = [["Gmail", "Network"], ["Goals", "Extensions"]];
const svcRows = [["postgres", "Healthy", "success", "●"], ["redis", "Starting", "info", "◐"], ["searxng", "Not responding", "warning", "◆"], ["ollama", "Failed", "error", "▲"]];

function railBuilt(cur) {
  const grp = (g) => `<div style="padding:12px 12px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-tertiary)">${g}</div>`;
  const item = ([i, t, dot]) => `<span style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;font-size:14px;white-space:nowrap;${t === cur ? "background:rgba(37,99,235,.15);color:var(--text-primary);font-weight:600" : "color:var(--text-muted)"}">${svgS(i, 15)}${t}${dot ? `<span style="margin-left:auto;width:6px;height:6px;border-radius:999px;background:${dot === "err" ? "var(--severity-error-fg)" : "#fbbf24"}"></span>` : ""}</span>`;
  const sub = ([n, g]) => `<span style="display:flex;align-items:center;gap:8px;padding:6px 12px 6px 36px;border-radius:6px;font-size:13px;opacity:.6;color:var(--text-muted)">${n}<span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">↗ ${g}</span></span>`;
  return `<nav style="width:224px;flex:none;display:flex;flex-direction:column;gap:2px;padding:8px;border-right:1px solid var(--border-primary)">${RAIL.map(([g, items]) => grp(g) + items.map(item).join("") + (g === "Extensions" ? PLUGINS.map(sub).join("") : "")).join("")}</nav>`;
}
function railProp(cur) {
  const item = ([i, t, dot]) => `<a class="r-ri" href="#" ${t === cur ? 'aria-current="page"' : ""}>${ic(i)}<span style="flex:1">${t}</span>${dot ? `<span class="r-dot ${dot}" role="img" aria-label="${dot === "err" ? "Needs attention" : "Warning"}">${ic(dot === "err" ? "AlertCircleOutline" : "AlertOutline")}</span>` : ""}</a>`;
  const sub = ([n, g]) => `<a class="r-ri r-sub" href="#">${n}<span class="hint">in ${g}</span></a>`;
  return `<nav class="r-rail" aria-label="Settings" style="background:none;border-right:1px solid var(--border-primary);border-radius:0">${RAIL.map(([g, items]) => `<span class="grp">${g}</span>` + items.map(item).join("") + (g === "Extensions" ? PLUGINS.map(sub).join("") : "")).join("")}</nav>`;
}
const settingsPage = (rail, body) => `<div class="s-app"><div class="s-top"><span class="s-title">Settings</span><button class="r-iconbtn" aria-label="Close settings">${ic("Close")}</button></div><div class="s-body">${rail}<div class="s-main">${body}</div></div></div>`;

const servicesBuilt = () => `<h2 style="margin:0 0 8px;font-size:14px;font-weight:600;color:var(--text-primary)">Services</h2>
  <div style="display:flex;border-bottom:1px solid var(--border-secondary);margin-bottom:12px">${["Services", "Runtimes"].map((t, i) => `<span style="font-size:12px;padding:6px 12px;margin-bottom:-1px;border-bottom:2px solid ${i ? "transparent" : "var(--accent-primary)"};color:${i ? "var(--text-secondary)" : "var(--text-primary)"}">${t}</span>`).join("")}</div>
  ${svcRows.map(([n, w, t, g]) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;border:1px solid var(--border-subtle);background:var(--bg-tertiary);margin-bottom:6px"><span style="flex:1;font-size:14px;color:var(--text-primary)">${n}</span><span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--severity-${t}-border);border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;background:var(--severity-${t}-bg);color:var(--severity-${t}-fg)">${g} ${w}</span></div>`).join("")}`;
const servicesProp = () => `<h2 class="s-h">Services</h2><p class="s-lead">Containers and local tools the dashboard starts for your sessions.</p>
  <div class="r-tabs" role="tablist" aria-label="Services">${[["Services", "Server", "4"], ["Runtimes", "CogOutline", ""]].map(([t, i, n], k) => `<button class="r-tab" role="tab" aria-selected="${!k}">${ic(i)}${t}${n ? `<span class="r-pill neutral" style="padding:0 6px">${n}</span>` : ""}</button>`).join("")}</div>
  <div style="display:grid;gap:6px;margin-top:12px">${svcRows.map(([n, w, t]) => `<div class="r-card"><div class="r-row"><span class="grow6" style="font-family:inherit;font-size:14px">${n}</span>${pill(t, w, t === "info" ? "Loading" : undefined)}</div></div>`).join("")}</div>`;

/* ── S2 session card + actions menu ─────────────────────────────── */
const cardShell = (inner) => `<div style="position:relative;isolation:isolate;padding:8px 8px 8px 6px;border-radius:12px;border:1px solid var(--border-secondary);background:var(--bg-tertiary);box-shadow:inset 0 1px 0 var(--elevation-rim),0 4px 8px var(--shadow-card)">${inner}</div>`;
const cardHead = (trigger) => `<div style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border-radius:999px;background:var(--status-working);flex:none"></span><span style="flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">fix-login-retry</span><span style="font-size:12px;color:var(--text-secondary)">2m</span>${trigger}</div>
  <div style="margin-left:24px;margin-top:4px;font-size:12px;color:var(--text-secondary)">Editing <code>auth/retry.ts</code></div>
  <div style="margin-left:24px;margin-top:2px;font-size:12px;color:var(--text-secondary);font-family:ui-monospace,monospace">feature/login-retry</div>`;
function menuBuilt() {
  const h = (t, s = "") => `<div style="position:sticky;top:0;display:flex;align-items:baseline;gap:8px;padding:4px 12px;background:var(--bg-secondary);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-secondary)">${t}${s ? `<span style="text-transform:none;letter-spacing:0;color:var(--text-tertiary)">${s}</span>` : ""}</div>`;
  const it = (i, t, o = {}) => `<div style="display:flex;align-items:center;gap:8px;min-height:30px;padding:6px 12px;font-size:14px;color:${o.plugin ? "var(--text-tertiary)" : o.dis ? "var(--text-tertiary)" : "var(--text-primary)"};${o.dis ? "opacity:.5" : ""}">${svgS(i, 14)}<span style="flex:1">${t}</span>${o.reason ? `<span style="font-size:10px;color:var(--text-tertiary)">${o.reason}</span>` : ""}${o.n ? `<span style="font-size:10px;font-weight:600;color:var(--text-tertiary)">${o.n}</span>` : ""}</div>`;
  return `<div style="min-width:220px;max-width:320px;border-radius:8px;border:1px solid var(--border-secondary);background:var(--bg-secondary);padding-bottom:4px;box-shadow:0 10px 15px rgba(0,0,0,.3)">${h("Next")}${it("SourceMerge", "Merge into develop")}${h("Session", "fix-login-retry")}${it("PencilOutline", "Rename")}${it("Plus", "New session here")}${it("SourceBranch", "New worktree", { dis: 1, reason: "Uncommitted changes" })}${h("OpenSpec")}${it("FileDocumentOutline", "Open change")}${it("ChevronRight", "More…", { n: 2 })}${h("Plugins")}${it("Play", "Run flow…", { plugin: 1 })}</div>`;
}
const menuProp = () => `<div class="r-menu" role="menu" aria-label="Session actions">
  <div role="group" aria-label="Next"><div class="r-mh" aria-hidden="true">Next</div><button class="r-mi next" role="menuitem">${ic("SourceMerge")}<span class="lbl">Merge into develop</span>${pill("info", "Next", "ArrowUp")}</button></div>
  <div role="group" aria-label="Session"><div class="r-mh" aria-hidden="true">Session <span class="sub">fix-login-retry</span></div>
    <button class="r-mi" role="menuitem">${ic("PencilOutline")}<span class="lbl">Rename</span></button>
    <button class="r-mi" role="menuitem">${ic("Plus")}<span class="lbl">New session here</span></button>
    <button class="r-mi" role="menuitem" aria-disabled="true">${ic("SourceBranch")}<span class="lbl">New worktree<span class="why">Commit or stash your changes first</span></span></button></div>
  <div role="group" aria-label="OpenSpec"><div class="r-mh" aria-hidden="true">OpenSpec</div>
    <button class="r-mi" role="menuitem">${ic("FileDocumentOutline")}<span class="lbl">Open change</span></button>
    <button class="r-mi" role="menuitem" aria-haspopup="true">${ic("DotsVertical")}<span class="lbl">More…</span><span class="kbd">2</span>${ic("ChevronRight")}</button></div>
  <div role="group" aria-label="Plugins"><div class="r-mh" aria-hidden="true">Plugins</div><button class="r-mi" role="menuitem">${ic("Play")}<span class="lbl">Run flow…</span></button></div>
  <div class="r-msep" role="separator"></div><button class="r-mi danger" role="menuitem">${ic("Close")}<span class="lbl">Exit session</span></button></div>`;
const sidebar = (card, menu) => `<div class="s-side"><div style="width:340px;max-width:100%;flex:none">${card}</div><div class="s-fly">${menu}</div></div>`;

/* ── S3 dialog over the dashboard ───────────────────────────────── */
const pageBehind = `<div class="s-behind" aria-hidden="true"><div class="s-behind-col"></div><div class="s-behind-main"><div></div><div></div><div></div></div></div>`;
function dialogBuilt({ title, icon, body, actions, w = 448 }) {
  const a = actions.map(([k, t]) => k === "cancel" ? `<span style="font-size:12px;padding:6px 12px;border-radius:4px;border:1px solid var(--border-primary);color:var(--text-secondary)">${t}</span>` : `<span style="font-size:12px;padding:6px 12px;border-radius:4px;background:${k === "danger" ? RAW.red600 : "var(--accent-primary)"};color:#fff">${t}</span>`).join("");
  return `<div class="s-stage">${pageBehind}<div style="position:absolute;inset:0;background:rgba(0,0,0,.6)"></div><div style="position:relative;margin:24px auto;width:calc(100% - 32px);max-width:${w}px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:8px;padding:20px;display:grid;gap:16px;box-shadow:0 20px 25px rgba(0,0,0,.4)">
    <span style="position:absolute;top:12px;right:12px;width:28px;height:28px;display:grid;place-items:center;color:var(--text-secondary)">${svgS("Close", 16)}</span>
    <div style="display:flex;gap:12px;align-items:center;padding-right:32px">${icon ? `<span style="width:36px;height:36px;border-radius:6px;display:grid;place-items:center;background:rgba(59,130,246,.15);color:var(--accent-primary)">${svgS(icon, 18)}</span>` : ""}<span style="font-size:16px;font-weight:600;color:var(--text-primary)">${title}</span></div>
    <div style="font-size:14px;color:var(--text-secondary);display:grid;gap:8px">${body}</div><div style="display:flex;justify-content:flex-end;gap:8px">${a}</div></div></div>`;
}
function dialogProp({ title, icon, tone = "", body, actions, role = "dialog", w = 448, close = true }) {
  const a = actions.map(([k, t, i]) => k === "cancel" ? btn("secondary", t, "", role === "alertdialog" ? "autofocus" : "") : btn(k, t, i || "")).join("");
  const id = nid("dt");
  return `<div class="s-stage">${pageBehind}<div class="s-scrim"></div><div class="r-dlg" role="${role}" aria-modal="true" aria-labelledby="${id}" style="position:relative;margin:24px auto;width:calc(100% - 32px);max-width:${w}px">
    <header>${icon ? `<span class="tile ${tone}">${ic(icon)}</span>` : ""}<h3 id="${id}">${title}</h3>${close ? `<button class="r-iconbtn" aria-label="Close">${ic("Close")}</button>` : ""}</header>
    <div class="body">${body}</div><footer>${a}</footer></div></div>`;
}
const DLG = {
  spawn: { title: "New worktree", icon: "SourceBranch", w: 448,
    body: `<p style="margin:0">Creates <code>../pi-agent-dashboard-login-retry</code> on a new branch and starts a session in it.</p><div><label class="p-label" for="wb">Branch</label><input id="wb" class="p-input" value="feature/login-retry" style="width:100%"></div>`,
    actions: [["cancel", "Cancel"], ["primary", "Create worktree"]] },
  confirm: { title: "Delete the flow \"nightly-triage\"?", icon: "DeleteOutline", tone: "danger", role: "alertdialog", close: false, w: 384,
    body: `<p style="margin:0">The flow file <code>.pi/flows/nightly-triage.yaml</code> is removed. 2 automations that run it are switched off.</p>`,
    actions: [["cancel", "Cancel"], ["danger", "Delete flow", "DeleteOutline"]] },
};

const SURFACES = [
  { id: "s-settings", title: "Settings page · rail", icon: "Menu",
    lead: "`SettingsPanel.tsx` rail as it renders on the Services page. Fix: `--text-secondary` items, tertiary fill + accent bar for the current item, 11 px semibold `--text-secondary` group labels, alert dots become icons with a label (raw `bg-amber-400` gone), plugin sub-items keep full contrast.",
    finds: [["R1", "Inactive items `--text-muted` (`:1403`); plugin sub-items `opacity-60` on `--text-muted` (`:1460`) — the lowest contrast on the page."], ["R2", "Active `bg-blue-600/15` (`:1402`)."], ["R4", "Group labels 11 px bold `--text-tertiary` (`:1381`)."], ["R5", "Attention dots are 6 px colour-only circles; warn dot raw `bg-amber-400` (`:1420`) — WCAG 1.4.1."]],
    built: () => settingsPage(railBuilt("Services"), servicesBuilt()),
    prop: () => settingsPage(railProp("Services"), servicesProp()) },
  { id: "s-menu", title: "Session card · actions menu", icon: "DotsVertical",
    lead: "The flyout from `SessionActionsPanel.tsx` next to a 340 px sidebar card. Fix: 11 px headings, 36/44 px items, plugin items at full contrast, disabled reason as a readable second line, destructive item last.",
    finds: [["M1", "Headings 10 px (`:263`)."], ["M2", "Items `min-h-[30px]` (`:27`)."], ["M3", "Plugin items `--text-tertiary` (`:300`)."], ["M4", "Disabled reason renders, but as a 10 px `--text-tertiary` trailing span (`:340`) — below the floor and truncated at 320 px."]],
    built: () => sidebar(cardShell(cardHead(`<span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:4px;color:var(--text-secondary);background:var(--bg-hover)">${svgS("DotsVertical", 16)}</span>`)), menuBuilt()),
    prop: () => sidebar(cardShell(cardHead(`<button class="r-trigger" aria-haspopup="menu" aria-expanded="true" aria-label="Session actions">${ic("DotsVertical")}</button>`)), menuProp()) },
  { id: "s-dialog", title: "Dialog over the dashboard", icon: "DockWindow",
    lead: "`client-utils/Dialog.tsx` (`ui:dialog`) — the primitive every plugin dialog builds on. Fix: `--bg-overlay` scrim, card-recipe panel, `text-lg` title, severity tile, 44/36 px close and actions, tinted danger. The primary fill (`--accent-solid`) comes from add-pi-spec-driven-schema; this board shows it so the result can be judged whole.",
    finds: [["D1", "Scrim `bg-black/60` (`:112`) — too heavy in light theme (`--bg-overlay` is 0.3 there)."], ["D2", "Panel `bg-[var(--bg-primary)] rounded-lg` (`:124`), title `text-base` (`:151`), icon tile `--accent-primary/15` (`:144`)."], ["D3", "Actions `text-xs py-1.5` ≈ 26 px (`:221`), close 28 px (`:136`), danger `bg-red-600` (`:194`)."]],
    built: () => dialogBuilt(DLG.spawn) + dialogBuilt(DLG.confirm),
    prop: () => dialogProp(DLG.spawn) + dialogProp(DLG.confirm) },
];
