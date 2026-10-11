// Diagram size budget + structural splitting. Deterministic: same input + budget -> same output.
// See references/splitting.md. See change: add-diagram-splitting.
import { buildIfml, ifmlToXmi } from "./ifml.mjs";

export const DEFAULT_BUDGET = { nodes: 30, edges: 40 };

/** Budget from argv flags `--max-nodes n` / `--max-edges n` (positive integers). */
export function budgetOf(argv) {
  const budget = { ...DEFAULT_BUDGET };
  for (const [flag, key] of [["--max-nodes", "nodes"], ["--max-edges", "edges"]]) {
    const i = argv.indexOf(flag);
    if (i < 0) continue;
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer`);
    budget[key] = n;
  }
  return budget;
}

const clipName = (x, n = 32) => (x.length > n ? `${x.slice(0, n - 2)}…` : x);
const fits = (size, budget) => size.nodes <= budget.nodes && size.edges <= budget.edges;

// ---------- IFML ----------

const REC_ID = /\b(?:SCR|DLG)-[\w-]*\w/g;
/** Directed links between UI records: navigation, dialogs that are records, records named in effect targets. */
function recordLinks(ui) {
  const ids = new Set(ui.screens.map((s) => s.id));
  const links = [];
  for (const s of ui.screens) {
    const to = [
      ...(s.navigation || []).map((n) => n.to),
      ...(s.dialogs || []).map((d) => d.id),
      ...(s.actions || []).flatMap((a) => (a.effects || []).flatMap((e) => String(e.target ?? "").match(REC_ID) || [])),
    ];
    for (const t of new Set(to)) if (ids.has(t) && t !== s.id) links.push({ from: s.id, to: t });
  }
  return links;
}

/** Hop distance from a route to every non-route record it reaches through non-route records. */
function reach(route, out, isRoute) {
  const dist = new Map([[route, 0]]);
  const queue = [route];
  while (queue.length) {
    const cur = queue.shift();
    for (const t of out.get(cur) || []) {
      if (isRoute(t) || dist.has(t)) continue;
      dist.set(t, dist.get(cur) + 1);
      queue.push(t);
    }
  }
  dist.delete(route);
  return dist;
}

/** Areas: each route + the non-route records nearest to it (ties: first route by id); rest -> AREA-shared. */
export function ifmlAreas(ui) {
  const byId = new Map(ui.screens.map((s) => [s.id, s]));
  const isRoute = (id) => byId.get(id)?.kind === "route";
  const out = new Map();
  for (const l of recordLinks(ui)) out.set(l.from, [...(out.get(l.from) || []), l.to]);
  const routes = ui.screens.filter((s) => s.kind === "route").map((s) => s.id).sort();
  const best = new Map();
  for (const r of routes)
    for (const [id, d] of reach(r, out, isRoute)) if (!best.has(id) || d < best.get(id).d) best.set(id, { r, d });
  const areas = routes.map((r) => {
    const members = [...best].filter(([, v]) => v.r === r).sort(([a, x], [b, y]) => x.d - y.d || a.localeCompare(b)).map(([id]) => id);
    return { id: `AREA-${r}`, title: clipName(byId.get(r).name || r), screens: [r, ...members] };
  });
  const rest = ui.screens.map((s) => s.id).filter((id) => !isRoute(id) && !best.has(id)).sort();
  if (rest.length) areas.push({ id: "AREA-shared", title: "Shared", screens: rest });
  return areas;
}

/** Nodes (elements except done ports) and edges (flows) of an IFML projection. */
export function ifmlSize(model) {
  return { nodes: model.elements.filter((e) => e.type !== "ActionEvent").length, edges: model.flows.length };
}

const hasLayout = (s) => Boolean((s.forms || []).length || (s.fields || []).length);

/** Forms + fields a part shows: layout "all" = every one, an atom list [{form|null, key|null}] = those, else none. */
function layoutOf(s, layout) {
  if (layout === "all") return { forms: s.forms, fields: s.fields };
  if (!layout) return { forms: [], fields: [] };
  const forms = new Set(layout.map((a) => a.form).filter(Boolean));
  const fields = new Set(layout.filter((a) => !a.form).map((a) => a.key));
  return { forms: (s.forms || []).filter((f) => forms.has(f.form)), fields: (s.fields || []).filter((f) => fields.has(f.key)) };
}

/** A screen record reduced to some actions (null = whole) and a layout (see layoutOf). */
function reduced(s, actions, layout) {
  if (!actions) return s;
  const keep = new Set(actions);
  return {
    ...s,
    actions: (s.actions || []).filter((a) => keep.has(a.id)),
    dialogs: (s.dialogs || []).filter((d) => keep.has(d.from)),
    navigation: [],
    ...layoutOf(s, layout),
  };
}

/** Form records cut to the fields an atom-list layout picks (element ids unchanged). */
function formsFor(ui, picks) {
  const forms = { ...ui.forms };
  for (const atoms of picks.map((p) => p.layout).filter(Array.isArray)) {
    for (const key of new Set(atoms.map((a) => a.form).filter(Boolean))) {
      const keep = new Set(atoms.filter((a) => a.form === key).map((a) => a.key));
      forms[key] = { ...ui.forms[key], fields: (ui.forms[key]?.fields || []).filter((f) => keep.has(f.key)) };
    }
  }
  return forms;
}

function partOf(ui, id, title, area, picks, name) {
  const byId = new Map(ui.screens.map((s) => [s.id, s]));
  const screens = picks.map((p) => reduced(byId.get(p.id), p.actions, p.layout));
  const model = buildIfml({ ...ui, forms: formsFor(ui, picks), screens });
  return { id, title, area, screens: picks.map(({ id: sid, actions }) => ({ id: sid, actions })), size: ifmlSize(model), xmi: ifmlToXmi(model, `${name} — ${title}`) };
}
const sizeOfPicks = (ui, picks) => partOf(ui, "x", "x", "x", picks, "x").size;

/** Items cut in order into chunks; a chunk grows while `ok(chunk, index)` holds (a lone item always stays). */
function greedyChunks(items, ok) {
  const chunks = [[]];
  for (const it of items) {
    const cur = chunks[chunks.length - 1];
    if (cur.length && !ok([...cur, it], chunks.length - 1)) chunks.push([it]);
    else cur.push(it);
  }
  return chunks;
}

/** Forms/fields of a screen as their own groups ("forms"), packed field by field to the budget. */
function layoutGroups(ui, s, budget) {
  const formAtoms = [...new Set((s.forms || []).map((f) => f.form))].flatMap((form) => {
    const keys = (ui.forms[form]?.fields || []).map((f) => f.key);
    return keys.length ? keys.map((key) => ({ form, key })) : [{ form, key: null }];
  });
  const atoms = [...formAtoms, ...(s.fields || []).map((f) => ({ form: null, key: f.key }))];
  const chunks = greedyChunks(atoms, (layout) => fits(sizeOfPicks(ui, [{ id: s.id, actions: [], layout }]), budget));
  return chunks.map((c, i) => ({ kind: "forms", n: chunks.length > 1 ? i + 1 : 0, actions: [], layout: c }));
}

/**
 * Groups of one screen: its forms/fields ride with the first action group, or, when they do not fit
 * beside the first action, lead as their own "forms" groups; then action groups by trigger kind
 * (first appearance), each chunked to the budget.
 */
function screenGroups(ui, s, budget) {
  const kinds = [...new Set((s.actions || []).map((a) => a.trigger?.kind || "other"))];
  const firstAction = (s.actions || []).slice(0, 1).map((a) => a.id);
  const lead = hasLayout(s) && !fits(sizeOfPicks(ui, [{ id: s.id, actions: firstAction, layout: "all" }]), budget);
  const groups = lead ? layoutGroups(ui, s, budget) : [];
  for (const kind of kinds) {
    const ids = s.actions.filter((a) => (a.trigger?.kind || "other") === kind).map((a) => a.id);
    const layoutAt = (i) => (!groups.length && i === 0 ? "all" : undefined);
    const chunks = greedyChunks(ids, (actions, i) => fits(sizeOfPicks(ui, [{ id: s.id, actions, layout: layoutAt(i) }]), budget));
    chunks.forEach((c, i) => groups.push({ kind, n: chunks.length > 1 ? i + 1 : 0, actions: c, layout: groups.length ? undefined : "all" }));
  }
  return groups;
}

/** Adjacent unchunked kind groups packed together while they fit (fewer, fuller parts). */
function packGroups(ui, s, groups, budget) {
  const out = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    const joinable = last && !last.n && !g.n;
    if (joinable && fits(sizeOfPicks(ui, [{ id: s.id, actions: [...last.actions, ...g.actions], layout: last.layout }]), budget)) {
      last.kinds.push(g.kind);
      last.actions.push(...g.actions);
    } else out.push({ ...g, kinds: [g.kind], actions: [...g.actions] });
  }
  return out;
}

/** Kinds for ids/titles: up to 3 joined, else the first two + count. */
const kindsText = (kinds, sep, more) => (kinds.length > 3 ? `${kinds.slice(0, 2).join(sep)}${more}${kinds.length - 2}` : kinds.join(sep));

/** Parts of one over-budget screen: one per (packed) action group. */
function groupParts(ui, s, areaId, budget, name) {
  return packGroups(ui, s, screenGroups(ui, s, budget), budget).map((g) => {
    const id = `P-${s.id}-${kindsText(g.kinds, "-", "-plus")}${g.n ? `-${g.n}` : ""}`;
    const title = `${clipName(s.name || s.id)} · ${kindsText(g.kinds, ", ", " +")}${g.n ? ` ${g.n}` : ""}`;
    return partOf(ui, id, title, areaId, [{ id: s.id, actions: g.actions, layout: g.layout }], name);
  });
}

/** Parts of one area: whole area, else screens packed in order, a screen over budget -> action groups. */
function areaParts(ui, area, budget, name) {
  const whole = area.screens.map((id) => ({ id, actions: null }));
  if (fits(sizeOfPicks(ui, whole), budget)) return [partOf(ui, `P-${area.id}`, area.title, area.id, whole, name)];
  const byId = new Map(ui.screens.map((s) => [s.id, s]));
  const parts = [];
  let pack = [];
  const flush = () => {
    if (pack.length) parts.push(partOf(ui, `P-${pack[0].id}`, pack.map((p) => clipName(byId.get(p.id).name || p.id)).join(", "), area.id, pack, name));
    pack = [];
  };
  for (const id of area.screens) {
    const one = { id, actions: null };
    const s = byId.get(id);
    const tooBig = !fits(sizeOfPicks(ui, [one]), budget) && ((s.actions || []).length > 1 || hasLayout(s));
    if (tooBig || (pack.length && !fits(sizeOfPicks(ui, [...pack, one]), budget))) flush();
    if (tooBig) parts.push(...groupParts(ui, byId.get(id), area.id, budget, name));
    else pack.push(one);
  }
  flush();
  return parts;
}

const mq = (s) => String(s).replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
/** Overview of areas: nodes with part counts, cross-area link counts, Mermaid flowchart. */
function overviewOf(ui, areas, parts) {
  const areaOf = new Map(areas.flatMap((a) => a.screens.map((s) => [s, a.id])));
  const counts = new Map();
  for (const l of recordLinks(ui)) {
    const [a, b] = [areaOf.get(l.from), areaOf.get(l.to)];
    if (a !== b) counts.set(`${a}>${b}`, (counts.get(`${a}>${b}`) || 0) + 1);
  }
  const nodes = areas.map((a, i) => ({ id: a.id, nid: `a${i}`, title: a.title, screens: a.screens.length, parts: parts.filter((p) => p.area === a.id).map((p) => p.id) }));
  const nid = new Map(nodes.map((n) => [n.id, n.nid]));
  const edges = [...counts].map(([k, count]) => ({ from: k.split(">")[0], to: k.split(">")[1], count }));
  // top-to-bottom: a shared area linking to every route stays one wide row instead of a tall column
  const lines = ["flowchart TB", ...nodes.map((n) => `  ${n.nid}["${mq(n.title)}<br/>${n.screens} screen(s) · ${n.parts.length} part(s)"]`), ...edges.map((e) => `  ${nid.get(e.from)} -->|${e.count}| ${nid.get(e.to)}`)];
  return { nodes, edges, mermaid: `${lines.join("\n")}\n` };
}

/** IFML split: {size, areas, parts:[{id,title,area,screens,size,xmi}], overview}. */
export function ifmlParts(ui, budget, name = "IFML") {
  const areas = ifmlAreas(ui);
  const parts = areas.flatMap((a) => areaParts(ui, a, budget, name));
  return { size: ifmlSize(buildIfml(ui)), areas, parts, overview: overviewOf(ui, areas, parts) };
}

// ---------- behaviour ----------

/** Transitions between the same two states as one edge, when the machine is over the edge budget; else null. */
export function mergeParallel(sm, budget) {
  if ((sm.transitions || []).length <= budget.edges) return null;
  const edges = new Map();
  sm.transitions.forEach((t, i) => {
    const k = `${t.from}>${t.to}`;
    if (!edges.has(k)) edges.set(k, { from: t.from, to: t.to, count: 0, transitions: [] });
    const e = edges.get(k);
    e.count += 1;
    e.transitions.push(i);
  });
  return [...edges.values()];
}

function messagesIn(list, acc = []) {
  for (const m of list || []) {
    if (m.fragment) {
      messagesIn(m.messages, acc);
      messagesIn(m.else?.messages, acc);
    } else acc.push(m);
  }
  return acc;
}

/** A fragment over budget -> framed pieces: its messages chunked (`<label> (i/n)`), else branch as `else <label>`. */
function fragmentPieces(m, max) {
  // balanced pieces: ceil(n / pieces) each, so a 41-message branch at budget 40 gives 21 + 20, not 40 + 1
  const even = (list) => Math.ceil(messagesIn(list).length / Math.ceil(messagesIn(list).length / max));
  const wrap = (label, list) =>
    chunkItems(list || [], even(list || [])).map((c, i, all) => ({ fragment: m.fragment, label: all.length > 1 ? `${label} (${i + 1}/${all.length})` : label, refs: m.refs, messages: c }));
  return [...wrap(m.label, m.messages), ...(m.else ? wrap(`else ${m.else.label}`, m.else.messages) : [])];
}

/** Greedy chunks of consecutive items within `max` messages; a fragment is cut only when it alone is over. */
function chunkItems(items, max) {
  const units = items.flatMap((m) => (m.fragment && messagesIn([m]).length > max ? fragmentPieces(m, max) : [m]));
  const chunks = [[]];
  let cost = 0;
  for (const m of units) {
    const c = messagesIn([m]).length;
    if (chunks[chunks.length - 1].length && cost + c > max) {
      chunks.push([]);
      cost = 0;
    }
    chunks[chunks.length - 1].push(m);
    cost += c;
  }
  return chunks;
}

/** Consecutive top-level steps chunked to the edge budget; null within budget. */
export function sequenceParts(seq, budget) {
  const items = seq.messages || [];
  if (messagesIn(items).length <= budget.edges) return null;
  return chunkItems(items, budget.edges).map((messages, i) => {
    const used = new Set(messagesIn(messages).flatMap((m) => [m.from, m.to]));
    const msgs = messagesIn(messages);
    return {
      id: `${seq.id}#${i + 1}`,
      n: i + 1,
      title: `${msgs[0]?.label ?? ""}${msgs.length > 1 ? ` … ${msgs[msgs.length - 1].label}` : ""}`,
      messages,
      participants: seq.participants.map((p) => p.id).filter((id) => used.has(id)),
    };
  });
}

// ---------- ER ----------

/**
 * ER entity set -> diagrams within `max` entities: by authored cluster (in order), then the rest in chunks.
 * Self-contained: site.mjs injects its source into the catalog.
 */
export function erChunks(names, clusters, max) {
  if (names.length <= max) return [{ name: null, entities: names.slice() }];
  const out = [];
  const push = (name, list) => {
    for (let i = 0; i < list.length; i += max) out.push({ name, entities: list.slice(i, i + max) });
  };
  let rest = names.slice();
  for (const c of clusters) {
    const inC = rest.filter((n) => c.entities.includes(n));
    if (!inC.length) continue;
    push(c.name, inC);
    rest = rest.filter((n) => !inC.includes(n));
  }
  push(null, rest);
  // pack adjacent pieces that fit together (fewer, fuller diagrams; relations between them stay visible)
  const packed = [];
  for (const c of out) {
    const last = packed[packed.length - 1];
    if (last && last.entities.length + c.entities.length <= max) {
      last.entities = [...last.entities, ...c.entities];
      last.name = [last.name, c.name].filter(Boolean).join(" + ") || null;
    } else packed.push({ ...c });
  }
  return packed;
}

// ---------- report ----------

function ifmlLines(ui, budget, name, mark) {
  if (!ui?.screens?.length) return [];
  const s = ifmlParts(ui, budget, name);
  return [`ifml all: ${s.size.nodes} nodes, ${s.size.edges} edges -> ${s.parts.length} parts in ${s.areas.length} areas`, ...s.parts.map((p) => `ifml ${p.id}: ${p.size.nodes} nodes, ${p.size.edges} edges${mark(p.size)}`)];
}
function stateLines(states, budget, mark) {
  return states.map((m) => {
    const edges = mergeParallel(m, budget)?.length ?? m.transitions.length;
    return `sm ${m.id}: ${m.transitions.length} transitions -> ${edges} edges${mark({ nodes: m.states.length, edges })}`;
  });
}
function sequenceLines(sequences, budget, mark) {
  const seqLine = (id, participants, messages, tail = "") => `seq ${id}: ${messagesIn(messages).length} messages${tail}${tail ? "" : mark({ nodes: participants.length, edges: messagesIn(messages).length })}`;
  return sequences.flatMap((q) => {
    const parts = sequenceParts(q, budget);
    if (!parts) return [seqLine(q.id, q.participants, q.messages)];
    return [seqLine(q.id, q.participants, q.messages, ` -> ${parts.length} parts`), ...parts.map((p) => seqLine(p.id, p.participants, p.messages))];
  });
}

/** check-size lines: whole diagram -> split, each part with OVER when still above budget. */
export function sizeReport({ ui, behaviour, er }, budget, name) {
  let over = 0;
  const mark = (size) => (fits(size, budget) ? "" : (over++, " OVER"));
  const lines = [
    ...ifmlLines(ui, budget, name, mark),
    ...stateLines(behaviour?.states ?? [], budget, mark),
    ...sequenceLines(behaviour?.sequences ?? [], budget, mark),
    ...(er ?? []).map((c) => `er ${c.name}: ${c.entities.length} entities, ${c.relations} relations${mark({ nodes: c.entities.length, edges: c.relations })}`),
  ];
  return { lines, over };
}
