#!/usr/bin/env node
/**
 * Guard: both preload bundles exist under their loader-contract filenames.
 *
 * `main.ts` loads `preload-main.js` and `remote-connect-window.ts` loads
 * `preload.js`; when the file is missing Electron runs the window WITHOUT a
 * preload (no `window.piDashboard`) and nothing fails loudly. Forge 8's Vite
 * plugin emits preloads as `[name].cjs` unless the preload Vite configs pin
 * `entryFileNames: "[name].js"` (the pin is asserted in
 * src/__tests__/forge-config-windows-version.test.ts; THIS script proves the
 * Forge output actually has the files).
 *
 * Usage: node assert-packaged-preloads.mjs [buildDir]   (default: <electron-pkg>/.vite/build)
 * Exit 0 both present; 1 any missing (names every missing file); 2 buildDir absent.
 *
 * See change: refresh-electron-bundled-components (design D7).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_PRELOADS = ["preload.js", "preload-main.js"];

/** @returns {string[]} the required preload filenames missing from `buildDir` */
export function missingPreloads(buildDir) {
  return REQUIRED_PRELOADS.filter((name) => !fs.existsSync(path.join(buildDir, name)));
}

function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const buildDir = argv[0] ?? path.resolve(here, "..", ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    console.error(`::error::preload build dir not found: ${buildDir}`);
    return 2;
  }
  const missing = missingPreloads(buildDir);
  if (missing.length === 0) {
    console.log(`assert-packaged-preloads: OK — ${REQUIRED_PRELOADS.join(", ")} present in ${buildDir}`);
    return 0;
  }
  for (const name of missing) {
    console.error(`::error::missing preload ${name} in ${buildDir} — main would run without window.piDashboard`);
  }
  const found = fs.readdirSync(buildDir).filter((f) => /^preload/.test(f));
  console.error(`preload-like files present: ${found.join(", ") || "(none)"}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
