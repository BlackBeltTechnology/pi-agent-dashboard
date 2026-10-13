#!/usr/bin/env node
/**
 * acp-bridge launcher — the out-of-process ACP adapter (host B, `durable: true`).
 *
 * Runs `src/acp-bridge/main.ts` under the same native TypeScript loader the
 * server CLI uses (located from `@blackbelt-technology/pi-dashboard-shared`).
 * It is the child the rpc-keeper supervises: `[node, bin/acp-bridge.mjs,
 * "--agent", <id>]`. Signals are forwarded so a keeper kill reaches the adapter
 * (which then terminates its agent).
 *
 * See change: add-acp-session-driver (D1, D2).
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "acp-bridge", "main.ts");

let loader = null;
try {
  const tsLoaderSelect = await import("@blackbelt-technology/pi-dashboard-shared/platform/ts-loader-select.mjs");
  loader = tsLoaderSelect.resolveNativeTsLoader({ anchor: fileURLToPath(import.meta.url) });
} catch {
  /* handled below */
}
if (!loader) {
  process.stderr.write("acp-bridge: cannot find the native TypeScript loader (@blackbelt-technology/pi-dashboard-shared).\n");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
  env: process.env,
});

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      child.kill(sig);
    } catch {
      /* child already gone */
    }
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else process.exit(code ?? 0);
});
child.on("error", (err) => {
  process.stderr.write(`acp-bridge: failed to spawn Node: ${err.message}\n`);
  process.exit(1);
});
