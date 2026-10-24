#!/usr/bin/env node
import { execFileSync } from "node:child_process";
// Catalog-parity check (D6). Asserts that every key in the source key set
// (union of all authored keys) exists in every non-source language catalog.
// Source (`en`) is intentionally empty (English lives at call sites), so the
// reference set is the union of `zh-CN` + `hu` + every plugin catalog block.
// Exits non-zero on any gap so CI fails.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function keysFromObjectLiteral(src, startNeedle) {
  // Collect "key": from the first object literal after startNeedle.
  const start = startNeedle ? src.indexOf(startNeedle) : 0;
  const body = src.slice(start);
  return new Set([...body.matchAll(/["']([a-zA-Z][\w.]*)["']\s*:/g)].map((m) => m[1]));
}

// --- Core client catalogs ---------------------------------------------------
// zh-CN lives in its own lazily-loaded module (change: shrink-client-entry-lazy-islands).
const zhSrc = fs.readFileSync(path.join(ROOT, "packages/client/src/lib/i18n/i18n-zh-CN.ts"), "utf8");
const zh = keysFromObjectLiteral(zhSrc, "const zhCN");
const huSrc = fs.readFileSync(path.join(ROOT, "packages/client/src/lib/i18n/i18n-hu.ts"), "utf8");
const hu = keysFromObjectLiteral(huSrc, "huCatalog");

// --- Plugin catalogs (plugin.<id>.* authored unprefixed) -------------------
// Each plugin ships src/i18n.ts exporting `catalog: { "zh-CN": {...}, hu: {...} }`.
// argv array, no shell (change: triage-codeql-alert-debt). A failed `find` yields no catalogs.
let pluginCatalogOut = "";
try {
  pluginCatalogOut = execFileSync(
    "find",
    [path.join(ROOT, "packages"), "-path", "*plugin*/src/i18n.ts", "-not", "-path", "*/node_modules/*"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
} catch {
  // empty result, as the former `2>/dev/null || true`
}
const pluginCatalogs = pluginCatalogOut.trim().split("\n").filter(Boolean);

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

// Plugins: import each plugin's `catalog` (robust vs. regex-parsing an object
// literal whose values contain arbitrary translated text). Each plugin's
// per-language blocks must have identical key sets.
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, { interopDefault: true });
for (const file of pluginCatalogs) {
  const id = file.replace(/.*packages\//, "").split("/")[0];
  let catalog;
  try {
    const mod = await jiti.import(file);
    catalog = mod.catalog ?? mod.default?.catalog ?? mod.default;
  } catch (e) {
    failed = true;
    console.error(`\u2717 ${id}: failed to import catalog (${e.message})`);
    continue;
  }
  if (!catalog || typeof catalog !== "object") continue;
  const langs = Object.keys(catalog);
  const ref = new Set(langs.flatMap((l) => Object.keys(catalog[l] ?? {})));
  if (ref.size === 0) continue;
  for (const lang of langs) {
    report(`${id} ${lang}`, ref, new Set(Object.keys(catalog[lang] ?? {})));
  }
}

// --- RESERVED_LABEL_TRANSLATIONS drift (change: shrink-client-entry-lazy-islands, D4) ---
// `translationsOf` reads a static table in i18n.tsx instead of the (now lazy)
// catalogs. The table must equal [zh-CN, hu] values of every built-in settings
// label key. `--fix` rewrites it; otherwise drift fails the run.
{
  const I18N_PATH = path.join(ROOT, "packages/client/src/lib/i18n/i18n.tsx");
  const PROMO_PATH = path.join(ROOT, "packages/client/src/lib/settings-promotions.ts");
  const promo = fs.readFileSync(PROMO_PATH, "utf8");
  const listBody = promo.slice(promo.indexOf("BUILT_IN_SETTINGS_LABELS"));
  const listEnd = listBody.indexOf("];");
  const keys = [...new Set([...listBody.slice(0, listEnd).matchAll(/\[\s*"([^"]+)"\s*,\s*"[^"]*"\s*\]/g)].map((m) => m[1]))];
  const { createJiti: mkJiti } = await import("jiti");
  const j = mkJiti(import.meta.url, { interopDefault: true });
  const zhCat = (await j.import(path.join(ROOT, "packages/client/src/lib/i18n/i18n-zh-CN.ts"))).zhCNCatalog;
  const huCat = (await j.import(path.join(ROOT, "packages/client/src/lib/i18n/i18n-hu.ts"))).huCatalog;
  const lines = keys.map((k) => {
    const vals = [zhCat[k], huCat[k]].filter((v) => typeof v === "string" && v);
    return `  ${JSON.stringify(k)}: [${vals.map((v) => JSON.stringify(v)).join(", ")}],`;
  });
  const BEGIN = "// <reserved-label-translations:begin>";
  const END = "// <reserved-label-translations:end>";
  const src = fs.readFileSync(I18N_PATH, "utf8");
  const bi = src.indexOf(BEGIN);
  const ei = src.indexOf(END);
  const objStart = src.indexOf("= {", bi) + 3;
  const objEnd = src.lastIndexOf("};", ei);
  if (bi === -1 || ei === -1 || objStart < 3 || objEnd < objStart) {
    failed = true;
    console.error("\u2717 RESERVED_LABEL_TRANSLATIONS: markers not found in i18n.tsx");
  } else {
    const expected = `\n${lines.join("\n")}\n`;
    if (src.slice(objStart, objEnd) === expected) {
      console.log(`\u2713 RESERVED_LABEL_TRANSLATIONS: in sync (${keys.length} keys)`);
    } else if (process.argv.includes("--fix")) {
      fs.writeFileSync(I18N_PATH, src.slice(0, objStart) + expected + src.slice(objEnd));
      console.log(`\u270e RESERVED_LABEL_TRANSLATIONS: rewritten (${keys.length} keys)`);
    } else {
      failed = true;
      console.error("\u2717 RESERVED_LABEL_TRANSLATIONS: drifted from the catalogs — run `node scripts/i18n-parity.mjs --fix`");
    }
  }
}

if (failed) {
  console.error("\ni18n parity check FAILED");
  process.exit(1);
}
console.log("\ni18n parity check passed");
