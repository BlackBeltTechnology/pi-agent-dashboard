// Architecture model (diagrams/architecture.json) -> gate, C4 + C5 views, Structurizr DSL, Mermaid C4.
// One model, two notations: C4 container = C5 component (deployable), C4 component = C5 element.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packageResolver, readIf, readUi } from "./lib.mjs";

export const KINDS = ["person", "system", "container", "component", "node"];
/** kind -> required parent kind (null = must have no parent). */
const PARENT = { person: null, system: null, container: "system", component: "container", node: "node" };
export const TERMS = {
  person: { c4: "Person", c5: "User" },
  system: { c4: "Software System", c5: "System" },
  container: { c4: "Container", c5: "Component" },
  component: { c4: "Component", c5: "Element" },
  node: { c4: "Deployment Node", c5: "Deployment Node" },
};
const CITE_RE = /^([^\s:]+):(\d+)(?:-(\d+))?$/;

/** Read the optional model; null when absent. */
export function readArch(pkgDir) {
  const p = join(pkgDir, "diagrams", "architecture.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Ref resolver over the whole package (rules, specs, capabilities, screens, use cases). */
export function refResolver(pkgDir) {
  const r = packageResolver(pkgDir);
  const screens = new Set(readUi(pkgDir).screens.flatMap((s) => [s.id, ...(s.dialogs || []).map((d) => d.id)]));
  const ucs = new Set(JSON.parse(readIf(join(pkgDir, "diagrams", "use-cases.json")) || "[]").map((u) => u.id));
  return (ref) => {
    if (/^(BR|QUIRK|GAP)-\d+$/.test(ref)) return r.id(ref);
    const spec = ref.match(/^spec:([a-z0-9][a-z0-9-]*)#(.+)$/);
    if (spec) return r.spec(spec[1], spec[2].trim());
    if (ref.startsWith("cap:")) return existsSync(join(pkgDir, "capabilities", ref.slice(4), "spec.md"));
    return screens.has(ref) || ucs.has(ref);
  };
}

/** Line count of a file by newline bytes (works for UTF-8, cp125x and UTF-16LE alike). */
function lineCount(path) {
  const buf = readFileSync(path);
  let n = 1;
  for (const b of buf) if (b === 10) n += 1;
  return n;
}

/** Problem with one cite, or null; `appDir` also checks the file and line range. */
export function citeError(c, appDir) {
  const m = String(c).match(CITE_RE);
  if (!m) return `malformed cite ${c} (need file:line or file:a-b)`;
  if (!appDir) return null;
  const f = join(appDir, m[1]);
  if (!existsSync(f)) return `cite ${c} — no such file`;
  return Number(m[3] || m[2]) > lineCount(f) ? `cite ${c} — past end of file` : null;
}

const citeErrors = (who, cites, appDir) => (cites || []).map((c) => citeError(c, appDir)).filter(Boolean).map((x) => `${who}: ${x}`);

/** Nesting problem of one element, or null. */
function parentError(e, byId) {
  const want = PARENT[e.kind];
  const parent = e.parent && byId.get(e.parent);
  if (e.parent && !parent) return `unknown parent ${e.parent}`;
  if (want === null) return e.parent ? `a ${e.kind} has no parent` : null;
  if (parent) return parent.kind === want ? null : `parent ${e.parent} is a ${parent.kind}, a ${e.kind} needs a ${want}`;
  return e.kind === "node" ? null : `a ${e.kind} needs a ${want} parent`;
}

function elementErrors(e, byId, resolve, appDir) {
  const who = `element ${e.id}`;
  if (!KINDS.includes(e.kind)) return [`${who}: unknown kind ${e.kind}`];
  const errors = [];
  const pe = parentError(e, byId);
  if (pe) errors.push(`${who}: ${pe}`);
  for (const h of e.hosts || []) if (byId.get(h)?.kind !== "container") errors.push(`${who}: hosts ${h}, which is not a container`);
  if (e.hosts && e.kind !== "node") errors.push(`${who}: only a node hosts containers`);
  for (const ref of e.refs || []) if (!resolve(ref)) errors.push(`${who}: dangling ref ${ref}`);
  return [...errors, ...citeErrors(who, e.cites, appDir)];
}

function relationErrors(r, i, byId, resolve, appDir) {
  const who = `relation ${i} ${r.from}->${r.to}`;
  return [
    ...[r.from, r.to].filter((end) => !byId.has(end)).map((end) => `${who}: unknown element ${end}`),
    ...(r.refs || []).filter((ref) => !resolve(ref)).map((ref) => `${who}: dangling ref ${ref}`),
    ...citeErrors(who, r.cites, appDir),
  ];
}

/** Violations of the architecture model; `appDir` also resolves cites against the code. */
export function checkArch(pkgDir, model, appDir = null) {
  const resolve = refResolver(pkgDir);
  const byId = new Map();
  const errors = [];
  for (const e of model.elements || []) {
    if (byId.has(e.id)) errors.push(`element ${e.id}: duplicate id`);
    else byId.set(e.id, e);
  }
  for (const e of model.elements || []) errors.push(...elementErrors(e, byId, resolve, appDir));
  for (const [i, r] of (model.relations || []).entries()) errors.push(...relationErrors(r, i, byId, resolve, appDir));
  return errors;
}

// ---------- views ----------

const label = (s) => String(s ?? "").replace(/"/g, "'").replace(/</g, "‹").replace(/>/g, "›").replace(/\s+/g, " ").trim();
const short = (s, n = 70) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || "");

/** Relations lifted to the nearest visible ancestors; one edge per ordered pair, no self-loops. */
function liftEdges(model, visible) {
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const vis = (id) => {
    for (let e = byId.get(id); e; e = byId.get(e.parent)) if (visible.has(e.id)) return e.id;
    return null;
  };
  const pairs = new Map();
  for (const r of model.relations || []) {
    const [a, b] = [vis(r.from), vis(r.to)];
    if (!a || !b || a === b) continue;
    const k = `${a}>${b}`;
    if (pairs.has(k)) pairs.get(k).n += 1;
    else pairs.set(k, { from: a, to: b, label: r.label, tech: r.tech, n: 1 });
  }
  return [...pairs.values()].map((e) => ({ ...e, label: e.n > 1 ? `${e.label} (+${e.n - 1})` : e.label }));
}

/** Mermaid flowchart in C4/C5 box notation; returns {mermaid, nodes: {nid: elementId}}. */
function flowchart({ model, notation, shown, groups, edges, extra = [] }) {
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const nid = new Map();
  const id = (x) => {
    if (!nid.has(x)) nid.set(x, `n${nid.size}`);
    return nid.get(x);
  };
  const lines = ["flowchart TB"];
  const box = (e, pad, gid = e.id) => {
    const term = TERMS[e.kind][notation];
    const kind = e.kind === "system" && e.external ? `External ${term}` : term;
    const text = `<b>${label(e.name)}</b><br/>[${kind}${e.tech ? `: ${label(e.tech)}` : ""}]${e.description ? `<br/>${label(short(e.description))}` : ""}`;
    const shape = e.kind === "person" ? [`(["`, `"])`] : e.store ? [`[("`, `")]`] : [`["`, `"]`];
    const cls = e.kind === "system" && e.external ? "ext" : e.kind;
    lines.push(`${pad}${id(gid)}${shape[0]}${text}${shape[1]}:::${cls}`);
  };
  const emit = (gid, pad) => {
    const e = byId.get(gid.split("@")[0]);
    const kids = groups.get(gid) || [];
    if (!kids.length) {
      box(e, pad, gid);
      return;
    }
    const term = TERMS[e.kind][notation];
    // short title (name + kind): long cluster titles wrap under the boxes; tech is on the element page
    lines.push(`${pad}subgraph ${id(gid)}["${label(e.name)} · ${term}"]`);
    for (const k of kids) emit(k, `${pad}  `);
    lines.push(`${pad}end`);
  };
  for (const s of shown) emit(s, "  ");
  for (const e of [...edges, ...extra]) {
    const text = label(`${e.label || ""}${e.tech ? ` [${e.tech}]` : ""}`);
    const arrow = e.deploy ? "-.->" : "-->";
    lines.push(`  ${id(e.from)} ${arrow}${text ? `|"${text}"|` : ""} ${id(e.to)}`);
  }
  lines.push(
    "  classDef person fill:#08427b,color:#fff,stroke:#052e56",
    "  classDef system fill:#1168bd,color:#fff,stroke:#0b4884",
    "  classDef ext fill:#999,color:#fff,stroke:#6b6b6b",
    "  classDef container fill:#438dd5,color:#fff,stroke:#2e6295",
    "  classDef component fill:#85bbf0,color:#000,stroke:#5d82a8",
    "  classDef node fill:#fff,color:#000,stroke:#888",
  );
  return { mermaid: lines.join("\n"), nodes: Object.fromEntries([...nid].map(([k, v]) => [v, k.split("@")[0]])) };
}

const kids = (model, parent, kind) => model.elements.filter((e) => e.parent === parent && (!kind || e.kind === kind)).map((e) => e.id);
const connected = (ids, edges, keep) => ids.filter((x) => keep.has(x) || edges.some((e) => e.from === x || e.to === x));

function contextView(model) {
  const ids = model.elements.filter((e) => e.kind === "person" || e.kind === "system").map((e) => e.id);
  const edges = liftEdges(model, new Set(ids));
  return { id: "c4-context", title: "C4 · System context", ...flowchart({ model, notation: "c4", shown: ids, groups: new Map(), edges }), edges };
}

function containerView(model, sys, single) {
  const conts = kids(model, sys, "container");
  const others = model.elements.filter((e) => (e.kind === "person" || e.kind === "system") && e.id !== sys).map((e) => e.id);
  const edges = liftEdges(model, new Set([...conts, ...others]));
  const shown = [sys, ...connected(others, edges, new Set())];
  const name = model.elements.find((e) => e.id === sys).name;
  return {
    id: single ? "c4-container" : `c4-container:${sys}`,
    title: `C4 · Containers of ${name}`,
    ...flowchart({ model, notation: "c4", shown, groups: new Map([[sys, conts]]), edges }),
    edges,
  };
}

function componentView(model, cont) {
  const comps = kids(model, cont, "component");
  const outside = model.elements.filter((e) => (e.kind === "container" && e.id !== cont) || e.kind === "person" || (e.kind === "system" && !kids(model, e.id).includes(cont))).map((e) => e.id);
  const edges = liftEdges(model, new Set([...comps, ...outside]));
  const shown = [cont, ...connected(outside, edges, new Set())];
  const name = model.elements.find((e) => e.id === cont).name;
  return { id: `c4-component:${cont}`, title: `C4 · Components of ${name}`, ...flowchart({ model, notation: "c4", shown, groups: new Map([[cont, comps]]), edges }), edges };
}

/** Nodes nest in nodes; each container appears inside the first node hosting it. */
function nodeGroups(model) {
  const groups = new Map();
  const placed = new Set();
  for (const n of model.elements.filter((e) => e.kind === "node")) {
    // first host keeps the container id (edges attach there); later hosts get an instance `<id>@<node>`
    const inner = [...kids(model, n.id, "node"), ...(n.hosts || []).map((h) => (placed.has(h) ? `${h}@${n.id}` : h))];
    for (const h of n.hosts || []) placed.add(h);
    groups.set(n.id, inner);
  }
  const roots = model.elements.filter((e) => e.kind === "node" && !e.parent).map((e) => e.id);
  return { groups, roots, placed };
}

function deploymentView(model) {
  const { groups, roots, placed } = nodeGroups(model);
  const edges = liftEdges(model, placed);
  return { id: "c4-deployment", title: "C4 · Deployment", ...flowchart({ model, notation: "c4", shown: roots, groups, edges }), edges };
}

function c5View(model) {
  const groups = new Map();
  for (const e of model.elements) if (e.kind === "system" || e.kind === "container") groups.set(e.id, kids(model, e.id).filter((k) => byKind(model, k) !== "node"));
  for (const e of model.elements) if (e.kind === "node") groups.set(e.id, kids(model, e.id, "node"));
  const visible = new Set(model.elements.filter((e) => e.kind !== "node").map((e) => e.id));
  const edges = liftEdges(model, visible);
  const deploy = model.elements.filter((e) => e.kind === "node").flatMap((n) => (n.hosts || []).map((h) => ({ from: n.id, to: h, label: "deploys", deploy: true })));
  const shown = model.elements.filter((e) => !e.parent).map((e) => e.id);
  return {
    id: "c5",
    title: "C5 · System, components, elements, deployment nodes",
    ...flowchart({ model, notation: "c5", shown, groups, edges, extra: deploy }),
    edges: [...edges, ...deploy],
  };
}
const byKind = (model, id) => model.elements.find((e) => e.id === id)?.kind;

/** All views: C4 context, containers per in-scope system, components per container, deployment; C5. */
export function archViews(model) {
  const inScope = model.elements.filter((e) => e.kind === "system" && !e.external).map((e) => e.id);
  const conts = model.elements.filter((e) => e.kind === "container" && kids(model, e.id, "component").length).map((e) => e.id);
  const views = [contextView(model), ...inScope.map((s) => containerView(model, s, inScope.length === 1)), ...conts.map((c) => componentView(model, c))];
  if (model.elements.some((e) => e.kind === "node")) views.push(deploymentView(model));
  views.push(c5View(model));
  return views;
}

// ---------- exports ----------

const q = (s) => `"${String(s ?? "").replace(/"/g, "'")}"`;
const ident = (s) => s.replace(/[^A-Za-z0-9_]/g, "_");

/** Structurizr DSL workspace: model (with deployment environment) + one view per C4 level. */
export function toStructurizr(model, title) {
  const out = [`workspace ${q(title)} "Generated from the rebuild package architecture model" {`, "  model {"];
  const el = (e, pad) => {
    const kw = { person: "person", system: "softwareSystem", container: "container", component: "component" }[e.kind];
    const args = e.kind === "person" || e.kind === "system" ? [e.name, e.description] : [e.name, e.description, e.tech];
    const inner = model.elements.filter((x) => x.parent === e.id);
    const tags = [e.external ? "External" : "", e.store ? "Database" : ""].filter(Boolean);
    const head = `${pad}${ident(e.id)} = ${kw} ${args.map(q).join(" ")}`;
    if (!inner.length && !tags.length) return out.push(head);
    out.push(`${head} {`);
    if (tags.length) out.push(`${pad}  tags ${tags.map(q).join(" ")}`);
    for (const x of inner) el(x, `${pad}  `);
    out.push(`${pad}}`);
  };
  for (const e of model.elements.filter((x) => !x.parent && x.kind !== "node")) el(e, "    ");
  for (const r of model.relations || []) out.push(`    ${ident(r.from)} -> ${ident(r.to)} ${q(r.label)}${r.tech ? ` ${q(r.tech)}` : ""}`);
  const nodes = model.elements.filter((e) => e.kind === "node");
  if (nodes.length) {
    out.push('    deploymentEnvironment "Production" {');
    const node = (n, pad) => {
      out.push(`${pad}${ident(n.id)} = deploymentNode ${q(n.name)} ${q(n.description)} ${q(n.tech)} {`);
      for (const h of n.hosts || []) out.push(`${pad}  containerInstance ${ident(h)}`);
      for (const c of nodes.filter((x) => x.parent === n.id)) node(c, `${pad}  `);
      out.push(`${pad}}`);
    };
    for (const n of nodes.filter((x) => !x.parent)) node(n, "      ");
    out.push("    }");
  }
  out.push("  }", "  views {");
  const inScope = model.elements.filter((e) => e.kind === "system" && !e.external);
  for (const s of inScope) {
    out.push(`    systemContext ${ident(s.id)} { include * autolayout lr }`, `    container ${ident(s.id)} { include * autolayout lr }`);
    if (nodes.length) out.push(`    deployment ${ident(s.id)} "Production" { include * autolayout lr }`);
  }
  for (const c of model.elements.filter((e) => e.kind === "container" && kids(model, e.id).length)) out.push(`    component ${ident(c.id)} { include * autolayout lr }`);
  out.push("    theme default", "  }", "}");
  return `${out.join("\n")}\n`;
}

/** Mermaid C4 (context + container) for tools that read Mermaid's C4 syntax. */
export function toMermaidC4(model, title) {
  const views = archViews(model);
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const decl = (e) => {
    if (e.kind === "person") return `Person(${ident(e.id)}, ${q(e.name)}, ${q(e.description)})`;
    if (e.kind === "system") return `${e.external ? "System_Ext" : "System"}(${ident(e.id)}, ${q(e.name)}, ${q(e.description)})`;
    return `${e.store ? "ContainerDb" : "Container"}(${ident(e.id)}, ${q(e.name)}, ${q(e.tech)}, ${q(e.description)})`;
  };
  const rels = (v) => v.edges.map((e) => `  Rel(${ident(e.from)}, ${ident(e.to)}, ${q(e.label)}${e.tech ? `, ${q(e.tech)}` : ""})`);
  const ctx = views.find((v) => v.id === "c4-context");
  const blocks = [["C4Context", ctx, () => model.elements.filter((e) => e.kind === "person" || e.kind === "system").map((e) => `  ${decl(e)}`)]];
  for (const v of views.filter((x) => x.id.startsWith("c4-container"))) {
    const sys = Object.values(v.nodes).find((id) => byId.get(id).kind === "system" && !byId.get(id).external);
    blocks.push([
      "C4Container",
      v,
      () => [
        ...Object.values(v.nodes).filter((id) => byId.get(id).kind !== "container" && id !== sys).map((id) => `  ${decl(byId.get(id))}`),
        `  System_Boundary(${ident(sys)}_b, ${q(byId.get(sys).name)}) {`,
        ...kids(model, sys, "container").map((id) => `    ${decl(byId.get(id))}`),
        "  }",
      ],
    ]);
  }
  const md = blocks.map(([kw, v, body]) => `## ${v.title}\n\n\`\`\`mermaid\n${kw}\n  title ${v.title}\n${[...body(), ...rels(v)].join("\n")}\n\`\`\`\n`);
  return `# ${title} — C4 (Mermaid)\n\n${md.join("\n")}`;
}
