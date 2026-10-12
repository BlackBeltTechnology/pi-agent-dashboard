#!/usr/bin/env node
/**
 * Single entry point for the TypeScript 7 compiler (`tsc`).
 *
 * `typescript-7` is an npm alias of `typescript@7.x`; the `typescript` package
 * name stays on 5.x for the classic JS API (codegen, tests, tooling). The
 * alias' bin takes over `node_modules/.bin/tsc`, so callers must not rely on
 * that link — they run this wrapper, which resolves the compiler by path and
 * forwards argv, stdio and the exit code.
 *
 * Rollback: point `pkgName` at `typescript` (restores 5.x for every caller).
 * See change: migrate-typecheck-to-ts7 (design D1).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const pkgName = "typescript-7";
const require = createRequire(import.meta.url);

let tscPath;
try {
  // The package `exports` map hides `bin/tsc`; resolve package.json, then join `bin.tsc`.
  const pkgJson = require.resolve(`${pkgName}/package.json`);
  const bin = JSON.parse(readFileSync(pkgJson, "utf8")).bin;
  tscPath = path.join(path.dirname(pkgJson), typeof bin === "string" ? bin : bin.tsc);
} catch {
  console.error(`tsc7: cannot resolve the "${pkgName}" alias (typescript@7) — run \`pnpm install\``);
  process.exit(1);
}

const r = spawnSync(process.execPath, [tscPath, ...process.argv.slice(2)], { stdio: "inherit" });
if (r.error) {
  console.error(`tsc7: failed to run ${tscPath}: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
