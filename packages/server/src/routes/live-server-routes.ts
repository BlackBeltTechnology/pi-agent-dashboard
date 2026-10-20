/**
 * REST routes for live-server-preview lifecycle. The `start` endpoint is the
 * SSRF gate (loopback-only via `validateLiveTarget` inside the manager);
 * non-loopback targets are rejected 400 and never reach the proxy.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */

import fs from "node:fs";
import path from "node:path";
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { isStaticWebAsset, resolveStaticRoot } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { canonicalHttpsOrigin } from "@blackbelt-technology/pi-dashboard-shared/preview-egress.js";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { COOKIE_NAME, type TokenPayload } from "../auth/auth.js";
import { hasLocalCredential } from "../auth/local-credential.js";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { canDiscloseAccessPosture, isGenuinelyLocal, isLocallyTrusted, isTrustedSource } from "../auth/localhost-guard.js";
import { sendTierRefusal, tierRefusalFor } from "../auth/route-tier-gate.js";
import {
  type CapabilityPrincipal,
  isViewerId,
  type LiveCapabilityStore,
  type LivePolicy,
  principalKeyOf,
  sessionKeyOf,
} from "../live-server/live-capability.js";
import {
  type EgressGrantRequestOutcome,
  type PreviewEgress,
  requestOriginsOf,
} from "../live-server/live-egress.js";
import type { PreviewExposure } from "../live-server/live-exposure.js";
import { type LiveLogSink, liveLog } from "../live-server/live-log.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { safeSegments } from "../live-server/live-static.js";
import type { NetworkGuard } from "./route-deps.js";

/**
 * The raw file-read gate for `start-static`: resolves `(cwd, path)` exactly as a
 * `/api/file/raw` read does (known session cwd + containment, grants admitted)
 * and, on refusal, yields that route's status and body verbatim.
 */
type StaticStartGate = (
  cwd: string | undefined,
  relPath: string | undefined,
  opts: { disclosure: boolean },
) => Promise<{ ok: true; resolved: string } | { ok: false; status: number; body: unknown }>;

/**
 * Who is minting? Read from what the admission hooks already settled on the
 * request: a device credential, a login session, an identity principal, or
 * nothing revocable (a genuine-local caller).
 */
function capabilityPrincipalOf(request: FastifyRequest): CapabilityPrincipal {
  const r = request as {
    authVia?: string;
    principalTier?: Tier;
    principalDeviceId?: string;
    sessionPayload?: TokenPayload;
    principal?: Principal | null;
    principalExpiresAt?: number | null;
    cookies?: Record<string, string | undefined>;
  };
  const identity = r.principal ?? undefined;
  const identityFields = identity
    ? { identity, ...(typeof r.principalExpiresAt === "number" ? { identityExpiresAt: r.principalExpiresAt } : {}) }
    : {};
  if (r.authVia === "device") {
    return { kind: "device", tier: r.principalTier, deviceId: r.principalDeviceId, ...identityFields };
  }
  if (r.authVia === "session") {
    const cookie = r.cookies?.[COOKIE_NAME];
    return {
      kind: "session",
      tier: r.principalTier,
      session: r.sessionPayload,
      ...(cookie ? { sessionKey: sessionKeyOf(cookie) } : {}),
      ...identityFields,
    };
  }
  // No credential: a genuine same-host caller, or one admitted by network trust
  // alone (`legacy`). The latter's tokens must not outlive a switch to `pair`.
  return { kind: canDiscloseAccessPosture(request) ? "local" : "network", ...identityFields };
}

/** Scripts on a mint: open → as asked; restricted → only `local-only` exposure or the viewer's explicit `runScripts`. */
function scriptsGranted(egress: LivePolicy["egress"], exposure: "local-only" | "exposed", body: Record<string, unknown>): boolean {
  if (body.scripts !== true) return false;
  return egress === "open" || exposure === "local-only" || body.runScripts === true;
}

/** A genuinely local, credential-less caller's token works only from genuinely local requests. */
function isLocalBoundMint(request: FastifyRequest, principal: CapabilityPrincipal): boolean {
  return (
    principal.kind === "local" &&
    isGenuinelyLocal(request.ip, request.headers as Record<string, unknown>) &&
    (request as { authVia?: string }).authVia === undefined
  );
}

/** The root-relative, per-segment-encoded entry for `file`, or `null` when the static branch would refuse to serve it. */
function staticEntry(root: string, file: string): string | null {
  const rel = path.relative(root, file).split(path.sep);
  if (rel.length === 0 || !isStaticWebAsset(rel[rel.length - 1])) return null;
  const segments = safeSegments(`/${rel.map(encodeURIComponent).join("/")}`);
  return segments ? segments.map(encodeURIComponent).join("/") : null;
}

export interface LiveServerRouteDeps {
  networkGuard: NetworkGuard;
  capabilities?: LiveCapabilityStore;
  /** Exposure service; absent ⇒ treated as `exposed` (fail closed). */
  exposure?: PreviewExposure;
  /** Is access prompting enabled (`accessGrants.promptEnabled`)? Absent ⇒ false. */
  promptingEnabled?: () => boolean;
  /** Raw file-read gate for `start-static`. Absent ⇒ the route is not registered. */
  staticGate?: StaticStartGate;
  /** Trusted networks + strict local proof, for the in-handler tier check (port mints need `control`). */
  getTrustedNetworks?: () => string[];
  localTrust?: LocalTrustContext;
  /** Does `dir` hold a static-root marker (`index.html` / `package.json`)? Default: the filesystem. */
  hasMarker?: (dir: string) => boolean;
  /** Per-token egress state (origins view, allow-once, reports). Absent ⇒ the egress routes are not registered. */
  egress?: PreviewEgress;
  /**
   * Record the deferred `(preview-egress, origin)` registry entry for the operator's click and raise
   * the dialog (see `createEgressGrantRequester`). Absent ⇒ project grants are unavailable.
   */
  requestEgressGrant?: (input: { origin: string; projectKey: string; channel: string }) => Promise<EgressGrantRequestOutcome>;
  /** The requester key for the registry's per-channel bounds (default: the request's source address). */
  channelOf?: (request: FastifyRequest) => string;
  /** Log sink (default `console.log`); lines are redacted. */
  log?: LiveLogSink;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function registerLiveServerRoutes(
  fastify: FastifyInstance,
  liveServerManager: LiveServerManager,
  deps: LiveServerRouteDeps,
) {
  const { networkGuard, capabilities } = deps;
  const log = (event: string, fields?: Record<string, unknown>) => liveLog(deps.log, event, fields);

  // Port-target mints need `control`. The route itself sits at the raw-read
  // (`observe`) tier so an observe-tier viewer can mint a STATIC target; the
  // port-target rule is enforced here, including for a proof-less bare-local
  // caller under strict local proof (the observe tier admits it for reads).
  const portMintRefused = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const getTrusted = deps.getTrustedNetworks ?? (() => []);
    const refusal = tierRefusalFor(request, "control", getTrusted, deps.localTrust);
    if (refusal) {
      sendTierRefusal(reply, "control");
      return true;
    }
    const r = request as { authVia?: string; isAuthenticated?: boolean };
    const tiered = r.authVia === "device" || r.authVia === "session";
    if (!tiered && !r.isAuthenticated && deps.localTrust?.strict()) {
      const headers = request.headers as Record<string, unknown>;
      const proven =
        isLocallyTrusted({ ip: request.ip, headers }, deps.localTrust) ||
        hasLocalCredential(headers) ||
        isTrustedSource(request.ip, headers, getTrusted(), deps.localTrust);
      if (!proven) {
        sendTierRefusal(reply, "control");
        return true;
      }
    }
    return false;
  };

  /** Which kind of registered target is `id`, or `null` when it is unknown. */
  const mintKindOf = (id: string): "port" | "static" | null => {
    if (liveServerManager.get(id)) return "port";
    return liveServerManager.getStatic(id) ? "static" : null;
  };

  // Register (or reuse) a loopback dev-server target. Returns the proxied path.
  // `addedBy:"preset"` (agent-declared, after the confirm chip) stays in memory.
  fastify.post<{ Body: { host?: unknown; port?: unknown; label?: unknown; addedBy?: unknown; sessionId?: unknown } }>(
    "/api/live-server/start",
    { preHandler: networkGuard },
    async (request, reply) => {
      const result = liveServerManager.start(asRecord(request.body));
      if (!result.ok) {
        reply.code(400);
        return { success: false, error: result.error } satisfies ApiResponse;
      }
      if (result.target.addedBy === "preset") {
        log("preset target registered", { id: result.target.id, host: result.target.host, port: result.target.port });
      }
      return { success: true, data: { ...result.target, path: result.path } } satisfies ApiResponse;
    },
  );

  // Register (or reuse) a static target for a file the raw file-read gate admits.
  // Same refusal status and body as `GET /api/file/raw`. In memory only; never listed.
  if (deps.staticGate) {
    const staticGate = deps.staticGate;
    const hasMarker =
      deps.hasMarker ??
      ((dir: string) => fs.existsSync(path.join(dir, "index.html")) || fs.existsSync(path.join(dir, "package.json")));
    /** Stat the admitted file, pick its root, refuse what the static branch would not serve, register. */
    const registerStatic = async (
      cwd: string,
      file: string,
    ): Promise<
      { ok: true; id: string; entry: string; root: string } | { ok: false; status: number; error: string }
    > => {
      const st = await fs.promises.stat(file).catch(() => null);
      if (!st) return { ok: false, status: 404, error: "file not found" };
      if (!st.isFile()) return { ok: false, status: 400, error: "not a file" };
      const root = resolveStaticRoot(cwd, file, hasMarker);
      const entry = staticEntry(root, file);
      if (entry === null) return { ok: false, status: 400, error: "this file cannot be served as a static preview" };
      const reg = liveServerManager.startStatic({ cwd, root });
      if (!reg.ok) return { ok: false, status: 400, error: reg.error };
      return { ok: true, id: reg.target.id, entry, root };
    };
    fastify.post<{ Body: { cwd?: unknown; path?: unknown } }>(
      "/api/live-server/start-static",
      { preHandler: networkGuard },
      async (request, reply) => {
        const body = asRecord(request.body);
        const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
        const rel = typeof body.path === "string" ? body.path : undefined;
        const gate = await staticGate(cwd, rel, { disclosure: canDiscloseAccessPosture(request) });
        if (!gate.ok) {
          reply.code(gate.status);
          return gate.body;
        }
        const reg = await registerStatic(cwd as string, gate.resolved);
        if (!reg.ok) {
          reply.code(reg.status);
          return { success: false, error: reg.error } satisfies ApiResponse;
        }
        const { id, entry, root } = reg;
        log("static target registered", { id, cwd, root });
        return { success: true, ok: true, id, entry, root };
      },
    );
  }

  // List the allowlist: persisted (user / legacy) and in-memory preset port targets.
  // Static targets are never listed.
  fastify.get(
    "/api/live-server/list",
    { preHandler: networkGuard },
    async () => {
      return { success: true, data: { servers: liveServerManager.list() } } satisfies ApiResponse;
    },
  );

  // Exposure posture (observe tier). The viewer reads it to decide whether scripts on a
  // restricted preview need the operator's explicit "Run scripts".
  fastify.get("/api/live-server/policy", { preHandler: networkGuard }, async () => {
    const state = deps.exposure?.current() ?? { exposure: "exposed" as const, epoch: 0 };
    let promptingEnabled = false;
    try {
      promptingEnabled = deps.promptingEnabled?.() === true;
    } catch {
      /* unreadable config → off */
    }
    return { success: true, ok: true, exposure: state.exposure, epoch: state.epoch, promptingEnabled };
  });

  // Remove a target from the allowlist. Its capability tokens die with it.
  fastify.delete<{ Params: { id: string } }>(
    "/api/live-server/:id",
    { preHandler: networkGuard },
    async (request) => {
      liveServerManager.remove(request.params.id);
      capabilities?.revokeByTarget(request.params.id);
      return { success: true } satisfies ApiResponse;
    },
  );

  if (capabilities) {
    // Mint a per-preview capability path. Route tier is raw-read (`observe`); a PORT
    // target additionally needs `control` (checked in the handler). The policy is
    // fail-closed: absent/invalid egress → restricted, absent scripts → off, and on a
    // restricted open scripts need `local-only` exposure or the viewer's `runScripts`.
    // The preview frame is sandboxed (opaque origin) and carries no cookie, so the
    // viewer frames this path instead. Unknown target → 404, no token created.
    // See change: retire-trusted-networks-bypass (D5), improve-canvas-html-and-url-ux (D4, D5).
    fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      "/api/live-server/:id/capability",
      { preHandler: networkGuard },
      async (request, reply) => {
        const id = request.params.id;
        const kind = mintKindOf(id);
        if (kind === null) {
          reply.code(404);
          return { success: false, error: "live-server target not found" } satisfies ApiResponse;
        }
        if (kind === "port" && portMintRefused(request, reply)) return reply;
        const body = asRecord(request.body);
        const exposure = deps.exposure?.current().exposure ?? "exposed";
        const egress: LivePolicy["egress"] = body.egress === "open" ? "open" : "restricted";
        const scripts = scriptsGranted(egress, exposure, body);
        const viewerId = isViewerId(body.viewerId) ? body.viewerId : undefined;
        const principal = capabilityPrincipalOf(request);
        const { token, tokenId, expiresAt, policy } = capabilities.mint(id, principal, {
          kind,
          policy: { egress, scripts },
          viewerId,
          exposure,
          localBound: isLocalBoundMint(request, principal),
        });
        liveServerManager.use(id);
        return {
          success: true,
          ok: true,
          path: `/live/${id}/~c/${token}/`,
          expiresAt,
          tokenId,
          policy,
        };
      },
    );

    // Keepalive: extend a token's idle expiry without re-pointing the frame. Only the
    // minting principal may touch its own token. Raw-read tier (a static viewer's
    // keepalive must work for an observe-tier operator); it widens nothing.
    fastify.post<{ Params: { id: string }; Body: { tokenId?: unknown } }>(
      "/api/live-server/:id/touch",
      { preHandler: networkGuard },
      async (request, reply) => {
        const tokenId = asRecord(request.body).tokenId;
        const grant = typeof tokenId === "string" ? capabilities.findByTokenId(tokenId) : null;
        const who = principalKeyOf(capabilityPrincipalOf(request));
        if (!grant || grant.targetId !== request.params.id || !capabilities.touch(grant.tokenId, who)) {
          reply.code(404);
          return { success: false, ok: false, error: "capability not found" };
        }
        return { success: true, ok: true };
      },
    );

    if (deps.egress) registerEgressRoutes(fastify, { ...deps, egress: deps.egress, capabilities });
  }
}

/** Everything the egress routes read: the route deps with the egress service and capability store present. */
type EgressRouteCtx = LiveServerRouteDeps & { egress: PreviewEgress; capabilities: LiveCapabilityStore };

/**
 * Egress (restricted previews). Reading a preview's blocked origins and widening it are control tier AND
 * only the token's MINTING principal: another device, even one holding control, is refused.
 */
function registerEgressRoutes(fastify: FastifyInstance, deps: EgressRouteCtx): void {
  const { networkGuard, capabilities, egress } = deps;
  const log = (event: string, fields?: Record<string, unknown>) => liveLog(deps.log, event, fields);
      /** The caller's own live token for `:id`, or a refusal already sent. */
      const ownTokenOf = (
        request: FastifyRequest,
        reply: FastifyReply,
        tokenId: unknown,
      ): ReturnType<LiveCapabilityStore["findByTokenId"]> => {
        const grant = typeof tokenId === "string" ? capabilities.findByTokenId(tokenId) : null;
        if (!grant || grant.targetId !== (request.params as { id: string }).id) {
          reply.code(404).send({ success: false, ok: false, error: "capability not found" });
          return null;
        }
        if (grant.minterKey !== principalKeyOf(capabilityPrincipalOf(request))) {
          log("egress refused", { reason: "not-minting-principal", tokenId: grant.tokenId });
          reply.code(403).send({ success: false, ok: false, error: "only the preview's owner may do that" });
          return null;
        }
        return grant;
      };
      const promptingOn = (): boolean => {
        try {
          return deps.promptingEnabled?.() === true;
        } catch {
          return false;
        }
      };

      fastify.get<{ Params: { id: string }; Querystring: { token?: unknown } }>(
        "/api/live-server/:id/egress",
        { preHandler: networkGuard },
        async (request, reply) => {
          const grant = ownTokenOf(request, reply, request.query.token);
          if (!grant) return reply;
          const view = await egress.view(grant, { own: requestOriginsOf(request) });
          return { success: true, ok: true, ...view, promptingEnabled: promptingOn() };
        },
      );

      /** A 400 refusal, logged without any capability. */
      const refuse = (reply: FastifyReply, tokenId: string, kind: "once" | "project", error: string) => {
        log("allow refused", { kind, reason: error, tokenId });
        reply.code(400);
        return { success: false, ok: false, error };
      };
      /** The canonical, grantable origin a body names, or the refusal text. */
      const grantableOrigin = (request: FastifyRequest, raw: unknown): { origin: string } | { error: string } => {
        const origin = typeof raw === "string" ? canonicalHttpsOrigin(raw) : null;
        if (!origin) return { error: "invalid origin" };
        return egress.isGrantable(origin, requestOriginsOf(request)) ? { origin } : { error: "origin cannot be allowed" };
      };

      // Allow an origin for ONE viewer (its re-mints included), nothing persisted.
      fastify.post<{ Params: { id: string }; Body: { tokenId?: unknown; viewerId?: unknown; origin?: unknown } }>(
        "/api/live-server/:id/allow-once",
        { preHandler: networkGuard },
        async (request, reply) => {
          const body = asRecord(request.body);
          const grant = ownTokenOf(request, reply, body.tokenId);
          if (!grant) return reply;
          const viewerId = body.viewerId;
          if (!isViewerId(viewerId)) return refuse(reply, grant.tokenId, "once", "invalid viewer");
          if (grant.viewerId !== viewerId) return refuse(reply, grant.tokenId, "once", "viewer does not own this preview");
          const named = grantableOrigin(request, body.origin);
          if ("error" in named) return refuse(reply, grant.tokenId, "once", named.error);
          capabilities.addAllowOnce(viewerId, named.origin);
          log("allow-once", { tokenId: grant.tokenId, origin: named.origin });
          return { success: true, ok: true };
        },
      );

      /** The route's reply for the registry's decision on a project-grant request. */
      const grantRequestReply = (reply: FastifyReply, tokenId: string, outcome: EgressGrantRequestOutcome) => {
        switch (outcome) {
          case "raised":
            return { success: true, ok: true };
          case "prompting-disabled":
            return { success: false, ok: false, reason: "prompting-disabled" };
          case "rate-limited":
            reply.code(429);
            return { success: false, ok: false, reason: "rate-limited" };
          case "not-promptable":
            return refuse(reply, tokenId, "project", "origin cannot be allowed");
          default:
            reply.code(503);
            return { success: false, ok: false, error: "could not ask right now" };
        }
      };

      /** A markup-detected, grantable origin of a static target that has a project, or the refusal text. */
      const projectGrantTarget = async (
        request: FastifyRequest,
        grant: NonNullable<ReturnType<LiveCapabilityStore["findByTokenId"]>>,
        rawOrigin: unknown,
      ): Promise<{ origin: string; projectKey: string } | { error: string }> => {
        const named = grantableOrigin(request, rawOrigin);
        if ("error" in named) return named;
        const projectKey = egress.projectKeyFor(grant);
        if (!projectKey) return { error: "this preview has no project" };
        const inMarkup = (await egress.markupOrigins(grant)).includes(named.origin);
        return inMarkup ? { origin: named.origin, projectKey } : { error: "origin was not found in the page markup" };
      };

      // "Allow for this project": on the operator's click, a deferred registry entry + the standard
      // dialog. Markup-detected origins of a STATIC target only (a page can forge runtime ones).
      fastify.post<{ Params: { id: string }; Body: { tokenId?: unknown; origin?: unknown } }>(
        "/api/live-server/:id/egress-grant-request",
        { preHandler: networkGuard },
        async (request, reply) => {
          const body = asRecord(request.body);
          const grant = ownTokenOf(request, reply, body.tokenId);
          if (!grant) return reply;
          const target = await projectGrantTarget(request, grant, body.origin);
          if ("error" in target) return refuse(reply, grant.tokenId, "project", target.error);
          if (!deps.requestEgressGrant || !promptingOn()) return { success: false, ok: false, reason: "prompting-disabled" };
          const channel = deps.channelOf?.(request) ?? request.ip;
          const outcome = await deps.requestEgressGrant({ ...target, channel });
          log("egress grant request", { tokenId: grant.tokenId, origin: target.origin, outcome });
          return grantRequestReply(reply, grant.tokenId, outcome);
        },
      );
}
