// Behaviour models of a rebuild package: sequences (+ collaboration projection), state machines, object diagrams.
// Records: diagrams/sequences/*.json, diagrams/state-machines/*.json, diagrams/objects/*.json (+ _local/objects with --local).
// Every record is gated (refs resolve, cites well-formed / in range with an app dir) before it is rendered.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { citeError, readArch, refResolver } from "./arch.mjs";
import { extractModel, readIf, readUi } from "./lib.mjs";
import { DEFAULT_BUDGET, mergeParallel, sequenceParts } from "./split.mjs";

const readJsonDir = (dir, extra = {}) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => ({ ...JSON.parse(readFileSync(join(dir, f), "utf8")), ...extra }))
    : [];

/** All behaviour records of a package; real-data objects (_local/objects) only when `local`. */
export function readBehaviour(pkgDir, { local = false } = {}) {
  const d = join(pkgDir, "diagrams");
  return {
    sequences: readJsonDir(join(d, "sequences")),
    states: readJsonDir(join(d, "state-machines")),
    objects: [...readJsonDir(join(d, "objects")), ...(local ? readJsonDir(join(pkgDir, "_local", "objects"), { local: true }) : [])],
  };
}

const uniq = (xs) => [...new Set(xs)];
const lbl = (s) => String(s ?? "").replace(/[;#]/g, ",").replace(/"/g, "'").replace(/\s+/g, " ").trim();
const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sid = (s) => String(s).replace(/[^\w]/g, "_");

// ---------- sequences ----------

/** Messages of a sequence in document order (fragments flattened, else branches included), with depth. */
function* walkMessages(list, depth = 0) {
  for (const m of list || []) {
    if (m.fragment) {
      yield { ...m, isFragment: true, depth };
      yield* walkMessages(m.messages, depth + 1);
      if (m.else) yield* walkMessages(m.else.messages, depth + 1);
    } else yield { ...m, depth };
  }
}
const FRAGMENTS = new Set(["alt", "opt", "loop", "par"]);

/** Dangling refs and bad cite of one record part. */
function refCiteErrors(who, x, ctx) {
  const errs = (x.refs || []).filter((r) => !ctx.resolve(r)).map((r) => `${who}: dangling ref ${r}`);
  const c = x.cite ? citeError(x.cite, ctx.appDir) : null;
  return c ? [...errs, `${who}: ${c}`] : errs;
}

function participantError(p, ctx) {
  if (p.kind === "element") return ctx.archIds.has(p.ref) ? null : `unknown architecture element ${p.ref}`;
  if (p.kind === "screen") return ctx.resolve(p.ref || p.id) ? null : `unknown screen ${p.ref || p.id}`;
  return p.kind === "actor" ? null : "kind must be actor, screen or element";
}

function messageErrors(m, parts, ctx) {
  const errs = [];
  if (m.isFragment && !FRAGMENTS.has(m.fragment)) errs.push(`fragment ${m.fragment}: kind must be alt, opt, loop or par`);
  if (!m.isFragment) for (const end of [m.from, m.to]) if (!parts.has(end)) errs.push(`message "${m.label}": unknown participant ${end}`);
  return [...errs, ...refCiteErrors(`"${m.label}"`, m, ctx)];
}

function sequenceErrors(seq, ctx) {
  const errs = [];
  const parts = new Map();
  for (const p of seq.participants || []) {
    if (parts.has(p.id)) errs.push(`participant ${p.id}: duplicate`);
    parts.set(p.id, p);
    const e = participantError(p, ctx);
    if (e) errs.push(`participant ${p.id}: ${e}`);
  }
  if (seq.useCase && !ctx.ucIds.has(seq.useCase)) errs.push(`unknown use case ${seq.useCase}`);
  if (seq.action && !ctx.actions.has(seq.action)) errs.push(`unknown UI action ${seq.action}`);
  for (const m of walkMessages(seq.messages)) errs.push(...messageErrors(m, parts, ctx));
  return errs.map((e) => `${seq.id || "<no id>"}: ${e}`);
}

function gateContext(pkgDir, appDir) {
  const ui = readUi(pkgDir);
  const arch = readArch(pkgDir);
  const ucs = JSON.parse(readIf(join(pkgDir, "diagrams", "use-cases.json")) || "[]");
  return {
    appDir,
    resolve: refResolver(pkgDir),
    archIds: new Set((arch?.elements || []).map((e) => e.id)),
    ucIds: new Set(ucs.map((u) => u.id)),
    actions: new Set(ui.screens.flatMap((s) => (s.actions || []).map((a) => `${s.id}#${a.id}`))),
  };
}

const dupIds = (kind, records) => {
  const seen = new Set();
  return records.filter((r) => (seen.has(r.id) ? true : (seen.add(r.id), false))).map((r) => `${kind} ${r.id}: duplicate id`);
};

export function checkSequences(pkgDir, sequences, appDir = null) {
  const ctx = gateContext(pkgDir, appDir);
  return [...dupIds("sequence", sequences), ...sequences.flatMap((s) => sequenceErrors(s, ctx))];
}

/** Mermaid sequenceDiagram. */
const ARROW = { reply: "-->>", async: "-)" };
function emitMessages(out, list, ind) {
  for (const m of list || []) {
    if (m.fragment) emitFragment(out, m, ind);
    else out.push(`${ind}${sid(m.from)}${ARROW[m.kind] || "->>"}${sid(m.to)}: ${lbl(m.label)}`);
  }
}
function emitFragment(out, m, ind) {
  out.push(`${ind}${m.fragment} ${lbl(m.label)}`);
  emitMessages(out, m.messages, `${ind}  `);
  if (m.else) {
    out.push(`${ind}else ${lbl(m.else.label)}`);
    emitMessages(out, m.else.messages, `${ind}  `);
  }
  out.push(`${ind}end`);
}

/** Mermaid sequenceDiagram. */
export function sequenceMermaid(seq) {
  const out = ["sequenceDiagram"];
  for (const p of seq.participants) out.push(`  ${p.kind === "actor" ? "actor" : "participant"} ${sid(p.id)} as ${lbl(p.label || p.id)}`);
  emitMessages(out, seq.messages, "  ");
  return `${out.join("\n")}\n`;
}

/** Sequence over budget: parts with their own diagrams + a main diagram showing each part as a `ref` block. */
export function sequenceSplit(seq, budget = DEFAULT_BUDGET) {
  const parts = sequenceParts(seq, budget);
  if (!parts) return { parts: null, mermaid: sequenceMermaid(seq) };
  const byId = new Map(seq.participants.map((p) => [p.id, p]));
  const out = ["sequenceDiagram"];
  for (const p of seq.participants) out.push(`  ${p.kind === "actor" ? "actor" : "participant"} ${sid(p.id)} as ${lbl(p.label || p.id)}`);
  for (const p of parts) {
    const ends = p.participants.length > 1 ? `${sid(p.participants[0])},${sid(p.participants[p.participants.length - 1])}` : sid(p.participants[0]);
    out.push(`  Note over ${ends}: ref part ${p.n} · ${clip(lbl(p.title), 60)}`);
  }
  return {
    mermaid: `${out.join("\n")}\n`,
    parts: parts.map((p) => ({ ...p, mermaid: sequenceMermaid({ ...seq, participants: p.participants.map((id) => byId.get(id)), messages: p.messages }) })),
  };
}

/** Collaboration (communication) diagram: messages numbered in sequence order on participant links. */
export function collaboration(seq) {
  const edges = new Map();
  let n = 0;
  for (const m of walkMessages(seq.messages)) {
    if (m.isFragment) continue;
    n += 1;
    const k = `${m.from}>${m.to}`;
    if (!edges.has(k)) edges.set(k, { from: m.from, to: m.to, msgs: [] });
    edges.get(k).msgs.push(`${n}: ${lbl(m.label)}`);
  }
  const out = ["flowchart LR"];
  for (const p of seq.participants) out.push(p.kind === "actor" ? `  ${sid(p.id)}(["${lbl(p.label || p.id)}"])` : `  ${sid(p.id)}["${lbl(p.label || p.id)}"]`);
  for (const e of edges.values()) out.push(`  ${sid(e.from)} -->|"${e.msgs.join("<br/>")}"| ${sid(e.to)}`);
  return { mermaid: `${out.join("\n")}\n`, messages: n };
}

/** Refs of a sequence or state machine, in first-appearance order. */
const refsOfSequence = (seq) => uniq([...walkMessages(seq.messages)].flatMap((m) => m.refs || []));

/** Architecture component whose cites name `file` (first match), or null. */
function componentOfFile(arch, file) {
  if (!arch || !file) return null;
  return arch.elements.find((e) => e.kind === "component" && (e.cites || []).some((c) => c.split(":")[0] === file)) || null;
}

/** Deterministic draft sequence for one UI action (`SCR#ACT`); throws when the action is unknown. */
export function sequenceFromUi(pkgDir, ref) {
  const [sId, aId] = ref.split("#");
  const screen = readUi(pkgDir).screens.find((s) => s.id === sId);
  const act = screen?.actions?.find((a) => a.id === aId);
  if (!act) throw new Error(`unknown UI action ${ref}`);
  const arch = readArch(pkgDir);
  // a UI-model cite may list several locations ("a.js:1; b.js:2"): the message is sent from the first
  const first = (c) => (c ? String(c).split(/;\s*/)[0] : undefined);
  const fileOf = (c) => (c ? first(c).split(":")[0] : null);
  const home = componentOfFile(arch, fileOf(act.handler?.cite || act.trigger?.cite));
  const parts = [
    { id: "user", kind: "actor", label: "User" },
    { id: screen.id, kind: "screen", ref: screen.id, label: screen.name || screen.id },
  ];
  const lifeline = (e) => {
    if (e.kind === "notify") return "user";
    const c = componentOfFile(arch, fileOf(e.cite));
    if (!c || c.id === home?.id) return screen.id;
    if (!parts.some((p) => p.id === c.id)) parts.push({ id: c.id, kind: "element", ref: c.id, label: c.name });
    return c.id;
  };
  const effects = (act.effects || []).map((e) => ({ from: screen.id, to: lifeline(e), label: e.step || e.kind, kind: "sync", cite: first(e.cite), refs: e.refs || [], note: e.target }));
  const trigger = { from: "user", to: screen.id, label: act.label || act.id, kind: "sync", cite: first(act.trigger?.cite), refs: act.refs || [] };
  const guards = act.guards || [];
  const body = guards.length
    ? [{ fragment: "alt", label: `allowed (${guards.join(", ")})`, refs: guards, messages: effects, else: { label: "refused", messages: [{ from: screen.id, to: "user", label: "refused", kind: "reply", refs: guards }] } }]
    : effects;
  return { id: `SEQ-${aId.replace(/^ACT-/, "")}`, title: `${act.label || act.id} (${screen.id})`, action: ref, source: "ui-draft", participants: parts, messages: [trigger, ...body] };
}

// ---------- state machines ----------

const modelOf = (pkgDir) => extractModel(readIf(join(pkgDir, "model.md")));

/** true when `value` is listed in the field text's `allowed:` clause (no clause = anything goes). */
function allowedValue(fieldText, value) {
  const m = String(fieldText || "").match(/allowed:\s*([^;]*)/);
  if (!m) return true;
  const v = String(value);
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return m[1].includes(`'${v}'`) || m[1].includes(`"${v}"`) || new RegExp(`(^|[\\s,(])${esc}($|[\\s,)])`).test(m[1]);
}

function reachableFrom(start, transitions) {
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) {
    const s = todo.pop();
    for (const t of transitions) if (t.from === s && !seen.has(t.to)) seen.add(t.to), todo.push(t.to);
  }
  return seen;
}

function transitionErrors(t, states, ctx) {
  const name = `transition ${t.from}->${t.to}`;
  const errs = [t.from, t.to].filter((end) => !states.has(end)).map((end) => `${name}: unknown state ${end}`);
  if (!t.trigger) errs.push(`${name}: no trigger`);
  if (!t.cite) errs.push(`${name}: no cite`);
  return [...errs, ...refCiteErrors(name, t, ctx)];
}

function stateErrors(sm, field, ctx) {
  const errs = [];
  for (const s of sm.states || []) {
    if (field && s.value !== undefined && !allowedValue(field.text, s.value)) errs.push(`state ${s.id}: value ${s.value} not among allowed values of ${sm.entity}.${sm.field}`);
    errs.push(...refCiteErrors(`state ${s.id}`, { cite: s.cite }, ctx));
  }
  return errs;
}

function reachabilityErrors(sm, initials) {
  if (!initials.length) return [];
  const seen = new Set(initials.flatMap((i) => [...reachableFrom(i.id, sm.transitions || [])]));
  return (sm.states || []).filter((s) => !seen.has(s.id)).map((s) => `state ${s.id}: unreachable from the initial state`);
}

function stateMachineErrors(sm, ctx) {
  const errs = [];
  const ent = ctx.entities.get(sm.entity);
  const field = ent?.fields.find((f) => f.name === sm.field);
  if (!ent) errs.push(`unknown entity ${sm.entity}`);
  else if (!field) errs.push(`unknown field ${sm.entity}.${sm.field}`);
  errs.push(...stateErrors(sm, field, ctx));
  const initials = (sm.states || []).filter((s) => s.initial);
  if (initials.length !== 1) errs.push(`${initials.length} initial states (need exactly 1)`);
  const states = new Set((sm.states || []).map((s) => s.id));
  for (const t of sm.transitions || []) errs.push(...transitionErrors(t, states, ctx));
  errs.push(...reachabilityErrors(sm, initials));
  return errs.map((e) => `${sm.id}: ${e}`);
}

export function checkStates(pkgDir, machines, appDir = null) {
  const ctx = { appDir, resolve: refResolver(pkgDir), entities: new Map(modelOf(pkgDir).entities.map((e) => [e.name, e])) };
  return [...dupIds("state machine", machines), ...machines.flatMap((m) => stateMachineErrors(m, ctx))];
}

/** Diagram label `trigger [guard]`, each part clipped (full text stays in the record, table and SCXML). */
const clip = (x, n = 40) => (x.length > n ? `${x.slice(0, n - 1)}…` : x);
/** State-diagram text: `:` starts a description in Mermaid's state grammar, so use the look-alike U+A789. */
const stLbl = (x) => clip(lbl(x).replace(/:/g, "꞉"));
const transitionLabel = (t) => `${stLbl(t.trigger)}${t.guard ? ` [${stLbl(t.guard)}]` : ""}`;

/** Mermaid stateDiagram-v2; over the edge budget, parallel transitions are one edge with their count. */
export function stateMermaid(sm, budget = DEFAULT_BUDGET) {
  const out = ["stateDiagram-v2"];
  for (const s of sm.states) if (s.label && s.label !== s.id) out.push(`  state "${stLbl(s.label)}" as ${sid(s.id)}`);
  for (const s of sm.states.filter((x) => x.initial)) out.push(`  [*] --> ${sid(s.id)}`);
  const merged = mergeParallel(sm, budget);
  if (merged) for (const e of merged) out.push(`  ${sid(e.from)} --> ${sid(e.to)} : ${e.count > 1 ? `${e.count} transitions` : transitionLabel(sm.transitions[e.transitions[0]])}`);
  else for (const t of sm.transitions) out.push(`  ${sid(t.from)} --> ${sid(t.to)} : ${transitionLabel(t)}`);
  for (const s of sm.states.filter((x) => x.final)) out.push(`  ${sid(s.id)} --> [*]`);
  return `${out.join("\n")}\n`;
}

/** W3C SCXML 1.0 document of a state machine. */
export function stateScxml(sm) {
  const init = sm.states.find((s) => s.initial);
  const body = sm.states.map((s) => {
    const ts = sm.transitions
      .filter((t) => t.from === s.id)
      .map((t) => `    <transition event="${xml(sid(t.trigger))}" target="${xml(t.to)}"${t.guard ? ` cond="${xml(t.guard)}"` : ""}/>`);
    const tag = s.final && !ts.length ? "final" : "state";
    return ts.length ? `  <${tag} id="${xml(s.id)}">\n${ts.join("\n")}\n  </${tag}>` : `  <${tag} id="${xml(s.id)}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="${xml(init?.id ?? "")}" name="${xml(sm.id)}">\n${body.join("\n")}\n</scxml>\n`;
}

const refsOfMachine = (sm) => uniq((sm.transitions || []).flatMap((t) => t.refs || []));

// ---------- objects ----------

/** ER relations of the package (diagrams/er/*.json), de-duplicated by endpoints. */
export function erRelations(pkgDir) {
  const dir = join(pkgDir, "diagrams", "er");
  const rels = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).relations || []) : [];
  const seen = new Set();
  return rels.filter((r) => (seen.has(`${r.from}>${r.to}`) ? false : (seen.add(`${r.from}>${r.to}`), true)));
}
const relationBetween = (rels, a, b) => rels.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
const SINGLE = new Set(["1", "0..1"]);
/** Object id from its entity: leading acronym lower-cased (ERPOrderLine -> erpOrderLine) + running number. */
const objId = (entity, n) => `${entity.replace(/^[A-Z]+(?=[A-Z][a-z])|^[A-Z]/, (m) => m.toLowerCase())}${n}`;

/** Multiplicity: an object may link to at most one object of an entity on a single-valued side. */
function neighbours(o, byId) {
  const nb = new Map(o.objects.map((x) => [x.id, []]));
  for (const l of o.links) {
    const [a, b] = [byId.get(l.from), byId.get(l.to)];
    if (a && b) nb.get(a.id).push(b), nb.get(b.id).push(a);
  }
  return nb;
}

/** Entity an object of `entity` may link to at most once through relation `r`, or null. */
function singleSide(r, entity) {
  const [left, right] = String(r.cardinality || "N:M").split(":");
  if (entity === r.to && SINGLE.has(left)) return r.from;
  return entity === r.from && SINGLE.has(right) ? r.to : null;
}

function multiplicityErrors(o, byId, rels) {
  const nb = neighbours(o, byId);
  const errs = [];
  for (const r of rels)
    for (const obj of o.objects) {
      const one = singleSide(r, obj.entity);
      if (one && nb.get(obj.id).filter((x) => x.entity === one).length > 1) errs.push(`${obj.id}: more than one ${one} (relation ${r.cardinality})`);
    }
  return errs;
}

function objectErrors(ob, ctx) {
  const ent = ctx.entities.get(ob.entity);
  if (!ent) return [`${ob.id}: unknown entity ${ob.entity}`];
  return Object.keys(ob.attrs || {})
    .filter((k) => !ent.fields.some((f) => f.name === k))
    .map((k) => `${ob.id}: ${ob.entity} has no field ${k}`);
}

function linkError(l, byId, rels) {
  const [a, b] = [byId.get(l.from), byId.get(l.to)];
  if (!a || !b) return `link ${l.from}-${l.to}: unknown object`;
  return relationBetween(rels, a.entity, b.entity) ? null : `link ${l.from}-${l.to}: no ER relation ${a.entity}-${b.entity}`;
}

function objectDiagramErrors(o, ctx) {
  const errs = [];
  const byId = new Map();
  for (const ob of o.objects || []) {
    if (byId.has(ob.id)) errs.push(`${ob.id}: duplicate object id`);
    byId.set(ob.id, ob);
    errs.push(...objectErrors(ob, ctx));
  }
  errs.push(...(o.links || []).map((l) => linkError(l, byId, ctx.rels)).filter(Boolean));
  errs.push(...multiplicityErrors({ objects: o.objects || [], links: o.links || [] }, byId, ctx.rels));
  return errs.map((e) => `${o.id}: ${e}`);
}

export function checkObjects(pkgDir, diagrams) {
  const ctx = { entities: new Map(modelOf(pkgDir).entities.map((e) => [e.name, e])), rels: erRelations(pkgDir) };
  return [...dupIds("object diagram", diagrams), ...diagrams.flatMap((o) => objectDiagramErrors(o, ctx))];
}

/** Synthetic value of a model field: first allowed value, else the default, else a typed placeholder. */
function synthValue(field, n) {
  const allowed = String(field.text || "").match(/allowed:\s*'([^']*)'/);
  if (allowed) return allowed[1];
  const t = String(field.type || "").toLowerCase();
  if (/number|int|float|decimal/.test(t)) return n;
  if (/bool/.test(t)) return true;
  if (/date|time/.test(t)) return `2026-01-${String(n).padStart(2, "0")}`;
  return `${field.name}-${n}`;
}

/** Synthetic object diagram from ER relations + model fields, breadth-first from `seed` (each entity once). */
/** Neighbour entities of `entity` not yet visited, with how many instances to create (fan-out on a many side). */
const otherEnd = (r, entity) => (r.from === entity ? r.to : r.to === entity ? r.from : null);

/** Neighbour entities of `entity` not yet visited, with how many instances to create (fan-out on a many side). */
function synthChildren(entity, rels, entities, visited, fanout) {
  const out = [];
  for (const r of rels) {
    const other = otherEnd(r, entity);
    if (!other || visited.has(other) || !entities.has(other)) continue;
    out.push({ other, label: r.label || "", count: singleSide(r, entity) === other ? 1 : fanout });
  }
  return out;
}

/** Synthetic object diagram from ER relations + model fields, breadth-first from `seed` (each entity once). */
export function objectsSynth(pkgDir, seed, { depth = 2, fanout = 2 } = {}) {
  const entities = new Map(modelOf(pkgDir).entities.map((e) => [e.name, e]));
  if (!entities.has(seed)) throw new Error(`unknown entity ${seed}`);
  const rels = erRelations(pkgDir);
  const counter = {};
  const objects = [];
  const links = [];
  const make = (entity, parent) => {
    counter[entity] = (counter[entity] || 0) + 1;
    const n = counter[entity];
    const attrs = {};
    for (const f of entities.get(entity).fields) attrs[f.name] = parent && f.name in parent.attrs ? parent.attrs[f.name] : synthValue(f, n);
    const ob = { id: objId(entity, n), entity, attrs };
    objects.push(ob);
    return ob;
  };
  const visited = new Set([seed]);
  let frontier = [make(seed, null)];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const ob of frontier)
      for (const c of synthChildren(ob.entity, rels, entities, visited, fanout))
        for (let i = 0; i < c.count; i++) {
          const child = make(c.other, ob);
          links.push({ from: ob.id, to: child.id, relation: c.label });
          next.push(child);
        }
    for (const ob of next) visited.add(ob.entity);
    frontier = next;
  }
  return { id: `OBJ-${seed}`, title: `${seed} (synthetic)`, source: "synthetic", masked: false, objects, links };
}

const decodeJson = (buf) => {
  for (const enc of ["utf-8", "windows-1250"]) {
    try {
      return JSON.parse(new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(buf).replace(/^\uFEFF/, ""));
    } catch {}
  }
  throw new Error("source is not JSON in UTF-8 or windows-1250");
};

/** Problems with a db extraction job (no source values in any message). */
function jobErrors(job, rels, entities, db) {
  const errs = [];
  for (const [ent, table] of Object.entries(job.tables || {})) {
    if (!entities.has(ent)) errs.push(`tables: unknown entity ${ent}`);
    if (!Array.isArray(db[table])) errs.push(`tables: ${ent} -> ${table}: no such table in the source`);
  }
  for (const j of job.joins || []) if (!relationBetween(rels, j.from, j.to) || j.from === j.to) errs.push(`join ${j.from}.${j.fk} -> ${j.to}.${j.key}: no ER relation ${j.from}-${j.to}`);
  if (!job.tables?.[job.seed?.entity]) errs.push(`seed: entity ${job.seed?.entity} has no table`);
  return errs;
}

/** Pseudonymizer: equal source values -> equal pseudonyms; `keep` fields pass through. */
function masker(keep) {
  const codes = new Map();
  return (field, v) => {
    if (v === null || v === undefined || keep.has(field)) return v ?? null;
    const k = JSON.stringify(v);
    if (!codes.has(k)) codes.set(k, codes.size + 1);
    return `${field}~${codes.get(k)}`;
  };
}

/** Object diagram from a JSON database snapshot (tables of row objects); masked unless fields are kept. */
function seedRowOf(job, rows) {
  const m = job.seed.match;
  return m ? rows.find((r) => Object.entries(m).every(([k, v]) => r[k] === v)) : rows[job.seed.index ?? 0];
}

/** Rows of the other side of join `j` that match object `ob` (by fk/key), at most `limit`. */
function joinHits(ob, j, rowsOf, limit) {
  const fwd = j.from === ob.entity;
  if (!fwd && j.to !== ob.entity) return null;
  const [other, mine, theirs] = fwd ? [j.to, j.fk, j.key] : [j.from, j.key, j.fk];
  return { other, rows: rowsOf(other).filter((r) => r[theirs] !== undefined && r[theirs] === ob.row[mine]).slice(0, limit) };
}

/** Object store for one extraction: masked attributes, one object per source row. */
function objectStore(job, entities, rowsOf) {
  const mask = masker(new Set(job.keep || []));
  const seen = new Map();
  const objects = [];
  const add = (ent, row) => {
    const key = `${ent}:${rowsOf(ent).indexOf(row)}`;
    if (seen.has(key)) return { ob: seen.get(key), fresh: false };
    const cols = job.columns?.[ent] || Object.fromEntries(entities.get(ent).fields.map((f) => [f.name, f.name]));
    const attrs = {};
    for (const [field, col] of Object.entries(cols)) if (col in row) attrs[field] = mask(field, row[col]);
    const ob = { id: objId(ent, objects.filter((o) => o.entity === ent).length + 1), entity: ent, attrs, row };
    seen.set(key, ob);
    objects.push(ob);
    return { ob, fresh: true };
  };
  return { add, objects };
}

/** Object diagram from a JSON database snapshot (tables of row objects); masked unless fields are kept. */
/** Breadth-first walk over the job's joins from the seed object; returns the links. */
/** Objects joined to `ob` through every job join; appends new links, returns newly created objects. */
function expandJoins(ob, ctx) {
  const fresh = [];
  for (const j of ctx.job.joins || []) {
    const hit = joinHits(ob, j, ctx.rowsOf, ctx.job.limit ?? 5);
    for (const r of hit?.rows || []) {
      const added = ctx.store.add(hit.other, r);
      const o2 = added.ob;
      if (!ctx.links.some((l) => (l.from === ob.id && l.to === o2.id) || (l.from === o2.id && l.to === ob.id)))
        ctx.links.push({ from: ob.id, to: o2.id, relation: relationBetween(ctx.rels, j.from, j.to).label || "" });
      if (added.fresh) fresh.push(o2);
    }
  }
  return fresh;
}

/** Breadth-first walk over the job's joins from the seed object; returns the links. */
function walkJoins(job, store, rowsOf, rels, seed) {
  const ctx = { job, store, rowsOf, rels, links: [] };
  let frontier = [seed];
  for (let d = 0; d < (job.depth ?? 2) && frontier.length; d++) frontier = frontier.flatMap((ob) => expandJoins(ob, ctx));
  return ctx.links;
}

/** Object diagram from a JSON database snapshot (tables of row objects); masked unless fields are kept. */
export function objectsFromDb(pkgDir, job) {
  const entities = new Map(modelOf(pkgDir).entities.map((e) => [e.name, e]));
  const rels = erRelations(pkgDir);
  const db = decodeJson(readFileSync(job.source));
  const errs = jobErrors(job, rels, entities, db);
  if (errs.length) return { errors: errs };
  const rowsOf = (ent) => db[job.tables[ent]];
  const store = objectStore(job, entities, rowsOf);
  const seedRow = seedRowOf(job, rowsOf(job.seed.entity));
  if (!seedRow) return { errors: ["seed: no matching row"] };
  const links = walkJoins(job, store, rowsOf, rels, store.add(job.seed.entity, seedRow).ob);
  const name = String(job.source).split(/[\\/]/).pop();
  const objects = store.objects.map(({ row, ...o }) => o);
  return { errors: [], diagram: { id: job.id || "OBJ-db", title: job.title || `${job.seed.entity} from ${name}`, source: name, masked: true, keep: job.keep || [], objects, links } };
}

/** Mermaid flowchart in UML object notation (`id : Entity` + attribute values). */
export function objectMermaid(o) {
  const out = ["flowchart LR"];
  for (const ob of o.objects) {
    const attrs = Object.entries(ob.attrs || {}).map(([k, v]) => `${lbl(k)} = ${lbl(v === null ? "null" : v)}`);
    out.push(`  ${sid(ob.id)}["<u>${lbl(ob.id)} : ${lbl(ob.entity)}</u>${attrs.length ? `<br/>${attrs.join("<br/>")}` : ""}"]`);
  }
  for (const l of o.links) out.push(`  ${sid(l.from)} ---${l.relation ? `|"${lbl(l.relation)}"|` : ""} ${sid(l.to)}`);
  return `${out.join("\n")}\n`;
}

// ---------- package-level ----------

/** Gate everything; return the embedded form (diagrams rendered, refs/entities collected) or errors. */
export function behaviourData(pkgDir, { local = false, appDir = null, budget = DEFAULT_BUDGET } = {}) {
  const b = readBehaviour(pkgDir, { local });
  const errors = [...checkSequences(pkgDir, b.sequences, appDir), ...checkStates(pkgDir, b.states, appDir), ...checkObjects(pkgDir, b.objects)];
  if (errors.length) return { errors, behaviour: null };
  return {
    errors,
    behaviour: {
      sequences: b.sequences.map((s) => ({ ...s, entities: s.entities || [], refs: refsOfSequence(s), ...sequenceSplit(s, budget), collab: collaboration(s) })),
      states: b.states.map((m) => ({ ...m, refs: refsOfMachine(m), mermaid: stateMermaid(m, budget), merged: mergeParallel(m, budget) ? mergeParallel(m, budget).length : null, scxml: stateScxml(m) })),
      objects: b.objects.map((o) => ({ ...o, entities: uniq(o.objects.map((x) => x.entity)), mermaid: objectMermaid(o) })),
    },
  };
}
