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

/** XML NCName-safe deterministic id. */
const xid = (...parts) => parts.join("_").replace(/[^A-Za-z0-9_.-]/g, "_");

// ---------- projection ----------

function newModel() {
  const elements = [];
  const flows = [];
  const add = (el) => {
    elements.push({ attrs: {}, trace: {}, ...el });
    return el.id;
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
    id: xid("P", formId, f.key),
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
        id: xid("VR", id, i),
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
    const x = m.add({ id: xid("X", s.id, a.id), type: "ActivationExpression", parent: FLOW_MODEL, feature: "interactionFlowModelElements", attrs: { language: "rebuild-package-ref", body: a.guards.join(" AND ") }, trace });
    m.elements.find((e) => e.id === ev).attrs.activationExpression = x;
  }
  if (!(a.effects || []).length) return ev;
  const act = m.add({ id: xid("A", s.id, a.id), type: "Action", name: a.label || a.id, parent: win, feature: "actions", trace: { ...trace, steps: a.effects.map((e) => e.step || e.kind) } });
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
  const m = newModel();
  const ctx = { windows: Object.fromEntries(ui.screens.map((s) => [s.id, xid("W", s.id)])), outOf: {} };
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
export function ifmlToXmi(model, name) {
  const kids = {};
  for (const e of model.elements) (kids[e.parent] = kids[e.parent] || []).push(e);
  const write = (el, depth) => {
    const pad = "  ".repeat(depth);
    const inner = [
      `${pad}  <annotations xmi:type="ifml:Annotation" xmi:id="${el.id}_trace" text="${xmlEsc(traceText(el.trace || {}))}"/>`,
      ...(kids[el.id] || []).map((c) => write(c, depth + 1)),
    ];
    return `${pad}<${el.feature}${attrString(el)}>\n${inner.join("\n")}\n${pad}</${el.feature}>`;
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xmi:XMI xmlns:xmi="${XMI_NS}" xmlns:ifml="${IFML_NS}">`,
    `  <ifml:IFMLModel xmi:id="${MODEL}" name="${xmlEsc(name)}">`,
    `    <interactionFlowModel xmi:type="ifml:InteractionFlowModel" xmi:id="${FLOW_MODEL}" name="${xmlEsc(name)}">`,
    ...(kids[FLOW_MODEL] || []).map((e) => write(e, 3)),
    ...model.flows.map((f) => `      <interactionFlowModelElements${attrString(f)}/>`),
    "    </interactionFlowModel>",
    "  </ifml:IFMLModel>",
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

/** Minimal tag scanner for the restricted XMI this module writes: [{tag, attrs, parent, line}]. */
function scan(xml) {
  const nodes = [];
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[1]) {
      stack.pop();
      continue;
    }
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const node = { tag: m[2], attrs, parent: stack.at(-1) ?? null, line: xml.slice(0, m.index).split("\n").length, children: {} };
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

function nodeErrors(n, ids, refs) {
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
