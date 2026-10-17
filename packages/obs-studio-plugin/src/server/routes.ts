/**
 * OBS panel REST routes under `/api/plugins/obs-studio/` (design D7). Fixed
 * operations only — no raw obs-websocket passthrough.
 *
 * | GET  /instances            | observe | 30/min  |
 * | GET  /:service/status      | observe | 60/min  | never opens a bridge; live data only when one is open |
 * | GET  /:service/screenshot  | operate + operate authority | 300/min |
 * | POST /:service/scene       | operate + operate authority | 30/min  | { sceneName } |
 * | POST /:service/virtualcam  | operate + operate authority | 10/min  | { on } |
 * | POST /:service/record      | operate + operate authority | 10/min  | { on } |
 *
 * Tiers live in `packages/shared/src/route-tiers.ts` (host tier gate). Operate
 * authority = `identity.hasOperateAuthority(request)` — the `/api/services`
 * mutation rule, so a trusted-network caller without credentials is refused;
 * an absent seam refuses (fail closed). The authority check runs BEFORE the
 * membership check and before any state read, so an unauthorized request
 * never starts OBS, opens a connection or resolves the password. `:service`
 * must be in `instances.json` AND have a definition (else 404; stale entries
 * pruned). A bridge opens only when the managed state is `healthy`.
 * Rate limits: encapsulated `@fastify/rate-limit` (`global: false`, route-level
 * `config.rateLimit`) WITHOUT a loopback allowList — loopback is limited too.
 * Errors are lowercase machine codes. See change: add-obs-studio-plugin.
 */
import type { PluginNetworkGuard } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BridgeError, type BridgeManager } from "./bridge.js";
import type { ServiceState, StateReader } from "./service-state.js";

export const PREFIX = "/api/plugins/obs-studio";

export interface ObsRouteDeps {
  bridges: BridgeManager;
  states: StateReader;
  /** Registered + still-defined instance ids (prunes stale entries). */
  instances: () => string[];
  /** The current definition's ws endpoint + mode, or undefined when removed. */
  definition: (id: string) => { mode: string; ws?: string } | undefined;
  /** `recovery-suspended` of the local instance (launch-state.json). */
  recoverySuspended: (id: string) => boolean;
  /** `ctx.identity?.hasOperateAuthority` — absent ⇒ refuse. */
  hasOperateAuthority?: (request: unknown) => boolean;
  networkGuard: PluginNetworkGuard;
  logger: { info(m: string): void; warn(m: string): void };
}

const SERVICE_PARAM = { type: "object", required: ["service"], properties: { service: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,62}$" } } } as const;

const limit = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

const STATUS_FOR: Record<string, number> = {
  "obs-timeout": 504,
  "not-found": 404,
  usage: 400,
  "unsupported-request": 409,
  "auth-failed": 502,
  unreachable: 502,
  "obs-unavailable": 502,
};

function sendBridgeError(reply: FastifyReply, e: unknown) {
  const code = e instanceof BridgeError ? e.code : "failed";
  const safe = /^[a-z][a-z-]{0,40}$/.test(code) ? code : "failed";
  const body: Record<string, unknown> = { error: safe };
  if (e instanceof BridgeError && Array.isArray(e.detail?.scenes)) body.scenes = e.detail.scenes;
  return reply.code(STATUS_FOR[safe] ?? 502).send(body);
}

export async function mountObsRoutes(fastify: FastifyInstance, deps: ObsRouteDeps): Promise<void> {
  const { bridges, states } = deps;

  const lookup = (id: string) => (deps.instances().includes(id) ? deps.definition(id) : undefined);

  const statusBody = async (id: string, def: { mode: string }, s: ServiceState) => {
    const body: Record<string, unknown> = {
      id,
      mode: def.mode,
      state: s.state,
      ...(s.reason ? { reason: s.reason } : {}),
      ...(s.hint ? { hint: s.hint } : {}),
      ...(s.exposure ? { exposure: s.exposure } : {}),
      recoverySuspended: deps.recoverySuspended(id),
      bridge: bridges.info(id),
    };
    return body;
  };

  await fastify.register(async (scope) => {
    // Loopback is limited too: no allowList (the gmail / mcp scopes exempt it; this one must not).
    await scope.register(rateLimit, { global: false });

    /** Operate-authorized + registered instance, else the reply is already sent. */
    const authorize = (request: FastifyRequest, reply: FastifyReply): { id: string; def: { mode: string; ws?: string } } | undefined => {
      if (!deps.hasOperateAuthority?.(request)) {
        void reply.code(403).send({ error: "operate_required", message: "OBS screenshots and controls need an operate-tier credential or a locally trusted caller" });
        return undefined;
      }
      const id = (request.params as { service: string }).service;
      const def = lookup(id);
      if (!def) {
        void reply.code(404).send({ error: "not-found" });
        return undefined;
      }
      return { id, def };
    };

    /** State must be `healthy` before a bridge opens; otherwise the state is returned. */
    const withBridge = async (request: FastifyRequest, reply: FastifyReply, op: string, args: Record<string, unknown>) => {
      const hit = authorize(request, reply);
      if (!hit) return reply;
      const s = await states.read(hit.id);
      if (s.state !== "healthy" || !hit.def.ws) {
        return reply.code(409).send({ error: "not-healthy", ...(await statusBody(hit.id, hit.def, s)) });
      }
      try {
        const result = await bridges.request(hit.id, hit.def.ws, op, args);
        return reply.send({ ok: true, result });
      } catch (e) {
        if (e instanceof BridgeError && e.code === "obs-timeout") states.invalidate(hit.id);
        return sendBridgeError(reply, e);
      }
    };

    const guarded = (max: number) => ({ preHandler: deps.networkGuard, config: limit(max) });

    scope.get(`${PREFIX}/instances`, guarded(30), async () => {
      const instances = [];
      for (const id of deps.instances()) {
        const def = deps.definition(id);
        if (!def) continue;
        instances.push(await statusBody(id, def, await states.read(id)));
      }
      return { instances };
    });

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single status handler; branches are the observe-tier rules
    scope.get(`${PREFIX}/:service/status`, { ...guarded(60), schema: { params: SERVICE_PARAM } }, async (request, reply) => {
      const id = (request.params as { service: string }).service;
      const def = lookup(id);
      if (!def) return reply.code(404).send({ error: "not-found" });
      const s = await states.read(id);
      const body = await statusBody(id, def, s);
      // Observe tier: never open a bridge. Live OBS data only rides an already-open one.
      if (bridges.isOpen(id) && def.ws) {
        try {
          body.live = await bridges.request(id, def.ws, "status");
        } catch (e) {
          body.liveError = e instanceof BridgeError ? e.code : "failed";
        }
      }
      return body;
    });

    scope.get(`${PREFIX}/:service/screenshot`, { ...guarded(300), schema: { params: SERVICE_PARAM } }, (request, reply) =>
      withBridge(request, reply, "screenshot", { width: 640 }),
    );

    scope.post(
      `${PREFIX}/:service/scene`,
      {
        ...guarded(30),
        schema: {
          params: SERVICE_PARAM,
          body: { type: "object", required: ["sceneName"], additionalProperties: false, properties: { sceneName: { type: "string", minLength: 1, maxLength: 256 } } },
        },
      },
      (request, reply) => withBridge(request, reply, "scene.switch", { sceneName: (request.body as { sceneName: string }).sceneName }),
    );

    const toggle = { type: "object", required: ["on"], additionalProperties: false, properties: { on: { type: "boolean" } } } as const;
    scope.post(`${PREFIX}/:service/virtualcam`, { ...guarded(10), schema: { params: SERVICE_PARAM, body: toggle } }, (request, reply) =>
      withBridge(request, reply, "vcam.set", { on: (request.body as { on: boolean }).on }),
    );
    scope.post(`${PREFIX}/:service/record`, { ...guarded(10), schema: { params: SERVICE_PARAM, body: toggle } }, (request, reply) =>
      withBridge(request, reply, "record.set", { on: (request.body as { on: boolean }).on }),
    );
  });
}
