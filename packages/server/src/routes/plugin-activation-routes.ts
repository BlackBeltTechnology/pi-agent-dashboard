/**
 * Plugin activation REST routes.
 *
 * GET  /api/plugins            — list every discovered plugin (manifest + status)
 * POST /api/plugins/:id/toggle — body { enabled: boolean }; writes
 *                                config.plugins.<id>.enabled, broadcasts
 *                                plugin_config_update, returns
 *                                { restartRequired: true } or 404.
 *
 * See change: add-plugin-activation-ui.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildGraph,
  computeToggleImpact,
  discoverPlugins,
  getPluginStatusStore,
  getWsRouteRegistry,
  redactPluginConfigForClient,
  resolvePluginEnabled,
  transitiveDependents,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";

// Resolved lazily so tests that override $HOME after import still work.
function configPaths() {
  const dir = path.join(os.homedir(), ".pi", "dashboard");
  return { dir, file: path.join(dir, "config.json") };
}

function readRawConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(configPaths().file, "utf-8"));
  } catch {
    return {};
  }
}

function writeRawConfig(merged: Record<string, unknown>): void {
  const { dir, file } = configPaths();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Every plugin id whose `enabled` must flip, the toggled plugin first.
 *
 * Extracted from the toggle handler to keep its branch chain under the
 * complexity budget: the cascade decision is a flat rule, while the handler owns
 * the request/response choreography. Behaviour is unchanged.
 */
function toggleFlips(
  id: string,
  enabled: boolean,
  impact: { cascadeEnable: string[]; cascadeDisable: string[] },
): Array<{ id: string; enabled: boolean }> {
  const flips: Array<{ id: string; enabled: boolean }> = [{ id, enabled }];
  for (const dep of enabled ? impact.cascadeEnable : impact.cascadeDisable) {
    flips.push({ id: dep, enabled });
  }
  return flips;
}

/**
 * Apply every flip to a COPY of the plugin config.
 *
 * Returns the new config plus the merged block per flipped id, because the
 * broadcast below must send what was actually written (it carries the plugin's
 * full previous block for redaction).
 */
function applyToggleFlips(
  existingPlugins: Record<string, unknown>,
  flips: Array<{ id: string; enabled: boolean }>,
): { nextPlugins: Record<string, unknown>; mergedPerId: Map<string, Record<string, unknown>> } {
  const nextPlugins: Record<string, unknown> = { ...existingPlugins };
  const mergedPerId = new Map<string, Record<string, unknown>>();
  for (const flip of flips) {
    const prev = (nextPlugins[flip.id] as Record<string, unknown> | undefined) ?? {};
    const merged = { ...prev, enabled: flip.enabled };
    nextPlugins[flip.id] = merged;
    mergedPerId.set(flip.id, merged);
  }
  return { nextPlugins, mergedPerId };
}

/**
 * The cascade impact of enabling/disabling `id`, resolved against the CURRENT
 * config. `isEnabled` follows the documented precedence: explicit config wins,
 * else the manifest `defaultEnabled` (false = opt-in plugin), else
 * default-allow (add-browser-relay GAP B).
 */
function toggleImpactFor(
  plugins: ReturnType<typeof discoverPlugins>,
  existingPlugins: Record<string, unknown>,
  id: string,
  enabled: boolean,
) {
  const isEnabled = (pid: string): boolean => {
    const cfg = existingPlugins[pid] as Record<string, unknown> | undefined;
    const defaultEnabled = plugins.find((p) => p.manifest.id === pid)?.manifest.defaultEnabled;
    return resolvePluginEnabled(cfg, defaultEnabled);
  };
  const graph = buildGraph(
    plugins.map((p) => ({ id: p.manifest.id, dependsOn: p.manifest.dependsOn ?? [] })),
    isEnabled,
  );
  return computeToggleImpact(graph, id, enabled);
}

/** Emit one `plugin_config_update` per flipped id, redacted per plugin. */
function broadcastToggleUpdates(
  broadcast: (msg: ServerToBrowserMessage) => void,
  mergedPerId: Map<string, Record<string, unknown>>,
  repoRoot?: string,
): void {
  for (const [flipId, merged] of mergedPerId) {
    // writeOnly fields (e.g. browser SSO tokens) never cross to a client — the
    // merged config here carries the plugin's FULL previous block.
    // Spec add-browser-relay, browser-plugin-settings F2 / GAP A.
    broadcast({
      type: "plugin_config_update",
      id: flipId,
      config: redactPluginConfigForClient(flipId, merged, repoRoot),
    });
  }
}

/**
 * Live teardown of WS routes on disable (spec add-browser-relay /
 * plugin-ws-route: sockets close 1001, later upgrades 404) — without a restart.
 * REST routes the plugin mounted stay until restart, which is why
 * `restartRequired` stays true: this is the WS-scope teardown, not a full plugin
 * unload. Idempotent — a no-op for plugins owning no routes.
 */
function teardownDisabledWsRoutes(
  enabled: boolean,
  flips: Array<{ id: string; enabled: boolean }>,
): void {
  if (enabled) return;
  const registry = getWsRouteRegistry();
  for (const flip of flips) registry.teardownPlugin(flip.id);
}

export function registerPluginActivationRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    broadcast: (msg: ServerToBrowserMessage) => void;
    repoRoot?: string;
  },
) {
  const { networkGuard, broadcast, repoRoot } = deps;

  // GET /api/plugins — every discovered plugin's manifest summary + status.
  fastify.get(
    "/api/plugins",
    { preHandler: networkGuard },
    async (_request, reply) => {
      const plugins = discoverPlugins(repoRoot);
      const store = getPluginStatusStore();
      const all = store.listAll();
      const statusById = new Map(all.map((s) => [s.id, s] as const));

      // Compute dependents per plugin for the cascade-impact preview UX.
      // See change: add-plugin-activation-ui (Layer 2 — dependency graph).
      const graph = buildGraph(
        plugins.map((p) => ({
          id: p.manifest.id,
          dependsOn: p.manifest.dependsOn ?? [],
        })),
        () => true,
      );

      const rows = plugins.map((p) => {
        const m = p.manifest;
        const status = statusById.get(m.id);
        const dependents = Array.from(transitiveDependents(graph, m.id)).sort();
        return {
          id: m.id,
          // Absolute directory the plugin was DISCOVERED from. Exposed so an
          // operator (and the clean-install smoke) can tell an install-prefix
          // plugin from a monorepo checkout that won discovery by id — the id
          // alone cannot distinguish them, and a checkout copy loads happily.
          packageDir: p.packageDir,
          displayName: m.displayName,
          priority: m.priority ?? 1000,
          hasServer: Boolean(p.serverEntryPath),
          hasBridge: Boolean(p.bridgeEntryPath),
          hasClient: Boolean(p.clientEntryPath),
          claims: m.claims.map((c) => ({
            slot: c.slot,
            component: c.component,
            tab: c.tab,
            command: c.command,
            toolName: c.toolName,
          })),
          requires: m.requires ?? null,
          dependsOn: m.dependsOn ?? [],
          dependents,
          status: status ?? null,
        };
      });

      return reply.status(200).send({ success: true, plugins: rows });
    },
  );

  // POST /api/plugins/:id/toggle — write config.plugins.<id>.enabled.
  //
  // Honors dependency-graph cascade per Robert's add-plugin-activation-ui
  // Layer 2: enabling cascades deps; disabling cascades dependents; enabling
  // with a missing dep returns 409 with the blocker list.
  fastify.post<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    "/api/plugins/:id/toggle",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};

      if (typeof body.enabled !== "boolean") {
        return reply
          .status(400)
          .send({ success: false, error: "body.enabled must be boolean" });
      }

      const plugins = discoverPlugins(repoRoot);
      const found = plugins.find((p) => p.manifest.id === id);
      if (!found) {
        return reply
          .status(404)
          .send({ success: false, error: `Plugin "${id}" not found` });
      }

      const existing = readRawConfig();
      const existingPlugins =
        (existing.plugins as Record<string, unknown> | undefined) ?? {};

      const impact = toggleImpactFor(plugins, existingPlugins, id, body.enabled);

      if (body.enabled && impact.blockers.length > 0) {
        return reply
          .status(409)
          .send({ success: false, reason: "blockers", blockers: impact.blockers });
      }

      // Atomic cascade write: collect every id whose `enabled` flips, write
      // them all in a single config write, then emit one plugin_config_update
      // per affected id.
      const flips = toggleFlips(id, body.enabled, impact);
      const { nextPlugins, mergedPerId } = applyToggleFlips(existingPlugins, flips);
      writeRawConfig({ ...existing, plugins: nextPlugins });
      broadcastToggleUpdates(broadcast, mergedPerId, repoRoot);
      teardownDisabledWsRoutes(body.enabled, flips);

      return reply.status(200).send({
        success: true,
        restartRequired: true,
        cascade: {
          ...(body.enabled ? { enable: impact.cascadeEnable } : {}),
          ...(!body.enabled ? { disable: impact.cascadeDisable } : {}),
        },
      });
    },
  );
}
