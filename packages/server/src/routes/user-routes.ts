/**
 * Operator user-directory routes `/api/users*` (passkey-user-auth › User
 * directory, › Invite by QR, › Primary switch warns; tasks 4B.2, 4B.4, 3.2).
 *
 * Every route carries `operatorGuard` (pairing-routes): a paired-device bearer
 * is refused outright; a login session, the local token, or a genuinely-local
 * caller is admitted, with Host admission in enforce semantics. The REST
 * route-tier gate additionally refuses a session below `operate` (all rows are
 * `operate` in `ROUTE_TIERS`).
 *
 * First-user bootstrap: with an EMPTY directory only a genuinely-local caller
 * (loopback without forwarding headers, or the local token) may create a user,
 * and it is always `operate`. A remote session is refused
 * `403 bootstrap_local_only`.
 *
 * Responses never carry credential ids, invite tokens (except the one-time
 * mint response), or token hashes.
 *
 * See change: add-passkey-user-auth.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { HostAdmissionOptions } from "../auth/host-admission.js";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { verifyLocalToken } from "../auth/local-token.js";
import { isLocallyTrusted } from "../auth/localhost-guard.js";
import { logPasskey } from "../auth/passkey/passkey-log.js";
import { qrDataUrl } from "../auth/passkey/passkey-routes.js";
import { PasskeyError, type PasskeyService } from "../auth/passkey/passkey-service.js";
import { MAX_INVITE_USES, type DirectoryUser } from "../auth/passkey/user-directory.js";
import { createOperatorGuard } from "./pairing-routes.js";

export interface UserRouteDeps {
  service: PasskeyService;
  localToken?: string;
  localTrust?: LocalTrustContext;
  hostAdmission: () => HostAdmissionOptions;
  log?: (line: string) => void;
}

const MAX_INVITE_TTL_HOURS = 168;

/** Public view: no credential ids, no token hashes, live invites only. */
function userView(u: DirectoryUser, currentRpId: string, now = Date.now()) {
  return {
    id: u.id,
    name: u.name,
    tier: u.tier,
    status: u.status,
    createdAt: u.createdAt,
    credentials: u.credentials.map((c) => ({
      rpId: c.rpId,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      orphaned: c.rpId !== currentRpId,
    })),
    invites: u.invites
      .filter((i) => !i.revoked && i.uses < i.maxUses && i.expiresAt > now)
      .map((i) => ({ id: i.id, createdAt: i.createdAt, expiresAt: i.expiresAt, uses: i.uses, maxUses: i.maxUses })),
  };
}

export function registerUserRoutes(fastify: FastifyInstance, deps: UserRouteDeps): void {
  const { service } = deps;
  const { directory } = service;
  const log = deps.log ?? ((l: string) => console.log(l));
  const operatorGuard = createOperatorGuard({
    localToken: deps.localToken,
    hostAdmission: deps.hostAdmission,
    localTrust: deps.localTrust,
  });
  const isGenuineLocal = (request: FastifyRequest): boolean => {
    const headers = request.headers as Record<string, unknown>;
    return (
      (deps.localToken !== undefined && verifyLocalToken(headers, deps.localToken)) ||
      isLocallyTrusted({ ip: request.ip, headers }, deps.localTrust)
    );
  };
  const requireEnabled = (reply: FastifyReply): boolean => {
    if (service.isEnabled()) return true;
    reply.code(409).send({ success: false, error: "passkeys_disabled" });
    return false;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof PasskeyError) return reply.code(err.status).send({ success: false, error: err.code });
    const message = (err as Error)?.message ?? "error";
    return reply.code(message === "unknown user" ? 404 : 400).send({ success: false, error: message });
  };
  const body = (request: FastifyRequest): Record<string, unknown> =>
    request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
  const idParam = (request: FastifyRequest, key: string): string => String((request.params as Record<string, unknown>)[key] ?? "");

  fastify.get("/api/users", { preHandler: operatorGuard }, async () => {
    const rp = service.rpContext();
    return {
      success: true,
      data: {
        enabled: service.isEnabled(),
        rp: { rpId: rp.rpId, rpOrigin: rp.rpOrigin, stable: rp.stable, ...(rp.reason ? { reason: rp.reason } : {}) },
        bootstrapRequired: directory.isEmpty(),
        users: directory.list().map((u) => userView(u, rp.rpId)),
      },
    };
  });

  fastify.post("/api/users", { preHandler: operatorGuard }, async (request, reply) => {
    if (!requireEnabled(reply)) return reply;
    const b = body(request);
    try {
      if (directory.isEmpty()) {
        if (!isGenuineLocal(request)) return reply.code(403).send({ success: false, error: "bootstrap_local_only" });
        const user = await directory.bootstrap({ name: b.name });
        return { success: true, data: userView(user, service.rpContext().rpId) };
      }
      const user = await directory.create({ name: b.name, tier: b.tier });
      return { success: true, data: userView(user, service.rpContext().rpId) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.patch("/api/users/:id", { preHandler: operatorGuard }, async (request, reply) => {
    if (!requireEnabled(reply)) return reply;
    try {
      const user = await directory.setTier(idParam(request, "id"), body(request).tier);
      return { success: true, data: userView(user, service.rpContext().rpId) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post("/api/users/:id/revoke", { preHandler: operatorGuard }, async (request, reply) => {
    try {
      const user = await directory.revoke(idParam(request, "id"));
      logPasskey("revoked", user.id, log);
      return { success: true, data: userView(user, service.rpContext().rpId) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post("/api/users/:id/invites", { preHandler: operatorGuard }, async (request, reply) => {
    if (!requireEnabled(reply)) return reply;
    const b = body(request);
    const ttlHours = b.ttlHours === undefined ? 24 : Number(b.ttlHours);
    const maxUses = b.maxUses === undefined ? 1 : Number(b.maxUses);
    if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > MAX_INVITE_TTL_HOURS) {
      return reply.code(400).send({ success: false, error: `ttlHours must be 1..${MAX_INVITE_TTL_HOURS}` });
    }
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES) {
      return reply.code(400).send({ success: false, error: `maxUses must be 1..${MAX_INVITE_USES}` });
    }
    try {
      const rp = service.requireStable();
      const { token, invite } = await directory.mintInvite(idParam(request, "id"), { ttlMs: ttlHours * 3600_000, maxUses });
      logPasskey("invite_created", invite.id, log);
      const url = `${rp.rpOrigin}/auth/invite#${token}`;
      reply.header("cache-control", "no-store");
      return {
        success: true,
        data: { inviteId: invite.id, url, qrDataUrl: await qrDataUrl(url), expiresAt: invite.expiresAt, maxUses: invite.maxUses },
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.delete("/api/users/invites/:inviteId", { preHandler: operatorGuard }, async (request, reply) => {
    const ok = await directory.revokeInvite(idParam(request, "inviteId"));
    if (!ok) return reply.code(404).send({ success: false, error: "unknown invite" });
    return { success: true };
  });

  fastify.get("/api/users/credentials/impact", { preHandler: operatorGuard }, async (request, reply) => {
    const q = request.query as { rpId?: unknown; url?: unknown };
    let next = typeof q.rpId === "string" ? q.rpId.trim().toLowerCase() : "";
    if (!next && typeof q.url === "string") {
      try {
        next = new URL(q.url).hostname;
      } catch {
        next = "";
      }
    }
    if (!next || next.length > 253) return reply.code(400).send({ success: false, error: "rpId or url required" });
    const current = service.rpContext().rpId;
    return { success: true, data: { currentRpId: current, nextRpId: next, ...directory.impact(current, next) } };
  });
}
