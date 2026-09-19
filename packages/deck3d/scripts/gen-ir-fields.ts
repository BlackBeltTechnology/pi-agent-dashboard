#!/usr/bin/env node
/**
 * Regenerate `.pi/skills/deck3d/reference/ir-fields.md` from `src/ir/schema.json`.
 *
 *   tsx scripts/gen-ir-fields.ts          # write
 *   tsx scripts/gen-ir-fields.ts --check  # fail if stale (used by tests)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderIrFieldsMd } from "../src/ir/field-reference.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(pkgRoot, ".pi/skills/deck3d/reference/ir-fields.md");
const generated = renderIrFieldsMd();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outPath, "utf8");
  } catch {
    console.error(`ir-fields.md missing at ${outPath} — run: tsx scripts/gen-ir-fields.ts`);
    process.exit(1);
  }
  if (current !== generated) {
    console.error("ir-fields.md is stale — run: tsx scripts/gen-ir-fields.ts");
    process.exit(1);
  }
  console.log("ir-fields.md up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  console.log(`wrote ${outPath}`);
}
