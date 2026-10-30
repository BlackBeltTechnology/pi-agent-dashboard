#!/usr/bin/env node
/**
 * Built-bundle layout gate — the workspace source ships ONCE.
 *
 * After `bundle-server.mjs` (full mode) the server tree must hold:
 *   - `packages/` with exactly one child, `dist` (the served client). Every
 *     `packages/<dir>` is a second copy of `node_modules/@blackbelt-technology/<pkg>`
 *     that nothing reads and the NSIS install pays for (one file create + one
 *     Defender scan each);
 *   - `node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` (the
 *     entry the app launches);
 *   - a `package.json` WITHOUT `workspaces` (the field was the input of an
 *     install that already ran; a leftover would make a later `npm install`
 *     treat the materialized copies as workspace links).
 *
 * Usage: node assert-bundle-layout.mjs [serverDir]
 *   serverDir  default `packages/electron/resources/server` (relative to cwd)
 * Exit 0 canonical; 1 violations; 2 usage/unreadable.
 *
 * See change: slim-windows-install-file-count (design D2).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @returns {{ ok: boolean, errors: string[] }} */
export function checkBundleLayout(serverDir) {
  const errors = [];

  const pkgsDir = path.join(serverDir, "packages");
  const children = existsSync(pkgsDir) ? readdirSync(pkgsDir).sort() : [];
  if (!children.includes("dist")) errors.push(`packages/dist (the served client) is missing under ${serverDir}`);
  const extra = children.filter((c) => c !== "dist");
  if (extra.length > 0) {
    errors.push(`packages/ must hold only 'dist'; leftover workspace copies: ${extra.join(", ")}`);
  }

  const cli = path.join(serverDir, "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts");
  if (!existsSync(cli)) errors.push(`server entry missing: ${cli}`);

  try {
    const pkg = JSON.parse(readFileSync(path.join(serverDir, "package.json"), "utf8"));
    if ("workspaces" in pkg) errors.push("package.json still declares `workspaces` (must be dropped after install)");
  } catch (err) {
    errors.push(`package.json unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const serverDir = path.resolve(process.argv[2] ?? path.join("packages", "electron", "resources", "server"));
  if (!existsSync(serverDir)) {
    console.error(`\u2717 bundle dir not found: ${serverDir}`);
    process.exit(2);
  }
  const { ok, errors } = checkBundleLayout(serverDir);
  if (!ok) {
    console.error("\u2717 Bundle layout assertion failed:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("See change: slim-windows-install-file-count (design D2).");
    process.exit(1);
  }
  console.log("\u2713 Bundle layout OK \u2014 workspace source only under node_modules, packages/ == [dist], no workspaces");
}
