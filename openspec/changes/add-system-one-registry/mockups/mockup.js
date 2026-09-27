// Mockup behaviour for the Decision models settings section. Data mirrors the
// spec catalog (system-one-settings-ui) and config shape (system-one-config).
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const icon = (id, cls = "ic sm") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const fmt = (n) => (n == null ? null : n.toLocaleString("en-US"));

// ---------- data ----------
const backends = {
  jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0", off: true, why: "hosted",
    caps: { ctx: 32000, opts: 255, lang: "en-first" }, price: 0.042, keyRef: "TYPESAFE_API_KEY" },
  von: { kind: "managed", engine: "von", model: "von-1.2", port: 18400, off: false, why: "loopback",
    caps: { ctx: 8192, opts: null, lang: "en" }, status: "ready", pid: 48213, rss: "412 MB", up: "2 h 14 min", health: "12 s ago" },
  laya: { kind: "managed", engine: "laya", model: "laya-multilingual", port: 18401, off: false, why: "loopback",
    caps: { ctx: 1024, opts: null, lang: "multi" }, status: "starting", elapsed: 42, budget: 120 },
  "laya-typed": { kind: "managed", engine: "laya", model: "laya-typed-decisions", port: 18402, off: false, why: "loopback",
    caps: { ctx: 1024, opts: null, lang: "en" }, status: "failed", reason: "port-in-use: 18402 is used by another process" },
  "kev-mac": { kind: "http", url: "http://127.0.0.1:18480/v1/systemone", model: "kev", off: false, why: "loopback (user-declared)",
    caps: { ctx: null, opts: null, lang: "en" } },
  fast: { kind: "llm", role: "@fast", resolves: "anthropic/claude-haiku-4-5", off: true, why: "cloud model",
    caps: { ctx: null, opts: null, lang: null }, timeout: "15 s" },
};
const presets = {
  "local-only": { chain: ["von", "laya", "kev-mac"] },
  hosted: { chain: ["jev", "fast"] },
};
const consumers = [
  { id: "system-one:selftest", policy: "fail-closed", requires: {}, fixtures: "bundled · 12 cases", cases: 12, override: null,
    calib: { von: { mode: "shadow", model: "von-1.2", at: "3 days ago" } } },
  { id: "context-manager:is_lesson", policy: "fail-open", requires: { primitives: "noul" }, fixtures: "~/.pi/agent/context-manager/fixtures/is_lesson.json · 40 cases",
    cases: 40, override: ["von", "fast"], calib: {} },
  { id: "pi-warden:tool-risk", policy: "fail-closed", requires: { minContextTokens: 4000, maxOptions: 60 },
    fixtures: "~/.pi/agent/pi-warden/fixtures/tool-risk.json · 180 cases", cases: 180, override: null, calib: { jev: { mode: "enforce", model: "jev-1.13.0", at: "12 days ago" } } },
  { id: "fleet:should-escalate", policy: "fail-open", requires: { languages: "en" }, fixtures: "~/.pi/agent/fleet/escalate.json", missing: "fixtures file not found",
    cases: 0, override: null, calib: {} },
];

const state = {
  allowOff: false, active: "local-only", runtime: "ok", key: "none", conflict: false,
  dirty: new Set(), saveError: false, showIncompat: {}, test: {},
};
const saved = JSON.stringify({ allowOff: false, active: "local-only", presets, ov: consumers.map((c) => c.override) });

// ---------- rules ----------
const usable = (id) => !!backends[id] && (!backends[id].off || state.allowOff) && effStatus(id) !== "unavailable";
function effStatus(id) {
  const b = backends[id];
  if (b.kind !== "managed") return null;
  if (state.runtime === "windows") return "unsupported-platform";
  if (state.runtime === "uv-missing") return "unavailable";
  return b.status;
}
function incompatReason(c, id) {
  const cap = backends[id].caps, r = c.requires, out = [];
  if (r.minContextTokens && cap.ctx != null && cap.ctx < r.minContextTokens) out.push(`context ${fmt(cap.ctx)} < ${fmt(r.minContextTokens)}`);
  if (r.maxOptions && cap.opts != null && cap.opts < r.maxOptions) out.push(`options ${cap.opts} < ${r.maxOptions}`);
  if (r.languages && cap.lang && !cap.lang.startsWith(r.languages) && cap.lang !== "multi") out.push(`language ${cap.lang}`);
  return out.join(", ");
}
function markDirty() {
  const now = JSON.stringify({ allowOff: state.allowOff, active: state.active, presets, ov: consumers.map((c) => c.override) });
  state.dirty = now === saved ? new Set() : new Set(["Decision models"]);
  state.saveError = false;
  renderSavebar();
}
const announce = (t) => { $("#live").textContent = t; };

// ---------- badges ----------
function egressBadge(id) {
  const b = backends[id];
  return b.off
    ? `<span class="badge off">${icon("i-cloud")}Off-machine · ${esc(b.why)}</span>`
    : `<span class="badge on">${icon("i-home")}On-machine · ${esc(b.why)}</span>`;
}
function kindLabel(b) {
  if (b.kind === "managed") return `managed ${b.engine} · ${b.model}`;
  if (b.kind === "http") return `http · ${b.model}`;
  return `chat role ${b.role} → ${b.resolves}`;
}

// ---------- S1 switch ----------
function renderSwitch() {
  const sw = $("#sw-off");
  sw.setAttribute("aria-checked", String(state.allowOff));
  $("#sw-off-desc").innerHTML = state.allowOff
    ? "<strong>On.</strong> Session text may be sent to hosted backends (TypeSafe Jev) and to chat roles that resolve to cloud models. Local backends are still tried first when they lead the chain."
    : "<strong>Off.</strong> Session text is only sent to backends on this machine (127.0.0.1). Off-machine backends are skipped and cannot be tested.";
}

// ---------- S2 presets + default chain ----------
function renderPresets() {
  $("#preset-list").innerHTML = Object.entries(presets).map(([name, p]) => `
    <label class="preset">
      <input type="radio" name="preset" value="${esc(name)}" ${name === state.active ? "checked" : ""}>
      <span><span class="preset-name">${esc(name)}</span>
      <span class="preset-chain">${p.chain.map(esc).join(" → ") || "empty"}</span></span>
    </label>`).join("");
  const chain = presets[state.active].chain;
  const anyUsable = chain.some(usable);
  $("#preset-warning").innerHTML = anyUsable ? "" : `
    <div class="callout warning">${icon("i-warn", "ic")}<div class="callout-body">
      <p><strong>No backend in “${esc(state.active)}” can be used right now.</strong>
      ${chain.map((id) => `<code>${esc(id)}</code>`).join(" and ")} ${chain.length > 1 ? "are" : "is"} off-machine, and off-machine use is off. Every question will return <code>no-backend</code>.</p>
      <div class="radio-row"><button type="button" class="btn sm" data-act="allow-off">Allow off-machine backends</button>
      <button type="button" class="btn sm" data-act="to-local">Switch to local-only</button></div>
    </div></div>`;
  $("#chain-preset-name").textContent = state.active;
  $("#default-chain").innerHTML = chainEditor(chain, "default", null);
}

function chainEditor(chain, key, consumer) {
  const rows = chain.map((id, i) => {
    const u = usable(id);
    const why = !u ? (backends[id].off ? "skipped: off-machine use is off" : "skipped: runtime unavailable") : "";
    return `<li class="${u ? "" : "unusable"}">
      <span class="pos">${i + 1}</span>
      <span class="bk">${esc(id)}</span>${egressBadge(id)}
      ${why ? `<span class="hint">${why}</span>` : ""}
      <span class="ctrls">
        <button type="button" class="icon-btn" data-chain="${key}" data-op="up" data-i="${i}" aria-label="Move ${esc(id)} up" ${i === 0 ? "disabled" : ""}>${icon("i-up", "ic")}</button>
        <button type="button" class="icon-btn" data-chain="${key}" data-op="down" data-i="${i}" aria-label="Move ${esc(id)} down" ${i === chain.length - 1 ? "disabled" : ""}>${icon("i-down", "ic")}</button>
        <button type="button" class="icon-btn" data-chain="${key}" data-op="rm" data-i="${i}" aria-label="Remove ${esc(id)} from chain" ${chain.length === 1 ? "disabled" : ""}>${icon("i-x", "ic")}</button>
      </span></li>`;
  }).join("");
  const candidates = Object.keys(backends).filter((id) => !chain.includes(id));
  let hidden = 0;
  const opts = candidates.map((id) => {
    const inc = consumer ? incompatReason(consumer, id) : "";
    if (inc && !state.showIncompat[consumer.id]) { hidden++; return ""; }
    const offDis = backends[id].off && !state.allowOff;
    const note = [inc && `incompatible: ${inc}`, offDis && "off-machine, disabled"].filter(Boolean).join("; ");
    return `<option value="${esc(id)}" ${offDis ? "disabled" : ""}>${esc(id)}${note ? ` (${note})` : ""}</option>`;
  }).join("");
  const incToggle = consumer && candidates.some((id) => incompatReason(consumer, id)) ? `
    <label class="check-row"><input type="checkbox" data-incompat="${esc(consumer.id)}" ${state.showIncompat[consumer.id] ? "checked" : ""}>
      Show incompatible backends${hidden ? ` (${hidden} hidden)` : ""}</label>` : "";
  const incWarn = consumer && state.showIncompat[consumer.id] ? `<p class="hint">${icon("i-warn")} Incompatible backends are likely to fail or error on this consumer's questions; the chain then falls through.</p>` : "";
  const sel = `sel-${key.replace(/[^a-z0-9]/gi, "-")}`;
  return `<ol class="chain" aria-label="Chain order">${rows}</ol>
    <div class="chain-add">
      <label class="sr-only" for="${sel}">Backend to add</label>
      <select class="input" id="${sel}">${opts || "<option disabled>No more backends</option>"}</select>
      <button type="button" class="btn" data-chain="${key}" data-op="add" data-sel="${sel}" ${opts ? "" : "disabled"}>Add to chain</button>
      ${incToggle}
    </div>${incWarn}`;
}

function chainFor(key) {
  if (key === "default") return presets[state.active].chain;
  return consumers.find((c) => c.id === key).override;
}
function chainOp(btn) {
  const key = btn.dataset.chain, op = btn.dataset.op, i = +btn.dataset.i, chain = chainFor(key);
  let focusSel = null;
  if (op === "up" || op === "down") {
    const j = op === "up" ? i - 1 : i + 1;
    [chain[i], chain[j]] = [chain[j], chain[i]];
    // Keep focus on the moved item; at a boundary its same-direction control is disabled, so use the other one.
    const other = op === "up" ? "down" : "up";
    focusSel = `[data-chain="${key}"][data-op="${op}"][data-i="${j}"]:not([disabled]), [data-chain="${key}"][data-op="${other}"][data-i="${j}"]`;
    announce(`${chain[j]} moved to position ${j + 1} of ${chain.length}`);
  } else if (op === "rm") {
    const [gone] = chain.splice(i, 1);
    announce(`${gone} removed from chain`);
  } else if (op === "add") {
    const v = $("#" + btn.dataset.sel).value;
    if (!v || !backends[v]) return;
    chain.push(v);
    announce(`${v} added at position ${chain.length}`);
  }
  markDirty();
  renderAll();
  const f = (focusSel && document.querySelector(focusSel)) || null;
  if (f && !f.disabled) f.focus();
  else (document.querySelector(`[data-chain="${key}"][data-op="add"]`) || document.body).focus();
}

// ---------- S3 backends ----------
function statusLine(id) {
  const b = backends[id], st = effStatus(id);
  if (!st) return "";
  if (st === "ready") return `<span class="status st-ready"><span class="shape"></span>Ready</span>
    <span class="meta"><span>PID ${b.pid}</span><span>${b.rss}</span><span>up ${b.up}</span><span>health ${b.health}</span><span>port ${b.port}</span></span>`;
  if (st === "starting") return `<span class="status st-starting"><span class="shape"></span>Starting · downloading weights (first run)</span>
    <span class="meta"><span>${b.elapsed} s of ${b.budget} s</span><span>port ${b.port}</span></span>`;
  if (st === "failed") return `<span class="status st-failed"><span class="shape"></span>Failed</span><span class="meta"><span>${esc(b.reason)}</span></span>`;
  if (st === "unavailable") return `<span class="status st-unavailable"><span class="shape"></span>Unavailable · uv not on PATH</span>`;
  return `<span class="status st-unavailable"><span class="shape"></span>Unsupported on Windows</span>`;
}
function managedActions(id) {
  const st = effStatus(id), n = esc(id);
  const off = st === "unavailable" || st === "unsupported-platform";
  if (st === "ready" || st === "starting") return `<button type="button" class="btn sm" aria-label="Stop ${n}">Stop</button>
    <button type="button" class="btn sm" aria-label="Show log for ${n}">Log</button>`;
  return `<button type="button" class="btn sm" aria-label="Start ${n}" ${off ? "disabled" : ""}>Start</button>
    ${st === "failed" ? `<button type="button" class="btn sm" aria-label="Show last 50 log lines for ${n}">Log</button>` : ""}`;
}
function caps(b) {
  const c = b.caps, cell = (label, v) => `<div><dt>${label}</dt><dd class="${v == null ? "unknown" : ""}">${v == null ? "unknown" : esc(v)}</dd></div>`;
  return `<dl class="caps">${cell("context", c.ctx && `${fmt(c.ctx)} tokens`)}${cell("options", c.opts)}${cell("language", c.lang)}
    ${b.price ? cell("price", `$${b.price} / M tokens (estimated)`) : ""}${b.timeout ? cell("timeout", b.timeout) : ""}</dl>`;
}
function keyBox(id) {
  const b = backends[id];
  if (!b.keyRef) return "";
  if (state.key === "env") return `<div class="keybox"><span class="key-state">${icon("i-key")}<code>${b.keyRef}</code> <strong>set</strong> · from environment variable</span>
    <span class="hint">To change it, edit your shell environment and restart the dashboard.</span></div>`;
  const set = state.key === "file";
  return `<form class="keybox" data-keyform="${esc(id)}">
    <span class="key-state">${icon("i-key")}<code>${b.keyRef}</code> <strong>${set ? "set" : "not set"}</strong>${set ? " · stored in <code>~/.pi/agent/system-one/auth.json</code>" : ""}</span>
    <div class="field"><label class="field-label" for="key-${esc(id)}">${set ? "Replace key" : "API key"}</label>
      <input class="input" id="key-${esc(id)}" type="password" autocomplete="off" spellcheck="false" placeholder="${set ? "Paste a new key to replace" : "Paste key"}"></div>
    <button type="submit" class="btn">${set ? "Replace key" : "Save key"}</button>
    <p class="hint">Saved immediately, not with the Save bar. The key is never shown again.</p></form>`;
}
function renderBackends() {
  $("#runtime-callout").innerHTML = state.runtime === "uv-missing"
    ? `<div class="callout warning">${icon("i-warn", "ic")}<div class="callout-body"><p><strong>Managed backends need uv.</strong> Install it, then reload this page: <code>curl -LsSf https://astral.sh/uv/install.sh | sh</code></p></div></div>`
    : state.runtime === "windows"
      ? `<div class="callout info">${icon("i-warn", "ic")}<div class="callout-body"><p><strong>Managed backends are not supported on Windows yet.</strong> Run Von or Laya yourself and add it as an HTTP endpoint. Prefer an environment variable for API keys on Windows; file permissions there are advisory.</p></div></div>`
      : "";
  $("#backend-list").innerHTML = Object.keys(backends).map((id) => {
    const b = backends[id];
    return `<li class="row">
      <div class="row-top"><span class="row-name">${esc(id)}</span>${egressBadge(id)}
        <span class="row-actions">${b.kind === "managed" ? managedActions(id) : ""}
          <button type="button" class="btn sm" aria-label="Edit ${esc(id)}">Edit</button></span></div>
      <p class="meta"><span class="mono">${esc(kindLabel(b))}</span>${b.url ? `<span class="mono">${esc(b.url)}</span>` : ""}</p>
      ${statusLine(id) ? `<div class="row-top">${statusLine(id)}</div>` : ""}
      ${b.status === "starting" && effStatus(id) === "starting" ? `<div class="progress" role="progressbar" aria-label="${esc(id)} start budget" aria-valuemin="0" aria-valuemax="${b.budget}" aria-valuenow="${b.elapsed}"><span style="width:${(b.elapsed / b.budget) * 100}%"></span></div>` : ""}
      ${caps(b)}${keyBox(id)}</li>`;
  }).join("");
}

// ---------- S4 consumers ----------
function calibLine(c) {
  const e = Object.entries(c.calib);
  if (!e.length) return "Not measured on any backend. Answers are advisory (shadow).";
  return e.map(([bk, r]) => `${r.mode === "enforce" ? "<strong>enforce</strong>" : "shadow"} on <code>${esc(bk)}</code> (${esc(r.model)}, ${esc(r.at)})`).join(" · ");
}
function testPanel(c) {
  const t = state.test[c.id] || {};
  if (c.missing) return `<div class="callout warning">${icon("i-warn", "ic")}<div class="callout-body"><p><strong>Test unavailable:</strong> ${esc(c.missing)}. The consumer declared <code>${esc(c.fixtures)}</code>.</p></div></div>`;
  const opts = Object.keys(backends).map((id) => {
    const dis = (backends[id].off && !state.allowOff) || !usable(id);
    return `<option value="${esc(id)}" ${dis ? "disabled" : ""} ${t.backend === id ? "selected" : ""}>${esc(id)}${dis ? (backends[id].off ? " (off-machine, disabled)" : " (not running)") : ""}</option>`;
  }).join("");
  const n = Math.min(c.cases, 500);
  let body = "";
  if (t.running) body = `<div class="progress" role="progressbar" aria-label="Test progress" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${t.done}"><span style="width:${(t.done / n) * 100}%"></span></div>
    <p class="hint">${t.done} / ${n} cases on <code>${esc(t.backend)}</code></p>`;
  if (t.result) body = resultsTable(c, t);
  return `<div class="test-bar">
      <div class="field"><label class="field-label" for="tb-${esc(c.id)}">Backend to test</label><select class="input" id="tb-${esc(c.id)}" ${t.running ? "disabled" : ""}>${opts}</select></div>
      ${t.running ? `<button type="button" class="btn" data-cancel="${esc(c.id)}">Cancel</button>` : `<button type="button" class="btn" data-run="${esc(c.id)}">Run Test (${n} cases)</button>`}
    </div>${body}`;
}
function resultsTable(c, t) {
  const b = backends[t.backend];
  const rows = c.id === "pi-warden:tool-risk"
    ? [["risk_level (pick 1 of 60)", "0.81", "n/a", 112, 240]]
    : [["is_lesson (noul)", "0.88", "0.93", 38, 71], ["is_duplicate (noul)", "0.79", "0.86", 36, 69]];
  const chars = c.cases * 1535;
  const cost = b.price ? `$${((b.price * chars) / 4 / 1e6).toFixed(4)} (estimated)` : "none (on-machine)";
  return `<div class="tablewrap"><table class="results">
      <caption>Results · ${esc(t.backend)} answered as <code>${esc(b.model || b.resolves)}</code></caption>
      <thead><tr><th scope="col">Question</th><th scope="col">Accuracy</th><th scope="col">AUC</th><th scope="col">p50</th><th scope="col">p90</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]} ms</td><td>${r[4]} ms</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="5">${c.cases} cases · ${fmt(chars)} input chars · cost ${cost}</td></tr></tfoot></table></div>
    <fieldset class="subpanel" style="border:0;padding:0;margin:0">
      <legend class="field-label">Save calibration for <code>${esc(t.backend)}::${esc(c.id)}</code></legend>
      <div class="calib">
        <div class="radio-row" role="radiogroup" aria-label="Mode">
          <label><input type="radio" name="mode-${esc(c.id)}" value="shadow" checked> Shadow <span class="hint">log answers, act on none</span></label>
          <label><input type="radio" name="mode-${esc(c.id)}" value="enforce"> Enforce <span class="hint">the feature acts on answers</span></label>
        </div>
        <button type="button" class="btn" data-savecal="${esc(c.id)}">Save calibration</button>
      </div>
      <p class="hint">Thresholds from this run: ${rows.map((r) => `${r[0].split(" ")[0]} ≥ 0.${70 + rows.indexOf(r) * 4}`).join(", ")}. Saved immediately.</p>
    </fieldset>`;
}
function renderConsumers() {
  const open = new Set([...document.querySelectorAll(".consumer[open]")].map((d) => d.dataset.id));
  if (!document.querySelector(".consumer")) open.add("context-manager:is_lesson");
  $("#consumer-list").innerHTML = consumers.map((c) => {
    const req = Object.entries(c.requires).map(([k, v]) => `${k}: ${v}`).join(", ") || "none";
    const llmWarn = c.policy === "fail-open" && c.override && c.override.some((id) => backends[id].kind === "llm");
    const status = c.missing ? "Test unavailable" : Object.values(c.calib).some((r) => r.mode === "enforce") ? "enforce" : "shadow";
    return `<details class="consumer" data-id="${esc(c.id)}" ${open.has(c.id) ? "open" : ""}>
      <summary><span class="cid">${esc(c.id)}</span><span class="badge">${esc(c.policy)}</span>
        ${llmWarn ? `<span class="badge off">${icon("i-warn")}slow fallback</span>` : ""}
        <span class="sum-meta">${c.override ? "override chain" : "preset chain"} · ${status}</span></summary>
      <div class="consumer-body">
        <dl class="decl"><dt>Failure policy</dt><dd>${esc(c.policy)}</dd><dt>Requires</dt><dd>${esc(req)}</dd>
          <dt>Fixtures</dt><dd class="mono">${esc(c.fixtures)}</dd><dt>Calibration</dt><dd>${calibLine(c)}</dd></dl>
        <fieldset class="subpanel" style="border:0;padding:0;margin:0">
          <legend class="sub-title" style="margin:0">Chain</legend>
          <div class="radio-row">
            <label><input type="radio" name="ov-${esc(c.id)}" value="preset" data-ov="${esc(c.id)}" ${c.override ? "" : "checked"}> Use preset (${esc(state.active)})</label>
            <label><input type="radio" name="ov-${esc(c.id)}" value="own" data-ov="${esc(c.id)}" ${c.override ? "checked" : ""}> Override for this consumer</label>
          </div>
          ${c.override ? chainEditor(c.override, c.id, c) : `<p class="hint">${presets[state.active].chain.map(esc).join(" → ")}</p>`}
          ${llmWarn ? `<div class="callout warning">${icon("i-warn", "ic")}<div class="callout-body"><p><strong>This consumer is fail-open and its chain includes a chat model.</strong> A chat role can take up to 15 s per question. Remove <code>fast</code> if this runs on a hot path.</p></div></div>` : ""}
        </fieldset>
        <section class="subpanel" aria-label="Test ${esc(c.id)}"><h3 class="sub-title" style="margin:0">Test</h3>${testPanel(c)}</section>
      </div></details>`;
  }).join("");
}

// ---------- Save Bar ----------
function renderSavebar() {
  const bar = $("#savebar");
  if (!state.dirty.size && !state.saveError) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.classList.toggle("error", state.saveError);
  if (state.saveError) {
    $("#savebar-msg").innerHTML = `${icon("i-err", "ic")}<span><strong>Not saved.</strong> system-one.json changed on disk after this page loaded (a managed backend saved its port). Reload to get the current file, then redo your edits.</span>`;
    $("#savebar-actions").innerHTML = `<button type="button" class="btn" data-act="discard">Discard my edits</button><button type="button" class="btn primary" data-act="reload">Reload</button>`;
  } else {
    $("#savebar-msg").innerHTML = `<span>Unsaved changes on 1 page: <strong>Decision models</strong></span>`;
    $("#savebar-actions").innerHTML = `<button type="button" class="btn" data-act="discard">Discard</button><button type="button" class="btn primary" data-act="save">Save</button>`;
  }
}

function renderAll() { renderSwitch(); renderPresets(); renderBackends(); renderConsumers(); renderSavebar(); }

// ---------- dialogs ----------
let lastFocus = null;
function openDialog(id) {
  lastFocus = document.activeElement;
  const s = $("#" + id); s.hidden = false;
  const first = s.querySelector("#confirm-cancel, input:checked, input, button");
  first && first.focus();
}
function closeDialog(id) { $("#" + id).hidden = true; lastFocus && lastFocus.focus(); }
function trap(e) {
  const s = [...document.querySelectorAll(".scrim")].find((x) => !x.hidden);
  if (!s) return;
  if (e.key === "Escape") { closeDialog(s.id); return; }
  if (e.key !== "Tab") return;
  const f = [...s.querySelectorAll("button, input, select")].filter((x) => !x.disabled && x.offsetParent);
  const a = f[0], z = f[f.length - 1];
  if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); }
}
let pendingCal = null;

// ---------- events ----------
document.addEventListener("keydown", trap);
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id === "sw-off") { state.allowOff = !state.allowOff; markDirty(); renderAll(); $("#sw-off").focus(); return; }
  if (t.dataset.chain) return chainOp(t);
  const act = t.dataset.act;
  if (act === "allow-off") { state.allowOff = true; markDirty(); renderAll(); $("#sw-off").focus(); }
  if (act === "to-local") { state.active = "local-only"; markDirty(); renderAll(); $('input[name="preset"]:checked').focus(); }
  if (act === "save") {
    if (state.conflict) { state.saveError = true; renderSavebar(); announce("Save failed: file changed on disk"); }
    else { state.dirty.clear(); renderSavebar(); announce("Saved"); }
  }
  if (act === "discard" || act === "reload") location.reload();
  if (t.dataset.run) {
    const c = consumers.find((x) => x.id === t.dataset.run);
    const bk = $("#tb-" + CSS.escape(c.id)).value;
    const n = Math.min(c.cases, 500);
    const run = (state.test[c.id] = { backend: bk, running: true, done: 0 });
    renderConsumers();
    run.timer = setInterval(() => {
      run.done = Math.min(n, run.done + Math.ceil(n / 8));
      if (run.done >= n) { clearInterval(run.timer); run.running = false; run.result = true; announce(`Test finished on ${bk}`); }
      renderConsumers();
      if (!run.running) { const b = document.querySelector(`[data-savecal="${CSS.escape(c.id)}"]`); b && b.focus(); }
    }, 350);
  }
  if (t.dataset.cancel) {
    const run = state.test[t.dataset.cancel]; clearInterval(run.timer); state.test[t.dataset.cancel] = { backend: run.backend };
    announce("Test cancelled"); renderConsumers();
  }
  if (t.dataset.savecal) {
    const c = consumers.find((x) => x.id === t.dataset.savecal), bk = state.test[c.id].backend;
    const mode = document.querySelector(`input[name="mode-${CSS.escape(c.id)}"]:checked`).value;
    if (mode === "shadow") { c.calib[bk] = { mode: "shadow", model: backends[bk].model || backends[bk].resolves, at: "just now" }; announce("Calibration saved as shadow"); renderConsumers(); return; }
    pendingCal = { c, bk };
    const model = backends[bk].model || backends[bk].resolves;
    $("#confirm-title").textContent = `Enforce ${bk} for ${c.id}?`;
    $("#confirm-body").innerHTML = `<p><strong>${esc(c.id)}</strong> will act on answers from <strong>${esc(bk)}</strong>, model <strong>${esc(model)}</strong>.</p>
      <p>Enforcement stops on its own if the backend starts answering with a different model version. You can switch back to shadow at any time.</p>`;
    openDialog("confirm");
  }
  if (t.id === "confirm-cancel") closeDialog("confirm");
  if (t.id === "confirm-ok") {
    const { c, bk } = pendingCal;
    c.calib[bk] = { mode: "enforce", model: backends[bk].model || backends[bk].resolves, at: "just now" };
    closeDialog("confirm"); renderConsumers(); announce(`Enforcing ${bk} for ${c.id}`);
  }
  if (t.id === "add-backend") openDialog("addbk");
  if (t.id === "addbk-cancel") closeDialog("addbk");
  if (t.id === "demo-theme") {
    const light = document.documentElement.dataset.theme !== "light";
    if (light) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    t.textContent = light ? "Switch to dark" : "Switch to light";
  }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "preset") { state.active = t.value; markDirty(); renderAll(); $(`input[name="preset"][value="${t.value}"]`).focus(); }
  if (t.dataset.incompat) { state.showIncompat[t.dataset.incompat] = t.checked; renderConsumers(); $(`[data-incompat="${CSS.escape(t.dataset.incompat)}"]`).focus(); }
  if (t.dataset.ov) {
    const c = consumers.find((x) => x.id === t.dataset.ov);
    // Seed from the preset chain, dropping backends this consumer cannot use.
    c.override = t.value === "own" ? presets[state.active].chain.filter((id) => !incompatReason(c, id)) : null;
    markDirty(); renderConsumers(); $(`input[name="ov-${CSS.escape(c.id)}"][value="${t.value}"]`).focus();
  }
  if (t.id === "demo-runtime") { state.runtime = t.value; renderAll(); }
  if (t.id === "demo-key") { state.key = t.value; renderBackends(); }
  if (t.id === "demo-conflict") state.conflict = t.checked;
  if (t.name === "kind") document.querySelectorAll("#addbk [data-kind]").forEach((f) => { f.hidden = f.dataset.kind !== t.value; });
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "bk-url") return;
  const v = e.target.value.trim();
  let msg = "Only http and https. Where the URL points decides on-machine vs off-machine.";
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) msg = "Only http and https URLs are accepted.";
    else msg = /^(127\.|localhost$|\[::1\]$)/.test(u.hostname) ? "On-machine: loopback address (you declare this server runs here)." : "Off-machine: this host is not loopback. It is skipped while off-machine use is off.";
  } catch { /* keep default */ }
  $("#bk-url-class").textContent = msg;
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "addbk-form") { closeDialog("addbk"); announce("Mockup: backend would be added"); return; }
  if (f.dataset.keyform) {
    const inp = f.querySelector("input");
    if (!inp.value) { inp.focus(); return; }
    inp.value = ""; state.key = "file"; $("#demo-key").value = "file"; renderBackends(); announce("Key saved");
  }
});

renderAll();
