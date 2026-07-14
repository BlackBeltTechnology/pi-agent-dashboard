#!/usr/bin/env node
// Catalog-parity check (D6). Asserts that every key in the source key set
// (union of all authored keys) exists in every non-source language catalog.
// Source (`en`) is intentionally empty (English lives at call sites), so the
// reference set is the union of `zh-CN` + `hu` + every plugin catalog block.
// Exits non-zero on any gap so CI fails.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

function keysFromObjectLiteral(src, startNeedle) {
  // Collect "key": from the first object literal after startNeedle.
  const start = startNeedle ? src.indexOf(startNeedle) : 0;
  const body = src.slice(start);
  return new Set([...body.matchAll(/["']([a-zA-Z][\w.]*)["']\s*:/g)].map((m) => m[1]));
}

// --- Core client catalogs ---------------------------------------------------
const i18n = fs.readFileSync(path.join(ROOT, "packages/client/src/lib/i18n.tsx"), "utf8");
const zh = keysFromObjectLiteral(i18n, "const zhCN");
const huSrc = fs.readFileSync(path.join(ROOT, "packages/client/src/lib/i18n-hu.ts"), "utf8");
const hu = keysFromObjectLiteral(huSrc, "huCatalog");

// --- Plugin catalogs (plugin.<id>.* authored unprefixed) -------------------
// Each plugin ships src/i18n.ts exporting `catalog: { "zh-CN": {...}, hu: {...} }`.
const pluginCatalogs = execSync(
  `find ${ROOT}/packages -path '*plugin*/src/i18n.ts' -not -path '*/node_modules/*' 2>/dev/null || true`,
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

let failed = false;
const report = (label, ref, target) => {
  const missing = [...ref].filter((k) => !target.has(k));
  if (missing.length) {
    failed = true;
    console.error(`\u2717 ${label}: ${missing.length} missing key(s):`);
    console.error("  " + missing.slice(0, 30).join("\n  ") + (missing.length > 30 ? "\n  \u2026" : ""));
  } else {
    console.log(`\u2713 ${label}: complete (${ref.size} keys)`);
  }
};

// Core: reference = union(zh, hu); both must cover it.
const core = new Set([...zh, ...hu]);
report("zh-CN (core)", core, zh);
report("hu (core)", core, hu);

// Plugins: each plugin's zh-CN and hu blocks must have identical key sets.
for (const file of pluginCatalogs) {
  const src = fs.readFileSync(file, "utf8");
  const id = file.replace(/.*packages\//, "").split("/")[0];
  const zhBlock = keysFromObjectLiteral(src, '"zh-CN"');
  // hu block starts after the zh block; approximate by searching for `hu:` / "hu"
  const huIdx = Math.max(src.indexOf("\n  hu:"), src.indexOf('"hu"'));
  const huBlock = huIdx >= 0 ? keysFromObjectLiteral(src.slice(huIdx)) : new Set();
  const ref = new Set([...zhBlock, ...huBlock]);
  if (ref.size === 0) continue;
  report(`${id} zh-CN`, ref, zhBlock);
  report(`${id} hu`, ref, huBlock);
}

if (failed) {
  console.error("\ni18n parity check FAILED");
  process.exit(1);
}
console.log("\ni18n parity check passed");
