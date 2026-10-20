/* Board data for improve-canvas-html-and-url-ux. Seven surfaces, each with an
   AS-BUILT replica (shipped Tailwind classes reproduced verbatim as inline
   styles; raw literals there ARE the finding) and PROPOSED states (canvas.css
   classes, token-only). Line refs are to develop @ 2026-10-20.
   The fake page rendered in S3/S4/S7 is page CONTENT (an agent-written mockup
   in an iframe srcdoc), so its own colours are literals inside the srcdoc. */

const ic = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n] || ""}"/></svg>`;
const svgS = (n, px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" style="fill:currentColor;flex:none"><path d="${ICON[n]}"/></svg>`;
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const attr = (s) => esc(s).replaceAll('"', "&quot;");
const RAW = { green400: "#4ade80" }; // text-green-400 on the shipped tool-call status glyph
const MONO = '"SF Mono",Menlo,Monaco,Consolas,monospace';
let _n = 0; const nid = (p) => `${p}-${++_n}`;
const cap = (s) => `<span class="c-pill neutral">${s}</span>`;

/* ── the fake page (agent-written mockup) ───────────────────────────── */
function fleetDoc(mode) {
  const body = `<header class="top"><a class="brand" href="#">__LOGO__<span>Fleetwise</span></a><nav><a href="#">Vehicles</a><a href="#">Drivers</a><a href="#">Reports</a></nav></header>
<main><section class="card"><h1>Sign in to Fleetwise</h1><p class="lead">Track vehicles, drivers and maintenance in one place.</p>
<form onsubmit="return false"><label for="e">Work email</label><input id="e" type="email" placeholder="name@company.com"><label for="p">Password</label><input id="p" type="password" value="hunter2hunter2"><label class="chk"><input type="checkbox" checked> Keep me signed in for 30 days</label><button type="submit">Sign in</button></form>
<a class="forgot" href="#">Forgot your password?</a><p class="sso">Single sign-on is available on the Enterprise plan.</p></section></main>`;
  if (mode === "plain") {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title><link rel="stylesheet" href="css/login.css"><script src="https://cdn.tailwindcss.com"><\/script></head><body>${body.replace("__LOGO__", '<img src="assets/logo.svg" alt="Fleetwise logo" width="28" height="28">')}</body></html>`;
  }
  const logo = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#2563eb"/><path d="M5 15l4-6 3 4 2-3 5 5z" fill="#fff"/></svg>';
  const css = `*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;background:#f3f4f6}
.top{display:flex;align-items:center;gap:24px;padding:10px 24px;background:#fff;border-bottom:1px solid #e5e7eb}.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#111827;text-decoration:none}
nav{display:flex;gap:16px}nav a{color:#4b5563;text-decoration:none}main{display:flex;justify-content:center;padding:28px 16px}
.card{width:100%;max-width:360px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}h1{margin:0 0 4px;font-size:20px;color:#111827}.lead{margin:0 0 16px;color:#4b5563}
form{display:grid;gap:6px}label{font-weight:600;font-size:13px}input[type=email],input[type=password]{width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font:inherit}
.chk{display:flex;align-items:center;gap:6px;font-weight:400;margin:4px 0}button{margin-top:6px;padding:9px 12px;border:0;border-radius:6px;background:#2563eb;color:#fff;font:inherit;font-weight:600}
.forgot{display:inline-block;margin-top:12px;color:#2563eb}.sso{margin:12px 0 0;font-size:12px;color:#6b7280}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title><style>${css}</style></head><body>${body.replace("__LOGO__", logo)}</body></html>`;
}
const pageFrame = (mode, { sandbox, size = "", title }) => `<iframe class="pg ${size}" ${sandbox === null ? "" : `sandbox="${sandbox}"`} title="${attr(title)}" srcdoc="${attr(fleetDoc(mode))}"></iframe>`;
const SB_BUILT = "allow-same-origin";
const SB_LIVE = "allow-scripts allow-forms allow-popups allow-downloads";
const SB_RESTRICTED = "allow-scripts allow-forms";

/* ── S1 tool card ───────────────────────────────────────────────────── */
/* ToolCallStep.tsx:177 wrapper, :194 raw green glyph, :202 summary, :250 body */
function tcBuilt(args, result, status = "complete") {
  const glyph = status === "error" ? "var(--severity-error-fg)" : RAW.green400;
  return `<div style="padding:12px"><div style="margin:0 16px;border-left:2px solid var(--border-secondary);padding-left:12px">
  <div style="display:flex;align-items:center;font-size:12px;color:var(--text-tertiary);gap:6px"><span style="display:inline-flex;color:${glyph}">${svgS(status === "error" ? "AlertCircleOutline" : "Check", 13)}</span><span>canvas</span><span style="margin-left:auto;color:var(--text-muted);display:inline-flex">${svgS("ChevronDown", 14)}</span></div>
  <div style="margin:4px 0 0 16px;padding:8px;background:var(--bg-secondary);border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1);border:1px solid var(--border-subtle);font-size:12px;color:var(--text-secondary)">
    <div style="display:grid;gap:8px"><pre style="margin:0;font-family:${MONO};font-size:12px;line-height:1.5;color:var(--text-secondary);white-space:pre-wrap">${esc(JSON.stringify(args, null, 2))}</pre>
    <div style="color:var(--text-tertiary);font-weight:500;font-size:12px">Output:</div>
    <pre style="margin:0;font-family:${MONO};font-size:12px;line-height:1.5;color:var(--text-secondary);white-space:pre-wrap">${esc(result)}</pre></div></div></div></div>`;
}
function tcHead(status = "complete") {
  const cls = status === "error" ? "bad" : "ok";
  return `<div class="tc-head"><span class="${cls}">${ic(status === "error" ? "AlertCircleOutline" : "Check")}</span><span>canvas</span><span class="chev">${ic("ChevronDown")}</span></div>`;
}
/** CanvasToolRenderer body. kind: file|url|server; active: link vs plain text. */
function cv({ kind, title, target, active, confirm }) {
  const icon = { file: "FileDocumentOutline", url: "Web", server: "ServerNetwork" }[kind];
  const label = { file: "File target", url: "URL target", server: "Server target" }[kind];
  const tid = 'data-testid="canvas-tool-target"';
  let tgt;
  if (confirm) {
    tgt = `<span class="path c-mono plain" ${tid}>${esc(target)}</span><span class="c-pill neutral" data-testid="canvas-tool-unconfirmed" title="Nothing is fetched until you confirm">${ic("HelpCircleOutline")}Not opened yet</span>`;
  } else if (kind === "server") {
    tgt = active
      ? `<a class="chip link c-link" href="#" ${tid} aria-label="Open server ${attr(target)} in canvas">${esc(target)}</a>`
      : `<span class="chip plain" ${tid}>${esc(target)}</span>`;
  } else {
    tgt = active
      ? `<a class="path c-mono c-link" href="#" ${tid}>${esc(target)}</a>`
      : `<span class="path c-mono plain" ${tid}>${esc(target)}</span>`;
  }
  const act = confirm ? `<button class="c-btn act" type="button" data-testid="canvas-tool-confirm">${ic("ServerNetwork")}Confirm and open</button>`
    : active ? `<button class="c-btn ghost act" type="button" data-testid="canvas-tool-open">${ic("OpenInNew")}Open in canvas</button>` : "";
  const sup = !active ? `<span class="c-pill neutral" title="A newer canvas declare replaced this one">${ic("History")}Superseded</span>` : "";
  return `<div class="cv" data-testid="canvas-tool-card" data-active="${!!active}"><span class="kind" role="img" aria-label="${label}">${ic(icon)}</span>
  <div class="main"><span class="ttl">${esc(title)}</span><div class="tgt">${tgt}${sup}</div></div>${act}</div>`;
}
const tcProp = (inner, status = "complete") => `<div class="tc-wrap"><div class="tc">${tcHead(status)}<div class="tc-body">${inner}</div></div></div>`;
/** Canvas confirm chip (mirrors CanvasServerChip.tsx:92-107: rounded-full, border-secondary, bg-secondary, min-h 44). */
const cvChip = ({ label, port, status = "" }) => `<div class="c-dock"><button type="button" class="c-chip" data-testid="canvas-server-chip" data-port="${port}" title="Tap to probe 127.0.0.1 and open a restricted preview">${ic("ServerNetwork", "lead")}<span class="lbl">${esc(label)}</span><span class="go" aria-hidden="true">Open</span></button>${status ? `<span class="c-chip-status" role="status" data-testid="canvas-server-chip-status">${esc(status)}</span>` : ""}</div>`;
const cvErr = (msg) => `<p class="c-err" role="alert" data-testid="canvas-tool-error">${ic("AlertCircleOutline")}<span>${esc(msg)}</span></p>`;

/* ── S2 viewer header ───────────────────────────────────────────────── */
/* LiveServerViewer.tsx:171-194 framed header */
const lvBuilt = () => `<div style="display:flex;flex-direction:column"><div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border-primary);padding:4px 8px;font-size:12px">
  <button type="button" data-testid="live-back" style="border-radius:4px;padding:2px 8px;color:var(--text-tertiary)">← Targets</button>
  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:${MONO};color:var(--text-secondary)">/live/ab12cd/</span><span style="flex:1"></span>
  <a href="#" style="display:flex;align-items:center;gap:4px;border-radius:4px;padding:2px 8px;color:var(--text-tertiary);text-decoration:none">${svgS("OpenInNew", 13)}<span>Open</span></a></div>
  <div style="padding:16px 12px;font-size:12px;color:var(--text-tertiary)">frame: <code style="font-family:${MONO}">data-testid="live-iframe"</code></div></div>`;

/** Proposed header. t: static|port. scripts: bool. restricted: agent-opened (Restricted pill).
    Order: [← Targets] [address] [Restricted] [↻] [Scripts | Static] (static only) [Open ↗].
    "Run scripts" lives in the exposure notice (lvExposed) so the header never carries a second copy. */
function lvBar({ t = "static", value, scripts = true, invalid = false, errId = "", restricted = false }) {
  const root = t === "static" ? `<span class="root" title="Document root">${ic("FileDocumentOutline")}<span>mockups/login/</span></span>` : "";
  const seg = t === "static"
    ? `<div class="c-seg" role="radiogroup" aria-label="Rendering mode" data-testid="live-scripts-toggle">
        <button type="button" role="radio" aria-checked="${scripts}">${scripts ? ic("Check") : ic("ScriptTextOutline")}Scripts</button>
        <button type="button" role="radio" aria-checked="${!scripts}">${!scripts ? ic("Check") : ic("EyeOffOutline")}Static</button></div>` : "";
  const pill = restricted ? `<span class="c-pill neutral" data-testid="live-restricted-pill" title="Opened by the agent. External sources are blocked unless you allow them.">${ic("ShieldLockOutline")}Restricted</span>` : "";
  const id = nid("addr");
  return `<div class="lv-bar"><button type="button" class="c-btn ghost" data-testid="live-back">${ic("ArrowLeft")}Targets</button>
  <div class="lv-addr" data-invalid="${invalid}">${root}<label class="sr-only" for="${id}">Address</label><input id="${id}" class="c-mono" data-testid="live-address" value="${attr(value)}" spellcheck="false" ${invalid ? `aria-invalid="true" aria-describedby="${errId}"` : ""}></div>
  ${pill}<button type="button" class="c-ibtn" data-testid="live-reload" aria-label="Reload preview">${ic("Refresh")}</button>${seg}
  <a href="#" class="c-btn ghost" style="text-decoration:none">${ic("OpenInNew")}Open</a></div>`;
}
const lvNote = (cls, testid, inner, btn = "") => `<div class="lv-row"><div class="c-note ${cls} grow" role="status" data-testid="${testid}">${ic("InformationOutline")}<div class="b">${inner}</div>${btn}</div></div>`;
const lv = (...parts) => `<div class="lv">${parts.join("")}</div>`;

/* ── S3 egress banner ───────────────────────────────────────────────── */
const egSrc = (src) => `<span class="c-pill neutral srcl" data-testid="egress-source">${src}</span>`;
/** One banner row. grant: "both" (markup) | "once" (runtime, or prompts disabled) | "none" (private). */
const egRow = ({ o, src, grant = "both", prompts = true, shared = false }) => {
  const once = `<button type="button" class="c-btn" data-testid="egress-allow-once" aria-label="Allow ${o} once">Allow once</button>`;
  const proj = `<button type="button" class="c-btn" data-testid="egress-allow-project" aria-label="Allow ${o} for this project">Allow for this project</button>`;
  const acts = grant === "none" ? `<span class="why">not grantable (private address)</span>` : once + (grant === "both" && prompts ? proj : "");
  const warn = shared ? `<p class="shared" data-testid="egress-shared-warning">${ic("AlertOutline")}Shared hosting: anyone can publish here</p>` : "";
  return `<li><span class="origin">${o}</span>${egSrc(src)}${acts}${warn}</li>`;
};
function egressBanner({ prompts = true } = {}) {
  const rows = prompts
    ? [egRow({ o: "https://cdn.tailwindcss.com", src: "in markup" }),
       egRow({ o: "https://someone.github.io", src: "in markup", shared: true }),
       egRow({ o: "https://stats.example-cdn.net", src: "reported by this page", grant: "once" }),
       egRow({ o: "http://192.168.1.10", src: "in markup", grant: "none" })]
    : [egRow({ o: "https://cdn.tailwindcss.com", src: "in markup", prompts: false }),
       egRow({ o: "https://stats.example-cdn.net", src: "reported by this page", grant: "once", prompts: false })];
  const n = rows.length;
  const foot = prompts ? "" : `<p class="foot" data-testid="egress-prompts-note">Project grants need access prompts (Settings \u2192 Access).</p>`;
  return `<div class="eg"><div class="c-note warning" role="status" aria-live="polite" data-testid="egress-banner" data-source="auto-open" data-prompts="${prompts}">${ic("AlertOutline")}<div class="b">
  <div class="head"><div class="b"><strong class="t">${n} external sources blocked (auto-opened preview)</strong><p>The page may look unstyled until you allow them. Nothing was requested from them.</p></div>
  <button type="button" class="c-ibtn" aria-label="Dismiss blocked sources notice">${ic("Close")}</button></div>
  <ul class="rows" aria-label="Blocked sources">${rows.join("")}</ul>${foot}</div></div></div>`;
}
const egressDone = () => `<div class="eg-done"><span class="c-pill success" role="status" data-testid="egress-banner" data-state="allowed-once">${ic("CheckCircleOutline")}cdn.tailwindcss.com allowed for this preview</span><button type="button" class="c-ibtn" aria-label="Dismiss notice">${ic("Close")}</button></div>`;

/* ── S5 picker ──────────────────────────────────────────────────────── */
/* LiveServerViewer.tsx:210-272 */
const DEAD_PORTS = [54387, 54108, 53977, 53642, 52911, 52744, 52390, 51876, 51530];
const builtItem = (host, port, label) => `<li><button type="button" style="display:flex;width:100%;align-items:center;gap:8px;border-radius:4px;padding:4px 8px;text-align:left;font-size:14px"><span style="color:var(--accent-green);display:inline-flex">${svgS("Play", 13)}</span><span style="font-weight:500">${label}</span><span style="font-family:${MONO};font-size:12px;color:var(--text-tertiary)">${host}:${port}</span></button></li>`;
const pickerBuiltTop = (err) => `<div><h3 style="margin:0 0 4px;font-weight:500;color:var(--text-primary)">Preview a local dev server</h3><p style="margin:0;font-size:12px;color:var(--text-tertiary)">Loopback only (localhost / 127.0.0.1). Runs sandboxed — the app can't reach the dashboard.</p></div>
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px"><input data-testid="live-url" value="http://localhost:5173" style="min-width:0;flex:1;border-radius:4px;border:1px solid var(--border-secondary);background:var(--bg-primary);color:var(--text-primary);padding:4px 8px;font-family:${MONO};font-size:12px">
  <input data-testid="live-label" placeholder="label (optional)" style="width:128px;border-radius:4px;border:1px solid var(--border-secondary);background:var(--bg-primary);color:var(--text-primary);padding:4px 8px;font-size:12px">
  <button type="button" data-testid="live-confirm" style="display:flex;align-items:center;gap:4px;border-radius:4px;background:var(--accent-blue);padding:4px 12px;color:#fff;font-size:14px">${svgS("Play", 14)}<span>Preview</span></button></div>
  ${err ? `<div data-testid="live-error" style="font-size:12px;color:var(--accent-red)">${err}</div>` : ""}`;
const pickerBuilt = () => `<div style="display:flex;flex-direction:column;gap:16px;padding:16px;font-size:14px;color:var(--text-primary)">${pickerBuiltTop("Only localhost / 127.0.0.1 targets can be previewed.")}
  <div><div style="margin-bottom:4px;font-size:12px;font-weight:500;color:var(--text-secondary)">Saved targets</div><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px">${DEAD_PORTS.map((p) => builtItem("localhost", p, `localhost:${p}`)).join("")}${builtItem("localhost", 54321, "localhost:54321")}${builtItem("localhost", 5173, "Fleetwise web")}${builtItem("localhost", 6006, "Storybook")}</ul></div></div>`;

const pkAdd = (err) => `<div><h3>Preview a local dev server</h3><p class="hint">Loopback only (localhost / 127.0.0.1). Runs sandboxed. The app can't reach the dashboard.</p></div>
  <div class="add"><label class="sr-only" for="pk-url">URL</label><input id="pk-url" class="c-input mono url" data-testid="live-url" value="http://localhost:5173" ${err ? 'aria-invalid="true" aria-describedby="pk-err"' : ""}>
  <label class="sr-only" for="pk-lbl">Label</label><input id="pk-lbl" class="c-input lbl" data-testid="live-label" placeholder="label (optional)">
  <button type="button" class="c-btn primary" data-testid="live-confirm">${ic("Play")}Preview</button></div>
  ${err ? `<p class="c-err" id="pk-err" role="alert" data-testid="live-error">${ic("AlertCircleOutline")}<span>${err}</span></p>` : ""}`;
const tRow = (label, hp, { live = false, dim = false } = {}) => `<li class="c-trow"><button type="button" class="c-row">${live ? '<span class="c-dot" aria-hidden="true"></span>' : ic("Play")}${label === hp ? "" : `<span class="nm">${label}</span>`}<span class="${label === hp ? "nm" : "hp"}">${hp}</span>${live ? '<span class="c-pill success">Live</span>' : ""}</button><button type="button" class="c-ibtn" data-testid="live-target-remove" aria-label="Remove target ${hp}">${ic("Close")}</button></li>`;
const pickerProp = (open, confirm = false) => `<div class="pk">${pkAdd("")}
  <section aria-labelledby="pk-a"><h4 class="sec" id="pk-a">Active canvas</h4><ul>${tRow("Login mockup", "localhost:54321", { live: true })}</ul></section>
  <section aria-labelledby="pk-u"><h4 class="sec" id="pk-u">Added by you</h4><ul>${tRow("Fleetwise web", "localhost:5173")}${tRow("Storybook", "localhost:6006")}</ul></section>
  <details ${open ? "open" : ""}><summary>${ic("ChevronDown", "chev")}Older targets (9)</summary><div class="inner"><div class="bar"><span>Added by earlier automatic launches or before this update</span>${confirm ? "" : `<button type="button" class="c-btn danger" data-testid="live-clear-older">${ic("DeleteOutline")}Clear all</button>`}</div>
  ${confirm ? `<div class="cfm" role="group" aria-label="Confirm removing older targets" data-testid="live-clear-confirm-row"><span class="q">Remove 9 older targets?</span><button type="button" class="c-btn danger" data-testid="live-clear-confirm">Remove</button><button type="button" class="c-btn" data-testid="live-clear-cancel">Cancel</button></div>` : ""}
  <ul>${DEAD_PORTS.map((p) => tRow(`localhost:${p}`, `localhost:${p}`)).join("")}</ul></div></details></div>`;

/* ── S6 access page ─────────────────────────────────────────────────── */
/* AccessSection.tsx:231-311 */
const acEntryBuilt = (subject, meta) => `<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;border-top:1px solid var(--border-primary)"><div style="min-width:0;flex:1"><div style="font-family:${MONO};font-size:14px;color:var(--text-primary);word-break:break-all">${subject}</div>${meta ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:2px;font-size:12px;color:var(--text-tertiary)">${meta}</div>` : ""}</div><button type="button" aria-label="Revoke ${subject}" style="flex:none;padding:4px 8px;border-radius:4px;font-size:14px;border:1px solid var(--border-secondary);color:var(--text-secondary)">Revoke</button></div>`;
const acBuilt = () => `<div style="padding:16px;display:grid;gap:16px"><div><h2 style="margin:0;font-size:16px;font-weight:600;color:var(--text-primary)">Access grants</h2><p style="margin:4px 0 0;font-size:12px;color:var(--text-tertiary)">Every access grant across all grant stores, labelled with the store it lives in.</p></div>
  <section><h3 style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.025em;color:var(--text-tertiary)">CORS allowed origins — cors.allowedOrigins</h3><div style="border:1px solid var(--border-primary);border-radius:4px;background:var(--bg-secondary)">${acEntryBuilt("https://app.fleetwise.example", "").replace("border-top:1px solid var(--border-primary)", "")}</div></section>
  <p style="margin:0;font-size:12px;color:var(--text-tertiary)">No store lists preview egress origins. A CDN allowed for a project cannot be reviewed or revoked here.</p></div>`;
const acEntry = (subject, project, granted) => `<div class="ent" data-testid="access-entry" data-store="previewEgress"><div class="m"><div class="subj">${subject}</div><div class="meta"><span data-testid="access-entry-project">Project: ${project}</span><span data-testid="access-entry-granted">Granted: ${granted}</span></div></div><button type="button" class="c-btn" data-testid="access-revoke" aria-label="Revoke ${subject} for ${project}">Revoke</button></div>`;
const acProp = () => `<div class="ac"><div><h2>Access grants</h2><p class="sub">Every access grant across all grant stores, labelled with the store it lives in.</p></div>
  <section data-testid="access-store-previewEgress"><h3>Preview egress origins · preview-egress.json</h3><div class="grp">${acEntry("https://cdn.tailwindcss.com", "~/Project/fleetwise", "2026-10-20")}${acEntry("https://fonts.googleapis.com", "~/Project/fleetwise", "2026-10-20")}${acEntry("https://unpkg.com", "~/Project/billing-portal", "2026-10-18")}</div></section></div>`;

/* ── S7 composition ─────────────────────────────────────────────────── */
const composition = () => `<div class="ws"><section class="chat" aria-label="Chat"><div class="top">${ic("ChatOutline")}fleetwise-login</div><div class="msgs">
  <p class="msg user">Build a login mockup for Fleetwise and show it in the canvas.</p>
  <p class="msg m" style="color:var(--text-secondary)">I wrote the login page and styled it with Tailwind from the CDN. It is open in the canvas now.</p>
  <div class="tc">${tcHead()}<div class="tc-body">${cv({ kind: "file", title: "Login mockup", target: "mockups/login/index.html", active: true })}</div></div></div>
  <div class="compose">Message the agent</div></section>
  <section class="editor" aria-label="Editor"><div class="tabs" role="tablist" aria-label="Open files"><div class="tab" role="tab" aria-selected="false">${ic("FileCodeOutline")}<span>login.css</span><span class="x" aria-hidden="true">${ic("Close")}</span></div>
  <div class="tab" role="tab" aria-selected="true">${ic("Web")}<span>login/index.html</span><button type="button" class="x" aria-label="Close login/index.html">${ic("Close")}</button></div></div>
  <div class="lv">${lvBar({ value: "index.html", restricted: true })}${egressDone()}${pageFrame("styled", { sandbox: SB_RESTRICTED, size: "tall", title: "Live preview: login/index.html" })}</div></section></div>`;

/* ── surfaces ───────────────────────────────────────────────────────── */
const SURFACES = [
  { id: "s1-tool-card", title: "Canvas tool card in chat", icon: "TabUnselected",
    lead: "A `canvas` call lands in `GenericToolRenderer` and prints its args and the `{\"ok\":true}` acknowledgement, with nothing to click. The proposed `CanvasToolRenderer` shows the title, a kind icon and the target. Only the card for the session's current canvas target is a link. A localhost URL declare never auto-opens: the card and the canvas chip ask first.",
    cites: [["GenericToolRenderer.tsx:18-26", ""], ["ToolCallStep.tsx:177,194,202,250", ""], ["registry.ts:11-25", ""], ["CanvasDriver.tsx:121-149", "openLiveTarget"], ["CanvasServerChip.tsx:92-107", "chip classes"]],
    finds: [["T1", "Body is `<pre>{JSON.stringify(args)}</pre>` plus `Output: {\"ok\":true}` (`GenericToolRenderer.tsx:18-26`). The target path is buried in JSON and is not linkified (args are verbatim by design)."],
      ["T2", "Collapsed header reads just `canvas` (`getSummary` falls back to the tool name). The card is closed until the user expands it."],
      ["T3", "Every card looks the same, so an older declare is indistinguishable from the live one."],
      ["T4", "A rejected declare shows `{\"ok\":false,…}` as raw output, not as an error line."],
      ["T5", "A loopback `kind:\"url\"` declare goes straight to `openLiveTarget` (`CanvasDriver.tsx:121-149`), which launches and persists the port with no tap. Only `kind:\"server\"` uses the confirm chip."]],
    realizes: ["CanvasToolRenderer shows the declared target", "Only the active canvas card opens its target", "Tool renderer registry", "canvas() declare-tool normalizes into a real ViewTarget", "Declared servers are dashboard-probed for loopback, never auto-detected"],
    built: () => `<div class="astate"><p class="src"><code>GenericToolRenderer</code>file declare</p>${tcBuilt({ target: { kind: "file", path: "mockups/login/index.html" }, title: "Login mockup" }, '{"ok":true}')}</div>`,
    states: [
      ["(a) active file target", () => tcProp(cv({ kind: "file", title: "Login mockup", target: "mockups/login/index.html", active: true })), "Link uses `--link`. The row is the session's current canvas target, so the link and the Open in canvas button both open it as the active tab."],
      ["(b) active URL target", () => tcProp(cv({ kind: "url", title: "Served mockup", target: "http://localhost:54321/", active: true }))],
      ["(c) active server target", () => tcProp(cv({ kind: "server", title: "Fleetwise web app", target: ":5173", active: true })), "Server targets show `:port` as a chip, the form the canvas chip already uses."],
      ["(d) superseded card", () => tcProp(cv({ kind: "file", title: "Login mockup", target: "mockups/login/index.html", active: false })), "Same layout. Target is plain `--text-secondary` text, no link, no button. The Superseded word says why."],
      ["(e) rejected declare", () => tcProp(cvErr("canvas: url target must be a valid URL"), "error"), "Inline action error recipe: `--severity-error-fg`, icon plus one sentence, `role=alert`. No raw JSON."],
      ["(f) loopback URL declare, awaiting confirmation", () => tcProp(cv({ kind: "url", title: "Fleetwise app", target: "http://localhost:54321/app", active: true, confirm: true })), "No auto-open and no fetch. The target is plain text and the card offers a confirm action instead of a link. Confirm runs the same tap as the chip (g): probe `127.0.0.1:54321`, then open `/app` as a restricted preset target."],
      ["(g) canvas confirm chip for a URL declare", () => cvChip({ label: "Open localhost:54321/app?", port: 54321 }), "Mirrors `CanvasServerChip`: `rounded-full`, `--border-secondary`, `--bg-secondary`, 44 px min height, server icon. The tap consents to connecting only, so the preview opens restricted."],
      ["(h) chip after a failed tap", () => cvChip({ label: "Open localhost:54321/app?", port: 54321, status: "Server not running" }), "Same status copy and `--severity-error-fg` text as the shipped chip. No frame is opened."],
    ] },

  { id: "s2-viewer-header", title: "Live viewer header (address bar)", icon: "Web",
    lead: "The framed header shows a read-only `/live/ab12cd/` path. Proposed: an editable address bar, a Restricted pill for agent-opened previews, reload, a Scripts/Static toggle (static targets only) and Open. When the dashboard is exposed, scripts on an agent-opened page stay off until the user clicks Run scripts. A localhost dev server is never started by the dashboard; a root-absolute page just gets a hint. Typing a new loopback port asks inline; a remote address or a `..` path shows an error. Every control is at least 24 px.",
    cites: [["LiveServerViewer.tsx:171-194", ""], ["LiveServerViewer.tsx:158-165", "onConfirm"], ["LiveServerViewer.tsx:247", "live-error"]],
    finds: [["H1", "`/live/<id>/` (`:183`) is the proxy path, not something the user can read or edit. It says nothing about which page or port is shown."],
      ["H2", "To open a sibling page or another port the user must go `← Targets`, retype in the picker and press Preview (`:172-182`, `:221-245`)."],
      ["H3", "No reload control. Header buttons are `px-2 py-0.5 text-xs`, about 20 px high, below the 24 px floor."],
      ["H4", "Errors and the confirm step exist only on the picker screen (`:247`), never next to the frame."]],
    realizes: ["The viewer header is an editable address bar", "Address bar paths are validated before use", "The viewer reloads on demand and on canvas re-declare", "Root-absolute pages explain how to view them", "Scripts on restricted previews depend on exposure", "Egress policy is fixed by provenance", "Embedded content SHALL be origin-isolated via sandbox"],
    built: () => `<div class="astate"><p class="src"><code>framed header</code>read-only path</p><div class="demo" style="border:0">${lvBuilt()}</div></div>`,
    states: [
      ["(a) static target, scripts on", () => lv(lvBar({ value: "screens/settings.html" })), "Operator open (tree click): open egress, so no Restricted pill. Prefix chip shows the document root and is not editable. Enter re-points the frame inside the same target, with no new target."],
      ["(b) static target, Static (no scripts) selected", () => lv(lvBar({ value: "screens/settings.html", scripts: false })), "Sandbox becomes empty. The selected segment carries a check icon as well as the info tint."],
      ["(c) port target, agent-declared", () => lv(lvBar({ t: "port", value: "http://localhost:5173/dashboard", restricted: true })), "Opened from the confirm chip, so the Restricted pill shows. The Scripts | Static toggle applies to static targets only."],
      ["(d) new port, inline confirm", () => lv(lvBar({ t: "port", value: "http://localhost:5174/" }), `<div class="lv-row" role="group" aria-label="Confirm new target"><span class="grow">Add <code>localhost:5174</code> as a preview target?</span><button type="button" class="c-btn primary" data-testid="live-confirm">Add</button><button type="button" class="c-btn">Cancel</button></div>`), "Nothing is added or fetched until Add. One primary action in the row."],
      ["(e) remote address refused", () => lv(lvBar({ t: "port", value: "http://10.0.0.5/", invalid: true, errId: "lv-err" }), `<div class="lv-row err"><p class="c-err" id="lv-err" role="alert" data-testid="live-error">${ic("AlertCircleOutline")}<span>Only localhost / 127.0.0.1 targets can be previewed.</span></p></div>`), "Frame stays on the last good target. The field is `aria-invalid` and points at the error."],
      ["(f) hint: root-absolute assets", () => lv(lvBar({ value: "index.html" }), lvNote("info", "live-hint-root-absolute", `<p>This page uses root-absolute paths (<code>/app.js</code>) that cannot resolve here. Run a dev server bound to localhost and open its localhost URL in the canvas.</p>`)), "Shown when the static scan finds a `src` or `href` starting with `/`. Guidance only: no button, because the dashboard does not start dev servers."],
      ["(g) invalid path refused", () => lv(lvBar({ value: "../../api/sessions", invalid: true, errId: "lv-err2" }), `<div class="lv-row err"><p class="c-err" id="lv-err2" role="alert" data-testid="live-error">${ic("AlertCircleOutline")}<span>Enter a path inside this preview.</span></p></div>`), "A `.`, `..`, empty, backslash or control segment is rejected before anything is framed. The frame stays on the last good page."],
      ["(h) restricted and exposed, scripts off", () => lv(lvBar({ value: "index.html", scripts: false, restricted: true }), lvNote("info", "live-exposed-notice", `<p>Scripts are off because this dashboard is reachable from other devices.</p>`, `<button type="button" class="c-btn" data-testid="live-run-scripts">${ic("ScriptTextOutline")}Run scripts</button>`), pageFrame("styled", { sandbox: "", size: "short", title: "Preview with scripts off" })), "Agent-opened page on a LAN-bound or tunnelled dashboard. The server mints scripts-off until the user clicks Run scripts (one click, external origins stay restricted). Static is selected in the toggle. Run scripts lives in the notice only, so the header has no second copy."],
      ["(i) active tab updated by the agent", () => lv(lvBar({ value: "index.html", restricted: true }), lvNote("info", "live-updated-notice", `<strong class="t">Updated by the agent</strong><p>You are still viewing the earlier version.</p>`, `<button type="button" class="c-btn" data-testid="live-updated-reload">${ic("Refresh")}Reload</button>`), pageFrame("styled", { sandbox: SB_RESTRICTED, size: "short", title: "Preview, content unchanged" })), "Non-modal (`role=status`, no focus move). The frame is not touched until Reload. A background tab reloads silently instead."],
    ] },

  { id: "s3-egress-banner", title: "Egress banner (blocked external sources)", icon: "ShieldLockOutline",
    lead: "An auto-opened HTML page gets a CSP that allows only itself plus granted origins, so a CDN stylesheet is dropped silently and the page renders bare. Proposed: a non-modal warning notice under the header and above the frame, one row per origin, each labelled `in markup` or `reported by this page`. Markup origins offer Allow once and Allow for this project; a page-reported origin offers Allow once only. Auto-open raises no dialog; the dialog appears only after the user clicks Allow for this project.",
    cites: [["HtmlPreview.tsx:60", "withRestrictiveCsp"], ["LiveServerViewer.tsx:195-205", "frame, no banner slot"]],
    finds: [["B1", "`restrictCsp` blocks external origins with no signal (`HtmlPreview.tsx:60`). The user sees an unstyled page and cannot tell a CDN was blocked."],
      ["B2", "There is no place between header and frame (`LiveServerViewer.tsx:171-195`) for a notice, and no grant flow to point it at."],
      ["B3", "A private-address origin such as `http://192.168.1.10` must be listed (so the user knows) but never offered a grant."],
      ["B4", "A page can post its own CSP reports, so a runtime-only origin must not become a persistent project grant. It gets Allow once only."],
      ["B5", "Project grants need access prompts, which are off by default. Without them the banner must say why the project button is missing."]],
    realizes: ["The viewer offers non-modal enablement for blocked origins", "Egress policy is fixed by provenance", "Blocked external origins are detected in markup", "Runtime-blocked origins are reported where the browser delivers reports", "Only public https origins are grantable"],
    built: () => `<div class="astate"><p class="src"><code>auto-open, CSP blocks CDN</code>no banner, bare page</p><div class="demo" style="border:0"><div style="padding:8px;font-size:12px;color:var(--text-tertiary);border-bottom:1px solid var(--border-primary)">no notice, no control, no log line for the user</div>${pageFrame("plain", { sandbox: SB_BUILT, size: "short", title: "As-built page, CDN blocked" })}</div></div>`,
    states: [
      ["(a) auto-opened, markup + runtime + shared host + private", () => lv(lvBar({ value: "index.html", restricted: true }), egressBanner(), pageFrame("plain", { sandbox: SB_RESTRICTED, size: "short", title: "Page while sources are blocked" })), "Non-modal: `role=status`, frame stays interactive, focus is not moved. Markup rows: Allow once and Allow for this project (user click, then the existing access-grant dialog, not redrawn). The runtime row (reported by this page) offers Allow once only. The shared-hosting row adds a warning line. The private address has no buttons."],
      ["(b) access prompts disabled", () => lv(lvBar({ value: "index.html", restricted: true }), egressBanner({ prompts: false }), pageFrame("plain", { sandbox: SB_RESTRICTED, size: "short", title: "Page while sources are blocked, prompts off" })), "Default configuration. Project buttons are absent and a footnote says where to turn prompting on."],
      ["(c) after Allow once on the CDN", () => lv(lvBar({ value: "index.html", restricted: true }), egressDone(), pageFrame("styled", { sandbox: SB_RESTRICTED, size: "short", title: "Page with CDN allowed" })), "The banner collapses to a success pill naming the origin. Dismiss removes it."],
    ] },

  { id: "s4-rendered-page", title: "Rendered page inside the frame", icon: "LanguageHtml5",
    lead: "A local `.html` file opens through `srcdoc` with no base URL and no scripts, so relative CSS and images fail and the page renders unstyled. Proposed: the file is served as a static target, assets resolve and scripts run in the opaque-origin sandbox.",
    cites: [["HtmlPreview.tsx:71-77", "srcdoc iframe"], ["HtmlPreview.tsx:73", "sandbox=allow-same-origin"]],
    finds: [["R1", "`<iframe sandbox=\"allow-same-origin\" srcDoc>` has no base URL: `css/login.css` and `assets/logo.svg` resolve against `about:srcdoc` and 404."],
      ["R2", "No scripts run, so JS-built UI and CDN tailwind are inert."],
      ["R3", "The broken logo shows alt text, the layout is the browser default (Times, no grid, full-width inputs)."]],
    realizes: ["HTML preview is sandboxed without script execution", "Static targets resolve a capped document root", "Static targets serve only contained web assets", "Capability responses enforce the sandbox themselves"],
    built: () => `<div class="astate"><p class="src"><code>srcdoc, no base URL, no scripts</code></p><div class="demo" style="border:0">${pageFrame("plain", { sandbox: SB_BUILT, size: "tall", title: "As-built render" })}</div></div>`,
    states: [["served static target, assets resolve", () => lv(lvBar({ value: "index.html" }), pageFrame("styled", { sandbox: SB_LIVE, size: "tall", title: "Proposed render" })), "Same file. The iframe keeps `allow-scripts allow-forms allow-popups allow-downloads` and no `allow-same-origin`."]] },

  { id: "s5-target-picker", title: "Target picker", icon: "FormatListBulleted",
    lead: "The picker lists every persisted target. Nine are dead ephemeral ports from earlier automatic launches; the one live port (54321) sits unmarked among twelve rows, each labelled with its own address. Proposed: the active canvas target first, targets you added next, everything else under a collapsed Older targets disclosure. Clear all asks for confirmation inline. Every row can be removed.",
    cites: [["LiveServerViewer.tsx:92-97", "list on mount"], ["LiveServerViewer.tsx:249-271", "Saved targets"], ["live-server-manager.ts:32-50", "never pruned"]],
    finds: [["P1", "Saved targets is a flat list of everything ever launched (`:249-271`). Dead ports are indistinguishable from the live one."],
      ["P2", "The default label is `host:port` (`live-server-manager.ts:64`), so each row prints the address twice."],
      ["P3", "No remove control, though `DELETE /api/live-server/:id` exists (`live-server-routes.ts:91-99`)."],
      ["P4", "Preview button `bg-[var(--accent-blue)] text-white` is 3.68:1. Error is `--accent-red` text."]],
    realizes: ["The target picker leads with live targets", "Targets SHALL be loopback-only and allowlisted (SSRF guard)"],
    built: () => `<div class="astate"><p class="src"><code>picker screen</code>after submitting a remote address</p><div class="demo" style="border:0">${pickerBuilt()}</div></div>`,
    states: [
      ["(a) older targets collapsed", () => pickerProp(false), "The live target is first, with a dot and a Live word. Remove is a 28 px icon button, `aria-label` names the target."],
      ["(b) older targets expanded", () => pickerProp(true), "Clear all is a destructive tint action inside the disclosure body, not in the summary. The group is renamed to cover targets persisted before this update."],
      ["(c) Clear all, inline confirm", () => pickerProp(true, true), "Clear all swaps for a confirm row: the question, Remove (destructive tint) and Cancel. Nothing is deleted until Remove. Removing revokes the targets' capabilities and deletes their allowlist entries."],
    ] },

  { id: "s6-access-row", title: "Settings, Access: preview egress group", icon: "ShieldLockOutline",
    lead: "Project egress grants live in dashboard config, so they need a review and revoke path like every other grant store. Proposed: a new Preview egress origins group in the existing Access list, one row per origin with its project and a Revoke button.",
    cites: [["AccessSection.tsx:38-47", "STORE_LABEL_EN"], ["AccessSection.tsx:231-311", "group + entry rows"]],
    finds: [["A1", "No store covers `previewEgress`, so a grant made from the banner can never be reviewed or revoked."],
      ["A2", "Existing groups use `text-xs font-bold uppercase tracking-wide text-[var(--text-tertiary)]` headings (`:233`), which the contract retires (section heading recipe is 12 px semibold `--text-secondary`)."],
      ["A3", "Revoke is a 30 px bordered button, `aria-label` already names the subject."]],
    realizes: ["Unified Access settings surface", "Revoking a preview-egress grant takes effect on the next preview load", "Project egress grants use the preview-egress access plane"],
    built: () => `<div class="astate"><p class="src"><code>AccessSection</code>existing groups only</p><div class="demo" style="border:0">${acBuilt()}</div></div>`,
    states: [["new store group", () => acProp(), "Row anatomy mirrors the existing entries (subject, meta line, Revoke). Heading and meta use contract tokens; the other groups are not redrawn and stay as shipped."]] },

  { id: "s7-composition", title: "Full composition", icon: "DockWindow",
    lead: "Split workspace after the agent declares a mockup and the canvas auto-opens it: the active canvas card in chat on the left; the editor pane on the right with the live tab, address bar with the Restricted pill, an allowed-once confirmation and the styled page.",
    cites: [["ToolCallStep.tsx:177-250", "card"], ["EditorTabs.tsx:135-215", "tab strip"], ["LiveServerViewer.tsx:167-207", "framed viewer"]],
    finds: [["C1", "Today the same flow shows `{\"ok\":true}` in chat and a bare unstyled page in the pane, with no way to move to a sibling page."]],
    realizes: ["CanvasToolRenderer shows the declared target", "Only the active canvas card opens its target", "The viewer header is an editable address bar", "Egress policy is fixed by provenance", "The viewer offers non-modal enablement for blocked origins", "Static targets resolve a capped document root"],
    solo: true,
    built: () => "",
    states: [["proposed, full width", () => composition(), "The tab strip is the existing `EditorTabs` look; the live tab shows its close button always (24 px target) instead of on hover."]] },
];
