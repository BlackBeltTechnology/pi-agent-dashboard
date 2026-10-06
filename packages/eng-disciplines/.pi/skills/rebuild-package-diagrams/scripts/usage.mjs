// Usage evidence: application log sources (described by a project job) -> event types -> gated
// mapping to UI actions / use cases (diagrams/usage/mapping.json, shared, no customer data) ->
// local-only aggregation per customer (pseudonymized) + privacy gate.
// Job: {sources: [{customer, file (relative to the job), encoding?, format: json|csv, table?,
//   columns: {type: col | [cols], user?, time?, object?}, kind: event|change, codeDirs?}], codeDirs?}.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

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

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
    const cells = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q && ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = !q;
      else if (ch === "," && !q) cells.push(cur), (cur = "");
      else cur += ch;
    }
    rows.push([...cells, cur]);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const toTime = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  const t = Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Events of one source: [{customer, type, user, time, object, kind}]. */
function sourceEvents(src, jobDir) {
  const text = decodeSource(readFileSync(join(jobDir, src.file)), src.encoding);
  const rows = src.format === "csv" ? parseCsv(text) : (JSON.parse(text)[src.table] ?? []);
  const c = src.columns;
  const typeOf = (r) => (Array.isArray(c.type) ? c.type.map((k) => r[k]).join(":") : r[c.type]);
  return rows.map((r) => ({ customer: src.customer, type: String(typeOf(r)), user: c.user ? r[c.user] : null, time: c.time ? toTime(r[c.time]) : null, object: c.object ? r[c.object] : null }));
}

export function readJob(jobFile) {
  const job = JSON.parse(readFileSync(jobFile, "utf8"));
  return { ...job, dir: dirname(jobFile) };
}
export const jobEvents = (job) => job.sources.flatMap((s) => sourceEvents(s, job.dir));

/** Last token of a type (`error,fix,align` -> `align`): what the code must spell out. */
export const typeToken = (type) => String(type).split(/[^\w$-]+/).filter(Boolean).at(-1) ?? String(type);

function codeFiles(appDir, dirs) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (!/^(node_modules|\.git)$/.test(n)) walk(p);
      } else if (CODE_RE.test(n)) out.push(relative(appDir, p));
    }
  };
  for (const d of dirs?.length ? dirs : ["."]) if (existsSync(join(appDir, d))) walk(join(appDir, d));
  return out;
}

/** Draft: distinct types with counts per customer, plus code lines spelling the type token in quotes. */
export function usageDraft(appDir, job) {
  const counts = new Map();
  for (const e of jobEvents(job)) {
    const m = counts.get(e.type) ?? {};
    m[e.customer] = (m[e.customer] ?? 0) + 1;
    counts.set(e.type, m);
  }
  const files = codeFiles(appDir, job.codeDirs).map((f) => [f, decodeSource(readFileSync(join(appDir, f))).split("\n")]);
  const candidates = (type) => {
    const t = typeToken(type);
    const re = new RegExp(`["'\`]${t.replace(/[$]/g, "\\$")}["'\`]`);
    return files.flatMap(([f, lines]) => lines.flatMap((l, i) => (re.test(l) ? [`${f}:${i + 1}`] : []))).slice(0, 10);
  };
  const types = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([type, c]) => ({ type, token: typeToken(type), counts: c, candidates: candidates(type) }));
  return { sources: job.sources.map(({ customer, file, format, kind }) => ({ customer, file, format, kind })), types };
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
  const file = m && join(appDir, m[1]);
  return file && existsSync(file) ? decodeSource(readFileSync(file)).split("\n")[+m[2] - 1] : undefined;
}

/** Gate. `appDir`: cite lines spell the type token; `events` + `complete`: every seen type is classified. */
export function checkUsage(ui, useCases, mapping, { appDir = null, events = null, complete = false } = {}) {
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
  return complete && events ? [...errors, ...coverageErrors(events, seen)] : errors;
}

function coverageErrors(events, seen) {
  const n = new Map();
  for (const e of events) n.set(e.type, (n.get(e.type) ?? 0) + 1);
  return [...n].sort().filter(([type]) => !seen.has(type)).map(([type, c]) => `type ${type} (seen ${c}) is neither mapped nor unmapped`);
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
const inc = (o, k, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};

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
  const c = { events: ev.length, users: Object.keys(users).length, byUser: users, byType: {}, byKind: {}, byAction: {}, byUseCase: {}, months: {} };
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
  const ucsOf = (t) => [...new Set([...(t.useCases ?? []), ...useCases.filter((u) => (t.actions ?? []).some((a) => (u.uiActions ?? []).includes(a))).map((u) => u.id)])];
  const customers = Object.fromEntries(
    [...new Set(events.map((e) => e.customer))].sort().map((cust) => [cust, customerUsage(events.filter((e) => e.customer === cust), byType, ucsOf)]),
  );
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
 */
export function sourceSecrets(events, { publicValues = [] } = {}) {
  const out = new Set();
  const leaves = (v) => {
    if (typeof v === "string") v.length >= 3 && out.add(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x);
  };
  for (const e of events) {
    if (e.user != null) leaves(String(e.user));
    leaves(e.object);
  }
  const skip = new Set([...events.map((e) => e.type), ...publicValues]);
  return new Set([...out].filter((v) => !skip.has(v) && !/^\d{1,3}$/.test(v)));
}

const tokenRe = (s) => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

/** Privacy gate over an output directory: file names that contain any source secret (never the value). */
export function leakErrors(outDir, secrets) {
  const errors = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const text = readFileSync(p, "utf8");
        const hits = [...secrets].filter((s) => tokenRe(s).test(text)).length;
        if (hits) errors.push(`${relative(outDir, p)}: contains a source value (${hits} distinct)`);
      }
    }
  };
  walk(outDir);
  return errors;
}
