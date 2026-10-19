// Services settings mockup (add-services-settings-ui). Vanilla DOM; every string
// goes through textContent (logs render as text, never HTML — spec "Logs viewer").
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const announce = (msg) => { $("#announcer").textContent = ""; setTimeout(() => ($("#announcer").textContent = msg), 30); };

// ── API ─────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const r = await fetch(path.replace(/^\//, ""), { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw Object.assign(new Error(j.message ?? r.statusText), { status: r.status, body: j });
  return j.data;
}

// ── Vocabulary (design D9 + reason sentences; Nielsen #9 plain-language errors) ─
const STATE = {
  healthy:      { label: "Healthy",       sev: "success", shape: "circle" },
  idle:         { label: "Idle",          sev: "neutral", shape: "ring" },
  starting:     { label: "Starting",      sev: "info",    shape: "half" },
  stopping:     { label: "Stopping",      sev: "info",    shape: "half" },
  stopped:      { label: "Stopped",       sev: "neutral", shape: "square" },
  blocked:      { label: "Not responding",sev: "warning", shape: "diamond" },
  failed:       { label: "Failed",        sev: "error",   shape: "triangle" },
  "stop-failed":{ label: "Stop failed",   sev: "error",   shape: "triangle" },
  unavailable:  { label: "Unavailable",   sev: "error",   shape: "triangle" },
};
const REASON = {
  "runtime-missing": "No container runtime (Docker or Podman) is installed.",
  "runtime-unreachable": "The container runtime is installed but not running.",
  "host-vm-stopped": "The Podman/Docker machine VM is stopped.",
  "image-absent": "The container image is not on this machine. Starts never download it.",
  "runner-absent": "The runner (uvx or npx) is not installed.",
  "package-absent": "The package is not in the local cache. Starts never download it.",
  "secret-unavailable": "A required secret could not be read.",
  "unsupported-platform": "This service cannot run on this platform.",
  "invalid-definition": "The service definition is invalid.",
  "adoption-uncertain": "A process from before the restart is still running, but the dashboard cannot prove it is this service.",
  "owner-conflict": "A container with this name belongs to another dashboard install.",
  "duplicate-instances": "More than one container claims to be this service.",
};
const LOG_REASON = {
  external: "The dashboard does not run this service, so it has no output for it.",
  "not-started": "The service has not been started since output capture was enabled.",
  "no-output": "This instance was started before output capture existed. Restart it to capture output.",
  "secret-unavailable": "Logs are withheld: a secret of this service could not be read, so its value could not be redacted.",
};
const ATTENTION = new Set(["unavailable", "failed", "blocked", "stop-failed"]);
const RUNNING = new Set(["healthy", "idle", "starting", "stopping"]);
const shapeOf = (s) => STATE[s] ?? { label: s, sev: "neutral", shape: "square" };

function pill(state) {
  const v = shapeOf(state);
  return h("span", { class: "pill", "data-sev": v.sev, "data-state": state }, h("span", { class: "shape", "data-shape": v.shape, "aria-hidden": "true" }), v.label);
}
function relTime(isoStr) {
  const s = Math.round((new Date(isoStr).getTime() - Date.now()) / 1000);
  if (s <= 0) return "now";
  return s < 90 ? `in ${s} s` : `in ${Math.round(s / 60)} min`;
}

// ── Gating (design D9) ─────────────────────────────────────────────────────
function actionsFor(s) {
  const a = [];
  const st = s.state, r = s.reason;
  if (st === "stopped") a.push({ verb: "start", label: "Start", primary: true });
  if (st === "unavailable" && !["adoption-uncertain", "duplicate-instances", "owner-conflict", "package-absent"].includes(r)) a.push({ verb: "start", label: "Try again", primary: true });
  if (st === "failed") a.push({ verb: "retry", label: "Retry now", primary: true });
  if ((st === "unavailable" && r === "package-absent") || (st === "stopped" && s.driver === "native")) a.push({ verb: "prefetch", label: "Prefetch package", primary: st === "unavailable" });
  if (["starting", "healthy", "idle", "blocked", "stop-failed"].includes(st) && s.mode !== "external" && s.startedBy !== "external") a.push({ verb: "stop", label: "Stop" });
  if (s.mode === "managed") a.push(s.pinned ? { verb: "unpin", label: "Unpin" } : { verb: "pin", label: "Keep running (pin)" });
  return a;
}
const canForceStop = (s) => s.state === "stop-failed" || (s.state === "unavailable" && ["adoption-uncertain", "duplicate-instances"].includes(s.reason));
const canResetData = (s) => ["stopped", "unavailable"].includes(s.state);

// ── State ──────────────────────────────────────────────────────────────────
const store = { list: null, detail: null, offers: null, runtimes: null, role: "operate", err: null, logs: null, logTail: 200, actionErr: {} };
const readOnly = () => store.role !== "operate";

// ── Routing (/settings/services[/<id>], /settings/runtimes) ─────────────────
function route() {
  const p = (location.hash.replace(/^#/, "") || "/settings/services").split("/").filter(Boolean);
  return { page: p[1] ?? "services", id: p[1] === "services" ? p[2] : undefined };
}
const go = (path) => { location.hash = path; };

// ── Rail (as-built groups; Services group inserted after Network — D1) ─────
const RAIL = [
  ["Models", [["providers", "Providers"]]],
  ["Dashboard", [["general", "General"], ["server", "Server"], ["sessions", "Sessions"]]],
  ["Network", [["remote", "Remote Servers"], ["gateway", "Gateway"], ["security", "Security"], ["access", "Access"], ["vault", "Vault"]]],
  ["Services", [["services", "All services"], ["runtimes", "Runtimes"]]],
  ["Add-ons", [["add-ons", "Add-ons"], ["plugins", "Plugins"], ["openspec", "OpenSpec"]]],
  ["Resources", [["skills", "Skills"], ["agents", "Agents"], ["extensions", "Extensions"], ["prompts", "Prompts"], ["themes", "Themes"]]],
  ["Advanced", [["developer", "Developer"], ["instructions", "Instructions"]]],
];
function renderRail() {
  const { page } = route();
  const attention = (store.list?.services ?? []).filter((s) => ATTENTION.has(s.state)).length;
  $("#rail").replaceChildren(...RAIL.map(([g, items]) => h("div", { class: "rail-group", "data-testid": `settings-nav-group-${g.toLowerCase()}` },
    h("div", { class: "rail-group-label" }, g),
    items.map(([id, label]) => {
      const live = id === "services" || id === "runtimes";
      return h("button", { class: "rail-item focus-ring", type: "button", "aria-current": page === id ? "page" : null, disabled: !live, title: live ? null : "Not part of this mockup", onclick: () => live && go(`/settings/${id}`) },
        label,
        id === "services" && attention ? [h("span", { class: "dot", "aria-hidden": "true" }), h("span", { class: "sr-only" }, `${attention} need attention`)] : null);
    }))));
}

// ── Shared bits ─────────────────────────────────────────────────────────────
function readOnlyBanner() {
  return h("div", { class: "callout warning", role: "status" }, h("span", { class: "glyph", "aria-hidden": "true" }, "!"),
    h("div", {}, h("strong", {}, "View only. "), "Changing services needs operate authority. This browser is paired at a lower tier.",
      h("div", { class: "actions" },
        h("button", { class: "btn-secondary focus-ring", type: "button" }, "Open on the host machine"),
        h("button", { class: "btn-secondary focus-ring", type: "button" }, "Re-pair with operate"),
        h("button", { class: "btn-secondary focus-ring", type: "button" }, "Sign in"))));
}
function errorCallout(e) {
  if (e?.body?.error === "operate_required") return readOnlyBanner();
  return h("div", { class: "callout error inline-error", role: "alert" }, h("span", { class: "glyph", "aria-hidden": "true" }, "✕"),
    h("div", {}, h("strong", {}, e.body?.error ?? "error"), ": ", e.message));
}
function corruptBanners(list) {
  const out = [];
  if (list.definitionsCorrupt) out.push(h("div", { class: "callout error", role: "alert" }, h("span", { class: "glyph", "aria-hidden": "true" }, "✕"),
    h("div", {}, h("strong", {}, "services.json is unreadable. "), "Every change is refused until it is fixed. A byte-exact copy was kept at ", h("code", { class: "mono" }, list.backupPath), ".")));
  if (list.secretsCorrupt) out.push(h("div", { class: "callout error", role: "alert" }, h("span", { class: "glyph", "aria-hidden": "true" }, "✕"),
    h("div", {}, h("strong", {}, "The secret store is unreadable. "), "Services that need secrets cannot start. Backup: ", h("code", { class: "mono" }, list.secretsBackupPath), ".")));
  return out;
}

// ── List page ──────────────────────────────────────────────────────────────
let filterText = "";
function serviceRow(s) {
  const why = ATTENTION.has(s.state)
    ? h("div", { class: "svc-why" }, s.reason ? REASON[s.reason] ?? s.reason : s.state === "failed" ? ["Start failed. Next automatic retry ", h("span", { "data-retry": s.retryAt }, relTime(s.retryAt)), "."] : s.state === "blocked" ? "Running, but its health check keeps failing." : "Stop did not complete.")
    : h("div", { class: "svc-endpoint mono" }, Object.entries(s.endpoints ?? {}).map(([k, v]) => `${k} ${v}`).join("  ·  ") || "—");
  const leases = s.leases ? h("span", { class: "chip" }, `${s.leases} in use`) : null;
  return h("li", {},
    h("a", { class: "card svc-row focus-ring", href: `#/settings/services/${s.id}`, "data-testid": `service-row-${s.id}`, "aria-describedby": `why-${s.id}` },
      h("div", { class: "svc-name" }, h("strong", { class: "mono" }, s.id), s.updateAvailable ? h("span", { class: "chip tint-blue" }, "Update") : null, s.restartRequired ? h("span", { class: "chip tint-orange" }, "Restart to apply") : null),
      h("div", { class: "toolbar" }, pill(s.state), h("span", { class: "meta" }, s.driver ?? s.mode)),
      h("div", { id: `why-${s.id}` }, why),
      h("div", { class: "svc-end" }, s.pinned ? h("span", { class: "chip" }, "Pinned") : null, leases, s.exposure === "all-interfaces" ? h("span", { class: "chip tint-orange", title: "Reachable from other machines" }, "Network-exposed") : null, h("span", { class: "chev", "aria-hidden": "true" }, "›"))));
}
function renderList() {
  const list = store.list;
  const page = h("div", { class: "page" });
  page.append(h("div", {}, h("h2", { class: "page-title" }, "All services"),
    h("p", { class: "page-sub" }, "Long-running helpers that skills and plugins use, such as document converters and databases. The dashboard starts them on demand and stops idle ones.")));
  if (readOnly()) page.append(readOnlyBanner());
  if (!list) { page.append(h("p", { class: "meta" }, "Loading services…")); return page; }
  page.append(...corruptBanners(list));
  if (store.err) page.append(errorCallout(store.err));
  const services = list.services.filter((s) => !filterText || s.id.includes(filterText));
  const attention = services.filter((s) => ATTENTION.has(s.state));
  const running = services.filter((s) => RUNNING.has(s.state));
  const stopped = services.filter((s) => !ATTENTION.has(s.state) && !RUNNING.has(s.state));
  page.append(h("div", { class: "toolbar" },
    h("label", { class: "sr-only", for: "svc-filter" }, "Filter services"),
    h("input", { id: "svc-filter", class: "search focus-ring", type: "search", placeholder: "Filter by id", value: filterText, oninput: (e) => { filterText = e.target.value.trim(); render(); $("#svc-filter").focus(); } }),
    h("span", { class: "grow" }),
    h("button", { class: "btn-secondary focus-ring", type: "button", disabled: readOnly(), onclick: openPrune }, "Clean up leftovers…"),
    h("button", { class: "btn-primary focus-ring", type: "button", disabled: readOnly(), onclick: openAdd }, "Add service")));
  if (!list.services.length) {
    page.append(h("div", { class: "card empty" }, h("strong", {}, "No services yet"),
      h("p", { class: "meta" }, "Add one from an installed package, or from the command line: ", h("code", { class: "mono" }, "pi-dashboard service add <offer>")),
      h("button", { class: "btn-primary focus-ring", type: "button", onclick: openAdd, disabled: readOnly() }, "Add service")));
    return page;
  }
  for (const [title, items] of [["Needs attention", attention], ["Running", running], ["Stopped", stopped]]) {
    if (!items.length) continue;
    const hid = `grp-${title.replace(/\s/g, "")}`;
    page.append(h("section", { class: "group", "aria-labelledby": hid }, h("h3", { class: "section-heading", id: hid }, title, h("span", { class: "chip" }, items.length)), h("ul", { class: "svc-list" }, items.map(serviceRow))));
  }
  return page;
}

// ── Detail page ────────────────────────────────────────────────────────────
async function doAction(s, verb, body) {
  store.actionErr[s.id] = null;
  try { await api("POST", `/api/services/${s.id}/${verb}`, body); announce(`${verb} sent for ${s.id}`); }
  catch (e) { store.actionErr[s.id] = e; }
  await refresh();
}
function renderDetail(id) {
  const page = h("div", { class: "page" });
  const s = store.detail?.id === id ? store.detail : null;
  page.append(h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "#/settings/services", class: "focus-ring" }, "All services"), h("span", { "aria-hidden": "true" }, "›"), h("span", { class: "mono", "aria-current": "page" }, id)));
  if (store.detailMissing === id) {
    page.append(h("div", { class: "callout info", role: "status" }, h("span", { class: "glyph", "aria-hidden": "true" }, "i"), h("div", {}, `No service named “${id}” is defined. Showing the list instead.`)), renderList());
    return page;
  }
  if (!s) { page.append(h("p", { class: "meta" }, "Loading…")); return page; }
  if (readOnly()) page.append(readOnlyBanner());

  // Head: identity + state + one primary next action (Von Restorff)
  const acts = actionsFor(s);
  page.append(h("div", { class: "detail-head" },
    h("div", { class: "title-row" }, h("h2", { class: "page-title mono" }, s.id), pill(s.state),
      h("span", { class: "chip" }, s.mode), s.driver ? h("span", { class: "chip" }, s.driver) : null,
      s.pinned ? h("span", { class: "chip" }, "Pinned") : null),
    h("p", { class: "page-sub" }, typeof s.origin === "object" ? `From ${s.origin.package} ${s.origin.version}` : "Added by you"),
    h("div", { class: "action-bar" }, acts.map((a) => h("button", { type: "button", class: `${a.primary ? "btn-primary" : "btn-secondary"} focus-ring`, disabled: readOnly(), "data-testid": `svc-action-${a.verb}`, onclick: () => (a.verb === "prefetch" ? confirmPrefetch(s) : doAction(s, a.verb)) }, a.label))),
    store.actionErr[s.id] ? errorCallout(store.actionErr[s.id]) : null));

  // Why callout for attention states (Nielsen #9: what, why, how to fix)
  if (ATTENTION.has(s.state)) {
    const sev = s.state === "blocked" ? "warning" : "error";
    page.append(h("div", { class: `callout ${sev}`, role: "status" }, h("span", { class: "glyph", "aria-hidden": "true" }, sev === "warning" ? "!" : "✕"),
      h("div", {},
        h("strong", {}, s.reason ? REASON[s.reason] ?? s.reason : shapeOf(s.state).label + "."), " ",
        s.state === "failed" && s.retryAt ? ["Next automatic retry ", h("span", { "data-retry": s.retryAt }, relTime(s.retryAt)), ". "] : "",
        s.hint ?? "",
        s.tried?.length ? h("ul", { class: "list-plain" }, s.tried.map((t) => h("li", {}, h("span", { class: "mono" }, t.driver), ": ", REASON[t.reason] ?? t.reason))) : null,
        canForceStop(s) ? h("div", { class: "actions" }, h("button", { type: "button", class: "btn-danger focus-ring", disabled: readOnly(), onclick: () => confirmForceStop(s) }, "Force stop…")) : null)));
  }
  if (s.updateAvailable) {
    page.append(h("section", { class: "card inset", "aria-labelledby": "upd" },
      h("h3", { class: "section-heading", id: "upd" }, "Update available"),
      h("table", { class: "table diff" }, h("thead", {}, h("tr", {}, h("th", {}, "Setting"), h("th", {}, "Current"), h("th", {}, "New"))),
        h("tbody", {}, (s.diff ?? []).map((d) => h("tr", {}, h("td", { class: "mono" }, d.path), h("td", { class: "mono" }, String(d.from)), h("td", { class: "mono" }, String(d.to)))))),
      h("p", { class: "hint" }, "Applies at the next start. Nothing is downloaded."),
      h("div", { class: "action-bar" }, h("button", { type: "button", class: "btn-secondary focus-ring", disabled: readOnly(), onclick: async () => { try { await api("POST", "/api/services", { offer: `${s.origin.package}#${s.id}`, update: true }); } catch (e) { store.actionErr[s.id] = e; } refresh(); } }, "Apply update"))));
  }
  if (s.restartRequired) page.append(h("div", { class: "callout info", role: "status" }, h("span", { class: "glyph", "aria-hidden": "true" }, "i"), h("div", {}, "The definition changed while this instance was running. It applies at the next start.")));

  // Connection + usage
  const conn = h("section", { class: "card inset", "aria-labelledby": "conn" }, h("h3", { class: "section-heading", id: "conn" }, "Connection"),
    h("dl", { class: "kv" },
      h("dt", {}, "Endpoints"), h("dd", {}, Object.entries(s.endpoints ?? {}).map(([k, v]) => h("div", { class: "line" }, h("span", { class: "chip" }, k), " ", h("span", { class: "mono" }, v))).concat(s.endpoints ? [] : ["—"])),
      h("dt", {}, "Exposure"), h("dd", {}, s.exposure === "all-interfaces" ? "All interfaces (reachable from other machines)" : s.exposure === "loopback" ? "This machine only" : "Unknown"),
      h("dt", {}, "Started by"), h("dd", {}, s.startedBy === "external" ? "Outside the dashboard (never stopped automatically)" : s.startedBy === "dashboard" ? "Dashboard" : "—"),
      h("dt", {}, "Idle stop"), h("dd", {}, s.pinned ? "Off while pinned" : s.mode === "managed" ? "After 15 min with no users" : "Never")));
  const usage = h("section", { class: "card inset", "aria-labelledby": "use" }, h("h3", { class: "section-heading", id: "use" }, "In use by", h("span", { class: "chip" }, s.leaseHolders?.length ?? 0)),
    s.leaseHolders?.length
      ? h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, "Holder"), h("th", {}, "Expires"))),
          h("tbody", {}, s.leaseHolders.map((l) => h("tr", {}, h("td", {}, l.holder ?? "(unnamed)"), h("td", { class: "meta" }, relTime(l.expiresAt))))))
      : h("p", { class: "hint" }, "Nothing is using this service right now."));
  page.append(h("div", { class: "grid-2" }, conn, usage));

  // Secrets — write-only (D12)
  const secrets = Object.entries(s.secrets ?? {});
  if (secrets.length) {
    page.append(h("section", { class: "card inset", "aria-labelledby": "sec" }, h("h3", { class: "section-heading", id: "sec" }, "Secrets"),
      h("p", { class: "hint" }, "Values are never shown. Saving replaces the stored value."),
      secrets.map(([name, st]) => {
        const src = s._def?.secretSources?.[name] ?? `store:${s.id}/${name}`;
        const storeBacked = src.startsWith("store:");
        const inputId = `secret-${s.id}-${name}`;
        const row = h("div", { class: "secret-row" },
          h("div", { class: "line" }, h("strong", { class: "mono" }, name),
            h("span", { class: "pill", "data-sev": st.configured ? "success" : "warning" }, h("span", { class: "shape", "data-shape": st.configured ? "circle" : "triangle", "aria-hidden": "true" }), st.configured ? "Set" : "Not set"),
            h("span", { class: "meta mono" }, src)));
        if (storeBacked) {
          const input = h("input", { id: inputId, class: "input focus-ring mono", type: "password", autocomplete: "new-password", spellcheck: "false", disabled: readOnly(), "aria-describedby": `${inputId}-hint` });
          row.append(h("label", { class: "field", for: inputId }, `New value for ${name}`), h("div", { class: "line" }, input,
            h("button", { type: "button", class: "btn-secondary focus-ring", disabled: readOnly(), onclick: async () => {
              if (!input.value) return;
              try { await api("PUT", `/api/services/${s.id}/secrets/${name}`, { value: input.value }); input.value = ""; announce(`${name} saved`); } catch (e) { store.actionErr[s.id] = e; }
              refresh();
            } }, st.configured ? "Replace" : "Save")),
            h("span", { class: "hint", id: `${inputId}-hint` }, "Takes effect at the next start."));
        } else row.append(h("span", { class: "hint" }, "Read from outside the dashboard; change it at its source."));
        return row;
      })));
  }

  // Logs (D5)
  const logsSec = h("section", { class: "card inset", "aria-labelledby": "logs-h" },
    h("div", { class: "toolbar" }, h("h3", { class: "section-heading grow", id: "logs-h" }, "Output"),
      h("label", { class: "sr-only", for: "tail" }, "Lines to show"),
      h("select", { id: "tail", class: "input focus-ring", disabled: readOnly(), onchange: (e) => { store.logTail = Number(e.target.value); loadLogs(s.id); } },
        [200, 500, 2000].map((n) => { const o = h("option", { value: n }, `Last ${n} lines`); if (n === store.logTail) o.selected = true; return o; })),
      h("button", { type: "button", class: "btn-secondary focus-ring", disabled: readOnly(), onclick: () => loadLogs(s.id) }, store.logs?.id === s.id ? "Refresh" : "Load output")));
  if (readOnly()) logsSec.append(h("p", { class: "hint" }, "Output can contain sensitive data, so it needs operate authority."));
  else if (store.logs?.id === s.id) {
    const L = store.logs.data;
    if (store.logs.error) logsSec.append(errorCallout(store.logs.error));
    else if (!L.available) logsSec.append(h("p", { class: "hint" }, LOG_REASON[L.reason] ?? L.reason));
    else {
      const pre = h("pre", { class: "logs", tabindex: "0", "aria-label": `Output of ${s.id}` });
      for (const line of L.lines) {
        const parts = line.split(/(«secret:[^»]+»)/);
        for (const p of parts) pre.append(p.startsWith("«secret:") ? h("mark", { title: "Secret value redacted" }, p) : document.createTextNode(p));
        pre.append("\n");
      }
      logsSec.append(pre, h("p", { class: "hint" }, `${L.lines.length} lines from ${L.driver}. Known secret values are replaced with «secret:name».`));
    }
  } else logsSec.append(h("p", { class: "hint" }, "Output is loaded on request."));
  page.append(logsSec);

  // Danger zone (Nielsen #5 error prevention: separated + specific confirmation)
  const vols = s._def?.volumes ?? [];
  page.append(h("section", { class: "danger", "aria-labelledby": "dz" }, h("h3", { class: "section-heading", id: "dz" }, "Danger zone"),
    vols.length ? h("div", { class: "danger-row" }, h("p", {}, h("strong", {}, "Reset data"), h("span", { class: "hint" }, `Deletes ${vols.join(", ")}. The service and its secrets stay. ${canResetData(s) ? "" : "Stop the service first."}`)),
      h("button", { type: "button", class: "btn-danger focus-ring", disabled: readOnly() || !canResetData(s), onclick: () => confirmReset(s, vols) }, "Reset data…")) : null,
    h("div", { class: "danger-row" }, h("p", {}, h("strong", {}, "Remove service"), h("span", { class: "hint" }, "Stops it if the dashboard started it, and deletes its definition, secrets and run files.")),
      h("button", { type: "button", class: "btn-danger focus-ring", disabled: readOnly(), onclick: () => confirmRemove(s, vols) }, "Remove…"))));
  return page;
}
async function loadLogs(id) {
  try { store.logs = { id, data: await api("GET", `/api/services/${id}/logs?tail=${store.logTail}`) }; }
  catch (e) { store.logs = { id, error: e }; }
  render();
}

// ── Runtimes page ──────────────────────────────────────────────────────────
const CAP = { ok: "Available", "ok-destructive": "Available (destructive)", "cli-present": "CLI only", "needs-secret": "Needs a password", unavailable: "Unavailable", unsupported: "Not supported" };
function renderRuntimes() {
  const page = h("div", { class: "page" }, h("div", {}, h("h2", { class: "page-title" }, "Runtimes"),
    h("p", { class: "page-sub" }, "What this machine can run services with. Detected on demand, cached for 30 s. The dashboard never starts or stops these.")));
  const rt = store.runtimes;
  if (!rt) { page.append(h("p", { class: "meta" }, "Detecting…")); return page; }
  for (const kind of ["container", "hypervisor"]) {
    const rows = rt.filter((r) => r.kind === kind);
    const caps = [...new Set(rows.flatMap((r) => Object.keys(r.capabilities)))];
    const hid = `rt-${kind}`;
    page.append(h("section", { class: "card inset", "aria-labelledby": hid },
      h("h3", { class: "section-heading", id: hid }, kind === "container" ? "Container runtimes" : "Hypervisors (report only)"),
      h("div", { style: "overflow-x:auto" }, h("table", { class: "table matrix" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Runtime"), h("th", { scope: "col" }, "Status"), caps.map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, rows.map((r) => {
          const status = !r.installed ? ["neutral", "square", "Not installed"] : kind === "hypervisor" ? ["success", "circle", `Installed ${r.version ?? ""}`]
            : r.reachable ? ["success", "circle", `Running ${r.version}`] : ["error", "triangle", `Installed ${r.version}, not running`];
          return h("tr", {}, h("th", { scope: "row" }, r.id),
            h("td", {}, h("span", { class: "pill", "data-sev": status[0] }, h("span", { class: "shape", "data-shape": status[1], "aria-hidden": "true" }), status[2]),
              r.hostVm && r.hostVm !== "none" ? h("div", { class: "hint" }, `Machine VM: ${r.hostVm}`) : null),
            caps.map((c) => h("td", { class: "cap" }, r.capabilities[c] ? CAP[r.capabilities[c]] ?? r.capabilities[c] : "—")));
        }))))));
  }
  return page;
}

// ── Dialogs ────────────────────────────────────────────────────────────────
let lastFocus = null;
function dialog(title, body, foot, { wide } = {}) {
  lastFocus = document.activeElement;
  const id = "dlg-" + Math.random().toString(36).slice(2);
  const panel = h("div", { class: "card dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": id, style: wide ? "max-width:680px" : null }, h("h2", { id }, title), body, h("div", { class: "foot" }, foot));
  const scrim = h("div", { class: "scrim", onmousedown: (e) => e.target === scrim && close() }, panel);
  function close() { scrim.remove(); document.removeEventListener("keydown", onKey); lastFocus?.focus?.(); }
  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "Tab") { const f = [...panel.querySelectorAll("button,input,select,textarea,a[href]")].filter((x) => !x.disabled); if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }
  document.addEventListener("keydown", onKey);
  $("#dialog-root").append(scrim);
  setTimeout(() => (panel.querySelector("input,textarea,select") ?? panel.querySelector(".foot button:last-child"))?.focus(), 0);
  return { close, panel };
}
const cancelBtn = (getD) => h("button", { type: "button", class: "btn-secondary focus-ring", onclick: () => getD().close() }, "Cancel");

function confirmReset(s, vols) {
  let d;
  const input = h("input", { class: "input focus-ring mono", id: "reset-confirm", autocomplete: "off", spellcheck: "false" });
  const go = h("button", { type: "button", class: "btn-danger focus-ring", disabled: true, onclick: async () => { try { await api("POST", `/api/services/${s.id}/reset-data`); announce("Data reset"); } catch (e) { store.actionErr[s.id] = e; } d.close(); refresh(); } }, "Delete data");
  input.addEventListener("input", () => (go.disabled = input.value !== s.id));
  d = dialog(`Reset data of ${s.id}?`, h("div", { style: "display:flex;flex-direction:column;gap:10px" },
    h("p", { style: "margin:0" }, "These volumes and everything in them are deleted. This cannot be undone:"),
    h("ul", { class: "list-plain mono" }, vols.map((v) => h("li", {}, v))),
    h("label", { class: "field", for: "reset-confirm" }, h("span", {}, "Type ", h("span", { class: "mono" }, s.id), " to confirm"), input)), [cancelBtn(() => d), go]);
}
function confirmRemove(s, vols) {
  let d;
  const purge = h("input", { type: "checkbox", id: "purge" });
  d = dialog(`Remove ${s.id}?`, h("div", { style: "display:flex;flex-direction:column;gap:10px" },
    h("p", { style: "margin:0" }, "Removes:"),
    h("ul", { class: "list-plain" }, h("li", {}, "the service definition"), h("li", {}, "its stored secrets"), h("li", {}, "its container or process, if the dashboard started it"), h("li", {}, "its run files and captured output")),
    vols.length ? h("label", { class: "check", for: "purge" }, purge, h("span", {}, "Also delete data volumes: ", h("span", { class: "mono" }, vols.join(", ")), h("span", { class: "hint", style: "display:block" }, "Left unticked, the volumes are kept and reused if you add the service again."))) : null),
    [cancelBtn(() => d), h("button", { type: "button", class: "btn-danger focus-ring", onclick: async () => {
      try { await api("DELETE", `/api/services/${s.id}${purge.checked ? "?purgeData=true" : ""}`); announce(`${s.id} removed`); d.close(); go("/settings/services"); }
      catch (e) { store.actionErr[s.id] = e; d.close(); } refresh();
    } }, "Remove service")]);
}
function confirmForceStop(s) {
  let d;
  d = dialog(`Force stop ${s.id}?`, h("p", { style: "margin:0" }, "The dashboard normally signals a process only when it can prove the process is this service, so it never kills an unrelated program that reused the same PID. Force stop skips that check."),
    [cancelBtn(() => d), h("button", { type: "button", class: "btn-danger focus-ring", onclick: () => { d.close(); doAction(s, "stop", { force: true }); } }, "Force stop")]);
}
function confirmPrefetch(s) {
  let d;
  d = dialog(`Download ${s.id}?`, h("p", { style: "margin:0" }, "Prefetch downloads the package into the local cache once. Starts after that never download."),
    [cancelBtn(() => d), h("button", { type: "button", class: "btn-primary focus-ring", onclick: () => { d.close(); doAction(s, "prefetch"); } }, "Download")]);
}
async function openPrune() {
  let d, data;
  try { data = await api("POST", "/api/services/prune", { dryRun: true }); } catch (e) { store.err = e; return render(); }
  const c = data.candidates;
  const body = c.length
    ? h("div", { style: "display:flex;flex-direction:column;gap:10px" }, h("p", { style: "margin:0" }, "These were created by this dashboard for services that are no longer defined. Volumes are never touched."),
        h("ul", { class: "list-plain" }, c.map((x) => h("li", {}, x.kind === "container" ? [`Container `, h("span", { class: "mono" }, x.id), ` (${x.runtime}, was `, h("span", { class: "mono" }, x.service), ")"] : ["Run folder ", h("span", { class: "mono" }, x.path)]))))
    : h("p", { style: "margin:0" }, "Nothing to clean up.");
  d = dialog("Clean up leftovers", body, c.length ? [cancelBtn(() => d), h("button", { type: "button", class: "btn-danger focus-ring", onclick: async () => {
    const r = await api("POST", "/api/services/prune", { dryRun: false }); d.close();
    announce(`Removed ${r.removed.length} leftover${r.removed.length === 1 ? "" : "s"}`);
    if (r.removed.length !== c.length) { store.err = { message: `Removed ${r.removed.length} of ${c.length}; the rest changed since the preview.`, body: { error: "prune-partial" } }; }
    refresh();
  } }, `Remove ${c.length}`)] : [h("button", { type: "button", class: "btn-secondary focus-ring", onclick: () => d.close() }, "Close")]);
}
async function openAdd() {
  let d, step = 1, source = "offer", review = null, reviewErr = null, pickedOffer = null;
  const offers = (await api("GET", "/api/services/offers")).offers;
  const avail = offers.filter((o) => !o.added);
  pickedOffer = avail[0]?.ref ?? null;
  const json = h("textarea", { id: "def-json", class: "focus-ring", spellcheck: "false", "aria-describedby": "def-hint" });
  json.value = JSON.stringify({ id: "tika", mode: "managed", drivers: ["oci:podman"], oci: { image: "docker.io/apache/tika@sha256:…", ports: { http: { container: 9998, protocol: "http" } } }, health: { kind: "http", endpoint: "http", path: "/version" } }, null, 2);
  const prefetch = h("input", { type: "checkbox", id: "prefetch" });
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const foot = h("div", { class: "foot", style: "display:contents" });
  function draw() {
    const steps = h("ol", { class: "steps", "aria-label": "Progress" }, ["Choose", "Review", "Done"].map((t, i) => h("li", { "aria-current": step === i + 1 ? "step" : null }, `${i + 1}. ${t}`)));
    body.replaceChildren(steps);
    if (step === 1) {
      body.append(h("fieldset", { style: "border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:8px" }, h("legend", { class: "section-heading" }, "Source"),
        h("label", { class: "radio-card" }, h("input", { type: "radio", name: "src", checked: source === "offer", onchange: () => { source = "offer"; draw(); } }),
          h("span", {}, h("strong", {}, "From an installed package"), h("span", { class: "hint", style: "display:block" }, `${avail.length} offered by installed packages`))),
        h("label", { class: "radio-card" }, h("input", { type: "radio", name: "src", checked: source === "json", onchange: () => { source = "json"; draw(); } }),
          h("span", {}, h("strong", {}, "Paste a definition"), h("span", { class: "hint", style: "display:block" }, "For your own containers, commands or external endpoints")))));
      if (source === "offer") body.append(h("fieldset", { style: "border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px" }, h("legend", { class: "section-heading" }, "Offer"),
        avail.length ? avail.map((o) => h("label", { class: "radio-card" }, h("input", { type: "radio", name: "offer", checked: pickedOffer === o.ref, onchange: () => (pickedOffer = o.ref) }),
          h("span", {}, h("strong", { class: "mono" }, o.id), h("span", { class: "hint", style: "display:block" }, `${o.package} ${o.version} · ${o.mode}`)))) : h("p", { class: "hint" }, "Every offered service is already added.")));
      else body.append(h("label", { class: "field", for: "def-json" }, "Definition (JSON)", json), h("span", { class: "hint", id: "def-hint" }, "Checked by the server before anything is written. See docs/managed-services.md."));
      if (reviewErr) body.append(h("div", { class: "callout error", role: "alert" }, h("span", { class: "glyph", "aria-hidden": "true" }, "✕"), h("div", {}, h("strong", {}, "The definition was rejected:"), h("ul", { class: "list-plain mono" }, reviewErr.split("\n").filter((l) => l.startsWith("- ")).map((l) => h("li", {}, l.slice(2)))))));
      foot.replaceChildren(cancelBtn(() => d), h("button", { type: "button", class: "btn-primary focus-ring", disabled: source === "offer" && !pickedOffer, onclick: async () => {
        let payload;
        if (source === "offer") payload = { offer: pickedOffer, dryRun: true };
        else { try { payload = { definition: JSON.parse(json.value), dryRun: true }; } catch (e) { reviewErr = `- JSON: ${e.message}`; return draw(); } }
        try { review = (await api("POST", "/api/services", payload)).review; reviewErr = null; step = 2; } catch (e) { reviewErr = e.message; }
        draw();
      } }, "Review"));
    } else if (step === 2) {
      const r = review;
      body.append(h("p", { style: "margin:0" }, "Nothing has been written yet. Check what this service will do:"),
        h("dl", { class: "kv inset" },
          h("dt", {}, "Id"), h("dd", { class: "mono" }, r.id),
          h("dt", {}, "Runs as"), h("dd", {}, r.mode, r.drivers ? ` · ${r.drivers.join(" → ")}` : ""),
          r.image ? [h("dt", {}, "Image"), h("dd", { class: "mono" }, r.image)] : null,
          h("dt", {}, "Ports"), h("dd", { class: "mono" }, r.ports.join(", ") || "—"),
          h("dt", {}, "Data volumes"), h("dd", { class: "mono" }, r.volumes.join(", ") || "—"),
          h("dt", {}, "Host folders"), h("dd", { class: "mono" }, r.binds.join(", ") || "none"),
          h("dt", {}, "Secrets"), h("dd", {}, r.secrets.length ? r.secrets.map((n) => h("div", { class: "mono" }, `${n} ← ${r.secretSources[n]}`)) : "none")),
        r.needsPrefetch ? h("label", { class: "check", for: "prefetch" }, prefetch, h("span", {}, "Also download it now", h("span", { class: "hint", style: "display:block" }, "Otherwise the first start reports it as not downloaded."))) : null);
      foot.replaceChildren(h("button", { type: "button", class: "btn-secondary focus-ring", onclick: () => { step = 1; draw(); } }, "Back"),
        h("button", { type: "button", class: "btn-primary focus-ring", onclick: async () => {
          try { await api("POST", "/api/services", source === "offer" ? { offer: pickedOffer } : { definition: JSON.parse(json.value) });
            if (prefetch.checked) await api("POST", `/api/services/${r.id}/prefetch`).catch(() => {});
            step = 3; } catch (e) { reviewErr = e.message; step = 1; }
          draw();
        } }, "Add service"));
    } else {
      body.append(h("div", { class: "callout info", role: "status" }, h("span", { class: "glyph", "aria-hidden": "true" }, "✓"), h("div", {}, h("span", { class: "mono" }, review.id), " was added. It starts the first time a skill asks for it.")));
      foot.replaceChildren(h("button", { type: "button", class: "btn-secondary focus-ring", onclick: () => d.close() }, "Close"),
        h("button", { type: "button", class: "btn-primary focus-ring", onclick: () => { d.close(); go(`/settings/services/${review.id}`); } }, "Open service"));
    }
  }
  draw();
  d = dialog("Add service", body, foot, { wide: true });
}

// ── Render + live refresh (D3: ping → refetch, no timer) ───────────────────
function render() {
  renderRail();
  const { page, id } = route();
  const c = $("#content");
  // Keep in-progress input across ping refetches (React keeps it via state).
  const keep = [...c.querySelectorAll("input[id],select[id]")].map((el) => [el.id, el.value]);
  const focusId = document.activeElement?.id;
  c.replaceChildren(page === "runtimes" ? renderRuntimes() : id ? renderDetail(id) : renderList());
  for (const [k, v] of keep) { const el = document.getElementById(k); if (el && el.type !== "checkbox") el.value = v; }
  if (focusId) document.getElementById(focusId)?.focus();
}
async function refresh() {
  const { page, id } = route();
  try {
    store.list = await api("GET", "/api/services");
    if (store.err?.body?.error !== "prune-partial") store.err = null;
    if (page === "runtimes" && !store.runtimes) store.runtimes = await api("GET", "/api/services/runtimes");
    if (id) {
      try { store.detail = await api("GET", `/api/services/${id}`); store.detailMissing = null; }
      catch (e) { if (e.status === 404) store.detailMissing = id; else throw e; }
    }
  } catch (e) { store.err = e; }
  render();
}
let pings = 0;
const es = new EventSource("mock/events");
es.onmessage = () => { $("#mock-ping").textContent = `ping: ${++pings}`; refresh(); };
es.onopen = () => refresh(); // reconnect → refetch
addEventListener("hashchange", () => { store.logs = null; refresh().then(() => $("#content").focus()); });

// mock controls
$("#mock-theme").addEventListener("change", (e) => {
  const v = e.target.value, html = document.documentElement;
  html.dataset.theme = v === "light" ? "light" : "dark";
  if (v === "nord") html.dataset.palette = "nord"; else delete html.dataset.palette;
});
$("#mock-role").addEventListener("click", async () => {
  const r = await (await fetch("mock/role", { method: "POST" })).json();
  store.role = r.role; $("#mock-role").textContent = `Caller: ${r.role}`; render();
});
fetch("mock/role").then((r) => r.json()).then((r) => { store.role = r.role; $("#mock-role").textContent = `Caller: ${r.role}`; });
setInterval(() => document.querySelectorAll("[data-retry]").forEach((el) => (el.textContent = relTime(el.dataset.retry))), 1000);
refresh();
