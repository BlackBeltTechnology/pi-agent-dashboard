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
  const questions = D.questions || [];
  const qById = Object.fromEntries(questions.map((q) => [q.id, q]));
  const itemQuestions = {};
  for (const q of questions) for (const r of q.refs || []) (itemQuestions[r] = itemQuestions[r] || []).push(q.id);
  const flowSteps = buildFlowSteps(); // ref -> [{uc, name}]
  const backlinks = (pred) => D.useCases.filter(pred).map((u) => u.id);
  const itemReqs = {};
  for (const [k, r] of Object.entries(reqs)) for (const ref of r.refs) (itemReqs[ref] = itemReqs[ref] || []).push(k);
  const UI = D.ui || { screens: [], forms: {} };
  const scrById = Object.fromEntries(UI.screens.map((x) => [x.id, x]));
  const uiRefs = buildUiRefIndex(); // ref (BR-1 | cap#Req) -> [{scr, act, how}]
  const formScreens = buildFormScreens();
  function buildFormScreens() {
    const out = {};
    for (const x of UI.screens) for (const f of x.forms || []) out[f.form] = uniq([...(out[f.form] || []), x.id]); // one screen may use a form in several regions
    return out;
  }
  const actionUcs = buildActionUcs(); // "SCR#ACT" -> use-case ids whose flows name the action (ui: lines)
  function buildActionUcs() {
    const out = {};
    for (const u of D.useCases) for (const k of u.uiActions || []) (out[k] = out[k] || []).push(u.id);
    return out;
  }
  const screenUcs = (sid) => D.useCases.filter((u) => (u.screens || []).includes(sid)).map((u) => u.id);

  /** Which UI actions guard, reference or have an effect on a rule/quirk/gap or requirement. */
  function buildUiRefIndex() {
    const out = {};
    const add = (ref, entry) => {
      const k = String(ref).replace(/^spec:/, "").trim();
      (out[k] = out[k] || []).push(entry);
    };
    for (const x of UI.screens) for (const a of x.actions || []) for (const [ref, how] of actionRefPairs(a)) add(ref, { scr: x.id, act: a, how });
    return out;
  }
  function actionRefPairs(a) {
    return [
      ...(a.guards || []).map((g) => [g, "guard"]),
      ...(a.refs || []).map((r) => [r, "ref"]),
      ...(a.effects || []).flatMap((e) => (e.refs || []).map((r) => [r, `effect: ${e.step || e.kind}`])),
    ];
  }

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
  /** Flow steps whose BPMN documentation references a BR/QUIRK/GAP id. */
  function buildFlowSteps() {
    const out = {};
    const parser = new DOMParser();
    for (const uc of D.useCases) {
      if (!uc.bpmnXml) continue;
      const doc = parser.parseFromString(uc.bpmnXml, "application/xml");
      for (const d of doc.getElementsByTagNameNS("*", "documentation")) {
        const name = d.parentElement?.getAttribute("name") || d.parentElement?.getAttribute("id");
        for (const ref of uniq(d.textContent.match(REF_RE) || [])) (out[ref] = out[ref] || []).push({ uc: uc.id, name });
      }
    }
    return out;
  }
  const questionsFor = (refs) => uniq(refs.flatMap((r) => itemQuestions[r] || [])).sort(bySeverity);
  const SEV = { key: 0, high: 1, medium: 2, low: 3 };
  function bySeverity(a, b) {
    const qa = qById[a]; const qb = qById[b];
    return (SEV[qa.severity] ?? 9) - (SEV[qb.severity] ?? 9) || a.localeCompare(b);
  }
  const capItems = (cap) =>
    Object.values(D.items).filter((i) => (i.capabilities || []).includes(cap)).map((i) => i.id).sort(byId);
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
  const state = { sel: [], view: "", tab: "uc", q: "", focus: "" };
  function readHash() {
    // ?sel=…&view=… is the initial state when there is no hash (embedders that drop the fragment)
    const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    state.sel = (p.get("sel") || "").split(",").filter((x) => ucById[x]);
    state.view = p.get("view") || (state.sel.length ? "merge" : "");
    state.focus = p.get("f") || "";
  }
  function link(over) {
    const sel = over.sel ?? state.sel;
    const p = new URLSearchParams();
    if (sel.length) p.set("sel", sel.join(","));
    const view = over.view ?? state.view;
    if (view) p.set("view", view);
    if (over.focus) p.set("f", over.focus);
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
    ["q", "Questions", () => questions.slice().sort((a, b) => bySeverity(a.id, b.id)).map((q) => ({ id: q.id, label: q.text, sub: [q.severity, q.status, q.group].filter(Boolean).join(" · "), view: `q:${q.id}` }))],
    ["ent", "Entities", () => Object.entries(D.entities).map(([k, e]) => ({ id: "", label: k, sub: e.capabilities.join(", "), view: `ent:${k}` }))],
    ...uiTabs(),
  ];
  function uiTabs() {
    if (!UI.screens.length) return [];
    return [
      ["scr", "Screens", () => UI.screens.map((x) => ({ id: x.id, label: x.name, sub: [x.kind, x.route || x.template].filter(Boolean).join(" · "), view: `scr:${x.id}` }))],
      ["form", "Forms", () => Object.values(UI.forms).map((f) => ({ id: f.id, label: f.formKey || f.id, sub: `${(f.fields || []).length} fields${f.variant ? ` · ${f.variant}` : ""}`, view: `form:${f.id}` }))],
    ];
  }
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
      ? `<span class="grow"><b>${state.sel.length}</b> selected</span><a class="chip uc" href="${link({ view: "merge" })}">Merged view</a>${D.ifml ? ifmlLink("sel", "IFML view") : ""}<button class="chip" data-clear>Clear</button>`
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
    if (r.view.startsWith("q:")) return `${qById[id].claim || ""} ${qById[id].note || ""} ${(qById[id].refs || []).join(" ")}`.toLowerCase().includes(q);
    if (r.view.startsWith("ent:")) return D.entities[id].fields.some((f) => f.name.toLowerCase().includes(q));
    if (r.view.startsWith("scr:")) return JSON.stringify(scrById[id]).toLowerCase().includes(q);
    if (r.view.startsWith("form:")) return JSON.stringify(UI.forms[id]).toLowerCase().includes(q);
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
  const sevBadge = (q) => `<span class="badge sev-${esc(q.severity)}">${esc(q.severity)}</span>`;
  const itemLink = (id) => `<a href="${link({ view: `item:${id}` })}">${id}</a>`;
  const scrChip = (sid) => `<a class="chip scr" href="${link({ view: `scr:${sid}` })}">${esc(sid)} ${esc(scrById[sid]?.name || "")}</a>`;
  const formChip = (fid) => `<a class="chip" href="${link({ view: `form:${fid}` })}">${esc(fid)}</a>`;
  /** A BR/QUIRK/GAP id or spec:<cap>#<Req> as a link. */
  function refChip(r) {
    if (D.items[r]) return `<a class="chip" href="${link({ view: `item:${r}` })}">${r}</a>`;
    const k = String(r).replace(/^spec:/, "").trim();
    return reqs[k] ? `<a class="chip" href="${link({ view: `req:${k.replace(/#/g, "~")}` })}">${esc(k.split("#")[1])}</a>` : `<span class="chip">${esc(r)}</span>`;
  }
  /** UI actions pointing at a ref, as a table. */
  function uiActionsTable(key) {
    const rows = uiRefs[key] || [];
    if (!rows.length) return "<p>None.</p>";
    return `<table><tr><th>Screen</th><th>Action</th><th>How</th></tr>${rows.map((r) => `<tr><td>${scrChip(r.scr)}</td><td><a href="${link({ view: `scr:${r.scr}` })}">${esc(r.act.label || r.act.id)}</a> <span class="cite">${esc(r.act.id)}</span></td><td><span class="badge via">${esc(r.how)}</span></td></tr>`).join("")}</table>`;
  }
  /** Screens (and their forms) of a set of use cases; shared marker when >1 use case lists the screen. */
  function screensHtml(list) {
    const count = {};
    for (const u of list) for (const sid of u.screens || []) count[sid] = (count[sid] || 0) + 1;
    const ids = Object.keys(count).filter((sid) => scrById[sid]).sort();
    if (!ids.length) return "<p>No screen recorded.</p>";
    return ids.map((sid) => `<div class="chips">${scrChip(sid)}${count[sid] > 1 && list.length > 1 ? ` <span class="badge shared">shared ×${count[sid]}</span>` : ""}${(scrById[sid].forms || []).map((f) => formChip(f.form)).join("")}</div>`).join("");
  }
  const capLink = (c) => `<a class="chip" href="${link({ view: `cap:${c}` })}">${esc(c)}</a>`;
  /** Question table; `usedBy(qid)` optionally returns use-case ids for a shared marker. */
  function questionsTable(ids, usedBy) {
    if (!ids.length) return "<p>None.</p>";
    return `<table><tr><th>ID</th><th>Question</th><th>Refs</th>${usedBy ? "<th>Use cases</th>" : ""}</tr>${ids.map((id) => {
      const q = qById[id];
      const ucs = usedBy ? usedBy(id) : [];
      const shared = ucs.length > 1 ? ` <span class="badge shared">shared ×${ucs.length}</span>` : "";
      return `<tr><td class="idc"><a href="${link({ view: `q:${id}` })}">${id}</a><br>${sevBadge(q)}${shared}</td><td>${md(q.text)}</td><td>${(q.refs || []).map(itemLink).join(", ")}</td>${usedBy ? `<td>${ucs.join(", ")}</td>` : ""}</tr>`;
    }).join("")}</table>`;
  }
  function itemsTable(ids) {
    if (!ids.length) return "<p>None.</p>";
    return `<table><tr><th>ID</th><th>Statement</th><th>Questions</th></tr>${ids.map((id) => `<tr><td class="idc">${itemLink(id)}<br>${kindBadge(id)}</td><td>${md(clip(D.items[id].statement, 400))}</td><td>${(itemQuestions[id] || []).map((q) => `<a href="${link({ view: `q:${q}` })}">${q}</a>`).join(", ")}</td></tr>`).join("")}</table>`;
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
      <div class="grid">${[["Use cases", D.useCases.length], ["Drawn flows", flows], ["Capabilities", Object.keys(D.capabilities).length], ["Requirements", Object.keys(reqs).length], ["Rules", n("BR")], ["Quirks", n("QUIRK")], ["Gaps", n("GAP")], ["Questions", questions.length], ["Entities", Object.keys(D.entities).length], ...(UI.screens.length ? [["Screens", UI.screens.length], ["Forms", Object.keys(UI.forms).length]] : [])]
        .map(([l, v]) => `<div class="card"><div class="stat">${v}</div>${l}</div>`).join("")}</div>
      ${D.ifml ? `<p>${ifmlLink("all", "IFML view of all screens")}</p>` : ""}
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
    const mergeQs = questionsFor(Object.keys(refCount));
    return `<h2>Merged view</h2><p class="lede">${sel.length} use case${sel.length > 1 ? "s" : ""} — union of flows, requirements, rules and entities. Items used by more than one selected use case are marked <span class="badge shared">shared</span>.</p>
      <div class="chips">${sel.map((u) => `<span class="chip uc">${u.id} ${esc(u.name)} <button class="x" data-toggle="${u.id}" aria-label="Remove ${u.id}">×</button></span>`).join("")}</div>
      <h3>Flows</h3>${flowsHtml(sel)}
      ${UI.screens.length ? `<h3>Screens and forms</h3>${screensHtml(sel)}${ifmlLink("sel", "IFML view of the selection")}` : ""}
      <h3>Requirements (${Object.keys(reqCount).length})</h3>${reqHtml || "<p>None listed.</p>"}
      <h3>Rules, quirks and gaps (${Object.keys(refCount).length})</h3>${refRows ? `<table><tr><th>ID</th><th>Statement</th><th>Used by / source</th></tr>${refRows}</table>` : "<p>None.</p>"}
      <h3>Open questions (${mergeQs.length})</h3>${questionsTable(mergeQs, (qid) => usedBy((u) => (qById[qid].refs || []).some((r) => u.refSource[r])))}
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

  /** Main + alternate flows of the given use cases: [{key, label, xml, roles}]. */
  function flowEntries(list) {
    return list.flatMap((u) => [
      ...(u.bpmnXml ? [{ key: u.id, label: `${u.id} ${u.name}`, xml: u.bpmnXml, roles: u.roles || [] }] : []),
      ...(u.altFlows || []).map((f, i) => ({ key: `${u.id}@${i}`, label: `${u.id} ${f.label}`, xml: f.bpmnXml, roles: f.roles || [] })).filter((f) => f.xml),
    ]);
  }
  const flowByKey = (key) => flowEntries(D.useCases).find((f) => f.key === key);
  function flowsHtml(list) {
    const drawn = flowEntries(list);
    const missing = list.filter((u) => !u.bpmnXml).map((u) => u.id);
    if (!drawn.length) return `<p>No flow drawn for ${missing.join(", ")}.</p>`;
    if (!D.viewers.bpmn) return `<div class="notice">BPMN viewer not embedded (build without <code>--bpmn-js</code>). ${drawn.length} flow(s) available as XML in the source package.</div>`;
    return `<div class="flowtabs">${drawn.map((f, i) => `<button data-flow="${f.key}" aria-pressed="${i === 0}">${esc(f.label)}</button>`).join("")}</div>
      <div class="flow" id="flow" data-uc="${drawn[0].key}"></div><div class="legend" id="legend"></div>
      <div class="flowinfo card" id="flowinfo">Click a task or gateway to see its package references.</div>
      ${missing.length ? `<p class="meta">No flow drawn for ${missing.join(", ")}.</p>` : ""}`;
  }

  function viewUseCase(id) {
    const u = ucById[id];
    if (!u) return viewHome();
    return `<h2>${u.id} ${esc(u.name)}</h2><p class="lede">Actor: <b>${esc(u.actor)}</b> · Trigger: ${esc(u.trigger)}</p>${selectButton(u.id)}
      <h3>Flow</h3>${flowsHtml([u])}
      ${UI.screens.length ? `<h3>Screens and forms</h3>${screensHtml([u])}${uiActionsOfUc(u)}${uiLinksOfUc(u)}${ifmlLink(u.id, "IFML view of this use case")}` : ""}
      <h3>Requirements</h3>${u.reqKeys.map((k) => reqs[k] ? `<details class="card"><summary>${esc(reqs[k].name)} <span class="cite">${esc(reqs[k].cap)}</span></summary><div class="text">${md(reqs[k].text)}</div>${cites(reqs[k].cites)}${scenariosHtml(reqs[k])}</details>` : "").join("")}
      <h3>Rules, quirks and gaps</h3><table><tr><th>ID</th><th>Statement</th><th>Source</th></tr>${u.allRefs.map((r) => `<tr><td class="idc"><a href="${link({ view: `item:${r}` })}">${r}</a><br>${kindBadge(r)}</td><td>${md(clip(D.items[r].statement, 600))}</td><td><span class="badge via">${u.refSource[r]}</span></td></tr>`).join("")}</table>
      <h3>Open questions</h3>${questionsTable(questionsFor(u.allRefs))}
      <h3>Entities</h3><div class="chips">${u.entities.map((e) => `<a class="chip" href="${link({ view: `ent:${e}` })}">${esc(e)}</a>`).join("")}</div>
      <div class="er" data-er="${esc(u.entities.join("|"))}"></div>
      <h3>Related use cases</h3>${relatedHtml([u])}
      ${archSection((r) => r === u.id)}${behSection({ uc: u.id })}${crudUcSection(u.id)}`;
  }

  const listOr = (items, none = "<li>None</li>") => items.join("") || none;
  /** Everything that points at a rule/quirk/gap: capabilities, questions, flow steps, use cases, requirements. */
  function itemLinks(id, it) {
    const steps = (flowSteps[id] || []).map((st) => `<li><a href="${link({ view: `uc:${st.uc}` })}">${st.uc}</a> › ${esc(st.name)}</li>`);
    return `<h3>Capabilities</h3><div class="chips">${listOr((it.capabilities || []).map(capLink), "None")}</div>
      <h3>Questions</h3>${questionsTable((itemQuestions[id] || []).slice().sort(bySeverity))}
      <h3>Flow steps</h3><ul>${listOr(steps)}</ul>
      ${UI.screens.length ? `<h3>UI actions</h3>${uiActionsTable(id)}` : ""}
      <h3>Use cases</h3><div class="chips">${listOr(backlinks((u) => u.refSource[id]).map(ucChip), "None")}</div>
      <h3>Requirements mentioning it</h3><ul>${listOr((itemReqs[id] || []).map((k) => `<li>${reqLink(k)}</li>`))}</ul>
      ${archSection((r) => r === id)}${behSection({ ref: id })}`;
  }
  function viewItem(id) {
    const it = D.items[id];
    if (!it) return viewHome();
    const fields = Object.entries(it.fields).filter(([k]) => k !== "Statement");
    const title = it.title ? `<p class="lede">${esc(it.title)}</p>` : "";
    const table = fields.length ? `<table>${fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${md(v)}</td></tr>`).join("")}</table>` : "";
    return `<h2>${id} ${kindBadge(id)}</h2>${title}
      <div class="card text">${md(it.fields.Statement ? it.statement : it.body)}</div>${cites(it.cites)}${table}
      ${itemLinks(id, it)}`;
  }


  function questionFacts(q) {
    const rows = [
      ["Severity", sevBadge(q)],
      ["Status", q.status && esc(q.status)],
      ["Group", q.group && esc(q.group)],
      ["Source", q.source && esc(q.source)],
      ["Claim", q.claim && md(q.claim)],
      ["Note", q.note && md(q.note)],
      ["Code", q.codeCite && esc(q.codeCite)],
    ];
    return `<table>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
  }
  function viewQuestion(id) {
    const q = qById[id];
    if (!q) return viewHome();
    const refs = q.refs || [];
    const reqKeys = uniq(refs.flatMap((r) => itemReqs[r] || []));
    const ucs = backlinks((u) => refs.some((r) => u.refSource[r]));
    const reqList = reqKeys.map((k) => `<li>${reqLink(k)}</li>`).join("") || "<li>None</li>";
    return `<h2>${id}</h2><div class="card text">${md(q.text)}</div>${questionFacts(q)}
      <h3>Rules, quirks and gaps</h3>${itemsTable(refs)}
      <h3>Use cases affected</h3><div class="chips">${ucs.map(ucChip).join("") || "None"}</div>
      <h3>Requirements</h3><ul>${reqList}</ul>`;
  }

  function viewReq(key) {
    const r = reqs[key];
    if (!r) return viewHome();
    return `<h2>${esc(r.name)}</h2><p class="lede">Capability <a href="${link({ view: `cap:${r.cap}` })}">${esc(r.cap)}</a></p>
      <div class="card text">${md(r.text)}</div>${cites(r.cites)}${scenariosHtml(r)}
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.reqKeys.includes(key)).map(ucChip).join("") || "None"}</div>
      <h3>Rules, quirks and gaps</h3><div class="chips">${r.refs.map((x) => `<a class="chip" href="${link({ view: `item:${x}` })}">${x}</a>`).join("") || "None"}</div>
      <h3>Questions</h3>${questionsTable(questionsFor(r.refs))}
      ${UI.screens.length ? `<h3>UI actions</h3>${uiActionsTable(key)}` : ""}
      ${archSection((x) => x === `spec:${key}`)}`;
  }

  function viewCap(cap) {
    const c = D.capabilities[cap];
    if (!c) return viewHome();
    return `<h2>${esc(cap)}</h2><p class="lede text">${md(c.purpose)}</p>${archSection((r) => r === `cap:${cap}` || r.startsWith(`spec:${cap}#`))}
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.reqKeys.some((k) => k.startsWith(`${cap}#`))).map(ucChip).join("") || "None"}</div>
      <h3>Rules, quirks and gaps (${capItems(cap).length})</h3>${itemsTable(capItems(cap))}
      <h3>Questions</h3>${questionsTable(questionsFor(capItems(cap)))}
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
      <h3>Use cases</h3><div class="chips">${backlinks((u) => u.entities.includes(name)).map(ucChip).join("") || "None"}</div>${behSection({ entity: name })}${crudEntitySection(name)}`;
  }

  const citeSpan = (c) => (c ? ` <span class="cite">${esc(c)}</span>` : "");
  function effectsHtml(a) {
    const rows = (a.effects || []).map((e) => `<li><span class="badge via">${esc(e.kind)}</span> <b>${esc(e.step || "")}</b> ${md(e.target || "")}${citeSpan(e.cite)} ${(e.refs || []).map(refChip).join("")}</li>`);
    return rows.length ? `<ol class="effects">${rows.join("")}</ol>` : "";
  }
  function actionCard(a, sid) {
    const trig = a.trigger ? `${esc(a.trigger.kind || "")}${citeSpan(a.trigger.cite)}` : "—";
    const handler = a.handler ? `<code>${esc(a.handler.name)}</code>${citeSpan(a.handler.cite)}` : "—";
    const guards = (a.guards || []).length ? `<div class="chips"><span class="badge k-GAP">guards</span>${a.guards.map(refChip).join("")}</div>` : "";
    const ucs = actionUcs[`${sid}#${a.id}`] || [];
    const inFlows = ucs.length ? `<div class="chips"><span class="badge via">in flows of</span>${ucs.map(ucChip).join("")}</div>` : "";
    return `<details class="card" id="${esc(a.id)}"${state.focus === a.id ? " open" : ""}><summary>${esc(a.label || a.id)} <span class="cite">${esc(a.id)}</span></summary>${inFlows}
      <table><tr><th>Trigger</th><td>${trig}</td></tr><tr><th>Handler</th><td>${handler}</td></tr></table>
      ${guards}${effectsHtml(a)}<div class="chips">${(a.refs || []).map(refChip).join("")}</div></details>`;
  }
  const rowsTable = (head, rows) => (rows.length ? `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>` : "<p>None.</p>");
  function screenFacts(x) {
    const rows = [
      ["Kind", esc(x.kind)],
      ["Route", x.route && esc(x.route)],
      ["Template", esc(x.template)],
      ["Controller", x.controller && esc(x.controller)],
      ["Opened by", x.opener && `${md(x.opener.trigger || "")}${citeSpan(x.opener.cite)}`],
      ["Confidence", x.confidence && esc(x.confidence)],
    ];
    return `<table>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
  }
  // ---------- Usage evidence (references/usage.md) ----------
  const actLink = (k) => {
    const [sid, aid] = k.split("#");
    return `<a href="${link({ view: `scr:${sid}`, focus: aid })}">${esc(aid)}</a> <span class="cite">${esc(sid)}</span>`;
  };
  function usageMapping(U) {
    return rowsTable(["Log type", "Kind", "Actions", "Use cases", "Cite"], U.mapping.map((t) => [`<code>${esc(t.type)}</code>`, esc(t.kind), t.actions.map(actLink).join("<br>"), t.useCases.map(ucChip).join(""), `<span class="cite">${esc(t.cite || "")}</span>`]));
  }
  function usageCounts(U) {
    const custs = Object.keys(U.customers);
    const ucIds = uniq(custs.flatMap((c) => Object.keys(U.customers[c].byUseCase))).sort();
    const max = Math.max(1, ...custs.flatMap((c) => Object.values(U.customers[c].byUseCase)));
    const num = (n) => (Number.isFinite(Number(n)) ? String(Number(n)) : "?"); // counts only, never markup
    const heat = (n) => (Number(n) ? `<td class="heat" style="--h:${(Number(n) / max).toFixed(2)}">${num(n)}</td>` : "<td></td>");
    const ucRows = ucIds.map((id) => [ucChip(id), ...custs.map((c) => U.customers[c].byUseCase[id] || 0)]);
    const src = custs.map((c) => { const x = U.customers[c]; return [esc(c), num(x.events), num(x.users), x.span ? `${esc(x.span.first)} … ${esc(x.span.last)} (${num(x.span.activeDays)} days)` : "—", Object.entries(x.byKind).map(([k, n]) => `${esc(k)} ${num(n)}`).join(", ")]; });
    const acts = custs.map((c) => [esc(c), Object.entries(U.customers[c].byAction).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${actLink(k)} ${num(n)}`).join("<br>")]);
    return `<h3>Sources</h3>${rowsTable(["Customer", "Events", "Users", "Span", "Kinds"], src)}
      <h3>Use cases by customer</h3><table class="crudm"><tr><th>Use case</th>${custs.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${ucRows.map(([u, ...ns]) => `<tr><th>${u}</th>${ns.map(heat).join("")}</tr>`).join("")}</table>
      <h3>Most used actions</h3>${rowsTable(["Customer", "Actions"], acts)}
      <h3>Not logged (${U.notLogged.length} actions)</h3><p class="meta">The code writes no log for these actions — no usage evidence either way.</p>`;
  }
  function viewUsage() {
    const U = D.usage;
    if (!U) return viewHome();
    const lede = U.customers ? "Local build: counts aggregated from customer log snapshots (users pseudonymized). Never share this file." : "Which UI actions and use cases each application log type evidences. Counts appear only in the local build.";
    return `<h2>Usage evidence</h2><p class="lede">${lede}</p>${U.customers ? usageCounts(U) : ""}<h3>Log types</h3>${usageMapping(U)}`;
  }

  // ---------- Customer variability (references/variability.md) ----------
  const vState = (st) => `<span class="vstate vstate-${st}">${st}</span>`;
  const condText = (c) => `${c.path} ${c.op}${c.value !== undefined ? ` ${JSON.stringify(c.value)}` : ""}`;
  const featCell = (f) => `<b>${esc(f.name)}</b> <span class="cite">${esc(f.id)} · ${esc(condText(f.condition))}</span>`;
  const affectChips = (a) => [...(a.screens || []).map(scrChip), ...(a.actions || []).map((k) => { const [sid, aid] = k.split("#"); return `<a class="chip scr" href="${link({ view: `scr:${sid}`, focus: aid })}">${esc(aid)} <span class="cite">${esc(sid)}</span></a>`; }), ...(a.refs || []).map(refChip)].join("");
  function viewVar(arg) {
    const V = D.variability;
    if (!V) return viewHome();
    if (V.customers.includes(arg)) return viewVarCustomer(V, arg);
    const byVariant = arg === "variants";
    const cols = byVariant ? V.variants : V.customers.map((c) => ({ id: c }));
    const head = cols.map((c) => (byVariant ? `<th class="crudh" title="${esc(c.variant)}">${esc(c.id)}${c.env !== "prod" ? ` (${esc(c.env)})` : ""}</th>` : `<th><a href="${link({ view: `var:${c.id}` })}">${esc(c.id)}</a></th>`)).join("");
    const rows = V.features.map((f) => `<tr><th>${featCell(f)}</th>${cols.map((c) => `<td>${vState(byVariant ? f.byVariant[c.id] : V.byCustomer[f.id][c.id])}</td>`).join("")}</tr>`).join("");
    const toggle = `<div class="chips"><a class="chip${byVariant ? "" : " active"}" href="${link({ view: "var:" })}">by customer</a><a class="chip${byVariant ? " active" : ""}" href="${link({ view: "var:variants" })}">by config variant</a></div>`;
    const F = V.findings;
    const fl = (ids) => `<div class="chips">${ids.map((x) => `<span class="chip">${esc(x)}</span>`).join("") || "None"}</div>`;
    return `<h2>Customer variability</h2><p class="lede">Which behaviour each customer's configuration switches on: ${V.features.length} features from config paths the code reads, evaluated on ${V.variants.length} config variants of ${V.customers.length} customers. Production variants decide a customer's state; demo/test/local variants are shown per variant.</p>${toggle}
      <div class="crudwrap"><table class="crudm vmat"><tr><th>Feature</th>${head}</tr>${rows}</table></div>
      <h3>Findings</h3><h4>Dead everywhere (${F.dead.length})</h4>${fl(F.dead)}<h4>Single-customer features (${F.single.length})</h4>${fl(F.single.map((x) => `${x.id} (${x.customer})`))}<h4>Constant across all variants (${F.constant.length})</h4>${fl(F.constant)}<h4>Customers without an own feature (${F.withoutOwn.length})</h4>${fl(F.withoutOwn)}
      <h3>Configuration that is data, not behaviour (${V.data.length})</h3>${rowsTable(["Path", "Reason"], V.data.map((d) => [`<code>${esc(d.path)}</code>`, esc(d.reason)]))}`;
  }
  function viewVarCustomer(V, c) {
    const rows = V.features.map((f) => [vState(V.byCustomer[f.id][c]), featCell(f), affectChips(f.affects || {})]);
    const un = V.unreachable[c] || [];
    return `<h2>Customer ${esc(c)}</h2><p class="meta">Variants: ${V.variants.filter((v) => v.customer === c).map((v) => `${esc(v.id)} (${esc(v.env)})`).join(", ")}</p>
      <h3>Unreachable UI (${un.length})</h3><div class="chips">${affectChips({ screens: un.filter((x) => !x.includes("#")), actions: un.filter((x) => x.includes("#")) }) || "None"}</div>
      <h3>Features</h3>${rowsTable(["State", "Feature", "Affects"], rows)}`;
  }
  function varScreenSection(sid) {
    const V = D.variability;
    if (!V) return "";
    const fs = V.features.filter((f) => (f.affects?.screens || []).includes(sid) || (f.affects?.actions || []).some((k) => k.startsWith(`${sid}#`)));
    if (!fs.length) return "";
    const off = V.customers.filter((c) => (V.unreachable[c] || []).includes(sid));
    return `<h3>Customer variability</h3>${off.length ? `<p>Screen unreachable for: ${off.map((c) => `<a href="${link({ view: `var:${c}` })}">${esc(c)}</a>`).join(", ")}</p>` : ""}${rowsTable(["Feature", ...V.customers], fs.map((f) => [featCell(f), ...V.customers.map((c) => vState(V.byCustomer[f.id][c]))]))}`;
  }
  function viewScreen(sid) {
    const x = scrById[sid];
    if (!x) return viewHome();
    const fields = (x.fields || []).map((f) => [`<code>${esc(f.key)}</code>`, esc(f.label), esc(f.type), f.required ? "yes" : "", esc(f.binding) + citeSpan(f.cite)]);
    const dialogs = (x.dialogs || []).map((d) => [esc(d.id), esc(d.kind), md(String(d.message ?? "")), esc((d.buttons || []).join(" / ")), esc(d.from || "") + citeSpan(d.cite)]);
    const nav = (x.navigation || []).map((n) => [scrById[n.to] ? scrChip(n.to) : esc(n.to), md(n.trigger || ""), citeSpan(n.cite)]);
    const unmapped = (x.unmapped || []).map((u) => `<li><span class="cite">${esc(u.at)}</span> ${esc(u.reason)}</li>`).join("");
    return `<h2>${esc(x.id)} ${esc(x.name)}</h2>${screenFacts(x)}${ifmlLink(sid, "IFML view of this screen")}${archSection((r) => r === sid)}${behSection({ screen: sid })}${varScreenSection(sid)}${planSection(sid)}
      <h3>Use cases</h3><div class="chips">${listOr(screenUcs(sid).map(ucChip), "None")}</div>
      <h3>Forms</h3><div class="chips">${listOr((x.forms || []).map((f) => `${formChip(f.form)} <span class="cite">${esc(f.region || "")}${f.cite ? ` · ${esc(f.cite)}` : ""}</span>`), "None")}</div>
      ${fields.length ? `<h3>Fields</h3>${rowsTable(["Key", "Label", "Type", "Required", "Binding"], fields)}` : ""}
      <h3>Actions (${(x.actions || []).length})</h3>${(x.actions || []).map((a) => actionCard(a, sid)).join("")}
      <h3>Dialogs (${dialogs.length})</h3>${rowsTable(["ID", "Kind", "Message", "Buttons", "From"], dialogs)}
      <h3>Navigation</h3>${rowsTable(["To", "Trigger", "Cite"], nav)}
      ${unmapped ? `<details class="card"><summary>Not modelled (${(x.unmapped || []).length})</summary><ul>${unmapped}</ul></details>` : ""}`;
  }
  function fieldLabel(l) {
    if (!l || typeof l !== "object") return esc(l);
    return Object.entries(l).filter(([, v]) => v).map(([lang, v]) => `${esc(v)} <span class="cite">${esc(lang)}</span>`).join("<br>");
  }
  const fieldEditable = (e) => (e && typeof e === "object" ? `when <code>${esc(e.when)}</code>` : esc(e ?? ""));
  function fieldCheck(c) {
    if (c.kind === "validation") return `<li><code>${esc(c.when)}</code> → ${esc(c.message)}</li>`;
    return `<li class="flag">unrecognized: <code>${esc(JSON.stringify(c.raw))}</code></li>`;
  }
  function fieldRow(f) {
    const label = fieldLabel(f.label);
    const editable = fieldEditable(f.editable);
    const checks = (f.conditions || []).filter((c) => c.kind !== "init").map(fieldCheck).join("");
    const flags = (f.flags || []).map((x) => `<span class="badge sev-high">${esc(x)}</span>`).join(" ");
    return [`<code>${esc(f.key)}</code><br>${flags}`, label, esc(f.type ?? ""), f.required ? "yes" : "", editable, f.computed ? "yes" : "", esc((f.views || []).join(", ")), checks ? `<ul>${checks}</ul>` : "", `<span class="cite">${esc((f.definedIn || []).join(" · "))}</span>`];
  }
  function viewForm(fid) {
    const f = UI.forms[fid];
    if (!f) return viewHome();
    const views = (f.views || []).map((v) => `${esc(v.id)}${citeSpan(v.cite)}`).join(" · ");
    return `<h2>${esc(fid)}</h2><table>
        ${f.variant ? `<tr><th>Variant</th><td>${esc(f.variant)}</td></tr>` : ""}
        ${f.layers ? `<tr><th>Config layers</th><td>${esc(f.layers.join(" → "))}</td></tr>` : ""}
        ${f.merge ? `<tr><th>Merged at</th><td><span class="cite">${esc(f.merge)}</span></td></tr>` : ""}
        ${views ? `<tr><th>Views</th><td>${views}</td></tr>` : ""}</table>
      <h3>Screens</h3><div class="chips">${listOr((formScreens[fid] || []).map(scrChip), "None")}</div>
      <h3>Fields (${(f.fields || []).length})</h3><div class="scroll">${rowsTable(["Key", "Label", "Type", "Required", "Editable", "Computed", "Views", "Validations", "Defined in"], (f.fields || []).map(fieldRow))}</div>`;
  }

  // ---------- IFML ----------
  function ifmlLink(arg, label) {
    if (!D.ifml) return "";
    return `<a class="chip ifml" href="${link({ view: `ifml:${arg}` })}">${esc(label)}</a>`;
  }
  function uiActionsOfUc(u) {
    const keys = u.uiActions || [];
    if (!keys.length) return "";
    return `<h4>UI actions in its flows</h4><div class="chips">${keys.map((k) => {
      const [sid, aid] = k.split("#");
      const a = (scrById[sid]?.actions || []).find((x) => x.id === aid);
      return `<a class="chip scr" href="${link({ view: `scr:${sid}`, focus: aid })}">${esc(a?.label || aid)} <span class="cite">${esc(sid)}</span></a>`;
    }).join("")}</div>`;
  }
  /** Gated use-case links: BPMN step -> UI action with its evidence; or the reason it has no UI. */
  function uiLinksOfUc(u) {
    if (u.noUi) return `<p class="noui">No UI: ${esc(u.noUi)}</p>`;
    if (!(u.uiLinks || []).length) return "";
    const rows = u.uiLinks.map((l) => {
      const [sid, aid] = l.action.split("#");
      const a = (scrById[sid]?.actions || []).find((x) => x.id === aid);
      const ev = l.evidence?.refs ? `<div class="chips">${l.evidence.refs.map(refChip).join("")}</div>` : `<span class="cite">${esc(l.evidence?.cite || "")}</span>`;
      return `<tr><td>${esc(l.stepName || l.step)} <span class="cite">${esc(l.step)}</span></td><td><a href="${link({ view: `scr:${sid}`, focus: aid })}">${esc(a?.label || aid)}</a> <span class="cite">${esc(sid)}</span></td><td>${ev}</td></tr>`;
    });
    return `<h4>Steps realised by UI actions</h4><table><tr><th>Step</th><th>Action</th><th>Evidence</th></tr>${rows.join("")}</table>`;
  }
  /** Screens shown for an IFML view argument: all | sel | UC-id | screen id. */
  function ifmlScreens(arg) {
    if (arg === "all") return UI.screens.map((x) => x.id);
    if (arg === "sel") return uniq(state.sel.flatMap((id) => ucById[id].screens || []));
    if (ucById[arg]) return ucById[arg].screens || [];
    return scrById[arg] ? [arg] : [];
  }
  /** Highlighted actions (named by ui: lines of the shown use cases). */
  function ifmlHighlight(arg) {
    const ucs = arg === "sel" ? state.sel : ucById[arg] ? [arg] : [];
    return new Set(ucs.flatMap((id) => ucById[id].uiActions || []));
  }
  const mLabel = (s, n = 42) => clip(String(s ?? ""), n).replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
  /** Element subset + flows for a set of screens: {els, flows, nid} with mermaid-safe ids. */
  function ifmlSubset(screens, only = null) {
    const keep = new Set(screens);
    const els = D.ifml.elements.filter((e) => keep.has(e.trace.screen) && (!only || only.has(e.id)));
    const ids = new Set(els.map((e) => e.id));
    const nid = Object.fromEntries(els.map((e, i) => [e.id, `n${i}`]));
    const isDone = (id) => els.find((e) => e.id === id)?.type === "ActionEvent";
    const drawn = (id) => (isDone(id) ? els.find((e) => e.id === id)?.parent : id);
    const flows = D.ifml.flows.filter((f) => ids.has(f.source) && ids.has(f.target)).map((f) => ({ from: drawn(f.source), to: f.target, done: isDone(f.source) }));
    return { els, flows, nid };
  }
  const isGuarded = (e) => D.ifml.elements.some((x) => x.parent === e.id && x.type === "ActivationExpression");
  const IFML_SHAPE = {
    Form: (id, e, n) => `${id}["«Form» ${mLabel(e.name)}<br/>${n} fields"]:::form`,
    // Events: compact stadium with a dot (Mermaid sizes circles to the label, which hides the layout).
    OnSubmitEvent: (id, e) => `${id}(["● submit: ${mLabel(e.name, 28)}"]):::event`,
    ViewElementEvent: (id, e) => `${id}(["● ${mLabel(e.name, 30)}"]):::event`,
    Action: (id, e) => `${id}{{"«Action» ${mLabel(e.name, 32)}"}}:::action`,
  };
  function windowLines(w, sub) {
    const forms = sub.els.filter((e) => e.parent === w.id && e.type === "Form");
    const onForm = (e) => forms.some((f) => f.id === e.parent);
    const events = sub.els.filter((e) => IFML_SHAPE[e.type] && /Event$/.test(e.type) && (e.parent === w.id || onForm(e)));
    const inner = [...forms, ...events];
    const title = `${w.attrs.isModal ? "«Modal»" : "«Window»"} ${mLabel(w.name, 48)}`;
    if (!inner.length) return [`  ${sub.nid[w.id]}[/"${title}"/]:::modal`];
    const fields = (e) => sub.els.filter((x) => x.parent === e.id && /Field$/.test(x.type)).length;
    return [
      `  subgraph ${sub.nid[w.id]}["${title}"]`,
      "  direction TB",
      ...inner.map((e) => `    ${IFML_SHAPE[e.type](sub.nid[e.id], e, fields(e))}`),
      "  end",
      ...events.filter(onForm).map((e) => `  ${sub.nid[e.parent]} -.- ${sub.nid[e.id]}`),
    ];
  }
  function ifmlText(sub, hi) {
    const lines = ["flowchart LR"];
    for (const w of sub.els.filter((e) => e.type === "Window")) lines.push(...windowLines(w, sub));
    for (const a of sub.els.filter((e) => e.type === "Action")) lines.push(`  ${IFML_SHAPE.Action(sub.nid[a.id], a)}`);
    for (const f of sub.flows) lines.push(`  ${sub.nid[f.from]} ${f.done ? '-->|"done"|' : "-->"} ${sub.nid[f.to]}`);
    const guarded = sub.els.filter(isGuarded).map((e) => sub.nid[e.id]);
    const hot = sub.els.filter((e) => hi.has(`${e.trace.screen}#${e.trace.action}`) && /Event|Action/.test(e.type)).map((e) => sub.nid[e.id]);
    lines.push("  classDef form fill:#eef5ff,stroke:#0b5cad", "  classDef event fill:#fff,stroke:#333", "  classDef action fill:#fff4e5,stroke:#b03a1a", "  classDef modal fill:#fff,stroke:#6a4c93,stroke-dasharray:4 3", "  classDef guarded stroke:#b03a1a,stroke-width:3px", "  classDef hot fill:#e6f4ea,stroke:#1f6f43,stroke-width:3px");
    if (guarded.length) lines.push(`  class ${guarded.join(",")} guarded`);
    if (hot.length) lines.push(`  class ${uniq(hot).join(",")} hot`);
    for (const w of sub.els.filter((e) => e.type === "Window" && e.attrs.isModal && sub.els.some((k) => k.parent === e.id))) lines.push(`  style ${sub.nid[w.id]} stroke-dasharray:4 3`);
    return lines.join("\n");
  }
  /** Where a click on an IFML element goes. */
  function ifmlTarget(e) {
    if (e.trace.form && !e.trace.field && UI.forms[e.trace.form]) return link({ view: `form:${e.trace.form}` });
    return link({ view: `scr:${e.trace.screen}`, focus: e.trace.action || e.trace.dialog || "" });
  }
  function ifmlTable(sub) {
    const shown = sub.els.filter((e) => ["Window", "Form", "OnSubmitEvent", "ViewElementEvent", "Action"].includes(e.type));
    return `<table><tr><th>IFML</th><th>Name</th><th>Trace</th></tr>${shown.map((e) => `<tr><td><span class="badge via">${esc(e.type)}</span>${isGuarded(e) ? ' <span class="badge k-GAP">guarded</span>' : ""}</td><td><a href="${ifmlTarget(e)}">${esc(e.name)}</a></td><td class="cite">${esc([e.trace.screen, e.trace.action || e.trace.dialog || e.trace.form].filter(Boolean).join(" › "))}</td></tr>`).join("")}</table>`;
  }
  // ---------- IFML split (overview + parts, see references/splitting.md) ----------
  const SPLIT = D.ifmlSplit;
  const BUDGET = { nodes: 30, edges: 40, ...D.meta.budget };
  const partById = Object.fromEntries(Array.from(SPLIT?.parts ?? [], (p) => [p.id, p]));
  const isSplit = () => (SPLIT?.parts.length || 0) > 1;
  const partsOfScreen = (sid) => (SPLIT?.parts || []).filter((p) => p.screens.some((s) => s.id === sid));
  const partChip = (p) => `<a class="chip ifml" href="${link({ view: `ifml:part:${p.id}` })}">${esc(p.title)} <span class="cite">${p.size.nodes}/${p.size.edges}</span></a>`;
  function viewIfmlOverview() {
    const areas = SPLIT.overview.nodes.map((n) => `<h4>${esc(n.title)} <span class="meta">${n.screens} screen(s)</span></h4><div class="chips">${n.parts.map((id) => partChip(partById[id])).join("")}</div>`);
    return `<h2>IFML overview</h2><p class="lede">The UI model (${SPLIT.size.nodes} elements, ${SPLIT.size.edges} flows) is split into ${SPLIT.parts.length} parts of at most ${BUDGET.nodes} elements / ${BUDGET.edges} flows. Areas group each route with the dialogs and panels it opens; arrows count navigation between areas. Click an area or a part.</p>
      <div class="chips">${ifmlLink("full", "Whole model (large)")}<button class="chip" data-xmi>Download IFML XMI</button></div>
      <h3>Areas</h3><div class="er" data-mmd="ifmlovw:"></div><h3>Parts</h3>${areas.join("")}`;
  }
  function viewIfmlPart(id) {
    const p = partById[id];
    if (!p) return viewIfmlOverview();
    const area = SPLIT.overview.nodes.find((n) => n.id === p.area);
    const sib = area.parts;
    const i = sib.indexOf(id);
    const nav = [i > 0 ? `<a class="chip" href="${link({ view: `ifml:part:${sib[i - 1]}` })}">← previous</a>` : "", i < sib.length - 1 ? `<a class="chip" href="${link({ view: `ifml:part:${sib[i + 1]}` })}">next →</a>` : ""].join("");
    const ids = new Set([...p.xmi.matchAll(/xmi:id="([^"]+)"/g)].map((m) => m[1]));
    const sub = ifmlSubset(uniq(p.screens.map((s) => s.id)), ids);
    const screens = uniq(p.screens.map((s) => s.id)).map(scrChip).join("");
    return `<p class="meta"><a href="${link({ view: "ifml:all" })}">IFML overview</a> › ${esc(area.title)} › ${esc(p.title)}</p>
      <h2>IFML · ${esc(p.title)}</h2><p class="lede">Part ${i + 1} of ${sib.length} in area ${esc(area.title)}: ${p.size.nodes} elements, ${p.size.edges} flows (budget ${BUDGET.nodes}/${BUDGET.edges}). Flows to records outside this part are listed on the screen pages.</p>
      <div class="chips">${nav}${screens}</div>
      ${D.viewers.ifml ? `<div class="ifmlcanvas" id="ifmlcanvas" data-ifmljs="part:${esc(id)}"></div>` : `<div class="er" data-ifml="part:${esc(id)}"></div>`}
      <h3>Elements</h3>${ifmlTable(sub)}`;
  }
  /** Split views take over: overview for "all", a part, or a split screen's first part; else null. */
  function ifmlSplitView(arg) {
    if (arg === "all" && isSplit()) return viewIfmlOverview();
    if (arg.startsWith("part:")) return viewIfmlPart(arg.slice(5));
    const parts = scrById[arg] ? partsOfScreen(arg) : [];
    if (parts.length < 2) return null;
    return `<div class="notice">${esc(arg)} is split into ${parts.length} parts: ${parts.map(partChip).join(" ")}</div>${viewIfmlPart(parts[0].id)}`;
  }
  function viewIfml(view) {
    if (!D.ifml) return viewHome();
    return ifmlSplitView(view || "") || viewIfmlScope(view === "full" ? "all" : view);
  }
  /** Unsplit IFML view of a scope: all | sel | UC-id | screen id. */
  function viewIfmlScope(arg) {
    const screens = ifmlScreens(arg);
    const sub = ifmlSubset(screens);
    const scope = arg === "all" ? "all screens" : arg === "sel" ? `selected use cases (${state.sel.join(", ") || "none"})` : arg;
    return `<h2>IFML view</h2><p class="lede">Interaction Flow Modeling Language (OMG IFML 1.0) projection of the UI model — ${esc(scope)}: ${screens.length} screen(s), ${sub.els.length} elements, ${sub.flows.length} flows. ${D.viewers.ifml ? "Windows hold forms with fields and events (circles); events trigger actions (hexagons) whose done event leads on; activation expressions mark guards; out-of-scope elements are dimmed" : 'Windows hold forms and events (● rounded); events trigger actions (hexagons); <span class="badge k-GAP">guarded</span> events have an activation expression'}; green = action named by the use case flows. Click an element to open it.</p>
      <div class="chips">${ifmlLink("all", "All screens")}${state.sel.length ? ifmlLink("sel", "Selected use cases") : ""}<button class="chip" data-xmi>Download IFML XMI</button></div>
      ${D.viewers.ifml ? `<div class="ifmlcanvas" id="ifmlcanvas" data-ifmljs="${esc(arg)}"></div><p class="meta">Rendered with ifml-js (OMG IFML notation, IFML-DI from the export). Drag to pan, wheel to zoom.</p>` : `<div class="er" data-ifml="${esc(arg)}"></div>`}
      <h3>Elements</h3>${ifmlTable(sub)}`;
  }
  /** Render the embedded XMI with ifml-js; scope zoom, dimming, highlight and click-through. */
  async function drawIfmlJs() {
    const el = document.querySelector("[data-ifmljs]");
    if (!el || !window.IfmlJS) return;
    const arg = el.dataset.ifmljs;
    const viewer = new window.IfmlJS({ container: el });
    const part = arg.startsWith("part:") ? partById[arg.slice(5)] : null;
    try {
      await viewer.importXML(part ? part.xmi : D.ifmlXmi);
    } catch (e) { el.innerHTML = `<div class="notice">IFML import failed: ${esc(e.message || e)}</div>`; return; }
    if (part) return wireIfmlJs(viewer, true);
    const sub = ifmlSubset(ifmlScreens(arg));
    const inScope = new Set([...sub.els.map((e) => e.id), ...D.ifml.flows.filter((f) => sub.els.some((e) => e.id === f.source)).map((f) => f.id)]);
    const hot = ifmlHighlight(arg);
    const canvas = viewer.get("canvas");
    const shapes = viewer.get("elementRegistry").getAll().filter((s) => s.businessObject && s.type !== "label" && s.parent);
    for (const s of shapes) markIfmlShape(canvas, s, arg === "all" || inScope.has(s.id), hot);
    zoomToScope(canvas, shapes.filter((s) => inScope.has(s.id) && s.width));
    wireIfmlJs(viewer, false);
  }
  function wireIfmlJs(viewer, fit) {
    if (fit) viewer.get("canvas").zoom("fit-viewport");
    viewer.get("eventBus").on("element.click", (ev) => {
      // ifml-moddle keeps the XMI id in $id; the diagram shape id equals it
      const g = D.ifml.elements.find((x) => x.id === ev.element.id || x.id === ev.element.businessObject?.$id);
      if (g) location.hash = ifmlTarget(g);
    });
  }
  function markIfmlShape(canvas, s, keep, hot) {
    if (!keep) canvas.addMarker(s.id, "ifml-dim");
    const g = D.ifml.elements.find((x) => x.id === s.id);
    if (g?.trace.action && hot.has(`${g.trace.screen}#${g.trace.action}`) && /Event|Action/.test(g.type)) canvas.addMarker(s.id, "ifml-hot");
  }
  function zoomToScope(canvas, list) {
    if (!list.length) return canvas.zoom("fit-viewport");
    const x = Math.min(...list.map((s) => s.x)) - 40;
    const y = Math.min(...list.map((s) => s.y)) - 40;
    const w = Math.max(...list.map((s) => s.x + s.width)) - x + 40;
    const h = Math.max(...list.map((s) => s.y + s.height)) - y + 40;
    canvas.viewbox({ x, y, width: w, height: h });
  }

  let ifmlSeq = 0;
  async function drawIfml() {
    const el = document.querySelector("[data-ifml]");
    if (!el) return;
    const arg = el.dataset.ifml;
    const part = arg.startsWith("part:") ? partById[arg.slice(5)] : null;
    const sub = part ? ifmlSubset(uniq(part.screens.map((s) => s.id)), new Set([...part.xmi.matchAll(/xmi:id="([^"]+)"/g)].map((m) => m[1]))) : ifmlSubset(ifmlScreens(arg));
    if (!sub.els.length) { el.textContent = "No screen in scope."; return; }
    const text = ifmlText(sub, ifmlHighlight(arg));
    if (!window.mermaid) { el.innerHTML = `<div class="notice">Diagram viewer not embedded (build without <code>--mermaid</code>).</div><pre>${esc(text)}</pre>`; return; }
    try {
      const { svg } = await window.mermaid.render(`ifml${++ifmlSeq}`, text);
      el.innerHTML = svg;
      wireIfmlClicks(el, sub);
    } catch (e) { el.innerHTML = `<div class="notice">IFML render failed: ${esc(e.message || e)}</div><pre>${esc(text)}</pre>`; }
  }
  function wireIfmlClicks(el, sub) {
    const byNid = Object.fromEntries(sub.els.map((e) => [sub.nid[e.id], e]));
    for (const g of el.querySelectorAll("g.node, g.cluster")) {
      const m = (g.id || "").match(/(?:^|-)(n\d+)(?:-|$)/);
      const e = m && byNid[m[1]];
      if (!e) continue;
      g.style.cursor = "pointer";
      g.addEventListener("click", () => { location.hash = ifmlTarget(e); });
    }
  }
  function downloadXmi() {
    const url = URL.createObjectURL(new Blob([D.ifmlXmi], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${D.meta.title.replace(/[^\w.-]+/g, "_")}.ifml.xmi`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      el.innerHTML = await erHtml(names);
    }
  }
  /** ER of an entity set; over the node budget one diagram per authored ER cluster, then chunks (erChunks, split.mjs). */
  async function erHtml(names) {
    const chunks = typeof erChunks === "function" ? erChunks(names, D.er.clusters || [], BUDGET.nodes) : [{ name: null, entities: names }];
    const html = [];
    for (const [i, c] of chunks.entries()) {
      try {
        const { svg } = await window.mermaid.render(`er${++erSeq}`, erText(c.entities));
        html.push(chunks.length > 1 ? `<h4>${esc(c.name || "other entities")} <span class="meta">${i + 1}/${chunks.length} · ${c.entities.length} entities</span></h4>${svg}` : svg);
      } catch (e) { html.push(`<div class="notice">ER render failed: ${esc(e.message || e)}</div>`); }
    }
    return html.join("");
  }

  let viewer = null;
  async function drawFlow(id) {
    const host = $("flow");
    if (!host || !window.BpmnJS) return;
    const u = flowByKey(id);
    if (!u) return;
    for (const b of document.querySelectorAll("[data-flow]")) b.setAttribute("aria-pressed", String(b.dataset.flow === id));
    if (viewer) viewer.destroy();
    host.innerHTML = "";
    viewer = new window.BpmnJS({ container: host });
    try {
      await viewer.importXML(u.xml);
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

  // ---------- architecture (C4 / C5) ----------
  const A = D.arch;
  const archById = A ? Object.fromEntries(A.model.elements.map((e) => [e.id, e])) : {};
  const ARCH_TERMS = { person: ["Person", "User"], system: ["Software System", "System"], container: ["Container", "Component"], component: ["Component", "Element"], node: ["Deployment Node", "Deployment Node"] };
  const archChip = (id) => `<a class="chip arch" href="${link({ view: `archel:${id}` })}">${esc(archById[id]?.name || id)}</a>`;
  /** Architecture elements whose refs satisfy `pred`, as a section (empty without a model or a hit). */
  function archSection(pred) {
    if (!A) return "";
    const ids = A.model.elements.filter((e) => (e.refs || []).some(pred)).map((e) => e.id);
    return ids.length ? `<h3>Architecture</h3><div class="chips">${ids.map(archChip).join("")}</div>` : "";
  }
  const archViewLabel = (v) => (v.id === "c5" ? "C5 model" : v.title.replace(/^C4 · /, ""));
  const archViewChip = (v, cur) => `<a class="chip arch${v.id === cur ? " active" : ""}" href="${link({ view: `arch:${v.id}` })}">${esc(archViewLabel(v))}</a>`;
  const ARCH_LEDE = {
    c4: "C4 model (c4model.com): people, software systems, containers (separately runnable/deployable units), components inside a container, deployment nodes. Relations between nested parts are lifted to the level shown",
    c5: "C5 model (softwarearchitecturemodels.com): a System is composed of Components (deployable units, = C4 containers), a Component of Elements (= C4 components); dotted arrows: a Deployment Node deploys a Component",
  };
  function archRefChip(r) {
    if (r.startsWith("cap:")) return capLink(r.slice(4));
    if (scrById[r]) return scrChip(r);
    if (ucById[r]) return ucChip(r);
    return refChip(r);
  }
  function archTable(ids) {
    const rows = ids.map((id) => archById[id]).filter(Boolean).map((e) => [archChip(e.id), `${ARCH_TERMS[e.kind][0]} / ${ARCH_TERMS[e.kind][1]}${e.external ? " (external)" : ""}`, esc(e.tech || ""), (e.refs || []).map(archRefChip).join("")]);
    return rowsTable(["Element", "C4 / C5", "Technology", "Refs"], rows);
  }
  function viewArch(id) {
    if (!A) return viewHome();
    const v = A.views.find((x) => x.id === id) || A.views[0];
    const c4 = A.views.filter((x) => x.id !== "c5");
    return `<h2>Architecture</h2><p class="lede"><b>${esc(v.title)}</b> — ${ARCH_LEDE[v.id === "c5" ? "c5" : "c4"]}. Click a box to open it.</p>
      <div class="chips"><span class="badge via">C4</span>${c4.map((x) => archViewChip(x, v.id)).join("")}</div>
      <div class="chips"><span class="badge via">C5</span>${A.views.filter((x) => x.id === "c5").map((x) => archViewChip(x, v.id)).join("")}<button class="chip" data-dl="dsl">Download Structurizr DSL</button><button class="chip" data-dl="c4">Download Mermaid C4</button></div>
      <div class="er" data-arch="${esc(v.id)}"></div>
      <h3>Elements</h3>${archTable(Object.values(v.nodes))}`;
  }
  /** Header buttons: Architecture and IFML (each only when the package has it). */
  function renderTopnav() {
    const on = (cls) => state.view.startsWith(cls) || (cls === "beh" && /^(seq|sm|obj):/.test(state.view));
    const btn = (show, cls, view, text) => (show ? `<a class="chip ${cls}${on(cls) ? " active" : ""}" href="${link({ view })}">${text}</a>` : "");
    $("topnav").innerHTML = btn(A, "arch", `arch:${A?.views[0].id}`, "Architecture") + btn(D.ifml, "ifml", "ifml:all", "IFML") + btn(UI.styleKit, "kit", "kit:", "Style kit") + btn(behCount(), "beh", "beh:", "Behaviour") + btn(D.crud, "crud", "crud:", "CRUD") + btn(D.variability, "var", "var:", "Variability") + btn(D.usage, "use", "use:", D.usage?.customers ? "Usage (local)" : "Usage");
  }
  function archFacts(e) {
    const hostedOn = A.model.elements.filter((x) => (x.hosts || []).includes(e.id)).map((x) => x.id);
    const rows = [
      ["C4", ARCH_TERMS[e.kind][0] + (e.external ? " (external)" : "")],
      ["C5", ARCH_TERMS[e.kind][1]],
      ["Technology", esc(e.tech || "")],
      ["Part of", e.parent ? archChip(e.parent) : ""],
      ["Deployed on", hostedOn.map(archChip).join("")],
      ["Hosts", (e.hosts || []).map(archChip).join("")],
    ];
    return `<table>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
  }
  function archRelRows(e) {
    const rel = (A.model.relations || []).filter((r) => r.from === e.id || r.to === e.id);
    return rel.map((r) => [r.from === e.id ? "→" : "←", archChip(r.from === e.id ? r.to : r.from), esc(r.label || ""), esc(r.tech || ""), (r.cites || []).map((c) => `<span class="cite">${esc(c)}</span>`).join(" ")]);
  }
  function viewArchEl(id) {
    const e = archById[id];
    if (!e) return viewHome();
    const children = A.model.elements.filter((x) => x.parent === id).map((x) => x.id);
    const views = A.views.filter((v) => Object.values(v.nodes).includes(id));
    return `<h2>${esc(e.name)}</h2>${e.description ? `<p class="lede text">${md(e.description)}</p>` : ""}
      ${archFacts(e)}
      <div class="chips"><span class="badge via">shown in</span>${views.map((v) => archViewChip(v, "")).join("")}</div>
      ${children.length ? `<h3>Contains (${children.length})</h3>${archTable(children)}` : ""}
      <h3>Relations</h3>${rowsTable(["", "With", "What", "Technology", "Cites"], archRelRows(e))}
      <h3>Code</h3>${(e.cites || []).length ? `<div class="cite">${e.cites.map(esc).join(" · ")}</div>` : "<p>No cite.</p>"}
      <h3>Package refs</h3><div class="chips">${listOr((e.refs || []).map(archRefChip), "None")}</div>`;
  }
  let archSeq = 0;
  async function drawArch() {
    const el = document.querySelector("[data-arch]");
    if (!el || !A) return;
    const v = A.views.find((x) => x.id === el.dataset.arch) || A.views[0];
    if (!window.mermaid) { el.innerHTML = `<div class="notice">Diagram viewer not embedded (build without <code>--mermaid</code>).</div><pre>${esc(v.mermaid)}</pre>`; return; }
    try {
      const { svg } = await window.mermaid.render(`arch${++archSeq}`, v.mermaid);
      el.innerHTML = svg;
      wireArchClicks(el, v);
    } catch (err) { el.innerHTML = `<div class="notice">Architecture render failed: ${esc(err.message || err)}</div><pre>${esc(v.mermaid)}</pre>`; }
  }
  function wireArchClicks(el, v) {
    for (const g of el.querySelectorAll("g.node, g.cluster")) {
      const m = (g.id || "").match(/(?:^|-)(n\d+)(?:-|$)/);
      const target = m && v.nodes[m[1]];
      if (!target) continue;
      g.style.cursor = "pointer";
      g.addEventListener("click", (ev) => { ev.stopPropagation(); location.hash = link({ view: `archel:${target}` }); });
    }
  }
  const downloadArch = (kind) => (kind === "dsl" ? downloadText(A.dsl, "workspace.dsl", "text/plain") : downloadText(A.c4, "c4.md", "text/markdown"));
  function downloadText(text, ext, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${D.meta.title.replace(/[^\w.-]+/g, "_")}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- behaviour: sequences (+ collaboration), state machines, object diagrams ----------
  const B = D.behaviour || { sequences: [], states: [], objects: [] };
  const BEH = { seq: B.sequences, sm: B.states, obj: B.objects };
  const behById = (kind, id) => BEH[kind].find((x) => x.id === id);
  const BEH_NAME = { seq: "Sequence", sm: "State machine", obj: "Object diagram" };
  const behChip = (kind, r) => `<a class="chip beh" href="${link({ view: `${kind}:${r.id}` })}">${esc(r.id)} ${esc(r.title || "")}${r.local ? " · local" : ""}</a>`;
  const behCount = () => B.sequences.length + B.states.length + B.objects.length;
  /** Records pointing at a rule/quirk/gap, entity, use case or screen. */
  // ---------- CRUD matrix (references/crud-matrix.md) ----------
  const CRUD_OPS = { C: "create", R: "read", U: "update", D: "delete" };
  const crudCell = (ops) => (ops ? [...ops].map((o) => `<span class="crudop crudop-${o}" title="${CRUD_OPS[o]}">${o}</span>`).join("") : "");
  const entLink = (e) => `<a href="${link({ view: `ent:${e}` })}">${esc(e)}</a>`;
  const FINDINGS = [
    ["neverWritten", "Never written by the UI", "read only — written by an import, the ERP or another system?"],
    ["neverRead", "Never read by the UI", "written but not shown — export target, audit trail or dead data?"],
    ["createdNeverDeleted", "Created but never deleted", "grows forever — archival or clean-up elsewhere?"],
    ["untouched", "Untouched by the UI", "persistent but no UI effect — background job, ERP side or unused?"],
  ];
  function viewCrud(arg) {
    const C = D.crud;
    if (!C) return viewHome();
    const bySc = arg === "scr";
    const cols = bySc ? C.screens : C.useCases.filter((u) => Object.keys(C.byUseCase[u] || {}).length);
    const map = bySc ? C.byScreen : C.byUseCase;
    const ents = Object.keys(C.byEntity).sort();
    const head = cols.map((c) => `<th class="crudh"><a href="${link({ view: bySc ? `scr:${c}` : `uc:${c}` })}" title="${esc(bySc ? scrById[c]?.name || c : ucById[c]?.name || c)}">${esc(c.replace(/^(SCR|DLG)-/, ""))}</a></th>`).join("");
    const rows = ents.map((e) => `<tr><th>${entLink(e)}</th>${cols.map((c) => `<td class="crudc">${crudCell(map[c]?.[e])}</td>`).join("")}</tr>`).join("");
    const toggle = `<div class="chips"><a class="chip${bySc ? "" : " active"}" href="${link({ view: "crud:uc" })}">by use case</a><a class="chip${bySc ? " active" : ""}" href="${link({ view: "crud:scr" })}">by screen</a></div>`;
    const finds = FINDINGS.map(([k, h, q]) => `<h4>${h} (${C.findings[k].length})</h4><p class="meta">${q}</p><div class="chips">${C.findings[k].map((e) => `<a class="chip" href="${link({ view: `ent:${e}` })}">${esc(e)}</a>`).join("") || "None"}</div>`).join("");
    return `<h2>CRUD matrix</h2><p class="lede">Which use case or screen creates, reads, updates or deletes each entity, from the classified UI effects (each cited to code). ${ents.length} entities touched; findings cover the persistent entities of the model.</p>${toggle}
      <div class="crudwrap"><table class="crudm"><tr><th>Entity</th>${head}</tr>${rows}</table></div><h3>Findings</h3>${finds}`;
  }
  function crudEntitySection(name) {
    const list = D.crud?.byEntity[name];
    if (!list) return "";
    return `<h3>CRUD</h3>${rowsTable(["Op", "Action", "Effect", "Note"], list.map((x) => {
      const [sid, aid] = x.action.split("#");
      return [crudCell(x.op), `<a href="${link({ view: `scr:${sid}`, focus: aid })}">${esc(x.action)}</a>`, `<code>${esc(x.effect)}</code>`, esc(x.note)];
    }))}`;
  }
  function crudUcSection(id) {
    const row = D.crud?.byUseCase[id];
    if (!row || !Object.keys(row).length) return "";
    return `<h3>CRUD</h3><div class="chips">${Object.keys(row).sort().map((e) => `<a class="chip" href="${link({ view: `ent:${e}` })}">${esc(e)} ${crudCell(row[e])}</a>`).join("")}</div>`;
  }
  function behSection({ ref, entity, uc, screen }) {
    const hit = {
      seq: B.sequences.filter((s) => (ref && s.refs.includes(ref)) || (entity && s.entities.includes(entity)) || (uc && s.useCase === uc) || (screen && (s.action || "").split("#")[0] === screen) || (screen && s.participants.some((p) => p.ref === screen))),
      sm: B.states.filter((m) => (ref && m.refs.includes(ref)) || (entity && m.entity === entity)),
      obj: B.objects.filter((o) => entity && o.entities.includes(entity)),
    };
    const chips = Object.entries(hit).flatMap(([k, rs]) => rs.map((r) => behChip(k, r)));
    return chips.length ? `<h3>Behaviour</h3><div class="chips">${chips.join("")}</div>` : "";
  }
  const behDiagram = (key, title) => `<h3>${title}</h3><div class="behd" data-mmd="${esc(key)}"></div>`;
  const behDownloads = (kind, r) => `<div class="chips"><button class="chip" data-beh-dl="${kind}:${esc(r.id)}:mmd">Mermaid (.mmd)</button>${kind === "seq" ? `<button class="chip" data-beh-dl="seq:${esc(r.id)}:collab">Collaboration (.mmd)</button>` : ""}${kind === "sm" ? `<button class="chip" data-beh-dl="sm:${esc(r.id)}:scxml">SCXML</button>` : ""}</div>`;
  const behRefs = (refs) => (refs || []).map(refChip).join("");
  function viewBeh() {
    const group = (kind, list, lede) => `<h3>${BEH_NAME[kind]}s (${list.length})</h3><p class="meta">${lede}</p><div class="chips">${list.map((r) => behChip(kind, r)).join("") || "None"}</div>`;
    return `<h2>Behaviour</h2><p class="lede">Dynamic models of the legacy system, each element cited to code and linked to rules, quirks and gaps.</p>
      ${group("seq", B.sequences, "Who calls whom for one user action (UML sequence); each also shown as a collaboration diagram with numbered messages.")}
      ${group("sm", B.states, "Lifecycle of one entity field: states (allowed values from the model), transitions with trigger, guard and effects.")}
      ${group("obj", B.objects, "Concrete instances of ER entities and their links: synthetic, or masked real data (local builds only).")}`;
  }
  function participantCell(p) {
    if (p.kind === "element" && A) return archChip(p.ref);
    if (p.kind === "screen" && scrById[p.ref]) return scrChip(p.ref);
    return esc(p.label || p.id);
  }
  function messageRows(list, depth, out) {
    for (const m of list || []) {
      if (m.fragment) {
        out.push([`<b>${esc(m.fragment)}</b>`, "", `<i>${esc(m.label)}</i>`, "", behRefs(m.refs)]);
        messageRows(m.messages, depth + 1, out);
        if (m.else) {
          out.push(["<b>else</b>", "", `<i>${esc(m.else.label)}</i>`, "", ""]);
          messageRows(m.else.messages, depth + 1, out);
        }
        continue;
      }
      out.push([String(out.filter((r) => r.n).length + 1), `${esc(m.from)} → ${esc(m.to)}`, `${"&nbsp;&nbsp;".repeat(depth)}${esc(m.label)}${m.note ? `<div class="meta">${esc(m.note)}</div>` : ""}`, citeSpan(m.cite), behRefs(m.refs)]);
      out[out.length - 1].n = true;
    }
    return out;
  }
  function viewSeq(id) {
    const s = behById("seq", id);
    if (!s) return viewBeh();
    const [sId, aId] = (s.action || "").split("#");
    const facts = rowsTable(["", ""], [
      ...(s.useCase && ucById[s.useCase] ? [["Use case", ucChip(s.useCase)]] : []),
      ...(s.action ? [["UI action", `<a href="${link({ view: `scr:${sId}`, focus: aId })}">${esc(s.action)}</a>`]] : []),
      ["Source", esc(s.source || "authored")],
    ]);
    const parts = (s.parts || []).map((p) => `${behDiagram(`seqpart:${p.n}:${s.id}`, `Part ${p.n} · ${esc(p.title)} (${p.messages.length} steps)`)}`).join("");
    const main = s.parts ? `<p class="meta">${s.parts.length} parts of at most ${BUDGET.edges} messages; the overview shows each as a <code>ref</code> block.</p>${behDiagram(`seq:${s.id}`, "Sequence overview")}${parts}` : behDiagram(`seq:${s.id}`, "Sequence");
    return `<h2>${esc(s.id)} ${esc(s.title || "")}</h2><p class="lede">${BEH_NAME.seq}</p>${facts}${behDownloads("seq", s)}
      ${main}${behDiagram(`collab:${s.id}`, `Collaboration (${s.collab.messages} messages)`)}
      <h3>Participants</h3>${rowsTable(["Id", "Kind", "Is"], s.participants.map((p) => [esc(p.id), esc(p.kind), participantCell(p)]))}
      <h3>Messages</h3>${rowsTable(["#", "From → to", "Message", "Cite", "Refs"], messageRows(s.messages, 0, []))}`;
  }
  function viewSm(id) {
    const m = behById("sm", id);
    if (!m) return viewBeh();
    const states = m.states.map((s) => [`<code>${esc(s.id)}</code>`, esc(s.value ?? ""), esc(s.label || ""), [s.initial ? "initial" : "", s.final ? "final" : ""].filter(Boolean).join(", "), citeSpan(s.cite)]);
    const trans = m.transitions.map((t) => [`${esc(t.from)} → ${esc(t.to)}`, esc(t.trigger), esc(t.guard || ""), esc((t.effects || []).join("; ")), citeSpan(t.cite), behRefs(t.refs)]);
    return `<h2>${esc(m.id)} ${esc(m.title || "")}</h2><p class="lede">${BEH_NAME.sm} of <a href="${link({ view: `ent:${m.entity}` })}">${esc(m.entity)}</a>.<code>${esc(m.field)}</code></p>${behDownloads("sm", m)}
      ${m.merged ? `<p class="meta">${m.transitions.length} transitions drawn as ${m.merged} edges: transitions between the same two states are merged (budget ${BUDGET.edges} edges). Every transition is in the table below and in the SCXML.</p>` : ""}
      ${behDiagram(`sm:${m.id}`, "States")}
      <h3>States</h3>${rowsTable(["State", "Value", "Label", "", "Cite"], states)}
      <h3>Transitions</h3>${rowsTable(["From → to", "Trigger", "Guard", "Effects", "Cite", "Refs"], trans)}`;
  }
  function viewObj(id) {
    const o = behById("obj", id);
    if (!o) return viewBeh();
    const badge = o.masked ? `<span class="badge sev-high">masked${o.keep?.length ? ` (kept: ${esc(o.keep.join(", "))})` : ""}</span>` : `<span class="badge via">${esc(o.source)}</span>`;
    return `<h2>${esc(o.id)} ${esc(o.title || "")}</h2><p class="lede">${BEH_NAME.obj} · source ${esc(o.source)} ${badge}${o.local ? ' <span class="badge sev-key">local build only</span>' : ""}</p>${behDownloads("obj", o)}
      <div class="chips">${o.entities.map((e) => `<a class="chip" href="${link({ view: `ent:${e}` })}">${esc(e)}</a>`).join("")}</div>
      ${behDiagram(`obj:${o.id}`, "Objects")}
      <h3>Objects</h3>${rowsTable(["Object", "Entity", "Values"], o.objects.map((x) => [`<code>${esc(x.id)}</code>`, esc(x.entity), Object.entries(x.attrs || {}).map(([k, v]) => `<code>${esc(k)}</code> = ${esc(v === null ? "null" : v)}`).join("<br>")]))}`;
  }
  const behText = (key) => {
    const [kind, id] = key.split(/:(.*)/s);
    if (kind === "collab") return behById("seq", id)?.collab.mermaid;
    if (kind === "ifmlovw") return SPLIT?.overview.mermaid;
    if (kind === "seqpart") {
      const [n, sid] = id.split(/:(.*)/s);
      return behById("seq", sid)?.parts?.[Number(n) - 1]?.mermaid;
    }
    return behById(kind, id)?.mermaid;
  };
  let behSeq = 0;
  async function drawBeh() {
    for (const el of document.querySelectorAll("[data-mmd]")) {
      const text = behText(el.dataset.mmd) || "";
      if (!window.mermaid) { el.innerHTML = `<div class="notice">Diagram viewer not embedded (build without <code>--mermaid</code>).</div><pre>${esc(text)}</pre>`; continue; }
      try {
        el.innerHTML = (await window.mermaid.render(`beh${++behSeq}`, text)).svg;
        if (el.dataset.mmd === "ifmlovw:") wireOverview(el);
      } catch (err) { el.innerHTML = `<div class="notice">Render failed: ${esc(err.message || err)}</div><pre>${esc(text)}</pre>`; }
    }
  }
  /** Overview nodes (a0, a1, …) open their area's first part. */
  function wireOverview(el) {
    const byNid = Object.fromEntries(SPLIT.overview.nodes.map((n) => [n.nid, n]));
    for (const g of el.querySelectorAll("g.node")) {
      const n = byNid[(g.id || "").match(/(?:^|-)(a\d+)(?:-|$)/)?.[1]];
      if (!n) continue;
      g.style.cursor = "pointer";
      g.addEventListener("click", () => { location.hash = link({ view: `ifml:part:${n.parts[0]}` }); });
    }
  }
  function downloadBeh(spec) {
    const [kind, id, what] = spec.split(":");
    const r = behById(kind, id);
    if (!r) return;
    const text = what === "scxml" ? r.scxml : what === "collab" ? r.collab.mermaid : r.mermaid;
    const url = URL.createObjectURL(new Blob([text], { type: what === "scxml" ? "application/xml" : "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}${what === "collab" ? ".collab" : ""}.${what === "scxml" ? "scxml" : "mmd"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- screen plans + style kit ----------
  /** Original-layout plan of a screen: sandboxed frame (scripts, no same-origin) filled after render. */
  function planSection(sid) {
    if (!UI.plans?.[sid]) return "";
    return `<h3>Screen plan</h3><p class="meta">Original template + toolbar, styled with the style kit; every control is numbered and linked in the legend. Action links in the legend open the action here.</p>
      <div class="chips"><button class="chip" data-plan-open="${esc(sid)}">Open in new tab</button>${UI.styleKit ? `<a class="chip" href="${link({ view: "kit:" })}">Style kit</a>` : ""}</div>
      <iframe class="plan" sandbox="allow-scripts" title="Screen plan ${esc(sid)}" data-plan="${esc(sid)}"></iframe>`;
  }
  function fillPlans() {
    for (const f of document.querySelectorAll("iframe[data-plan]")) f.srcdoc = UI.plans[f.dataset.plan] || "";
  }
  // new tab = wrapper page (catalog origin, no plan script) holding the plan in a sandboxed, origin-less frame
  function openPlan(sid) {
    const page = `<!doctype html><meta charset="utf-8"><title>Screen plan ${esc(sid)}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe sandbox="allow-scripts" srcdoc="${esc(UI.plans[sid] || "")}" title="Screen plan ${esc(sid)}"></iframe>`;
    const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  // a plan (sandboxed, origin "null") asks to open an action: accept only the expected shape and a known screen
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m?.type !== "screen-plan-open" || typeof m.screen !== "string" || typeof m.action !== "string" || !scrById[m.screen]) return;
    location.hash = link({ view: `scr:${m.screen}`, focus: m.action });
  });
  const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$/i;
  const kitCites = (cs) => `<span class="cite">${(cs || []).map(esc).join(" · ")}</span>`;
  function kitColors(k) {
    const rows = k.tokens.color.map((t) => [`<span class="swatch" style="background:${SAFE_COLOR.test(t.value) ? t.value : "transparent"}"></span>`, `<code>${esc(t.name)}</code>`, esc(t.value), String(t.uses), kitCites(t.cites)]);
    return rowsTable(["", "Token", "Value", "Uses", "Cites (first 5)"], rows);
  }
  function kitComponents(k) {
    return Object.entries(k.components || {}).map(([name, parts]) => `<details class="card"><summary><code>.sk-${esc(name)}</code> ${parts.map((p) => `<span class="cite">${esc(p.selector)}</span>`).join(" ")}</summary>
      ${parts.map((p) => `<div><code>${esc(p.selector)}</code> ${kitCites([p.cite])}<pre>${esc(p.decls.map(([a, b]) => `${a}: ${b};`).join("\n"))}</pre></div>`).join("")}</details>`).join("");
  }
  function viewKit() {
    const k = UI.styleKit;
    if (!k) return viewHome();
    const scale = (list) => `<div class="chips">${(list || []).slice(0, 24).map((t) => `<span class="chip">${esc(t.value)} <span class="cite">×${t.uses}</span></span>`).join("")}</div>`;
    const fonts = k.tokens.font.map((t) => [`<code>${esc(t.name)}</code>`, `<span style="font-family:${esc(t.value)}">${esc(t.value)} — Felvétel 0123</span>`, String(t.uses), kitCites(t.cites)]);
    const plans = Object.keys(UI.plans || {}).filter((id) => scrById[id]).map(scrChip).join("");
    return `<h2>Style kit</h2><p class="lede">Extracted from the application's own stylesheets (${(k.sources || []).map(esc).join(", ")}): ${k.tokens.color.length} colour tokens, ${k.tokens.font.length} font stacks, ${Object.keys(k.components || {}).length} components. The screen plans use it; the tokens are the starting point of a rebuild theme.</p>
      ${plans ? `<div class="chips"><span class="badge via">screen plans</span>${plans}</div>` : ""}
      <h3>Colours</h3>${kitColors(k)}<h3>Fonts</h3>${rowsTable(["Token", "Stack", "Uses", "Cites"], fonts)}
      <h3>Font sizes</h3>${scale(k.tokens.fontSize)}<h3>Corner radii</h3>${scale(k.tokens.radius)}<h3>Components</h3>${kitComponents(k)}`;
  }

  // ---------- render + events ----------
  const VIEWS = { merge: viewMerge, uc: viewUseCase, item: viewItem, req: viewReq, cap: viewCap, ent: viewEntity, q: viewQuestion, scr: viewScreen, form: viewForm, ifml: viewIfml, arch: viewArch, archel: viewArchEl, kit: viewKit, beh: viewBeh, seq: viewSeq, sm: viewSm, obj: viewObj, crud: viewCrud, var: viewVar, use: viewUsage };
  function render() {
    readHash();
    const kind = state.view === "merge" ? "merge" : state.view.split(":")[0];
    const fn = VIEWS[kind] || viewHome;
    $("main").innerHTML = fn(viewArg(state.view));
    renderTabs();
    renderList();
    renderTopnav();
    const flow = $("flow");
    if (flow) void drawFlow(flow.dataset.uc);
    void drawEr();
    void drawIfml();
    void drawIfmlJs();
    void drawArch();
    void drawBeh();
    fillPlans();
    if (state.focus) document.getElementById(state.focus)?.scrollIntoView({ block: "start" });
  }

  /** XMI / Structurizr / Mermaid C4 download buttons; true when handled. */
  function handleDownload(t) {
    if ("xmi" in t.dataset) downloadXmi();
    else if (t.dataset.dl) downloadArch(t.dataset.dl);
    else if (t.dataset.planOpen) openPlan(t.dataset.planOpen);
    else if (t.dataset.behDl) downloadBeh(t.dataset.behDl);
    else return false;
    return true;
  }
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-tab],[data-toggle],[data-clear],[data-flow],[data-xmi],[data-dl],[data-plan-open],[data-beh-dl]");
    if (!t) return;
    if (handleDownload(t)) return;
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
