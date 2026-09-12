/**
 * Test harness for booting the REAL server with FAKE plugins.
 *
 * Writes a minimal plugin (package.json manifest + a dependency-free
 * `server.mjs` server entry) into the per-file test HOME's installed-plugins
 * dir (`~/.pi/dashboard/plugins`), where the runtime's installed-dir
 * discovery finds it on the next `createServer` boot. The entry stashes its
 * `ServerPluginContext` on globalThis, so the test — running in the SAME
 * process as the server — can drive `ctx.*` capabilities directly.
 *
 * Used by the plugin host-hook / ctx-capability suites; the scenarios need
 * the real host wiring (trust gates, registries, gateways), which only
 * exists inside `createServer`. See change: relocate-goal-product-to-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

/** Stash keyed by plugin id; the server.mjs entry writes into it at register. */
declare global {
  // eslint-disable-next-line no-var
  var __pluginHostHarness: Record<string, ServerPluginContext | undefined> | undefined;
}

/** Drop stashed contexts from a previous server boot (stale-wiring guard). */
export function resetPluginHostHarness(): void {
  globalThis.__pluginHostHarness = undefined;
}

/** The ServerPluginContext a fake plugin received at registerPlugin time. */
export function pluginCtx(pluginId: string): ServerPluginContext {
  const ctx = globalThis.__pluginHostHarness?.[pluginId];
  if (!ctx) {
    throw new Error(`fake plugin "${pluginId}" has not registered — was the server booted with installFakePlugin("${pluginId}") before createServer?`);
  }
  return ctx;
}

/**
 * Write a fake plugin into the per-file HOME's installed-plugins dir. MUST
 * run before the `createServer` that should load it (discovery happens at
 * boot). `priority <= 100` passes the trusted gate (spawnSession & friends).
 */
export function installFakePlugin(opts: {
  id: string;
  priority: number;
  displayName?: string;
}): void {
  const pluginsDir = path.join(os.homedir(), ".pi", "dashboard", "plugins");
  const pkgDir = path.join(pluginsDir, opts.id);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: opts.id,
      "pi-dashboard-plugin": {
        id: opts.id,
        displayName: opts.displayName ?? opts.id,
        priority: opts.priority,
        claims: [],
        server: "./server.mjs",
      },
    }),
  );
  fs.writeFileSync(
    path.join(pkgDir, "server.mjs"),
    `export default function registerPlugin(ctx) {
  (globalThis.__pluginHostHarness ??= {})[${JSON.stringify(opts.id)}] = ctx;
}
`,
  );
}
