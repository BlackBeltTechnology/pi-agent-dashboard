#!/usr/bin/env node
/**
 * assert-runnable-bundle.mjs — runnable-bundle invariant gate
 *
 * Invoked by `.github/workflows/_electron-build.yml` (step "Assert runnable
 * bundle (cli.ts exists)") when `inputs.source_only_bundle == false`.
 *
 * Asserts that `packages/electron/resources/server/node_modules/
 * @blackbelt-technology/pi-dashboard-server/{src/cli.ts,package.json}`
 * exists after `bundle-server.mjs` ran. Without this gate, a regression in
 * `scripts/sync-versions.js` (workspace cross-ref drift → registry fallback
 * for unpublished CI versions) or a future change to the bundle layout
 * could silently ship a non-runnable artefact that throws
 * `BundledServerMissingError` only when the user double-clicks the
 * unzipped installer.
 *
 * Runs identically on Linux/macOS/Windows (no shell:bash). Pinned by
 * `packages/shared/src/__tests__/publish-workflow-contract.test.ts`
 * ("contains a runnable-bundle assertion step").
 *
 * See change: fix-ci-electron-runnable-bundles.
 */

import { existsSync } from "node:fs";
import path from "node:path";

const root = path.join(
  "packages",
  "electron",
  "resources",
  "server",
  "node_modules",
  "@blackbelt-technology",
  "pi-dashboard-server",
);

const required = [
  path.join(root, "src", "cli.ts"),
  path.join(root, "package.json"),
];

const missing = required.filter((p) => !existsSync(p));

if (missing.length > 0) {
  console.error("\u2717 Runnable-bundle assertion failed. Missing paths:");
  for (const p of missing) console.error("  - " + p);
  console.error("See change: fix-ci-electron-runnable-bundles.");
  process.exit(1);
}

console.log(
  `\u2713 Runnable bundle OK \u2014 ${required.length} path(s) present`,
);
