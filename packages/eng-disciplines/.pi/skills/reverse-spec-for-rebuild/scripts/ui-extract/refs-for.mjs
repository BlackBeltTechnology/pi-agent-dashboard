#!/usr/bin/env node
// Usage: node refs-for.mjs <pkgDir> <file> [from] [to]
// Lists BR/QUIRK/GAP items whose cites overlap file[:from-to] — so generators link existing ids.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCite } from "./lib.mjs";

const [pkgDir, file, from = "1", to = String(Number.MAX_SAFE_INTEGER)] = process.argv.slice(2);
if (!file) {
  console.error("usage: refs-for.mjs <pkgDir> <file> [from] [to]");
  process.exit(2);
}
for (const f of ["rules.md", "quirks.md", "gaps.md"]) {
  if (!existsSync(join(pkgDir, f))) continue;
  for (const block of readFileSync(join(pkgDir, f), "utf8").split(/^(?=## [A-Z]+-\d+)/m).slice(1)) {
    const id = /^## ([A-Z]+-\d+)(.*)$/m.exec(block);
    const cites = [...block.matchAll(/(?:ref=|Evidence: )([^,>\n]+)/g)].flatMap((m) => m[1].split(/;\s*/)).map(parseCite).filter(Boolean);
    const hits = cites.filter((c) => c.file === file && c.from <= +to && c.to >= +from);
    if (!hits.length) continue;
    const stmt = /^- (?:Statement|Behavior|Description): (.*)$/m.exec(block)?.[1] ?? id[2].trim();
    console.log(`${id[1]}\t${hits.map((c) => `${c.file}:${c.from}-${c.to}`).join(",")}\t${stmt.slice(0, 140)}`);
  }
}
