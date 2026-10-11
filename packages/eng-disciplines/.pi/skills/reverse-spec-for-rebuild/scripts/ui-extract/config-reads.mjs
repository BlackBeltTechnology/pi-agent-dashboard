#!/usr/bin/env node
// Usage: node config-reads.mjs <appDir> <adapter> <pkgDir>
// Config paths the application code reads (adapter `configReads`: global regex, group 1 = dotted
// path) with every cite, comments stripped; plus the variants of <pkg>/ui/_effective/ classified by
// the adapter's `variantInfo(variantPath)` -> {customer, env} (default: customer = variant, env prod).
// Writes <pkgDir>/ui/_config-reads.json. Deterministic (sorted, no timestamps).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adapterOrExit, lineAt, listFiles, readText, stripHtmlComments, stripJsComments } from "./lib.mjs";

const [appDir, adapterName, pkgDir] = process.argv.slice(2);
if (!pkgDir) {
  console.error("usage: config-reads.mjs <appDir> <adapter> <pkgDir>");
  process.exit(2);
}
const adapter = await adapterOrExit(adapterName);
if (!adapter.configReads) {
  console.error("config-reads: adapter has no configReads hook (global regex, group 1 = config path)");
  process.exit(1);
}

const reads = new Map();
for (const file of adapter.sources.flatMap((s) => listFiles(appDir, s.dir, s.re, adapter.vendor))) {
  const raw = readText(join(appDir, file));
  const src = file.endsWith(".js") ? stripJsComments(raw) : stripHtmlComments(raw);
  for (const m of src.matchAll(new RegExp(adapter.configReads.source, "g"))) {
    const path = m[1].replace(/^\./, "");
    const cite = `${file}:${lineAt(src, m.index)}`;
    if (!reads.has(path)) reads.set(path, new Set());
    reads.get(path).add(cite);
  }
}
const byLine = (a, b) => {
  const [fa, la] = [a.slice(0, a.lastIndexOf(":")), +a.slice(a.lastIndexOf(":") + 1)];
  const [fb, lb] = [b.slice(0, b.lastIndexOf(":")), +b.slice(b.lastIndexOf(":") + 1)];
  return fa.localeCompare(fb) || la - lb;
};

const effDir = join(pkgDir, "ui", "_effective");
const variants = (existsSync(effDir) ? readdirSync(effDir).filter((f) => f.endsWith(".json")).sort() : []).map((f) => {
  const variant = JSON.parse(readFileSync(join(effDir, f), "utf8")).variant;
  const info = adapter.variantInfo ? adapter.variantInfo(variant) : { customer: variant, env: "prod" };
  return { id: f.replace(/\.json$/, ""), variant, customer: info.customer, env: info.env ?? "prod" };
});

const out = {
  adapter: adapter.id,
  reads: [...reads].sort(([a], [b]) => a.localeCompare(b)).map(([path, cites]) => ({ path, cites: [...cites].sort(byLine) })),
  variants,
};
writeFileSync(join(pkgDir, "ui", "_config-reads.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`config-reads: ${out.reads.length} path(s), ${variants.length} variant(s)`);
