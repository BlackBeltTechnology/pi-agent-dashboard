/**
 * Runtime plugin client routes:
 *
 * GET    /api/plugins/runtime-clients — admitted runtime clients only (`observe`).
 * POST   /api/plugins/:id/trust       — `{sha256}` pins the client bundle, `{server:true}` grants
 *                                       pi-package server-entry trust (`operate` AND genuinely local).
 * DELETE /api/plugins/:id/trust       — removes the whole trust entry (`operate`).
 *
 * Every trust write goes through the dedicated trust writer inside `withSettingsWriteLock`, logs id,
 * action and the 12-hex hash prefix (never the full hash), then yields ONE `plugins_changed`.
 *
 * See change: decouple-plugins-from-core (tasks 6.11, 6.12, 6.20; design D12).
 */
import {
  buildRuntimeClientListing,
  type DiscoveredPlugin,
  type DiscoveryOptions,
  discoverPlugins,
  getPluginStatusStore,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { isLocallyTrusted } from "../auth/localhost-guard.js";
import { grantClientTrust, grantServerTrust, revokeTrust, TRUST_WRITE_LOCK_KEY } from "../auth/plugin-trust-store.js";
import { noteServeAppTrustChange } from "../auth/serve-app-host.js";
import { withSettingsWriteLock } from "../pi/settings-write-lock.js";
import { type AdmissionLog, getRuntimeClientRegistry, hashPrefix, logRuntimeAdmissions } from "../plugin-runtime-clients.js";
import type { NetworkGuard } from "./route-deps.js";

export interface PluginRuntimeClientRoutesDeps {
  networkGuard: NetworkGuard;
  broadcast: (msg: ServerToBrowserMessage) => void;
  /** Genuinely-local proof context (strict mode); omitted → plain loopback-without-forwarding. */
  localTrust?: LocalTrustContext;
  /** `refreshPluginDiscovery()`: loads a newly trusted pi-package server entry and ends in ONE `plugins_changed`. */
  refreshDiscovery?: () => Promise<void>;
  /** Fastify runs with `logger:false`, so the server passes console-backed sinks. */
  log?: AdmissionLog;
  repoRoot?: string;
  /** Discovery options matching the boot load (tests inject a pi-package agent dir). */
  discovery?: DiscoveryOptions;
}

interface TrustBody {
  sha256?: unknown;
  server?: unknown;
}

const SHA256 = /^[0-9a-f]{64}$/;

function findPlugin(id: string, repoRoot?: string, discovery?: DiscoveryOptions): DiscoveredPlugin | undefined {
  return discoverPlugins(repoRoot, [], discovery).find((p) => p.manifest.id === id);
}

/** `{sha256}` XOR `{server:true}`; anything else is a 400. */
function parseTrustBody(body: TrustBody | undefined): { kind: "client"; sha256: string } | { kind: "server" } | { error: string } {
  const hasSha = body?.sha256 !== undefined;
  const hasServer = body?.server !== undefined;
  if (hasSha === hasServer) return { error: "body must carry exactly one of sha256 or server:true" };
  if (hasServer) return body?.server === true ? { kind: "server" } : { error: "server must be true" };
  return typeof body?.sha256 === "string" && SHA256.test(body.sha256) ? { kind: "client", sha256: body.sha256 } : { error: "sha256 must be 64 hex characters" };
}

export function registerPluginRuntimeClientRoutes(fastify: FastifyInstance, deps: PluginRuntimeClientRoutesDeps): void {
  const { networkGuard, broadcast, repoRoot, discovery } = deps;
  const log: AdmissionLog = deps.log ?? { info: (m) => console.log(m) };

  /** After a trust write: serve-app restart flag, then ONE `plugins_changed` (the refresh owns it for a server grant). */
  async function afterTrustChange(plugin: DiscoveredPlugin | undefined, refresh: boolean): Promise<void> {
    if (plugin) noteServeAppTrustChange({ packageDir: plugin.packageDir, manifestId: plugin.manifest.id, source: plugin.source });
    if (refresh && deps.refreshDiscovery) {
      await deps.refreshDiscovery();
    } else {
      broadcast({ type: "plugins_changed", plugins: getPluginStatusStore().listAll() });
    }
    logRuntimeAdmissions(log, "trust");
  }

  // GET /api/plugins/runtime-clients — admitted runtime plugins only.
  fastify.get("/api/plugins/runtime-clients", { preHandler: networkGuard }, async (_request, reply) => {
    const admitted = getRuntimeClientRegistry()?.getAdmittedRuntimePlugins() ?? [];
    return reply.status(200).send({ success: true, plugins: buildRuntimeClientListing(admitted) });
  });

  /** `{server:true}`: record pi-package server trust, then refresh discovery (loads the entry additively). */
  async function grantServer(plugin: DiscoveredPlugin, reply: FastifyReply): Promise<FastifyReply> {
    const id = plugin.manifest.id;
    if (plugin.source !== "pi-package" || !plugin.serverEntryPath) {
      return reply.status(400).send({ success: false, error: "server trust applies to a pi-package plugin with a server entry" });
    }
    const { after } = await withSettingsWriteLock(TRUST_WRITE_LOCK_KEY, async () => grantServerTrust(id));
    log.info(`[plugin-trust] id=${id} action=grant-server sha=${hashPrefix(after.find((e) => e.id === id)?.clientSha256)}`);
    await afterTrustChange(plugin, true);
    return reply.status(200).send({ success: true, entry: after.find((e) => e.id === id) });
  }

  /** `{sha256}`: pin the client bundle, only when the hash is the CURRENT one (decided against a full rehash). */
  async function grantClient(plugin: DiscoveredPlugin, sha256: string, reply: FastifyReply): Promise<FastifyReply> {
    const id = plugin.manifest.id;
    const registry = getRuntimeClientRegistry();
    registry?.clearContentHashCache(); // the pin is never decided against a stale stat cache (design D12, R2)
    const outcome = await withSettingsWriteLock(TRUST_WRITE_LOCK_KEY, async () => {
      const current = registry?.currentContentHash(id);
      if (!current) return { status: 400 as const };
      if (current !== sha256) return { status: 409 as const };
      return { status: 200 as const, after: grantClientTrust(id, sha256).after };
    });
    if (outcome.status === 400) return reply.status(400).send({ success: false, error: "plugin has no client bundle to trust" });
    if (outcome.status === 409) {
      return reply.status(409).send({ success: false, error: "stale_hash", message: "The bundle changed since the hash was displayed; reload and review it again." });
    }
    log.info(`[plugin-trust] id=${id} action=grant-client sha=${hashPrefix(sha256)}`);
    await afterTrustChange(plugin, false);
    return reply.status(200).send({ success: true, entry: outcome.after.find((e) => e.id === id) });
  }

  // POST /api/plugins/:id/trust
  fastify.post<{ Params: { id: string }; Body: TrustBody }>(
    "/api/plugins/:id/trust",
    { preHandler: networkGuard },
    async (request: FastifyRequest<{ Params: { id: string }; Body: TrustBody }>, reply: FastifyReply) => {
      // Trusting code is a host-owner decision: a remote operate bearer may revoke but never grant.
      if (!isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }, deps.localTrust)) {
        return reply.status(403).send({ success: false, error: "local_only", message: "Plugin trust can only be granted from the machine running the dashboard." });
      }
      const { id } = request.params;
      const parsed = parseTrustBody(request.body);
      if ("error" in parsed) return reply.status(400).send({ success: false, error: parsed.error });
      const plugin = findPlugin(id, repoRoot, discovery);
      if (!plugin) return reply.status(404).send({ success: false, error: `Plugin "${id}" not found` });
      return parsed.kind === "server" ? grantServer(plugin, reply) : grantClient(plugin, parsed.sha256, reply);
    },
  );

  // DELETE /api/plugins/:id/trust — drops the whole entry (client pin and server grant).
  fastify.delete<{ Params: { id: string } }>("/api/plugins/:id/trust", { preHandler: networkGuard }, async (request, reply) => {
    const { id } = request.params;
    const { before } = await withSettingsWriteLock(TRUST_WRITE_LOCK_KEY, async () => revokeTrust(id));
    const removed = before.find((e) => e.id === id);
    log.info(`[plugin-trust] id=${id} action=revoke sha=${hashPrefix(removed?.clientSha256)}`);
    // A server entry that is already running keeps running until a restart: say so on its row.
    const store = getPluginStatusStore();
    const row = store.getStoredStatus(id);
    if (removed?.server && row?.loaded) store.setStatus({ ...row, restartRequired: true });
    await afterTrustChange(findPlugin(id, repoRoot, discovery), false);
    return reply.status(200).send({ success: true, removed: Boolean(removed), restartRequired: Boolean(removed?.server && row?.loaded) });
  });
}
