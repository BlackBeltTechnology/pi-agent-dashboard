#!/usr/bin/env node
// Usage: node gate.mjs <appDir> <pkgDir>
// Deterministic gate over <pkgDir>/ui/screens/*.json (format: ui-model.md).
// Exit 0 = clean, 1 = violations (printed on stderr), 2 = bad usage.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCite, readText, TRIGGER_KINDS } from "./lib.mjs";

const [appDir, pkgDir] = process.argv.slice(2);
if (!appDir || !pkgDir) {
  console.error("usage: gate.mjs <appDir> <pkgDir>");
  process.exit(2);
}
const STRUCTURAL = new Set(["template", "controller", "directive", "component", "factory", "service", "vue-component"]);
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

// --- application files (cite resolution) ---
const lines = new Map();
const fileLines = (f) => {
  if (!lines.has(f)) lines.set(f, existsSync(join(appDir, f)) ? readText(join(appDir, f)).split("\n") : null);
  return lines.get(f);
};
function checkCite(where, cite) {
  for (const part of String(cite).split(/;\s*/)) {
    const c = parseCite(part);
    if (!c) return err(where, `malformed cite '${part}'`);
    const ls = fileLines(c.file);
    if (!ls) return err(where, `cite file missing '${c.file}'`);
    if (c.from < 1 || c.to > ls.length || c.from > c.to) err(where, `cite out of range '${part}' (file has ${ls.length} lines)`);
  }
}

// --- package refs ---
const headings = (f) => (existsSync(join(pkgDir, f)) ? readFileSync(join(pkgDir, f), "utf8").match(/^## [A-Z]+-\d+/gm) ?? [] : []).map((h) => h.slice(3));
const ids = new Set([...headings("rules.md"), ...headings("quirks.md"), ...headings("gaps.md")]);
const reqCache = new Map();
const hasReq = (cap, name) => {
  if (!reqCache.has(cap)) {
    const f = join(pkgDir, "capabilities", cap, "spec.md");
    reqCache.set(cap, existsSync(f) ? new Set(readFileSync(f, "utf8").match(/^### Requirement: .+$/gm)?.map((h) => h.slice(17).trim())) : null);
  }
  return reqCache.get(cap)?.has(name);
};
function checkRef(where, ref) {
  const m = /^spec:([\w-]+)#(.+)$/.exec(ref);
  if (m) return hasReq(m[1], m[2].trim()) || err(where, `dangling requirement '${ref}'`);
  if (!/^(BR|QUIRK|GAP)-\d+$/.test(ref)) return err(where, `malformed ref '${ref}'`);
  if (!ids.has(ref)) err(where, `dangling ref '${ref}'`);
}

// --- inventory ---
const inv = JSON.parse(readFileSync(join(pkgDir, "ui", "_inventory.json"), "utf8")).rows;
const invKeys = new Set(inv.map((r) => `${r.file}:${r.line}`));

const dir = join(pkgDir, "ui", "screens");
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
if (!files.length) err(dir, "no screen records");
const seen = new Map();
const unique = (where, id) => (seen.has(id) ? err(where, `duplicate id '${id}' (also in ${seen.get(id)})`) : seen.set(id, where));

for (const f of files) {
  const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const W = `${f}`;
  for (const k of ["id", "kind", "name", "template", "scope", "actions"]) if (s[k] === undefined) err(W, `missing '${k}'`);
  unique(W, s.id);
  if (s.template && !fileLines(s.template)) err(W, `template missing '${s.template}'`);
  if (s.opener?.cite) checkCite(`${W} opener`, s.opener.cite);
  for (const fm of s.forms ?? []) {
    if (!existsSync(join(pkgDir, "ui", "forms", `${fm.form}.json`))) err(W, `form record missing '${fm.form}'`);
    if (fm.cite) checkCite(`${W} form ${fm.form}`, fm.cite);
  }
  const covered = new Set((s.unmapped ?? []).map((u) => u.at));
  const cover = (where, list) => {
    for (const c of list ?? []) {
      if (!invKeys.has(c)) err(where, `covers '${c}' which is not an inventory row`);
      covered.add(c);
    }
  };
  for (const u of s.unmapped ?? []) {
    if (!invKeys.has(u.at)) err(`${W} unmapped`, `'${u.at}' is not an inventory row`);
    if (!u.reason) err(`${W} unmapped`, `'${u.at}' has no reason`);
  }
  for (const fd of s.fields ?? []) {
    checkCite(`${W} field ${fd.key}`, fd.cite);
    cover(`${W} field ${fd.key}`, fd.covers);
  }
  for (const a of s.actions ?? []) {
    const A = `${W} ${a.id}`;
    unique(A, a.id);
    if (a.trigger?.cite) checkCite(`${A} trigger`, a.trigger.cite);
    if (a.trigger && !TRIGGER_KINDS.has(a.trigger.kind)) err(A, `trigger kind '${a.trigger.kind}' is not in the vocabulary (${[...TRIGGER_KINDS].join(", ")})`);
    if (a.handler) {
      checkCite(`${A} handler`, a.handler.cite);
      const c = parseCite(a.handler.cite);
      const ls = c && fileLines(c.file);
      if (ls && !ls.slice(c.from - 1, c.to).join("\n").includes(a.handler.name)) err(A, `handler '${a.handler.name}' not found in ${a.handler.cite}`);
    }
    for (const r of [...(a.guards ?? []), ...(a.refs ?? [])]) checkRef(A, r);
    // a guard refuses the action before any effect; input validation is a `validate` effect, not a guard
    const validated = new Set((a.effects ?? []).filter((e) => e.kind === "validate").flatMap((e) => e.refs ?? []));
    for (const g of a.guards ?? []) if (validated.has(g)) err(A, `'${g}' is both a guard and a validate-effect ref (validation is not a guard)`);
    for (const e of a.effects ?? []) {
      if (e.cite) checkCite(`${A} effect ${e.kind}`, e.cite);
      for (const r of e.refs ?? []) checkRef(`${A} effect ${e.kind}`, r);
    }
    cover(A, a.covers);
  }
  for (const d of s.dialogs ?? []) {
    unique(`${W} ${d.id}`, d.id);
    checkCite(`${W} ${d.id}`, d.cite);
    cover(`${W} ${d.id}`, d.covers);
  }
  for (const n of s.navigation ?? []) {
    if (n.cite) checkCite(`${W} nav ${n.to}`, n.cite);
    cover(`${W} nav ${n.to}`, n.covers);
  }
  // coverage: every behavioural inventory row in scope is explained or deliberately unmapped
  for (const sc of s.scope ?? []) {
    for (const r of inv) {
      if (r.file !== sc.file || STRUCTURAL.has(r.kind)) continue;
      if ((sc.from && r.line < sc.from) || (sc.to && r.line > sc.to)) continue;
      if (!covered.has(`${r.file}:${r.line}`)) err(W, `uncovered ${r.id} ${r.kind} ${r.file}:${r.line} '${r.name}'`);
    }
  }
}

for (const e of errors) console.error(e);
console.log(errors.length ? `FAIL ${errors.length} violation(s) in ${files.length} record(s)` : `PASS ${files.length} record(s)`);
process.exitCode = errors.length ? 1 : 0;
