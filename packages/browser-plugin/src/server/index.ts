/**
 * browser-plugin · SERVER entry.
 *
 * Minimal activation scaffold (workstream 2a): loads cleanly, logs, exposes
 * nothing yet. The relay machinery lands with workstream 2c — relay-instance
 * + relay-manager wrapping `relay/vendor/playwright-core` (see
 * relay/vendor/NOTICE), WS routes via `ctx.registerWsRoute`, REST under
 * `/api/browser/*`.
 *
 * The plugin is OPT-IN: the manifest declares `defaultEnabled: false`, so a
 * fresh install loads it disabled until the operator flips the toggle.
 *
 * See change: add-browser-relay (tasks 2.1).
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("browser-plugin server entry activated (scaffold: relay lands with workstream 2c)");
}
