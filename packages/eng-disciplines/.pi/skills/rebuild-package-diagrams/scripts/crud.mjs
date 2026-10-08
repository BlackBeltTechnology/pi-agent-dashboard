// CRUD matrix: entity x use case / screen from classified UI effects. See references/crud-matrix.md.
// See change: add-crud-matrix.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { csvCell, duplicateRecords } from "./lib.mjs";

// call: data-layer functions (data.createInactivity, …) write too
const DATA_KINDS = new Set(["write", "read", "export", "call"]);
const OPS = ["C", "R", "U", "D"];
const STOP = new Set(["named", "of", "the", "row", "rows", "by", "per", "name", "table", "tables", "db", "cfg", "conf", "config", "settings", "data"]);

/** Lower-case identifiers of a text plus their camelCase / snake_case parts. */
function tokens(text) {
  const out = new Set();
  for (const id of String(text ?? "").match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
    out.add(id.toLowerCase());
    for (const p of id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/)) if (p) out.add(p.toLowerCase());
  }
  return out;
}

/** Entity -> aliases: name, plural, segments of dotted identifiers, table and collection names in its Persistence. */
export function aliasIndex(model) {
  return model.entities.map((e) => {
    const p = e.persistence || "";
    const al = new Set([e.name.toLowerCase(), `${e.name.toLowerCase()}s`]);
    for (const m of p.matchAll(/\b\w+(?:\.\w+)+/g)) for (const seg of m[0].split(".")) al.add(seg.toLowerCase());
    for (const m of p.matchAll(/\btable\s+(\w+)/gi)) al.add(m[1].toLowerCase());
    for (const m of p.matchAll(/\b(?:collection|colection)\s+(\w+)/gi)) al.add(m[1].toLowerCase());
    return { entity: e.name, aliases: [...al].filter((a) => !STOP.has(a)) };
  });
}

const effectsOf = (s) => (s.actions || []).flatMap((a) => (a.effects || []).map((e, n) => ({ action: a.id, n, key: `${a.id}#${n}`, e })));

/** Draft of one screen: every write/read/export/call effect with alias candidates (sorted). */
export function crudDraft(ui, model, screenId) {
  const s = ui.screens.find((x) => x.id === screenId);
  if (!s) throw new Error(`unknown screen ${screenId}`);
  const index = aliasIndex(model);
  const effects = effectsOf(s)
    .filter(({ e }) => DATA_KINDS.has(e.kind))
    .map(({ key, action, e }) => {
      const t = tokens(`${e.target ?? ""} ${e.step ?? ""}`);
      const candidates = index.filter((x) => x.aliases.some((a) => t.has(a))).map((x) => x.entity).sort();
      return { effect: key, action, kind: e.kind, step: e.step ?? "", target: e.target ?? "", cite: e.cite ?? "", candidates };
    });
  return { screen: s.id, effects };
}

/** diagrams/crud/*.json records (sorted by file), or null without the directory. */
export function readCrud(pkgDir) {
  const dir = join(pkgDir, "diagrams", "crud");
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

function effectError(s, key) {
  const [act, n] = String(key).split("#");
  const a = (s.actions || []).find((x) => x.id === act);
  if (!a) return `unknown action ${act}`;
  if (!/^\d+$/.test(n ?? "") || !(a.effects || [])[Number(n)]) return `${act} has no effect ${n}`;
  return null;
}

function oneEntryErrors(s, x, entities) {
  return [
    effectError(s, x.effect),
    entities.has(x.entity) ? null : `${x.effect}: unknown entity ${x.entity}`,
    OPS.includes(x.op) ? null : `${x.effect}: op ${x.op} (need C, R, U or D)`,
  ].filter(Boolean);
}

function entryErrors(s, r, entities) {
  const errors = [];
  const seen = new Set();
  for (const x of r.entries || []) {
    errors.push(...oneEntryErrors(s, x, entities));
    const k = `${x.effect} ${x.entity} ${x.op}`;
    if (seen.has(k)) errors.push(`duplicate entry ${k}`);
    seen.add(k);
  }
  for (const u of r.unmapped || []) {
    errors.push(...[effectError(s, u.effect), String(u.reason ?? "").trim() ? null : `unmapped ${u.effect}: reason missing`].filter(Boolean));
  }
  return errors;
}

function coverageErrors(s, r) {
  const done = new Set([...(r.entries || []), ...(r.unmapped || [])].map((x) => x.effect));
  return effectsOf(s)
    .filter(({ e, key }) => DATA_KINDS.has(e.kind) && !done.has(key))
    .map(({ e, key }) => `${key} (${e.kind}) not classified`);
}

/** Gate CRUD records; `complete` also requires a record for every screen with data effects. */
export function checkCrud(ui, model, records, { complete = false } = {}) {
  const entities = new Set(model.entities.map((e) => e.name));
  const byId = new Map(ui.screens.map((s) => [s.id, s]));
  const errors = duplicateRecords(records || [], "screen");
  for (const r of records || []) {
    const s = byId.get(r.screen);
    if (!s) {
      errors.push(`crud/${r.file}: unknown screen ${r.screen}`);
      continue;
    }
    errors.push(...[...entryErrors(s, r, entities), ...coverageErrors(s, r)].map((e) => `${r.screen}: ${e}`));
  }
  if (complete) {
    const have = new Set((records || []).map((r) => r.screen));
    for (const s of ui.screens) if (!have.has(s.id) && effectsOf(s).some(({ e }) => DATA_KINDS.has(e.kind))) errors.push(`${s.id}: no CRUD record`);
  }
  return errors;
}

const opString = (ops) => OPS.filter((o) => ops.has(o)).join("");
function addOp(map, row, col, op) {
  map[row] ??= {};
  map[row][col] = opString(new Set([...(map[row][col] || ""), op]));
}

/** Actions ("SCR#ACT") of a use case: its UI actions, else every action of its screens. */
function ucActions(uc, ui) {
  if ((uc.uiActions || []).length) return new Set(uc.uiActions);
  const screens = new Set(uc.screens || []);
  return new Set(ui.screens.filter((s) => screens.has(s.id)).flatMap((s) => (s.actions || []).map((a) => `${s.id}#${a.id}`)));
}

function findingsOf(model, byEntity) {
  const sets = {};
  for (const [ent, list] of Object.entries(byEntity)) sets[ent] = new Set(list.map((x) => x.op));
  const persistent = model.entities.filter((e) => e.persistent).map((e) => e.name).sort();
  const touched = persistent.filter((e) => sets[e]);
  const has = (e, ops) => ops.some((o) => sets[e].has(o));
  return {
    neverWritten: touched.filter((e) => !has(e, ["C", "U", "D"])),
    neverRead: touched.filter((e) => !has(e, ["R"])),
    createdNeverDeleted: touched.filter((e) => sets[e].has("C") && !sets[e].has("D")),
    untouched: persistent.filter((e) => !sets[e]),
  };
}

/** Catalog form: byEntity, byScreen, byUseCase, findings, column orders. */
export function crudData(ui, useCases, model, records) {
  const byEntity = {};
  const byScreen = {};
  for (const r of records) {
    for (const x of r.entries || []) {
      const action = `${r.screen}#${x.effect.split("#")[0]}`;
      (byEntity[x.entity] ??= []).push({ action, effect: x.effect, screen: r.screen, op: x.op, note: x.note || "" });
      addOp(byScreen, r.screen, x.entity, x.op);
    }
  }
  const byUseCase = {};
  for (const uc of useCases) {
    const acts = ucActions(uc, ui);
    byUseCase[uc.id] = {};
    for (const [ent, list] of Object.entries(byEntity)) for (const x of list) if (acts.has(x.action)) addOp(byUseCase, uc.id, ent, x.op);
  }
  return {
    byEntity,
    byScreen,
    byUseCase,
    findings: findingsOf(model, byEntity),
    useCases: useCases.map((u) => u.id),
    screens: ui.screens.map((s) => s.id).filter((id) => byScreen[id]),
  };
}

/** Entity x column CSV over a {column: {entity: ops}} map; rows = entities with any cell. */
export function crudCsv(map, columns) {
  const ents = [...new Set(columns.flatMap((c) => Object.keys(map[c] || {})))].sort();
  const rows = ents.map((e) => [e, ...columns.map((c) => map[c]?.[e] || "")].map(csvCell).join(","));
  return `${["entity", ...columns].map(csvCell).join(",")}\n${rows.map((r) => `${r}\n`).join("")}`;
}

const FINDING_TITLES = [
  ["neverWritten", "Never written by the UI", "read only — written by an import, the ERP or another system?"],
  ["neverRead", "Never read by the UI", "written but not shown — export target, audit trail or dead data?"],
  ["createdNeverDeleted", "Created but never deleted", "grows forever — archival or clean-up elsewhere?"],
  ["untouched", "Untouched by the UI", "persistent but no UI effect — background job, ERP side or unused?"],
];
/** Findings as Markdown (persistent entities only). */
export function findingsMd(findings, title) {
  const parts = FINDING_TITLES.map(([k, h, q]) => `## ${h}\n\n${(findings[k].length ? findings[k] : ["none"]).map((e) => `- ${e}`).join("\n")}\n\n_${q}_\n`);
  return `# CRUD findings — ${title}\n\nPersistent entities of model.md, from the classified UI effects (diagrams/crud/).\n\n${parts.join("\n")}`;
}
