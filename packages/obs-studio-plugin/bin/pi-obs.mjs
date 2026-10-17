#!/usr/bin/env node
import { dirname, resolve } from "node:path";
// pi-obs launcher. Registers the dashboard's Node-native TypeScript loader
// (@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs,
// the same loader `pi-dashboard` uses) IN-PROCESS, then imports the TS entry
// `../src/bin/pi-obs.ts`. No child process, so stdio (the `serve --stdio`
// NDJSON pipe) and signals stay the caller's. The managed-service start argv
// names THIS file with an absolute node: `[<node>, <abs>/bin/pi-obs.mjs, "launch"]`
// (never a shim — a win32 `.cmd` cannot spawn with `shell: false`).
// See change: add-obs-studio-plugin (design D3).
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let loader;
try {
  const select = await import("@blackbelt-technology/pi-dashboard-shared/platform/ts-loader-select.mjs");
  loader = select.resolveNativeTsLoader({ anchor: fileURLToPath(import.meta.url) });
} catch (e) {
  process.stderr.write(`pi-obs: cannot find the native TypeScript loader (@blackbelt-technology/pi-dashboard-shared): ${e?.message ?? e}\n`);
  process.exit(1);
}
await import(loader);
await import(pathToFileURL(resolve(here, "..", "src", "bin", "pi-obs.ts")).href);
