// Usage evidence: application log sources (described by a project job) -> event types -> gated
// mapping to UI actions / use cases (diagrams/usage/mapping.json, shared, no customer data) ->
// local-only aggregation per customer (pseudonymized) + privacy gate.
// Job: {sources: [{customer, file (relative to the job), encoding?, format: json|csv, table?,
//   columns: {type: col | [cols], user?, time?, object?}, kind: event|change, codeDirs?}], codeDirs?}.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { appFile } from "./lib.mjs";

const KINDS = new Set(["user", "auto", "repair"]);
const CODE_RE = /\.(js|mjs|ts|tsx|jsx|htm|html|java|cs|php|py|rb|go|vb|bas|frm|pas|dfm|sql|xml)$/i;

/** Text of a source/snapshot: UTF-16 by BOM, else UTF-8 when valid, else `encoding` (default windows-1252). */
export function decodeSource(buf, encoding = "windows-1252") {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder(encoding).decode(buf);
  }
}

/** RFC 4180 records: quoted cells may hold commas, quotes ("") and newlines. Blank lines skipped. */
function csvRecords(text) {
  const CELL = /("(?:[^"]|"")*"|[^",\r\n]*)(,|\r\n|\n|\r|$)/g;
  const rows = [];
  let row = [];
  for (const m of text.matchAll(CELL)) {
    const cell = m[1];
    row.push(cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell);
    if (m[2] === ",") continue;
    if (row.length > 1 || row[0].trim()) rows.push(row);
    row = [];
    if (m[2] === "") break;
  }
  return rows;
}

/** Rows of a CSV source as objects; a record whose cell count differs from the header is an error. */
function parseCsv(text, file) {
  const [head = [], ...body] = csvRecords(text);
  return body.map((r, i) => {
    if (r.length !== head.length) throw new Error(`${file} row ${i + 2}: ${r.length} cells, header has ${head.length}`);
    return Object.fromEntries(head.map((h, k) => [h, r[k]]));
  });
}

const toTime = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  const t = Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function jsonRows(text, src) {
  const data = JSON.parse(text);
  if (!src.table) return Array.isArray(data) ? data : [];
  return Array.isArray(data?.[src.table]) ? data[src.table] : null;
}

/** Events of one source: [{customer, type, user, time, object, kind}]. */
function sourceEvents(src, jobDir) {
  const text = decodeSource(readFileSync(join(jobDir, src.file)), src.encoding);
  const rows = src.format === "csv" ? parseCsv(text, src.file) : jsonRows(text, src);
  if (rows === null) return { events: [], skip: `${src.file}: no table ${src.table}` };
  if (!rows.length) return { events: [], skip: `${src.file}: no rows` };
  const c = src.columns;
  const typeOf = (r) => (Array.isArray(c.type) ? c.type.map((k) => r[k]).join(":") : r[c.type]);
  return { events: rows.map((r) => ({ customer: src.customer, type: String(typeOf(r)), user: c.user ? r[c.user] : null, time: c.time ? toTime(r[c.time]) : null, object: c.object ? r[c.object] : null })) };
}

export function readJob(jobFile) {
  const job = JSON.parse(readFileSync(jobFile, "utf8"));
  return { ...job, dir: dirname(jobFile) };
}
/**
 * Events of every source. One customer's snapshot without a table, or with no rows, is normal
 * (`onNote`); a table named by the job but present in no source (typo), or no events at all, throws.
 */
export function jobEvents(job, onNote = () => {}) {
  const results = job.sources.map((s) => ({ s, ...sourceEvents(s, job.dir) }));
  const events = results.flatMap((r) => r.events);
  const skips = results.filter((r) => r.skip);
  if (!events.length) throw new Error(skips.map((r) => r.skip).join("; ") || "no events in any source");
  const tables = [...new Set(job.sources.map((s) => s.table).filter(Boolean))];
  const absent = tables.filter((t) => results.filter((r) => r.s.table === t).every((r) => r.skip?.endsWith(`no table ${t}`)));
  if (absent.length) throw new Error(absent.map((t) => `table ${t} is in no source (check the job)`).join("; "));
  for (const r of skips) onNote(r.skip);
  return events;
}

/** Last token of a type (`error,fix,align` -> `align`): what the code must spell out. */
export const typeToken = (type) => String(type).split(/[^\w$-]+/).filter(Boolean).at(-1) ?? String(type);

function codeFiles(appDir, dirs) {
  const out = [];
  const walk = (d) => {
    // dirents: symlinks are neither followed nor stat'ed, so a dangling link cannot abort the walk
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!/^(node_modules|\.git)$/.test(e.name)) walk(p);
      } else if (e.isFile() && CODE_RE.test(e.name)) out.push(relative(appDir, p));
    }
  };
  for (const d of dirs?.length ? dirs : ["."]) if (existsSync(join(appDir, d))) walk(join(appDir, d));
  return out;
}

/**
 * Draft for the mapper (LLM context): distinct types with their total count and code lines spelling
 * the type token in quotes. No customer names, per-customer counts or source file names.
 */
export function usageDraft(appDir, job, events = jobEvents(job)) {
  const counts = new Map();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const files = codeFiles(appDir, job.codeDirs).map((f) => [f, decodeSource(readFileSync(join(appDir, f))).split("\n")]);
  const candidates = (type) => {
    const t = typeToken(type);
    const re = new RegExp(`["'\`]${t.replace(/[$]/g, "\\$")}["'\`]`);
    return files.flatMap(([f, lines]) => lines.flatMap((l, i) => (re.test(l) ? [`${f}:${i + 1}`] : []))).slice(0, 10);
  };
  const types = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([type, seen]) => ({ type, token: typeToken(type), seen, candidates: candidates(type) }));
  return { types };
}

/**
 * Problems with the event types themselves, never naming them: a type that contains a user/object
 * value (the type column holds identifying data), or more distinct types than a vocabulary has.
 */
export function typeProblems(events, job) {
  const types = new Set(events.map((e) => e.type));
  const max = job.maxTypes ?? 500;
  const errors = [];
  if (types.size > max) errors.push(`${types.size} distinct event types (max ${max}): the type column looks like free text or ids; fix the job's columns.type or set maxTypes`);
  const leaky = leakyValues(types, sourceSecrets(events, { publicValues: job.publicValues, keepTypes: true }));
  if (leaky.size) errors.push(`${leaky.size} event types contain a user/object value: the job's columns.type must name a type/code column`);
  return { errors, leaky };
}

/** Values (from `values`) that contain any secret as a whole token. */
function leakyValues(values, secrets) {
  const res = [...secrets].map(tokenRe);
  return new Set([...values].filter((v) => res.some((re) => re.test(String(v)))));
}

/** Mapping types that contain a source value (the shared file must hold none), as one counted error. */
export function mappingLeakErrors(mapping, events, job) {
  const names = [...(mapping.types ?? []), ...(mapping.unmapped ?? [])].map((t) => t.type);
  const n = leakyValues(names, sourceSecrets(events, { publicValues: job.publicValues, keepTypes: true })).size;
  return n ? [`mapping: ${n} type${n > 1 ? "s" : ""} contain${n > 1 ? "" : "s"} a source value (remove it from diagrams/usage/mapping.json)`] : [];
}

/** Make the nearest enclosing `_local` directory git-ignored (local aggregates are never shared). */
export function ignoreLocal(path) {
  const parts = path.split(sep);
  const i = parts.lastIndexOf("_local");
  if (i < 0) return;
  const dir = parts.slice(0, i + 1).join(sep) || sep;
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), "*\n");
}

export function readMapping(pkgDir) {
  const f = join(pkgDir, "diagrams", "usage", "mapping.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

function typeErrors(t, ctx) {
  const errs = [];
  if (!KINDS.has(t.kind)) errs.push(`${t.type}: kind ${t.kind} (need user, auto or repair)`);
  for (const k of t.actions ?? []) if (!ctx.actions.has(k)) errs.push(`${t.type}: unknown action ${k}`);
  for (const u of t.useCases ?? []) if (!ctx.useCases.has(u)) errs.push(`${t.type}: unknown use case ${u}`);
  if (ctx.appDir && !citeLine(ctx.appDir, t.cite)?.includes(typeToken(t.type))) errs.push(`${t.type}: cite ${t.cite} does not contain '${typeToken(t.type)}'`);
  return errs;
}

/** Text of the app line a `file:line` cite names, or undefined. */
function citeLine(appDir, cite) {
  const m = /^(.+):(\d+)$/.exec(cite ?? "");
  const file = m && appFile(appDir, m[1]);
  return file ? decodeSource(readFileSync(file)).split("\n")[+m[2] - 1] : undefined;
}

/** Gate. `appDir`: cite lines spell the type token; `events` + `complete`: every seen type is classified. */
export function checkUsage(ui, useCases, mapping, { appDir = null, events = null, complete = false, leaky = new Set() } = {}) {
  const ctx = {
    appDir,
    actions: new Set(ui.screens.flatMap((s) => (s.actions ?? []).map((a) => `${s.id}#${a.id}`))),
    useCases: new Set(useCases.map((u) => u.id)),
  };
  const errors = [];
  const seen = new Set();
  for (const t of mapping.types ?? []) {
    if (seen.has(t.type)) errors.push(`duplicate type ${t.type}`);
    seen.add(t.type);
    errors.push(...typeErrors(t, ctx));
  }
  for (const u of mapping.unmapped ?? []) {
    if (seen.has(u.type)) errors.push(`duplicate type ${u.type}`);
    seen.add(u.type);
    if (!String(u.reason ?? "").trim()) errors.push(`unmapped ${u.type}: reason missing`);
  }
  return complete && events ? [...errors, ...coverageErrors(events, seen, leaky)] : errors;
}

/** Seen types missing from the mapping; types that hold a source value are counted, never named. */
function coverageErrors(events, seen, leaky = new Set()) {
  const n = new Map();
  for (const e of events) n.set(e.type, (n.get(e.type) ?? 0) + 1);
  const missing = [...n].sort().filter(([type]) => !seen.has(type));
  const hidden = missing.filter(([type]) => leaky.has(type)).length;
  return [
    ...missing.filter(([type]) => !leaky.has(type)).map(([type, c]) => `type ${type} (seen ${c}) is neither mapped nor unmapped`),
    ...(hidden ? [`${hidden} more unclassified types hold a source value (not shown)`] : []),
  ];
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
const inc = (o, k, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};
/** Tally without a prototype: keys such as `constructor` or `__proto__` count like any other. */
const tally = () => Object.create(null);

/** Event counts per user as `user~k` (k = rank by activity, ties by value); real values never leave. */
function pseudonyms(ev) {
  const users = new Map();
  for (const e of ev) if (e.user != null) users.set(e.user, (users.get(e.user) ?? 0) + 1);
  const ranked = [...users].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return Object.fromEntries(ranked.map(([, n], i) => [`user~${i + 1}`, n]));
}

/** One customer's events -> counts by user (pseudonymized), type, kind, action, use case, month; span. */
function customerUsage(ev, byType, ucsOf) {
  const users = pseudonyms(ev);
  const c = { events: ev.length, users: Object.keys(users).length, byUser: users, byType: tally(), byKind: tally(), byAction: tally(), byUseCase: tally(), months: tally() };
  const days = new Set();
  for (const e of ev) {
    const t = byType.get(e.type);
    inc(c.byType, e.type);
    inc(c.byKind, t ? t.kind : "unmapped");
    for (const a of t?.actions ?? []) inc(c.byAction, a);
    for (const u of t ? ucsOf(t) : []) inc(c.byUseCase, u);
    if (e.time == null) continue;
    inc(c.months, day(e.time).slice(0, 7));
    days.add(day(e.time));
  }
  const ds = [...days].sort();
  c.span = ds.length ? { first: ds[0], last: ds.at(-1), activeDays: ds.length } : null;
  return c;
}

/** Per-customer aggregation. `useCases` carry merged `uiActions` (catalog data). */
export function aggregateUsage(events, mapping, ui, useCases) {
  const byType = new Map((mapping.types ?? []).map((t) => [t.type, t]));
  const memo = new Map(); // per mapping type: computed once, not per event
  const ucsOf = (t) => {
    if (!memo.has(t)) memo.set(t, [...new Set([...(t.useCases ?? []), ...useCases.filter((u) => (t.actions ?? []).some((a) => (u.uiActions ?? []).includes(a))).map((u) => u.id)])]);
    return memo.get(t);
  };
  const customers = Object.create(null);
  for (const cust of [...new Set(events.map((e) => e.customer))].sort()) customers[cust] = customerUsage(events.filter((e) => e.customer === cust), byType, ucsOf);
  const logged = new Set((mapping.types ?? []).flatMap((t) => t.actions ?? []));
  const allActions = ui.screens.flatMap((s) => (s.actions ?? []).map((a) => `${s.id}#${a.id}`));
  return {
    customers,
    notLogged: allActions.filter((a) => !logged.has(a)),
    neverSeen: Object.fromEntries(Object.keys(customers).map((k) => [k, [...logged].filter((a) => !customers[k].byAction[a]).sort()])),
  };
}

export function usageMd(u, title) {
  const list = (xs) => (xs.length ? xs.join("\n") : "- none");
  const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
  const custs = Object.entries(u.customers);
  return `# ${title} — usage evidence (LOCAL ONLY: aggregated from customer data)

Users are pseudonymized per customer (\`user~1\` = most active). "Not logged" means the code writes no log for the action — not that nobody uses it.

## Sources
${list(custs.map(([k, c]) => `- ${k}: ${c.events} events, ${c.users} users, ${c.span ? `${c.span.first} … ${c.span.last}, ${c.span.activeDays} active days` : "no timestamps"}`))}

## Most used use cases
${list(custs.map(([k, c]) => `- ${k}: ${top(c.byUseCase) || "none"}`))}

## Most used actions
${list(custs.map(([k, c]) => `- ${k}: ${top(c.byAction) || "none"}`))}

## Event kinds
${list(custs.map(([k, c]) => `- ${k}: ${top(c.byKind)}`))}

## Users
${list(custs.map(([k, c]) => `- ${k}: ${top(c.byUser)}`))}

## Logged but never seen
${list(custs.map(([k]) => `- ${k}: ${u.neverSeen[k].join(", ") || "none"}`))}

## Not logged (${u.notLogged.length} actions)
${u.notLogged.join(", ") || "none"}
`;
}

/**
 * Identifying strings of the sources: user values and string leaves of object columns (>= 3 chars).
 * Not secrets: event types (the shared mapping names them), numbers under 4 digits (quantities),
 * and the job's reviewed `publicValues` (schema vocabulary such as entity or phase names).
 * `keepTypes` (checking the types themselves): user values stay secrets even when equal to a type;
 * object values equal to a whole type are still skipped (an object field may carry the type).
 */
export function sourceSecrets(events, { publicValues = [], keepTypes = false } = {}) {
  const users = new Set();
  const objects = new Set();
  const leaves = (v, into) => {
    if (typeof v === "string") v.length >= 3 && into.add(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x, into);
  };
  for (const e of events) {
    if (e.user != null) leaves(String(e.user), users);
    leaves(e.object, objects);
  }
  const types = new Set(events.map((e) => e.type));
  const pub = new Set(publicValues);
  const keep = (v, isUser) => !pub.has(v) && !/^\d{1,3}$/.test(v) && (!types.has(v) || (keepTypes && isUser));
  return new Set([...[...users].filter((v) => keep(v, true)), ...[...objects].filter((v) => keep(v, users.has(v)))]);
}

const tokenRe = (s) => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

/** Privacy gate over an output directory: file names that contain any source secret (never the value). */
export function leakErrors(outDir, secrets) {
  const errors = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const text = readFileSync(p, "utf8");
        const hits = [...secrets].filter((s) => tokenRe(s).test(text)).length;
        if (hits) errors.push(`${relative(outDir, p)}: contains a source value (${hits} distinct)`);
      }
    }
  };
  walk(outDir);
  return errors;
}
