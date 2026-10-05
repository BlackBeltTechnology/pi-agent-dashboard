// IFML 1.0 projection of a rebuild package UI model, XMI export and conformance check.
// Metamodel reference: ../references/ifml-metamodel.json (from OMG IFML-Metamodel.xmi, ptc/14-03-16).
// Mapping: ../references/ifml-mapping.md. See change: add-catalog-ifml.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MM = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "references", "ifml-metamodel.json"), "utf8"));
export const IFML_NS = MM.nsURI;
const XMI_NS = "http://www.omg.org/spec/XMI/20131001"; // XMI 2.5, as read by ifml-moddle / ifmledit tooling
const MODEL = "IFMLModel_1";
const FLOW_MODEL = "InteractionFlowModel_1";

/**
 * XML NCName-safe deterministic id; parts joined by "." so the trace (screen, action, form, field)
 * is recoverable from the id alone (record ids and field keys contain no ".").
 */
export const xid = (...parts) => parts.map((p) => String(p).replace(/[^A-Za-z0-9_-]/g, "_")).join(".");

// ---------- projection ----------

function newModel(alias = {}) {
  const elements = [];
  const flows = [];
  // alias: canonical id -> id kept from an IFML editor (screen.ifmlIds), so round-trips stay stable
  const add = (el) => {
    const id = alias[el.id] ?? el.id;
    elements.push({ attrs: {}, trace: {}, ...el, id, parent: alias[el.parent] ?? el.parent });
    return id;
  };
  // InteractionFlow is not a NamedElement in IFML 1.0: flows carry no name.
  const flow = (source, target) => {
    const id = xid("NF", source, target);
    if (!flows.some((f) => f.id === id)) flows.push({ id, type: "NavigationFlow", source, target });
  };
  return { elements, flows, add, flow };
}

function addField(m, formId, scr, formKey, f) {
  const id = m.add({
    id: xid("P", scr, formKey ?? "fields", f.key),
    type: f.type === "select" ? "SelectionField" : "SimpleField",
    name: f.key,
    parent: formId,
    feature: "viewComponentParts",
    trace: { screen: scr, form: formKey, field: f.key },
  });
  (f.conditions || [])
    .filter((c) => c.kind === "validation")
    .forEach((c, i) =>
      m.add({
        id: xid("VR", scr, formKey ?? "fields", f.key, i),
        type: "ValidationRule",
        parent: id,
        feature: "constraints",
        attrs: { language: "javascript", body: c.when },
        trace: { screen: scr, form: formKey, field: f.key, message: c.message ?? "" },
      }),
    );
}

function addForms(m, ui, s, win) {
  const forms = [];
  for (const key of [...new Set((s.forms || []).map((f) => f.form))]) {
    const id = m.add({ id: xid("F", s.id, key), type: "Form", name: key, parent: win, feature: "viewElements", trace: { screen: s.id, form: key } });
    for (const f of ui.forms[key]?.fields || []) addField(m, id, s.id, key, f);
    forms.push(id);
  }
  if ((s.fields || []).length) {
    const id = m.add({ id: xid("F", s.id, "fields"), type: "Form", name: `${s.name} fields`, parent: win, feature: "viewElements", trace: { screen: s.id } });
    for (const f of s.fields) addField(m, id, s.id, null, f);
    forms.push(id);
  }
  return forms;
}

function addAction(m, s, win, forms, a) {
  const validates = (a.effects || []).some((e) => e.kind === "validate");
  const holder = validates && forms.length ? forms[0] : win;
  const trace = { screen: s.id, action: a.id };
  const ev = m.add({ id: xid("E", s.id, a.id), type: validates && forms.length ? "OnSubmitEvent" : "ViewElementEvent", name: a.label || a.id, parent: holder, feature: "viewElementEvents", trace });
  if ((a.guards || []).length) {
    // Nested under the event (as IFML tooling ifml-moddle/ifml-js reads and draws it); see references/ifml-mapping.md.
    m.add({ id: xid("X", s.id, a.id), type: "ActivationExpression", parent: ev, feature: "activationExpression", attrs: { language: "rebuild-package-ref", body: a.guards.join(" AND ") }, trace });
  }
  if (!(a.effects || []).length) return ev;
  const act = m.add({ id: xid("A", s.id, a.id), type: "Action", name: a.ifmlActionName || a.label || a.id, parent: win, feature: "actions", trace: { ...trace, steps: a.effects.map((e) => e.step || e.kind) } });
  const done = m.add({ id: xid("AE", s.id, a.id), type: "ActionEvent", name: "done", parent: act, feature: "actionEvents", trace });
  m.flow(ev, act);
  return done;
}

/** UI model -> IFML graph: {elements:[{id,type,name,parent,feature,attrs,trace}], flows:[{id,type,source,target}]}. */
/** One screen/dialog record -> Window with forms, events, actions; dialog records -> modal Windows. */
function addScreen(m, ui, s, ctx) {
  const win = m.add({
    id: ctx.windows[s.id],
    type: "Window",
    name: s.name,
    parent: FLOW_MODEL,
    feature: "interactionFlowModelElements",
    attrs: { isModal: s.kind === "modal", isLandmark: s.kind === "route" },
    trace: { screen: s.id },
  });
  const forms = addForms(m, ui, s, win);
  for (const a of s.actions || []) ctx.outOf[a.id] = addAction(m, s, win, forms, a);
  for (const d of s.dialogs || []) {
    const trace = { screen: s.id, dialog: d.id, message: String(d.message ?? "") };
    ctx.windows[d.id] = m.add({ id: xid("W", d.id), type: "Window", name: d.id, parent: FLOW_MODEL, feature: "interactionFlowModelElements", attrs: { isModal: true }, trace });
  }
}

/** Dialogs opened from actions and recorded navigation -> NavigationFlows. */
function addNavigation(m, s, ctx) {
  for (const d of s.dialogs || []) if (d.from && ctx.outOf[d.from]) m.flow(ctx.outOf[d.from], ctx.windows[d.id]);
  for (const n of s.navigation || []) {
    const to = ctx.windows[n.to];
    if (to && to !== ctx.windows[s.id]) m.flow(ctx.windows[s.id], to);
  }
}

export function buildIfml(ui) {
  const alias = Object.assign({}, ...ui.screens.map((s) => s.ifmlIds || {}));
  const m = newModel(alias);
  const wid = (id) => alias[xid("W", id)] ?? xid("W", id);
  const ctx = { windows: Object.fromEntries(ui.screens.map((s) => [s.id, wid(s.id)])), outOf: {} };
  for (const s of ui.screens) addScreen(m, ui, s, ctx);
  for (const s of ui.screens) addNavigation(m, s, ctx);
  return { elements: m.elements, flows: m.flows };
}

// ---------- XMI ----------

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
const traceText = (t) =>
  `trace: ${[t.screen, t.action].filter(Boolean).join("#")}${t.dialog ? ` dialog ${t.dialog}` : ""}${t.form ? ` form ${t.form}` : ""}${t.field ? ` field ${t.field}` : ""}${t.steps ? ` | steps: ${t.steps.join("; ")}` : ""}${t.message ? ` | message: ${t.message}` : ""}`;

function attrString(el) {
  const a = { "xmi:type": `ifml:${el.type}`, "xmi:id": el.id, ...(el.name !== undefined && { name: el.name }), ...el.attrs };
  if (el.source) Object.assign(a, { sourceInteractionFlowElement: el.source, targetInteractionFlowElement: el.target });
  return Object.entries(a)
    .map(([k, v]) => ` ${k}="${xmlEsc(v)}"`)
    .join("");
}

/**
 * IFML graph -> XMI 2.5 document (namespace http://www.omg.org/spec/IFML/20140301).
 * Flows are owned by the InteractionFlowModel (valid: InteractionFlow is an InteractionFlowModelElement),
 * the placement IFML tooling such as ifml-moddle reads.
 */
export function ifmlToXmi(model, name, { withDi = true, withTrace = false } = {}) {
  const kids = {};
  for (const e of model.elements) (kids[e.parent] = kids[e.parent] || []).push(e);
  const write = (el, depth) => {
    const pad = "  ".repeat(depth);
    const inner = [
      // Annotations are drawn as shapes by IFML editors (ifml-js), so they are opt-in; the trace lives in the ids.
      ...(withTrace ? [`${pad}  <annotations xmi:type="ifml:Annotation" xmi:id="${el.id}.trace" text="${xmlEsc(traceText(el.trace || {}))}"/>`] : []),
      ...(kids[el.id] || []).map((c) => write(c, depth + 1)),
    ];
    return `${pad}<${el.feature}${attrString(el)}>\n${inner.join("\n")}\n${pad}</${el.feature}>`;
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xmi:XMI xmlns:xmi="${XMI_NS}" xmlns:ifml="${IFML_NS}"${withDi ? ` ${DI_NAMESPACES}` : ""}>`,
    `  <ifml:IFMLModel xmi:id="${MODEL}" name="${xmlEsc(name)}">`,
    `    <interactionFlowModel xmi:type="ifml:InteractionFlowModel" xmi:id="${FLOW_MODEL}" name="${xmlEsc(name)}">`,
    ...(kids[FLOW_MODEL] || []).map((e) => write(e, 3)),
    ...model.flows.map((f) => `      <interactionFlowModelElements${attrString(f)}/>`),
    "    </interactionFlowModel>",
    "  </ifml:IFMLModel>",
    ...(withDi ? [diagramXml(model, layoutIfml(model))] : []),
    "</xmi:XMI>",
    "",
  ].join("\n");
}

// ---------- conformance check ----------

const PRIMITIVE = new Set(["String", "Boolean", "Integer", "Real", "UnlimitedNatural"]);
const featureOf = (cls, name, seen = new Set()) => {
  const c = MM.classes[cls];
  if (!c || seen.has(cls)) return null;
  seen.add(cls);
  return c.features[name] ?? c.supers.map((s) => featureOf(s, name, seen)).find(Boolean) ?? null;
};
const isA = (cls, sup) => cls === sup || (MM.classes[cls]?.supers ?? []).some((s) => isA(s, sup));
const isRef = (f) => f.type && !PRIMITIVE.has(f.type) && MM.classes[f.type];

const ENT = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" };
/** Decode XML entities in an attribute value (named, decimal and hex character references). */
const xmlUnesc = (v) =>
  v.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] !== "#") return ENT[e] ?? m;
    return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });

/** Minimal tag scanner for the restricted XMI this module writes: [{tag, attrs, parent, line}]. */
function scan(xml) {
  const nodes = [];
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[1]) {
      const open = stack.pop();
      if (open && !Object.keys(open.children).length) open.text = xmlUnesc(xml.slice(open.end, m.index).trim());
      continue;
    }
    // editors write inherited features prefixed (uml:name); the feature name is what counts
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)].map((a) => [a[1].replace(/^(uml|ifml):/, ""), xmlUnesc(a[2])]));
    const node = { tag: m[2], attrs, parent: stack.at(-1) ?? null, line: xml.slice(0, m.index).split("\n").length, children: {}, end: m.index + m[0].length };
    if (node.parent) node.parent.children[m[2]] = (node.parent.children[m[2]] ?? 0) + 1;
    nodes.push(node);
    if (!m[4]) stack.push(node);
  }
  return nodes;
}

function classOf(n) {
  if (n.attrs["xmi:type"]) return n.attrs["xmi:type"].replace(/^ifml:/, "");
  if (n.tag.startsWith("ifml:")) return n.tag.slice(5);
  return n.parent?.cls ? featureOf(n.parent.cls, n.tag)?.type : undefined;
}

/** The child's feature must exist on the parent class and accept the child's class. */
function placementErrors(n, cls, where) {
  if (!n.parent?.cls || !MM.classes[n.parent.cls]) return [];
  const f = featureOf(n.parent.cls, n.tag);
  if (!f) return [`${where}: feature ${n.tag} not declared on ${n.parent.cls}`];
  return isA(cls, f.type) ? [] : [`${where}: ${cls} is not a ${f.type} (feature ${n.tag})`];
}

/** Attributes must be declared features; reference-typed ones are collected for resolution. */
function attrErrors(n, cls, where, refs) {
  const errors = [];
  for (const [k, v] of Object.entries(n.attrs)) {
    if (k.startsWith("xmi:") || k.startsWith("xmlns:")) continue;
    const f = featureOf(cls, k);
    if (!f) errors.push(`${where}: attribute ${k} not declared on ${cls}`);
    else if (isRef(f)) for (const r of v.split(" ")) refs.push({ where, k, r });
  }
  return errors;
}

const repeatErrors = (n, cls, where) =>
  Object.entries(n.children)
    .filter(([tag, count]) => count > 1 && featureOf(cls, tag)?.many === false)
    .map(([tag, count]) => `${where}: single-valued feature ${tag} repeated ${count}x`);

const isDiNode = (n) => /^(ifmldi|di|dc):/.test(n.attrs["xmi:type"] ?? n.tag) || n.tag.startsWith("ifmldi:") || Boolean(n.parent?.di);

/** IFML-DI / DC elements are outside the IFML metamodel: only their modelElement must resolve. */
function diErrors(n, ids, refs) {
  n.di = true;
  if (n.attrs["xmi:id"]) ids.add(n.attrs["xmi:id"]);
  if (n.attrs.modelElement) refs.push({ where: `line ${n.line} <${n.tag}>`, k: "modelElement", r: n.attrs.modelElement });
  return [];
}

/**
 * XMI may serialize a primitive feature as a child element (<body>x</body>, <isModal>true</isModal>):
 * fold it into the parent's attributes. Returns true when folded.
 */
function foldPrimitive(n) {
  if (!n.parent?.cls || n.attrs["xmi:type"] || n.tag.includes(":")) return false;
  const f = featureOf(n.parent.cls, n.tag);
  if (!f || isRef(f)) return false;
  n.parent.attrs[n.tag] = n.text ?? "";
  n.parent.children[n.tag] -= 1;
  n.folded = true;
  return true;
}

function nodeErrors(n, ids, refs) {
  if (isDiNode(n)) return diErrors(n, ids, refs);
  if (foldPrimitive(n)) return [];
  const where = `line ${n.line} <${n.tag}>`;
  const cls = classOf(n);
  n.cls = cls;
  if (n.attrs["xmi:id"]) ids.add(n.attrs["xmi:id"]);
  if (!MM.classes[cls]) return [`${where}: unknown metaclass ${cls}`];
  return [
    ...(MM.classes[cls].abstract ? [`${where}: abstract metaclass ${cls}`] : []),
    ...placementErrors(n, cls, where),
    ...attrErrors(n, cls, where, refs),
    ...repeatErrors(n, cls, where),
  ];
}

/** Violations of an XMI document against the IFML 1.0 metamodel reference. */
export function checkIfmlXmi(xml) {
  const nodes = scan(xml).filter((n) => n.tag !== "xmi:XMI");
  for (const n of nodes) if (n.parent?.tag === "xmi:XMI") n.parent = null;
  const ids = new Set();
  const refs = [];
  const errors = nodes.flatMap((n) => nodeErrors(n, ids, refs));
  for (const { where, k, r } of refs) if (!ids.has(r)) errors.push(`${where}: ${k} references unknown id ${r}`);
  if (!xml.includes(`xmlns:ifml="${IFML_NS}"`)) errors.push(`missing namespace xmlns:ifml="${IFML_NS}"`);
  return errors;
}

// ---------- IFML-DI layout (deterministic) ----------

const L = { x: 40, winW: 440, pad: 20, head: 34, formW: 250, fieldH: 22, evGap: 58, ev: 20, guardX: 520, guardW: 130, actX: 700, actW: 220, actH: 54, dlgX: 1060, dlgW: 200, dlgH: 54, gap: 18, winGap: 90 };

const childrenOf = (model, id, pred) => model.elements.filter((e) => e.parent === id && pred(e));
const isEvent = (e) => e.type === "OnSubmitEvent" || e.type === "ViewElementEvent";
/** Activation expression box right of its event circle. */
function placeGuard(model, e, box) {
  const x = childrenOf(model, e.id, (c) => c.type === "ActivationExpression")[0];
  if (x) box[x.id] = { x: L.guardX, y: box[e.id].y - 4, w: L.guardW, h: 28 };
}

/** Place one screen window with forms, fields and events; returns window bottom and event centres. */
function placeWindow(model, w, y, box) {
  const forms = childrenOf(model, w.id, (e) => e.type === "Form");
  let fy = y + L.head;
  const evs = [];
  for (const f of forms) {
    const fields = childrenOf(model, f.id, (e) => /Field$/.test(e.type));
    const fh = Math.max(L.head + fields.length * L.fieldH + 10, L.head + 10);
    box[f.id] = { x: L.x + L.pad, y: fy, w: L.formW, h: fh };
    fields.forEach((p, i) => {
      box[p.id] = { x: L.x + L.pad + 10, y: fy + L.head - 6 + i * L.fieldH, w: L.formW - 20, h: L.fieldH - 4 };
    });
    childrenOf(model, f.id, isEvent).forEach((e, i) => {
      box[e.id] = { x: L.x + L.pad + L.formW - L.ev / 2, y: fy + 12 + i * L.evGap, w: L.ev, h: L.ev };
      placeGuard(model, e, box);
      evs.push(e);
    });
    fy += fh + L.gap;
  }
  const own = childrenOf(model, w.id, isEvent);
  own.forEach((e, i) => {
    box[e.id] = { x: L.x + L.winW - L.ev / 2, y: y + L.head + i * L.evGap, w: L.ev, h: L.ev };
    placeGuard(model, e, box);
    evs.push(e);
  });
  const bottom = Math.max(fy, y + L.head + own.length * L.evGap) + L.pad;
  box[w.id] = { x: L.x, y, w: L.winW, h: bottom - y };
  return evs;
}

/** Stack items in a column at desired y without overlap. */
function stack(col, desired, h) {
  const y = Math.max(desired, col.next);
  col.next = y + h + L.gap;
  return y;
}

const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
function route(a, b) {
  const s = { x: a.x + a.w, y: mid(a).y };
  const t = mid(b).x > s.x ? { x: b.x, y: mid(b).y } : { x: b.x + b.w, y: mid(b).y };
  const mx = t.x > s.x ? Math.round((s.x + t.x) / 2) : Math.max(s.x, t.x) + 40;
  return [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t];
}

/** Action (with its done event and the dialogs it opens) aligned to the triggering event. */
function placeAction(model, id, desired, box, cols, flowsFrom) {
  const act = model.elements.find((x) => x.id === id && x.type === "Action");
  if (!act || box[act.id]) return;
  const ay = stack(cols.acts, desired, L.actH);
  box[act.id] = { x: L.actX, y: ay, w: L.actW, h: L.actH };
  const done = childrenOf(model, act.id, (x) => x.type === "ActionEvent")[0];
  if (!done) return;
  box[done.id] = { x: L.actX + L.actW - L.ev / 2, y: ay + L.actH / 2 - L.ev / 2, w: L.ev, h: L.ev };
  for (const g of flowsFrom(done.id)) {
    const dlg = model.elements.find((x) => x.id === g.target);
    if (dlg && !box[dlg.id] && dlg.type === "Window") box[dlg.id] = { x: L.dlgX, y: stack(cols.dlgs, ay, L.dlgH), w: L.dlgW, h: L.dlgH };
  }
}

/** Deterministic IFML-DI geometry: {box: {id: {x,y,w,h}}, edges: {flowId: [{x,y}...]}}. */
export function layoutIfml(model) {
  const box = {};
  const screens = model.elements.filter((e) => e.type === "Window" && e.trace.screen && !e.trace.dialog);
  const flowsFrom = (id) => model.flows.filter((f) => f.source === id);
  let y = 40;
  for (const w of screens) {
    const evs = placeWindow(model, w, y, box);
    const cols = { acts: { next: y }, dlgs: { next: y } };
    for (const e of evs) for (const f of flowsFrom(e.id)) placeAction(model, f.target, box[e.id].y - L.actH / 2 + L.ev / 2, box, cols, flowsFrom);
    for (const d of model.elements.filter((x) => x.trace.dialog && x.trace.screen === w.trace.screen && !box[x.id])) {
      box[d.id] = { x: L.dlgX, y: stack(cols.dlgs, y, L.dlgH), w: L.dlgW, h: L.dlgH };
    }
    for (const a of childrenOf(model, w.id, (x) => x.type === "Action" && !box[x.id])) box[a.id] = { x: L.actX, y: stack(cols.acts, y, L.actH), w: L.actW, h: L.actH };
    y = Math.max(box[w.id].y + box[w.id].h, cols.acts.next, cols.dlgs.next) + L.winGap;
  }
  const edges = {};
  for (const f of model.flows) if (box[f.source] && box[f.target]) edges[f.id] = route(box[f.source], box[f.target]);
  return { box, edges };
}

const IFMLDI_NS = "http://www.omg.org/spec/IFML/20130218/IFML-DI";
const DC_NS = "http://www.omg.org/spec/DD/20100524/DC";

/** IFML-DI diagram XML (nodes nested like the semantic containment, connections at diagram level). */
export function diagramXml(model, layout) {
  const kids = {};
  for (const e of model.elements) if (layout.box[e.id]) (kids[e.parent] = kids[e.parent] || []).push(e);
  const node = (e, d) => {
    const b = layout.box[e.id];
    const pad = "  ".repeat(d);
    const inner = (kids[e.id] || []).map((c) => node(c, d + 1)).join("\n");
    return `${pad}<ownedElement xmi:type="ifmldi:IFMLNode" xmi:id="${e.id}_di" modelElement="${e.id}">\n${inner ? `${inner}\n` : ""}${pad}  <bounds xmi:type="dc:Bounds" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>\n${pad}</ownedElement>`;
  };
  const conns = model.flows
    .filter((f) => layout.edges[f.id])
    .map((f) => `    <ifmldi:IFMLConnection xmi:id="${f.id}_di" modelElement="${f.id}">\n${layout.edges[f.id].map((p) => `      <waypoint xmi:type="dc:Point" x="${p.x}" y="${p.y}"/>`).join("\n")}\n    </ifmldi:IFMLConnection>`);
  return [`  <ifmldi:IFMLDiagram xmi:type="ifmldi:IFMLDiagram" xmi:id="IFMLDiagram_1" modelElement="${FLOW_MODEL}">`, ...(kids[FLOW_MODEL] || []).map((e) => node(e, 2)), ...conns, "  </ifmldi:IFMLDiagram>"].join("\n");
}
export const DI_NAMESPACES = `xmlns:ifmldi="${IFMLDI_NS}" xmlns:dc="${DC_NS}"`;


// ---------- XMI -> IFML graph (reverse) ----------

const FLOW_TYPES = new Set(["NavigationFlow", "DataFlow"]);
const SKIP = new Set(["IFMLModel", "InteractionFlowModel", "Annotation"]);

/** One scanned node -> graph element or flow (DI and annotations skipped, primitive children folded). */
function parseNode(n, out) {
  if (isDiNode(n)) {
    n.di = true;
    return;
  }
  if (foldPrimitive(n)) {
    if (n.parent.el) Object.assign(n.parent.el, n.tag === "name" ? { name: n.text } : { attrs: { ...n.parent.el.attrs, [n.tag]: n.text } });
    return;
  }
  n.cls = classOf(n);
  if (SKIP.has(n.cls) || !n.attrs["xmi:id"]) return;
  const { "xmi:id": id, "xmi:type": _t, name, sourceInteractionFlowElement: source, targetInteractionFlowElement: target, ...rest } = n.attrs;
  if (FLOW_TYPES.has(n.cls)) {
    out.flows.push({ id, type: n.cls, source, target });
    return;
  }
  const parent = n.parent && !SKIP.has(n.parent.cls) ? n.parent.attrs["xmi:id"] : FLOW_MODEL;
  n.el = { id, type: n.cls, name, parent, feature: n.tag, attrs: rest, trace: {} };
  out.elements.push(n.el);
}

/** Parse an IFML XMI (any producer) into {elements, flows} like buildIfml; DI and annotations ignored. */
export function parseIfmlXmi(xml) {
  const nodes = scan(xml).filter((n) => n.tag !== "xmi:XMI");
  for (const n of nodes) if (n.parent?.tag === "xmi:XMI") n.parent = null;
  const out = { elements: [], flows: [] };
  for (const n of nodes) parseNode(n, out);
  return out;
}
