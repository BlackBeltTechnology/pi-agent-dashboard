// Rebuild-package catalog browser (vanilla JS, no build). Data: #catalog-data.
// State lives in the URL hash: #sel=UC-01,UC-03&view=item:BR-001
(() => {
  const D = JSON.parse(document.getElementById("catalog-data").textContent);
  const $ = (id) => document.getElementById(id);
  const REF_RE = /\b(?:BR|QUIRK|GAP)-\d+\b/g;
  const KIND_LABEL = { BR: "Rule", QUIRK: "Quirk", GAP: "Gap" };

  // ---------- indexes ----------
  const reqKey = (cap, name) => `${cap}#${name}`;
  const reqs = buildReqIndex(); // key -> {cap, ...req, refs}
  const ucById = buildUcIndex();
  const backlinks = (pred) => D.useCases.filter(pred).map((u) => u.id);
  const itemReqs = {};
  for (const [k, r] of Object.entries(reqs)) for (const ref of r.refs) (itemReqs[ref] = itemReqs[ref] || []).push(k);

  function buildReqIndex() {
    const out = {};
    for (const [cap, c] of Object.entries(D.capabilities)) {
      for (const r of c.requirements) {
        const all = [r.text, ...r.scenarios.map((s) => s.text)].join("\n");
        out[reqKey(cap, r.name)] = { cap, ...r, refs: uniq(all.match(REF_RE) || []).filter((x) => D.items[x]) };
      }
    }
    return out;
  }
  /** Annotate each use case with requirement keys and ref provenance (explicit > in flow > via requirement). */
  function buildUcIndex() {
    const out = {};
    for (const uc of D.useCases) {
      uc.reqKeys = (uc.requirements || []).map((s) => s.replace(/^spec:/, ""));
      uc.refSource = {};
      for (const r of uc.reqKeys.flatMap((k) => reqs[k]?.refs || [])) uc.refSource[r] = "via requirement";
      for (const r of uc.bpmnRefs || []) uc.refSource[r] = "in flow";
      for (const r of uc.refs || []) uc.refSource[r] = "explicit";
      uc.allRefs = Object.keys(uc.refSource).sort(byId);
      uc.entities = uc.entities || [];
      out[uc.id] = uc;
    }
    return out;
  }
  function uniq(a) { return [...new Set(a)]; }
  function byId(a, b) {
    const [ka, na] = a.split("-"); const [kb, nb] = b.split("-");
    return ka === kb ? Number(na) - Number(nb) : ka.localeCompare(kb);
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  /** Escape, then light markdown: `code`, **bold**, and linkified BR/QUIRK/GAP ids. */
  function md(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(REF_RE, (id) => (D.items[id] ? `<a href="${link({ view: `item:${id}` })}">${id}</a>` : id));
  }

  // ---------- state (hash) ----------
  const state = { sel: [], view: "", tab: "uc", q: "" };
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    state.sel = (p.get("sel") || "").split(",").filter((x) => ucById[x]);
    state.view = p.get("view") || (state.sel.length ? "merge" : "");
  }
  function link(over) {
    const sel = over.sel ?? state.sel;
    const p = new URLSearchParams();
    if (sel.length) p.set("sel", sel.join(","));
    const view = over.view ?? state.view;
    if (view) p.set("view", view);
    return `#${p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%23/g, "~")}`;
  }
  function go(over) { location.hash = link(over); }
  function viewArg(v) { return v.slice(v.indexOf(":") + 1).replace(/~/g, "#"); }

  // ---------- sidebar ----------
  const TABS = [
    ["uc", "Use cases", () => D.useCases.map((u) => ({ id: u.id, label: u.name, sub: `${u.actor} · ${u.trigger}`, view: `uc:${u.id}`, uc: u.id }))],
    ["cap", "Capabilities", () => Object.entries(D.capabilities).map(([k, c]) => ({ id: "", label: k, sub: `${c.requirements.length} requirements`, view: `cap:${k}` }))],
    ["BR", "Rules", () => kindRows("BR")],
    ["QUIRK", "Quirks", () => kindRows("QUIRK")],
    ["GAP", "Gaps", () => kindRows("GAP")],
    ["ent", "Entities", () => Object.entries(D.entities).map(([k, e]) => ({ id: "", label: k, sub: e.capabilities.join(", "), view: `ent:${k}` }))],
  ];
  function kindRows(kind) {
    return Object.values(D.items).filter((i) => i.kind === kind).sort((a, b) => byId(a.id, b.id))
      .map((i) => ({ id: i.id, label: i.title || i.statement, sub: i.title ? "" : "", view: `item:${i.id}` }));
  }
  function renderTabs() {
    $("tabs").innerHTML = TABS.map(([k, label, rows]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${label} <span>${rows().length}</span></button>`).join("");
  }
  function renderList() {
    const rows = TABS.find((t) => t[0] === state.tab)[2]();
    const q = state.q.toLowerCase();
    const hit = q ? rows.filter((r) => `${r.id} ${r.label} ${r.sub}`.toLowerCase().includes(q) || searchBody(r, q)) : rows;
    const shown = hit.slice(0, 400);
    $("list").innerHTML = shown.map(listRow).join("") + (hit.length > shown.length ? `<li class="more">${hit.length - shown.length} more — refine the search</li>` : "") +
      (hit.length ? "" : `<li class="more">No match</li>`);
    const bar = $("selbar");
    bar.hidden = !state.sel.length;
    bar.innerHTML = state.sel.length
      ? `<span class="grow"><b>${state.sel.length}</b> selected</span><a class="chip uc" href="${link({ view: "merge" })}">Merged view</a><button class="chip" data-clear>Clear</button>`
      : "";
  }
  function listRow(r) {
    const box = r.uc ? `<input type="checkbox" data-uc="${r.uc}" aria-label="Select ${esc(r.label)}" ${state.sel.includes(r.uc) ? "checked" : ""}>` : "";
    const active = state.view === r.view ? " active" : "";
    const id = r.id ? `<span class="id">${r.id}</span>` : "";
    const sub = r.sub ? `<span class="sub">${esc(r.sub)}</span>` : "";
    return `<li><div class="row${active}">${box}<a class="open" href="${link({ view: r.view })}">${id}${esc(clip(r.label, 140))}${sub}</a></div></li>`;
  }
  function searchBody(r, q) {
    const id = r.view.slice(r.view.indexOf(":") + 1);
    if (r.view.startsWith("item:")) return D.items[id].body.toLowerCase().includes(q);
    if (r.view.startsWith("ent:")) return D.entities[id].fields.some((f) => f.name.toLowerCase().includes(q));
    return false;
  }
  function clip(s, n) { s = String(s || ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

  // ---------- shared fragments ----------
  const ucChip = (id) => `<a class="chip uc" href="${link({ view: `uc:${id}` })}">${id} ${esc(ucById[id].name)}</a>`;
  const reqLink = (k) => `<a href="${link({ view: `req:${k.replace(/#/g, "~")}` })}">${esc(k.split("#")[1])}</a> <span class="cite">${esc(k.split("#")[0])}</span>`;
  const kindBadge = (id) => `<span class="badge k-${D.items[id].kind}">${KIND_LABEL[D.items[id].kind]}</span>`;
  const cites = (cs) => (cs || []).length ? `<div class="cite">${cs.map((c) => `${esc(c.ref)} (${c.confidence})`).join(" · ")}</div>` : "";
  function scenariosHtml(r) {
    return r.scenarios.map((s) => `<div class="scenario"><b>Scenario: ${esc(s.name)}</b><div class="text">${md(s.text)}</div>${cites(s.cites)}</div>`).join("");
  }
  function selectButton(id) {
    const on = state.sel.includes(id);
    return `<button class="chip uc" data-toggle="${id}">${on ? "✓ Selected — remove" : "+ Add to merge"}</button>`;
  }

  // ---------- views ----------
  function viewHome() {
    const n = (k) => Object.values(D.items).filter((i) => i.kind === k).length;
    const flows = D.useCases.filter((u) => u.bpmnXml).length;
    return `<h2>${esc(D.meta.title)}</h2><p class="lede">Built ${D.meta.built}. Tick use cases on the left to merge them; every item links to what references it.</p>
      <div class="grid">${[["Use cases", D.useCases.length], ["Drawn flows", flows], ["Capabilities", Object.keys(D.capabilities).length], ["Requirements", Object.keys(reqs).length], ["Rules", n("BR")], ["Quirks", n("QUIRK")], ["Gaps", n("GAP")], ["Entities", Object.keys(D.entities).length]]
        .map(([l, v]) => `<div class="card"><div class="stat">${v}</div>${l}</div>`).join("")}</div>
      <h3>Use cases</h3><table><tr><th>ID</th><th>Use case</th><th>Actor</th><th>Flow</th><th></th></tr>${D.useCases.map((u) =>
        `<tr><td class="idc">${u.id}</td><td><a href="${link({ view: `uc:${u.id}` })}">${esc(u.name)}</a></td><td>${esc(u.actor)}</td><td>${u.bpmnXml ? "BPMN" : "—"}</td><td>${selectButton(u.id)}</td></tr>`).join("")}</table>`;
  }

  /** Merged view over the selected use cases. */
  function viewMerge() {
    const sel = state.sel.map((id) => ucById[id]);
    if (!sel.length) return viewHome();
    const count = (list) => { const m = {}; for (const x of list) m[x] = (m[x] || 0) + 1; return m; };
    const reqCount = count(sel.flatMap((u) => u.reqKeys));
    const refCount = count(sel.flatMap((u) => u.allRefs));
    const entCount = count(sel.flatMap((u) => u.entities));
    const usedBy = (pred) => sel.filter(pred).map((u) => u.id);
    const shared = (n) => (n > 1 && sel.length > 1 ? ` <span class="badge shared">shared ×${n}</span>` : "");

    const byCap = {};
    for (const k of Object.keys(reqCount)) (byCap[k.split("#")[0]] = byCap[k.split("#")[0]] || []).push(k);
    const reqHtml = Object.entries(byCap).sort().map(([cap, keys]) => `<h4>${esc(cap)}</h4>${keys.map((k) => {
      const r = reqs[k];
      if (!r) return `<div class="card">Missing requirement ${esc(k)}</div>`;
      return `<details class="card${reqCount[k] > 1 && sel.length > 1 ? " shared" : ""}"><summary>${esc(r.name)}${shared(reqCount[k])}</summary>
        <div class="chips">${usedBy((u) => u.reqKeys.includes(k)).map(ucChip).join("")}</div>
        <div class="text">${md(r.text)}</div>${cites(r.cites)}${scenariosHtml(r)}</details>`;
    }).join("")}`).join("");

    const refRows = Object.keys(refCount).sort(byId).map((id) => {
      const it = D.items[id];
      const src = uniq(sel.filter((u) => u.refSource[id]).map((u) => u.refSource[id]));
      return `<tr><td class="idc"><a href="${link({ view: `item:${id}` })}">${id}</a><br>${kindBadge(id)}${shared(refCount[id])}</td>
        <td>${md(clip(it.statement, 600))}</td><td>${usedBy((u) => u.refSource[id]).join(", ")}<br>${src.map((s) => `<span class="badge via">${s}</span>`).join(" ")}</td></tr>`;
    }).join("");

    const ents = Object.keys(entCount).sort();
    return `<h2>Merged view</h2><p class="lede">${sel.length} use case${sel.length > 1 ? "s" : ""} — union of flows, requirements, rules and entities. Items used by more than one selected use case are marked <span class="badge shared">shared</span>.</p>
      <div class="chips">${sel.map((u) => `<span class="chip uc">${u.id} ${esc(u.name)} <button class="x" data-toggle="${u.id}" aria-label="Remove ${u.id}">×</button></span>`).join("")}</div>
      <h3>Flows</h3>${flowsHtml(sel)}
      <h3>Requirements (${Object.keys(reqCount).length})</h3>${reqHtml || "<p>None listed.</p>"}
      <h3>Rules, quirks and gaps (${Object.keys(refCount).length})</h3>${refRows ? `<table><tr><th>ID</th><th>Statement</th><th>Used by / source</th></tr>${refRows}</table>` : "<p>None.</p>"}
      <h3>Entities (${ents.length})</h3><div class="chips">${ents.map((e) => `<a class="chip" href="${link({ view: `ent:${e}` })}">${esc(e)}${shared(entCount[e])}</a>`).join("")}</div>
      <div class="er" data-er="${esc(ents.join("|"))}"></div>
      <h3>Related use cases</h3>${relatedHtml(sel)}`;
  }

  function facets(u) { return new Set([...u.reqKeys.map((k) => `r:${k}`), ...u.allRefs.map((x) => `i:${x}`), ...u.entities.map((e) => `e:${e}`)]); }
  function relatedHtml(sel) {
    const pool = new Set(sel.flatMap((u) => [...facets(u)]));
    const rows = D.useCases.filter((u) => !state.sel.includes(u.id)).map((u) => {
      const f = facets(u);
      const common = [...f].filter((x) => pool.has(x));
      return { u, common, score: common.length / (new Set([...f, ...pool]).size || 1) };
    }).filter((r) => r.common.length).sort((a, b) => b.score - a.score).slice(0, 8);
    if (!rows.length) return "<p>No other use case shares requirements, rules or entities.</p>";
    const kinds = (c, p) => c.filter((x) => x.startsWith(p)).length;
    return `<table class="related"><tr><th>Use case</th><th>Shared</th><th>Overlap</th><th></th></tr>${rows.map(({ u, common, score }) =>
      `<tr><td>${ucChip(u.id)}</td><td>${kinds(common, "r:")} requirements · ${kinds(common, "i:")} rules/quirks/gaps · ${kinds(common, "e:")} entities</td><td>${Math.round(score * 100)}%</td><td>${selectButton(u.id)}</td></tr>`).join("")}</table>`;
  }

  function flowsHtml(list) {
    const drawn = list.filter((u) => u.bpmnXml);
    const missing = list.filter((u) => !u.bpmnXml).map((u) => u.id);
    if (!drawn.length) return `<p>No flow drawn for ${missing.join(", ")}.</p>`;
    if (!D.viewers.bpmn) return `<div class="notice">BPMN viewer not embedded (build without <code>--bpmn-js</code>). ${drawn.length} flow(s) available as XML in the source package.</div>`;
    return `<div class="flowtabs">${drawn.map((u, i) => `<button data-flow="${u.id}" aria-pressed="${i === 0}">${u.id} ${esc(u.name)}</button>`).join("")}</div>
      <div class="flow" id="flow" data-uc="${drawn[0].id}"></div><div class="legend" id="legend"></div>
      <div class="flowinfo card" id="flowinfo">Click a task or gateway to see its package references.</div>
      ${missing.length ? `<p class="meta">No flow drawn for ${missing.join(", ")}.</p>` : ""}`;
  }

  function viewUseCase(id) {
    const u = ucById[id];
    if (!u) return viewHome();
    return `<h2>${u.id} ${esc(u.name)}</h2><p class="lede">Actor: <b>${esc(u.actor)}</b> · Trigger: ${esc(u.trigger)}</p>${selectButton(u.id)}
      <h3>Flow</h3>${flowsHtml([u])}
      <h3>Requirements</h3>${u.reqKeys.map((k) => reqs[k] ? `<details class="card"><summary>${esc(reqs[k].name)} <span class="cite">${esc(reqs[k].cap)}</span></summary><div class="text">${md(reqs[k].text)}</div>${cites(reqs[k].cites)}${scenariosHtml(reqs[k])}</details>` : "").join("")}
      <h3>Rules, quirks and gaps</h3><table><tr><th>ID</th><th>Statement</th><th>Source</th></tr>${u.allRefs.map((r) => `<tr><td class="idc"><a href="${link({ view: `item:${r}` })}">${r}</a><br>${kindBadge(r)}</td><td>${md(clip(D.items[r].statement, 600))}</td><td><span class="badge via">${u.refSource[r]}</span></td></tr>`).join("")}</table>
      <h3>Entities</h3><div class="chips">${u.entities.map((e) => `<a class="chip" href="${link({ view: `ent:${e}` })}">${esc(e)}</a>`).join("")}</div>
      <div class="er" data-er="${esc(u.entities.join("|"))}"></div>
      <h3>Related use cases</h3>${relatedHtml([u])}`;
  }

  function viewItem(id) {
    const it = D.items[id];
    if (!it) return viewHome();
    const fields = Object.entries(it.fields).filter(([k]) => k !== "Statement");
    return `<h2>${id} ${kindBadge(id)}</h2>${it.title ? `<p class="lede">${esc(it.title)}</p>` : ""}
      <div class="card text">${md(it.fields.Statement ? it.statement : it.body)}</div>${cites(it.cites)}
      ${fields.length ? `<table>${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${md(v)}</td></tr>`).join("")}</table>` : ""}
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.refSource[id]).map(ucChip).join("") || "None"}</div>
      <h3>Requirements mentioning it</h3><ul>${(itemReqs[id] || []).map((k) => `<li>${reqLink(k)}</li>`).join("") || "<li>None</li>"}</ul>`;
  }

  function viewReq(key) {
    const r = reqs[key];
    if (!r) return viewHome();
    return `<h2>${esc(r.name)}</h2><p class="lede">Capability <a href="${link({ view: `cap:${r.cap}` })}">${esc(r.cap)}</a></p>
      <div class="card text">${md(r.text)}</div>${cites(r.cites)}${scenariosHtml(r)}
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.reqKeys.includes(key)).map(ucChip).join("") || "None"}</div>
      <h3>Rules, quirks and gaps</h3><div class="chips">${r.refs.map((x) => `<a class="chip" href="${link({ view: `item:${x}` })}">${x}</a>`).join("") || "None"}</div>`;
  }

  function viewCap(cap) {
    const c = D.capabilities[cap];
    if (!c) return viewHome();
    return `<h2>${esc(cap)}</h2><p class="lede text">${md(c.purpose)}</p>
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.reqKeys.some((k) => k.startsWith(`${cap}#`))).map(ucChip).join("") || "None"}</div>
      <h3>Requirements (${c.requirements.length})</h3>${c.requirements.map((r) => `<details class="card"><summary>${esc(r.name)}</summary><div class="text">${md(r.text)}</div>${cites(r.cites)}${scenariosHtml(r)}
        <p><a href="${link({ view: `req:${reqKey(cap, r.name).replace(/#/g, "~")}` })}">Open requirement</a></p></details>`).join("")}`;
  }

  function viewEntity(name) {
    const e = D.entities[name];
    if (!e) return viewHome();
    const rels = D.er.relations.filter((r) => r.from === name || r.to === name);
    const neigh = uniq([name, ...rels.flatMap((r) => [r.from, r.to])]);
    return `<h2>${esc(name)}</h2><p class="lede">${esc(e.capabilities.join(", "))}</p>
      <table><tr><th>Identity</th><td>${md(e.identity)}</td></tr><tr><th>Persistence</th><td>${md(e.persistence)}</td></tr><tr><th>Relationships</th><td>${md(e.relationships)}</td></tr></table>
      <h3>ER neighbourhood</h3><div class="er" data-er="${esc(neigh.join("|"))}"></div>
      ${rels.length ? `<table><tr><th>From</th><th>Card.</th><th>To</th><th>Label</th><th>Evidence</th></tr>${rels.map((r) => `<tr><td>${esc(r.from)}</td><td>${esc(r.cardinality)}${r.confidence === "confirmed" ? "" : " (inferred)"}</td><td>${esc(r.to)}</td><td>${esc(r.label)}</td><td>${esc(r.evidence)}</td></tr>`).join("")}</table>` : "<p>No ER relation drawn.</p>"}
      <h3>Fields (${e.fields.length})</h3><table><tr><th>Field</th><th>Type</th><th>Required</th><th>Nullable</th></tr>${e.fields.map((f) => `<tr><td><code>${esc(f.name)}</code></td><td>${esc(f.type)}</td><td>${f.required ? "yes" : ""}</td><td>${f.nullable ? "yes" : ""}</td></tr>`).join("")}</table>
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.entities.includes(name)).map(ucChip).join("") || "None"}</div>`;
  }

  // ---------- diagrams ----------
  const ident = (s) => s.replace(/[^A-Za-z0-9_]/g, "_");
  function erText(names) {
    const set = new Set(names);
    const lines = ["erDiagram"];
    for (const n of names) {
      const rows = (D.er.entities[n] || []).map((f) => `    ${f.type} ${ident(f.name)}${f.key ? ` ${f.key}` : ""}`);
      lines.push(`  ${ident(n)} {\n${rows.map((r) => `${r}\n`).join("")}  }`);
    }
    for (const r of D.er.relations) if (set.has(r.from) && set.has(r.to)) lines.push(`  ${ident(r.from)} ${r.conn} ${ident(r.to)} : "${String(r.label || "").replace(/"/g, "'")}"`);
    return lines.join("\n");
  }
  let erSeq = 0;
  async function drawEr() {
    for (const el of document.querySelectorAll("[data-er]")) {
      const names = el.dataset.er ? el.dataset.er.split("|").filter((n) => D.entities[n]) : [];
      if (!names.length) { el.textContent = "No entities."; continue; }
      if (!window.mermaid) { el.innerHTML = `<div class="notice">ER viewer not embedded (build without <code>--mermaid</code>).</div><pre>${esc(erText(names))}</pre>`; continue; }
      try {
        const { svg } = await window.mermaid.render(`er${++erSeq}`, erText(names));
        el.innerHTML = svg;
      } catch (e) { el.innerHTML = `<div class="notice">ER render failed: ${esc(e.message || e)}</div>`; }
    }
  }

  let viewer = null;
  async function drawFlow(id) {
    const host = $("flow");
    if (!host || !window.BpmnJS) return;
    const u = ucById[id];
    for (const b of document.querySelectorAll("[data-flow]")) b.setAttribute("aria-pressed", String(b.dataset.flow === id));
    if (viewer) viewer.destroy();
    host.innerHTML = "";
    viewer = new window.BpmnJS({ container: host });
    try {
      await viewer.importXML(u.bpmnXml);
    } catch (e) {
      host.innerHTML = `<div class="notice">Flow has no layout or failed to load: ${esc(e.message || e)}. Run the bpmn-package-explorer pipeline on it first.</div>`;
      return;
    }
    viewer.get("canvas").zoom("fit-viewport");
    markRoles(viewer.get("canvas"), u.roles || []);
    viewer.get("eventBus").on("element.click", (ev) => showElementInfo(ev.element.businessObject));
  }
  function markRoles(canvas, list) {
    const roles = uniq(list.map((r) => r.role));
    for (const r of list) {
      try { canvas.addMarker(r.element, `role-${roles.indexOf(r.role) % 4}`); } catch (_) { /* element not in diagram */ }
    }
    const colors = ["#0b5cad", "#b03a1a", "#1f6f43", "#6a4c93"];
    $("legend").innerHTML = roles.map((r, i) => `<span><i style="border-color:${colors[i % 4]}"></i>${esc(r)}</span>`).join("");
  }
  function showElementInfo(bo) {
    const doc = (bo.documentation || []).map((d) => d.text).join("\n");
    const head = `<b>${esc(bo.name || bo.id)}</b>`;
    $("flowinfo").innerHTML = doc
      ? `${head}<div class="text">${md(doc.replace(/spec:([a-z0-9-]+)#([^;\n]+)/g, "$1 › $2"))}</div>${specLinks(doc)}`
      : `${head} — no documentation.`;
  }
  function specLinks(doc) {
    const ks = [...doc.matchAll(/spec:([a-z0-9-]+)#([^;\n]+)/g)].map((m) => reqKey(m[1], m[2].trim())).filter((k) => reqs[k]);
    return ks.length ? `<div class="chips">${ks.map((k) => `<a class="chip" href="${link({ view: `req:${k.replace(/#/g, "~")}` })}">${esc(k.split("#")[1])}</a>`).join("")}</div>` : "";
  }

  // ---------- render + events ----------
  const VIEWS = { merge: viewMerge, uc: viewUseCase, item: viewItem, req: viewReq, cap: viewCap, ent: viewEntity };
  function render() {
    readHash();
    const kind = state.view === "merge" ? "merge" : state.view.split(":")[0];
    const fn = VIEWS[kind] || viewHome;
    $("main").innerHTML = fn(viewArg(state.view));
    renderTabs();
    renderList();
    const flow = $("flow");
    if (flow) void drawFlow(flow.dataset.uc);
    void drawEr();
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-tab],[data-toggle],[data-clear],[data-flow]");
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderTabs(); renderList(); return; }
    if (t.dataset.flow) { void drawFlow(t.dataset.flow); return; }
    if ("clear" in t.dataset) { go({ sel: [], view: "" }); return; }
    const id = t.dataset.toggle;
    const sel = state.sel.includes(id) ? state.sel.filter((x) => x !== id) : [...state.sel, id];
    go({ sel, view: state.view.startsWith("uc:") || !state.view ? state.view : "merge" });
  });
  document.addEventListener("change", (ev) => {
    const id = ev.target.dataset?.uc;
    if (!id) return;
    const sel = ev.target.checked ? uniq([...state.sel, id]) : state.sel.filter((x) => x !== id);
    go({ sel, view: sel.length ? "merge" : "" });
  });
  $("search").addEventListener("input", (ev) => { state.q = ev.target.value.trim(); renderList(); });
  window.addEventListener("hashchange", () => { render(); $("main").scrollTop = 0; });
  if (window.mermaid) window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  render();
})();
