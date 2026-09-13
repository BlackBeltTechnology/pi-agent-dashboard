/**
 * browser-plugin · SERVER entry (change: add-browser-relay, tasks 2.1 / 2.10b
 * / 2.11 / 3.6; design D2–D7).
 *
 * Composition root. On activation it builds ONE audit ring, ONE relay manager,
 * ONE status broadcaster and mounts the three surfaces on `ctx`:
 *
 *  - WS routes (`registerBrowserWsRoutes`) — `/ws/browser-ext/` + `/ws/browser-cdp/`,
 *  - browser→server handlers (`status.registerHandlers`) — subscribe/unsubscribe/input,
 *  - REST routes (`registerBrowserRoutes`) — `/api/browser/*`.
 *
 * The plugin is OPT-IN: the manifest declares `defaultEnabled: false`, so a
 * fresh install loads it disabled until the operator flips the toggle.
 *
 * TEARDOWN ON PLUGIN DISABLE needs no hook here: the loader's `teardownPlugin`
 * closes every WS socket the plugin tracked with 1001, and closing an extension
 * socket drives `RelayInstance`'s own finalize path, which releases the Chrome
 * tab group and drops the manager entry (same path as X5). `ctx.onShutdown`
 * additionally disposes the status broadcaster's timer and closes everything.
 *
 * `PI_BROWSER_RELAY_FAKE=1` seeds a socket-less `Fake` instance (design D9) so
 * the docker/e2e harness can exercise the UI without real Chrome.
 *
 * See change: add-browser-relay.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { AuditRing } from "./audit.js";
import { canOpenChrome } from "./capability.js";
import { listChromeProfiles } from "./profiles.js";
import { type RelayConfig, RelayManager } from "./relay/relay-manager.js";
import { registerBrowserRoutes } from "./routes.js";
import { BrowserRelayStatus } from "./status.js";
import { registerBrowserWsRoutes } from "./ws-routes.js";

/** The dashboard's own listening port — the extension and CDP client dial loopback. */
function dashboardPort(ctx: ServerPluginContext): number {
  const address = ctx.fastify.server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const audit = new AuditRing();
  const getConfig = () => ctx.getPluginConfig<RelayConfig>();

  // The manager needs `status.broadcastNow` and status needs the manager — the
  // forward declaration breaks the cycle; both are assigned before any relay
  // event can fire (events only start once routes are registered and a connect
  // happens, all after this block).
  let status!: BrowserRelayStatus;

  const manager = new RelayManager({
    audit,
    logger: ctx.logger,
    getConfig,
    getPort: () => dashboardPort(ctx),
    canOpenChrome: () => canOpenChrome(),
    listProfiles: () => listChromeProfiles(),
    onStatusChange: () => status.broadcastNow(),
  });

  status = new BrowserRelayStatus({
    manager,
    audit,
    broadcast: (msg) => ctx.broadcastToSubscribers(msg),
    logger: ctx.logger,
  });

  registerBrowserWsRoutes(ctx, manager);
  status.registerHandlers(ctx);
  registerBrowserRoutes(ctx.fastify, {
    manager,
    audit,
    canOpenChrome: () => canOpenChrome(),
    listProfiles: () => listChromeProfiles(),
    updateConfig: (partial) => ctx.updatePluginConfig(partial),
    logger: ctx.logger,
  });

  // Test-only instance for the docker/e2e harness (deliberately env-gated, never
  // config-gated, so a real deployment cannot enable it).
  if (process.env.PI_BROWSER_RELAY_FAKE === "1") {
    const fake = manager.seedFake();
    ctx.logger.info(`[browser-relay] fake instance seeded id=${fake.instanceId}`);
  }

  ctx.onShutdown(() => {
    status.dispose();
    manager.closeAll("shutdown");
  });

  ctx.logger.info("[browser-relay] plugin activated");
}

export default registerPlugin;
