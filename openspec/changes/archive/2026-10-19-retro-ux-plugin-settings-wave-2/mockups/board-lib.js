/* Board helpers. Each PROPOSED helper mirrors one runtime kit member
   (dashboard-plugin-runtime/src/settings-fields.tsx) or a NEW kit member from
   design.md D2 — the comment on each names it. Markup only; no behaviour. */
const ic = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n] || ""}"/></svg>`;
let uid = 0;
const nid = (p) => `${p}-${++uid}`;
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/* kit FieldShell — label row (htmlFor, unit chip, key, state pill, reset) → control → hint → error.
   beside = default (toggle/select/number); stacked = text inputs. */
function field({ label, unit, key, hint, control, error, state, reset, stacked, disabled }) {
  const id = nid("f"), hid = nid("h"), eid = nid("e");
  const desc = [hint ? hid : "", error ? eid : ""].filter(Boolean).join(" ");
  const ctl = control.replaceAll("%ID", id).replaceAll("%DESC", desc).replaceAll("%INV", error ? 'aria-invalid="true"' : "");
  const pill = state === "default" ? `<span class="pill neutral">Default</span>` : state === "changed" ? `<span class="pill info">Changed</span>` : "";
  const head = `<span class="sf-head"><label class="p-label" for="${id}">${label}${unit ? ` <span class="sf-unitchip">${unit}</span>` : ""}</label>${key ? `<code class="sf-key">${key}</code>` : ""}${pill}${reset ? `<button class="p-btn sm ghost">${ic("Restore")}Reset</button>` : ""}</span>`;
  return `<div class="sf-field ${stacked ? "stacked" : ""}" ${disabled ? 'style="opacity:.6"' : ""}>
    ${stacked ? `${head}<div class="sf-ctl">${ctl}</div>` : `<div class="sf-row">${head}${ctl}</div>`}
    ${hint ? `<p class="p-help sf-hint" id="${hid}">${hint}</p>` : ""}
    ${error ? `<p class="sf-err" id="${eid}" role="alert">${ic("AlertCircleOutline")}${error}</p>` : ""}
  </div>`;
}
/* kit ToggleField / NumberField / SelectField / TextField / TextAreaField controls */
const sw = (on, dis = false) => `<span class="inline-flex" style="display:inline-flex;gap:8px;align-items:center"><span class="sw-word" aria-hidden="true">${on ? "On" : "Off"}</span><button id="%ID" role="switch" class="sw" aria-checked="${on}" aria-describedby="%DESC" ${dis ? "disabled" : ""}></button></span>`;
const num = (v, dis = false) => `<input id="%ID" class="p-input num" inputmode="decimal" value="${v}" aria-describedby="%DESC" %INV ${dis ? "disabled" : ""}>`;
const sel = (opts, v) => `<select id="%ID" class="p-input" aria-describedby="%DESC">${opts.map((o) => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>`;
const txt = (v, ph = "", mono = false, type = "text") => `<input id="%ID" type="${type}" class="p-input wide ${mono ? "mono" : ""}" value="${esc(v)}" placeholder="${esc(ph)}" aria-describedby="%DESC" %INV>`;
const area = (v, ph = "", rows = 3) => `<textarea id="%ID" class="p-input" rows="${rows}" placeholder="${esc(ph)}" aria-describedby="%DESC" %INV>${esc(v)}</textarea>`;
const withBtn = (inputHtml, btnHtml) => `<div class="inline-ctl">${inputHtml.replace('class="p-input wide', 'class="p-input')}${btnHtml}</div>`;
/* custom FieldShell control: ModelSelector primitive trigger */
const model = (v, role = "") => `<span style="display:inline-flex;gap:6px;align-items:center"><button id="%ID" class="p-trigger secondary p-btn sm" aria-describedby="%DESC">${role ? `<span class="pill neutral">${role}</span>` : ""}<code>${v || "Select a model…"}</code>${ic("ChevronDown")}</button></span>`;

/* kit SettingsGroup */
const group = (title, body, { open = true, meta = "" } = {}) =>
  `<details class="sf-grp" ${open ? "open" : ""}><summary>${ic("ChevronRight", "chev")}${title}${meta ? `<span class="meta">${meta}</span>` : ""}</summary><div class="sf-body">${body}</div></details>`;
/* kit SettingsNotice */
const NOTICE_IC = { info: "InformationOutline", warning: "AlertOutline", error: "AlertCircleOutline", success: "CheckCircleOutline" };
const notice = (tone, html, actions = "") =>
  `<div class="callout ${tone}" ${tone === "error" ? 'role="alert"' : ""}>${ic(NOTICE_IC[tone])}<div class="body">${html}${actions ? `<div class="actions" style="margin-top:6px">${actions}</div>` : ""}</div></div>`;
/* NEW kit SettingsStatusPill — tone + icon + word (never colour alone) */
const PILL_IC = { success: "CheckCircleOutline", warning: "AlertOutline", error: "AlertCircleOutline", info: "InformationOutline", neutral: "" };
const pill = (tone, text, icon) => { const n = icon ?? PILL_IC[tone]; return `<span class="pill ${tone}">${n ? ic(n) : ""}${text}</span>`; };
const btn = (kind, label, icon = "", extra = "") => `<button class="p-btn ${kind}" ${extra}>${icon ? ic(icon) : ""}${label}</button>`;
/* NEW kit SettingsItem — repeatable entity card (profile, instance, server, binding) */
const item = ({ title, sub = "", pills = "", actions = "", body = "", collapsible = false, open = true }) => {
  const head = `<div class="ih">${collapsible ? ic("ChevronRight", "chev") : ""}<span class="grow"><span class="t">${title}</span>${sub ? `<br><span class="s">${sub}</span>` : ""}</span><span class="status-row">${pills}</span>${actions ? `<span class="actions">${actions}</span>` : ""}</div>`;
  const b = body ? `<div class="ib">${body}</div>` : "";
  return collapsible ? `<details class="item" ${open ? "open" : ""}><summary>${head}</summary>${b}</details>` : `<div class="item">${head}${b}</div>`;
};
/* NEW kit SettingsFacts — read-only term/value list */
const facts = (rows) => `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
/* NEW kit SettingsTable — read-only data table, scrolls horizontally */
const table = (heads, rows) => `<div class="tbl-wrap"><table class="st"><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const lead = (html) => `<p class="lead">${html}</p>`;
const sec = (t) => `<h4 class="sec">${t}</h4>`;
const savebar = (n) => n ? `<div class="savebar" role="region" aria-label="Unsaved settings"><span class="grow">${pill("warning", `${n} unsaved change${n > 1 ? "s" : ""}`)}</span>${btn("ghost", "Discard")}${btn("primary", "Save")}</div>` : "";

/* PROPOSED host chrome (PluginSettingsPage) — D5. */
function chrome({ title, id, icon = "PackageVariantClosed", on = true, status = "enabled", deps = [], requiredBy = [], claims = [], dev = false, banners = "", restart = false }) {
  // H2: healthy = no pill (compact-header precedent); only unhealthy states speak.
  const st = { enabled: "", error: pill("error", "Failed to load"), "not-loaded": pill("warning", "Not loaded"), disabled: pill("neutral", "Off"), req: pill("warning", "Needs setup") }[status];
  const swId = nid("en");
  const meta = deps.length || requiredBy.length ? `<div class="meta">${deps.length ? `<span>Needs ${deps.map((d) => `<code>${d}</code>`).join(" ")}</span>` : ""}${requiredBy.length ? `<span>Used by ${requiredBy.map((d) => `<code>${d}</code>`).join(" ")}</span>` : ""}</div>` : "";
  // D5: slot claims are developer data — rendered only when Settings ▸ Developer ▸ "Show plugin internals" is on.
  const details = dev && claims.length ? `<details class="more"><summary>${ic("ChevronRight", "chev")}Plugin internals</summary>${facts([["Plugin id", `<code>${id}</code>`], ["Contributes", claims.map((c) => `<code>${c}</code>`).join(" ")]])}</details>` : "";
  return `<a class="crumb" href="#">${ic("ArrowLeft")}Plugins</a>
  <section class="chrome" aria-labelledby="${swId}-t">
    <div class="top"><span class="ico">${ic(icon)}</span><span class="idn"><h3 id="${swId}-t">${title}</h3><span class="sub">${id}</span></span>${st}
      <span class="en"><label for="${swId}">Enabled</label><button id="${swId}" role="switch" class="sw" aria-checked="${on}"></button></span></div>
    ${meta}${banners ? `<div class="banners">${banners}</div>` : ""}${details}
  </section>${restart ? notice("warning", "Restart the dashboard to finish turning this plugin on.", btn("secondary sm", "Restart now", "Restart")) : ""}`;
}
const page = (chromeOpts, bodyHtml, dirty = 0) => `<div class="pg">${chrome(chromeOpts)}<div class="pbody">${bodyHtml}</div>${savebar(dirty)}</div>`;
