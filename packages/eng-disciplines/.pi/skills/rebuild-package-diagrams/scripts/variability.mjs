// Customer variability: which behaviour each customer's configuration switches on. Inputs:
// ui/_config-reads.json (config paths read by code + variants with customer/env, from
// reverse-spec-for-rebuild config-reads.mjs) and ui/_effective/<variant>.json (merged configs).
// Record: diagrams/variability/features.json {features: [{id, name, kind, condition: {path, op,
// value?}, cites, affects: {screens, actions, refs}, deadEverywhere?}], data: [{path, reason}]}.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appFile, csvRows as csv, packageResolver } from "./lib.mjs";

const OPS = new Set(["exists", "truthy", "eq", "ne", "in"]);
const KINDS = new Set(["toggle", "option", "parameter"]);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

/** Config inputs of a package: {reads, variants, conf: {variantId: config}} or null. */
export function readConfigInputs(pkgDir) {
  const f = join(pkgDir, "ui", "_config-reads.json");
  if (!existsSync(f)) return null;
  const { reads, variants } = readJson(f);
  const effDir = join(pkgDir, "ui", "_effective");
  const missing = variants.filter((v) => !existsSync(join(effDir, `${v.id}.json`))).map((v) => v.id);
  const conf = Object.fromEntries(variants.map((v) => [v.id, missing.includes(v.id) ? {} : readJson(join(effDir, `${v.id}.json`)).conf]));
  return { reads, variants, conf, missing };
}

/** Value at a dotted path, or undefined. Own keys only. */
export function getPath(obj, path) {
  let o = obj;
  for (const k of path.split(".")) {
    if (o === null || typeof o !== "object" || !Object.hasOwn(o, k)) return undefined;
    o = o[k];
  }
  return o;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Draft: each read path with its value per variant (absent omitted) and flags. */
export function variabilityDraft(inputs) {
  const paths = inputs.reads.map(({ path, cites }) => {
    const values = {};
    for (const v of inputs.variants) {
      const x = getPath(inputs.conf[v.id], path);
      if (x !== undefined) values[v.id] = x;
    }
    const all = inputs.variants.map((v) => JSON.stringify(values[v.id]));
    return { path, group: path.split(".")[0], cites, values, varying: new Set(all).size > 1, absentEverywhere: !Object.keys(values).length };
  });
  return { variants: inputs.variants, paths };
}

/** Condition on one config: true/false. */
export function evaluate(cond, conf) {
  const v = getPath(conf, cond.path);
  if (cond.op === "exists") return v !== undefined;
  if (cond.op === "truthy") return !!v;
  if (cond.op === "eq") return same(v, cond.value);
  if (cond.op === "ne") return !same(v, cond.value);
  return (cond.value ?? []).some((x) => same(v, x));
}

export function readVariability(pkgDir) {
  const f = join(pkgDir, "diagrams", "variability", "features.json");
  return existsSync(f) ? readJson(f) : null;
}

const isRead = (reads, path) => reads.some((r) => path === r.path || path.startsWith(`${r.path}.`));

function conditionErrors(f) {
  const c = f.condition ?? {};
  if (!OPS.has(c.op)) return [`${f.id}: op ${c.op} (need ${[...OPS].join(", ")})`];
  if (["eq", "ne", "in"].includes(c.op) && c.value === undefined) return [`${f.id}: op ${c.op} needs a value`];
  if (c.op === "in" && !Array.isArray(c.value)) return [`${f.id}: op in needs an array value`];
  return [];
}

/** Source text for line lookups: UTF-16 by BOM, else byte-per-char (identifiers are ASCII). */
const sourceText = (buf) => (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString("utf16le") : buf[0] === 0xfe && buf[1] === 0xff ? Buffer.from(buf.subarray(2)).swap16().toString("utf16le") : buf.toString("latin1"));

function citeErrors(f, appDir) {
  if (!appDir) return [];
  const seg = f.condition.path.split(".").at(-1);
  return (f.cites ?? []).flatMap((cite) => {
    const m = /^(.+):(\d+)$/.exec(cite);
    const file = m && appFile(appDir, m[1]);
    const line = file ? sourceText(readFileSync(file)).split("\n")[+m[2] - 1] : undefined;
    return line?.includes(seg) ? [] : [`${f.id}: cite ${cite} does not read '${seg}'`];
  });
}

function affectsErrors(f, ui, resolve) {
  const screens = new Set(ui.screens.map((s) => s.id));
  const actions = new Set(ui.screens.flatMap((s) => (s.actions ?? []).map((a) => `${s.id}#${a.id}`)));
  const a = f.affects ?? {};
  const refOk = (r) => {
    const m = /^spec:([\w-]+)#(.+)$/.exec(r);
    return m ? resolve.spec(m[1], m[2].trim()) : /^(BR|QUIRK|GAP)-\d+$/.test(r) && resolve.id(r);
  };
  return [
    ...(a.screens ?? []).filter((s) => !screens.has(s)).map((s) => `${f.id}: unknown screen ${s}`),
    ...(a.actions ?? []).filter((k) => !actions.has(k)).map((k) => `${f.id}: unknown action ${k}`),
    ...(a.refs ?? []).filter((r) => !refOk(r)).map((r) => `${f.id}: dangling ref ${r}`),
  ];
}

function featureErrors(f, inputs, ctx) {
  if (!KINDS.has(f.kind)) return [`${f.id}: kind ${f.kind} (need toggle, option or parameter)`];
  const errs = conditionErrors(f);
  if (errs.length) return errs;
  if (!isRead(inputs.reads, f.condition.path)) return [`${f.id}: path ${f.condition.path} is not read by the code`];
  const on = inputs.variants.filter((v) => evaluate(f.condition, inputs.conf[v.id]));
  if (!on.length && !f.deadEverywhere) errs.push(`${f.id}: condition false in every variant; mark deadEverywhere`);
  if (on.length && f.deadEverywhere) errs.push(`${f.id}: deadEverywhere but on in ${on[0].id}`);
  return [...errs, ...citeErrors(f, ctx.appDir), ...affectsErrors(f, ctx.ui, ctx.resolve)];
}

/** Gate. `appDir`: also check that every cite line reads the path; `complete`: cover every varying path. */
export function checkVariability(pkgDir, ui, inputs, rec, { appDir = null, complete = false } = {}) {
  if (!inputs) return ["variability: ui/_config-reads.json missing (run config-reads.mjs)"];
  if (inputs.missing?.length) return inputs.missing.map((id) => `variability: ui/_effective/${id}.json missing (run config.mjs for variant ${id})`);
  const ctx = { ui, appDir, resolve: packageResolver(pkgDir) };
  const errors = [];
  const seen = new Set();
  for (const f of rec.features ?? []) {
    if (seen.has(f.id)) errors.push(`duplicate feature ${f.id}`);
    seen.add(f.id);
    errors.push(...featureErrors(f, inputs, ctx));
  }
  for (const d of rec.data ?? []) {
    if (!isRead(inputs.reads, d.path)) errors.push(`data ${d.path}: path is not read by the code`);
    if (!String(d.reason ?? "").trim()) errors.push(`data ${d.path}: reason missing`);
  }
  return complete ? [...errors, ...coverageErrors(inputs, rec)] : errors;
}

/** Every varying read path is covered by a feature or data entry (same path, above or below it). */
function coverageErrors(inputs, rec) {
  const covers = [...(rec.features ?? []).map((f) => f.condition?.path), ...(rec.data ?? []).map((d) => d.path)].filter(Boolean);
  const covered = (p) => covers.some((c) => p === c || p.startsWith(`${c}.`) || c.startsWith(`${p}.`));
  return variabilityDraft(inputs)
    .paths.filter((x) => x.varying && !covered(x.path))
    .map((x) => `varying path ${x.path} is neither a feature nor data`);
}

/** Customer state of a feature: production variants decide; a customer with only env variants uses those. */
function customerState(f, inputs, customer) {
  const own = inputs.variants.filter((v) => v.customer === customer);
  const prod = own.filter((v) => v.env === "prod");
  const states = new Set((prod.length ? prod : own).map((v) => evaluate(f.condition, inputs.conf[v.id])));
  return states.size > 1 ? "mixed" : states.has(true) ? "on" : "off";
}

/** Matrices, reachability and findings. */
export function variabilityData(inputs, rec) {
  const customers = [...new Set(inputs.variants.map((v) => v.customer))].sort();
  const features = (rec.features ?? []).map((f) => ({
    ...f,
    byVariant: Object.fromEntries(inputs.variants.map((v) => [v.id, evaluate(f.condition, inputs.conf[v.id]) ? "on" : "off"])),
  }));
  const byCustomer = Object.fromEntries(features.map((f) => [f.id, Object.fromEntries(customers.map((c) => [c, customerState(f, inputs, c)]))]));
  const unreachable = Object.fromEntries(
    customers.map((c) => [c, [...new Set(features.filter((f) => byCustomer[f.id][c] === "off").flatMap((f) => [...(f.affects?.screens ?? []), ...(f.affects?.actions ?? [])]))].sort()]),
  );
  const onFor = (f) => customers.filter((c) => byCustomer[f.id][c] === "on");
  const dead = features.filter((f) => Object.values(f.byVariant).every((s) => s === "off")).map((f) => f.id);
  const single = features.filter((f) => onFor(f).length === 1).map((f) => ({ id: f.id, customer: onFor(f)[0] }));
  const constant = features.filter((f) => Object.values(f.byVariant).every((s) => s === "on")).map((f) => f.id);
  const owners = new Set(single.map((s) => s.customer));
  return {
    customers,
    variants: inputs.variants,
    features: features.map(({ id, name, kind, condition, affects, cites, byVariant }) => ({ id, name, kind, condition, affects: affects ?? {}, cites, byVariant })),
    data: rec.data ?? [],
    byCustomer,
    unreachable,
    findings: { dead, single, constant, withoutOwn: customers.filter((c) => !owners.has(c)) },
  };
}

const variantLabel = (v) => (v.env === "prod" ? v.id : `${v.id} (${v.env})`);
export const variantsCsv = (d) => csv([["feature", ...d.variants.map(variantLabel)], ...d.features.map((f) => [f.id, ...d.variants.map((v) => f.byVariant[v.id])])]);
export const customersCsv = (d) => csv([["feature", ...d.customers], ...d.features.map((f) => [f.id, ...d.customers.map((c) => d.byCustomer[f.id][c])])]);

export function variabilityMd(d, title) {
  const name = (id) => d.features.find((f) => f.id === id)?.name ?? "";
  const list = (xs) => (xs.length ? xs.join("\n") : "- none");
  return `# ${title} — customer variability findings

Customers: ${d.customers.join(", ")}. Production variants decide a customer's state; demo/test/local variants are shown in the matrix but not counted (a customer with only those uses them).

## Dead everywhere
${list(d.findings.dead.map((id) => `- ${id} ${name(id)}`))}

## Single-customer features
${list(d.findings.single.map((s) => `- ${s.id} (${s.customer}) ${name(s.id)}`))}

## Constant across all variants
${list(d.findings.constant.map((id) => `- ${id} ${name(id)}`))}

## Customers without an own feature
${list(d.findings.withoutOwn.map((c) => `- ${c}`))}

## Unreachable UI per customer
${list(d.customers.filter((c) => d.unreachable[c].length).map((c) => `- ${c}: ${d.unreachable[c].join(", ")}`))}
`;
}

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** FeatureIDE-style feature model: flat optional features under one abstract root. */
export const featureModelXml = (d, title) => `<?xml version="1.0" encoding="UTF-8"?>
<featureModel>
 <struct>
  <and abstract="true" mandatory="true" name="${xmlEsc(title)}">
${d.features.map((f) => `   <feature name="${xmlEsc(f.id)}"><description>${xmlEsc(f.name)}</description></feature>`).join("\n")}
  </and>
 </struct>
</featureModel>
`;
