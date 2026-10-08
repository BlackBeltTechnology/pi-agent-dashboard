#!/usr/bin/env node
// Usage: node config.mjs <appDir> <adapter> <variantConfig> <out.json>
// Deterministic effective-config evaluation: the adapter reproduces the app's own merge from statically
// read config (helpers: parseLiteralAt, guarded defaultsDeep); application code is never executed.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLiteralAt } from "./js-literal.mjs";
import { adapterOrExit, defaultsDeep, lineAt, readText } from "./lib.mjs";

const [appDir, adapterName, variant, outFile] = process.argv.slice(2);
if (!outFile) {
  console.error("usage: config.mjs <appDir> <adapter> <variantConfig> <out.json>");
  process.exit(2);
}
const adapter = await adapterOrExit(adapterName);
const res = await adapter.effectiveConfig(appDir, variant, { join, readText, lineAt, parseLiteralAt, defaultsDeep });
writeFileSync(outFile, `${JSON.stringify({ variant, ...res }, null, 1)}\n`);
for (const [k, f] of Object.entries(res.forms)) console.log(k, f.fields.map((x) => `${x.key}[${x.definedIn.length}]`).join(" "));
