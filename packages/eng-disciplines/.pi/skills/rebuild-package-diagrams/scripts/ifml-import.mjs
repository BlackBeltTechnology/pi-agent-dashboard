// IFML -> UI model (reverse), round-trip diff and apply. See change: add-ifml-render-roundtrip.
// Ids: dot-separated trace ids (W.<screen>, E.<screen>.<action>, ...) when present, else derived from names;
// editor-created ids are kept per screen in `ifmlIds` (canonical id -> editor id) so re-export is stable.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIfml, xid } from "./ifml.mjs";

const slug = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "x";
const traceParts = (id, prefix) => (String(id).startsWith(`${prefix}.`) ? String(id).slice(prefix.length + 1).split(".") : null);
const isEvent = (e) => e.type === "OnSubmitEvent" || e.type === "ViewElementEvent";
const truthy = (v) => v === true || v === "true";

function indexGraph(g) {
  const byId = Object.fromEntries(g.elements.map((e) => [e.id, e]));
  const kids = {};
  for (const e of g.elements) (kids[e.parent] = kids[e.parent] || []).push(e);
  const out = {};
  for (const f of g.flows) (out[f.source] = out[f.source] || []).push(f);
  return { byId, kids: (id, pred = () => true) => (kids[id] || []).filter(pred), out: (id) => out[id] || [] };
}

/** Window that (transitively) owns an element. */
function windowOf(ix, id) {
  let e = ix.byId[id];
  while (e && e.type !== "Window") e = ix.byId[e.parent];
  return e;
}

/** Dialog windows: no children, reached only from action events. */
function dialogOwners(g, ix) {
  const owners = {};
  for (const f of g.flows) {
    const src = ix.byId[f.source];
    const tgt = ix.byId[f.target];
    if (src?.type === "ActionEvent" && tgt?.type === "Window" && !ix.kids(tgt.id).length) owners[tgt.id] ||= { from: ix.byId[src.parent], win: windowOf(ix, src.id) };
  }
  return owners;
}

function recordId(win, isDialog) {
  return traceParts(win.id, "W")?.[0] ?? `${isDialog || truthy(win.attrs.isModal) ? "DLG" : "SCR"}-${slug(win.name)}`;
}

/** Fields of a form element -> [{key, type, conditions}] and aliases. */
function fieldsOf(ix, form, sid, formKey, alias) {
  return ix.kids(form.id, (p) => /Field$/.test(p.type)).map((p) => {
    const key = traceParts(p.id, "P")?.[2] ?? slug(p.name).replace(/-/g, "_");
    alias(xid("P", sid, formKey, key), p.id);
    const conditions = ix.kids(p.id, (c) => c.type === "ValidationRule").map((c, i) => {
      alias(xid("VR", sid, formKey, key, i), c.id);
      return { kind: "validation", when: c.attrs.body ?? "", message: "" };
    });
    return { key, label: p.name ?? key, type: p.type === "SelectionField" ? "select" : "text", conditions, source: "ifml" };
  });
}

function formsOf(ix, win, rec, forms, alias) {
  for (const f of ix.kids(win.id, (e) => e.type === "Form")) {
    const t = traceParts(f.id, "F");
    const key = t ? t.slice(1).join(".") : `FRM-${slug(f.name)}`;
    alias(xid("F", rec.id, key), f.id);
    const fields = fieldsOf(ix, f, rec.id, key, alias);
    if (key === "fields") rec.fields = fields;
    else {
      rec.forms.push({ form: key, region: "" });
      forms[key] = { id: key, source: "ifml", fields };
    }
  }
}

/** Event (+ its Action) -> action record. */
function actionOf(ix, ev, rec, alias) {
  const aid = traceParts(ev.id, "E")?.[1] ?? `ACT-${slug(ev.name)}`;
  alias(xid("E", rec.id, aid), ev.id);
  const guard = ix.kids(ev.id, (c) => c.type === "ActivationExpression")[0];
  if (guard) alias(xid("X", rec.id, aid), guard.id);
  const act = ix.out(ev.id).map((f) => ix.byId[f.target]).find((t) => t?.type === "Action");
  const effects = ev.type === "OnSubmitEvent" ? [{ kind: "validate", step: "Validate input", target: "IFML OnSubmitEvent" }] : [];
  const a = { id: aid, label: ev.name ?? aid, trigger: { kind: "ifml" }, guards: guard ? String(guard.attrs.body ?? "").split(/\s+AND\s+/).filter(Boolean) : [], effects, refs: [], source: "ifml" };
  if (act) {
    alias(xid("A", rec.id, aid), act.id);
    const done = ix.kids(act.id, (c) => c.type === "ActionEvent")[0];
    if (done) alias(xid("AE", rec.id, aid), done.id);
    effects.push({ kind: "call", step: act.name ?? aid, target: "IFML Action" });
    if (act.name && act.name !== a.label) a.ifmlActionName = act.name;
  }
  return { a, act };
}

const kindOf = (win) => (truthy(win.attrs.isModal) ? "modal" : truthy(win.attrs.isLandmark) ? "route" : "panel");

/** One non-dialog Window -> screen record; registers its actions by Action element id. */
function screenOf(ix, win, forms, actionsByElement) {
  const rec = { id: recordId(win, false), kind: kindOf(win), name: win.name ?? "", template: "", scope: [], forms: [], fields: [], actions: [], dialogs: [], navigation: [], source: "ifml", ifmlIds: {} };
  const alias = (canonical, actual) => {
    if (canonical !== actual) rec.ifmlIds[canonical] = actual;
  };
  alias(xid("W", rec.id), win.id);
  formsOf(ix, win, rec, forms, alias);
  const holders = [win, ...ix.kids(win.id, (e) => e.type === "Form")];
  for (const ev of holders.flatMap((h) => ix.kids(h.id, isEvent))) {
    const { a, act } = actionOf(ix, ev, rec, alias);
    rec.actions.push(a);
    if (act) actionsByElement[act.id] = { rec, a };
  }
  return rec;
}

function attachDialogs(ix, owners, recOfWin, actionsByElement) {
  for (const [wid, o] of Object.entries(owners)) {
    const src = o.from ? actionsByElement[o.from.id] : undefined;
    const rec = src?.rec ?? recOfWin[o.win?.id];
    if (!rec) continue;
    const did = recordId(ix.byId[wid], true);
    if (xid("W", did) !== wid) (rec.ifmlIds ||= {})[xid("W", did)] = wid;
    rec.dialogs.push({ id: did, kind: "modal", message: "", from: src?.a.id, source: "ifml" });
  }
}

function attachNavigation(g, ix, recOfWin) {
  for (const f of g.flows) {
    const s = recOfWin[f.source];
    const t = ix.byId[f.target];
    if (s && t?.type === "Window") s.navigation.push({ to: recOfWin[t.id]?.id ?? recordId(t, true), trigger: "", source: "ifml" });
  }
}

/** IFML graph -> {screens, forms} UI model (records marked source: "ifml"). */
export function graphToUi(g) {
  const ix = indexGraph(g);
  const owners = dialogOwners(g, ix);
  const forms = {};
  const recOfWin = {};
  const actionsByElement = {};
  const wins = g.elements.filter((e) => e.type === "Window" && !owners[e.id]);
  const screens = wins.map((win) => (recOfWin[win.id] = screenOf(ix, win, forms, actionsByElement)));
  attachDialogs(ix, owners, recOfWin, actionsByElement);
  attachNavigation(g, ix, recOfWin);
  for (const r of screens) if (!Object.keys(r.ifmlIds).length) delete r.ifmlIds;
  return { screens, forms };
}

// ---------- diff ----------

const norm = (v) => (v === undefined || v === null || v === false || v === "false" ? "" : String(v));
const COMPARED = ["type", "name", "parent"];
const ATTRS = ["body", "isModal", "isLandmark"];

function elementChanges(a, b) {
  const out = [];
  for (const k of COMPARED) if (norm(a[k]) !== norm(b[k])) out.push(`changed ${a.id} ${k}: '${norm(a[k])}' -> '${norm(b[k])}'`);
  for (const k of ATTRS) if (norm(a.attrs?.[k]) !== norm(b.attrs?.[k])) out.push(`changed ${a.id} ${k}: '${norm(a.attrs?.[k])}' -> '${norm(b.attrs?.[k])}'`);
  return out;
}

/** Element-by-element comparison of two IFML graphs (base = package, edited = file). */
export function diffGraphs(base, edited) {
  const A = Object.fromEntries(base.elements.map((e) => [e.id, e]));
  const B = Object.fromEntries(edited.elements.map((e) => [e.id, e]));
  const lines = [];
  for (const e of edited.elements) if (!A[e.id]) lines.push(`added ${e.type} ${e.id} '${norm(e.name)}'`);
  for (const e of base.elements) if (!B[e.id]) lines.push(`removed ${e.type} ${e.id} '${norm(e.name)}'`);
  for (const e of base.elements) if (B[e.id]) lines.push(...elementChanges(e, B[e.id]));
  const key = (f) => `${f.source} -> ${f.target}`;
  const fa = new Set(base.flows.map(key));
  const fb = new Set(edited.flows.map(key));
  for (const k of fb) if (!fa.has(k)) lines.push(`flow added ${k}`);
  for (const k of fa) if (!fb.has(k)) lines.push(`flow removed ${k}`);
  return lines;
}

// ---------- apply ----------

/** Screen records with their file names: [{file, rec}]. */
export function readScreenFiles(pkgDir) {
  const dir = join(pkgDir, "ui", "screens");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, rec: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}

const byKey = (list, k) => Object.fromEntries((list || []).map((x) => [x[k], x]));
const pushNew = (list, items, k) => {
  const have = byKey(list, k);
  for (const it of items) if (!have[it[k]]) list.push(it);
};

function mergeAction(cur, imp) {
  if (imp.label !== cur.label) cur.label = imp.label;
  if (JSON.stringify(imp.guards) !== JSON.stringify(cur.guards || [])) cur.guards = imp.guards;
  if (imp.ifmlActionName && imp.ifmlActionName !== cur.ifmlActionName) cur.ifmlActionName = imp.ifmlActionName;
}

function mergeScreen(cur, imp) {
  if (imp.name && imp.name !== cur.name) cur.name = imp.name;
  cur.actions ||= [];
  const have = byKey(cur.actions, "id");
  for (const a of imp.actions) {
    if (have[a.id]) mergeAction(have[a.id], a);
    else cur.actions.push(a);
  }
  pushNew((cur.dialogs ||= []), imp.dialogs, "id");
  mergeFields((cur.fields ||= []), imp.fields);
  pushNew((cur.forms ||= []), imp.forms, "form");
  const nav = new Set((cur.navigation || []).map((n) => n.to));
  for (const n of imp.navigation) if (!nav.has(n.to)) (cur.navigation ||= []).push(n);
  if (imp.ifmlIds) cur.ifmlIds = { ...(cur.ifmlIds || {}), ...imp.ifmlIds };
}

function mergeForm(cur, imp) {
  mergeFields((cur.fields ||= []), imp.fields);
}

/** New fields are added; validation conditions of existing fields are updated by position or appended. */
function mergeFields(fields, imported) {
  const have = byKey(fields, "key");
  for (const f of imported || []) {
    const c = have[f.key];
    if (!c) {
      fields.push(f);
      continue;
    }
    const vals = (c.conditions || []).filter((x) => x.kind === "validation");
    (f.conditions || []).forEach((v, i) => {
      if (vals[i]) vals[i].when = v.when;
      else (c.conditions ||= []).push(v);
    });
  }
}

/** Merge an imported UI model into the package ui/: additions, renames, guard/validation changes; never deletes. */
export function applyUi(pkgDir, imported) {
  const files = readScreenFiles(pkgDir);
  const cur = byKey(
    files.map((f) => f.rec),
    "id",
  );
  const dir = join(pkgDir, "ui", "screens");
  mkdirSync(dir, { recursive: true });
  // a dialog without an opening action reads back as a stand-alone modal Window: it is that dialog, not a new screen
  const dialogIds = new Set(files.flatMap((f) => (f.rec.dialogs || []).map((d) => d.id)));
  for (const s of imported.screens) {
    if (cur[s.id]) mergeScreen(cur[s.id], s);
    else if (!dialogIds.has(s.id)) files.push({ file: `${s.id}.json`, rec: s });
  }
  for (const { file, rec } of files) writeFileSync(join(dir, file), `${JSON.stringify(rec, null, 1)}\n`);
  const fdir = join(pkgDir, "ui", "forms");
  mkdirSync(fdir, { recursive: true });
  for (const [id, f] of Object.entries(imported.forms)) {
    const p = join(fdir, `${id}.json`);
    const existing = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
    if (existing) mergeForm(existing, f);
    writeFileSync(p, `${JSON.stringify(existing ?? f, null, 1)}\n`);
  }
}

/** Write a fresh UI model (ifml-to-ui). */
export function writeUi(outDir, ui) {
  mkdirSync(join(outDir, "ui", "screens"), { recursive: true });
  mkdirSync(join(outDir, "ui", "forms"), { recursive: true });
  for (const s of ui.screens) writeFileSync(join(outDir, "ui", "screens", `${s.id}.json`), `${JSON.stringify(s, null, 1)}\n`);
  for (const [id, f] of Object.entries(ui.forms)) writeFileSync(join(outDir, "ui", "forms", `${id}.json`), `${JSON.stringify(f, null, 1)}\n`);
}

export { buildIfml };
