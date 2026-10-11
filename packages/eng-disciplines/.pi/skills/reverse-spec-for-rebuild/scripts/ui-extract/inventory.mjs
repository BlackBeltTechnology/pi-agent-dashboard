#!/usr/bin/env node
// Usage: node inventory.mjs <appDir> <adapter> <out.json>
// Deterministic UI inventory: every screen/binding/dialog/menu/action site with file:line.
// Same input => byte-identical output (sorted, no timestamps).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { adapterOrExit, lineAt, listFiles, readText, snippet, stripHtmlComments, stripJsComments } from "./lib.mjs";

const [appDir, adapterName, outFile] = process.argv.slice(2);
if (!appDir || !adapterName || !outFile) {
  console.error("usage: inventory.mjs <appDir> <adapter> <out.json>");
  process.exit(2);
}
const adapter = await adapterOrExit(adapterName);

const files = adapter.sources.flatMap((s) => listFiles(appDir, s.dir, s.re, adapter.vendor));
const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) {
    const raw = readText(join(appDir, f));
    cache.set(f, f.endsWith(".js") ? stripJsComments(raw) : stripHtmlComments(raw));
  }
  return cache.get(f);
};

const rows = [...adapter.routes(files, read)];
for (const file of files) {
  const src = read(file);
  const scope = file.endsWith(".js") ? "js" : "html";
  for (const p of adapter.patterns) {
    if (p.scope !== "all" && p.scope !== scope) continue;
    for (const m of src.matchAll(p.re)) {
      rows.push({ kind: p.kind, name: m.groups.name.trim(), file, line: lineAt(src, m.index), text: snippet(src, m.index) });
    }
  }
}

const kept = rows.filter(adapter.keep);
kept.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
kept.forEach((r, i) => {
  r.id = `UI-${String(i + 1).padStart(4, "0")}`;
});
const counts = {};
for (const r of kept) counts[r.kind] = (counts[r.kind] ?? 0) + 1;

const out = { adapter: adapter.id, files: files.length, counts, rows: kept.map(({ id, ...r }) => ({ id, ...r })) };
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ files: files.length, rows: kept.length, counts }));
