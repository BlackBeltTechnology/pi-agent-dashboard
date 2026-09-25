/**
 * Core resolver-dispatch `onRequest` hook (openspec §4.3 / design D2).
 *
 * Registered AFTER `registerBearerAuth` and BEFORE `registerAuthPlugin`, at a
 * fixed position, reading the mutable `ResolverRegistry` so plugin load order
 * is irrelevant. Behavior:
 *   - INERT (no resolver registered) → returns immediately; `request.principal`
 *     stays null, `isAuthenticated` untouched — byte-for-byte as before.
 *   - already authenticated as a DEVICE (opaque paired-device bearer) → the
 *     device is not a person; we still run resolution only if a bearer could
 *     also carry a human principal, but a device token is not a Keycloak token
 *     so it resolves to `null` and `principal` stays null.
 *   - a CLAIM → sets `request.principal`, `request.principalExpiresAt`,
 *     `request.isAuthenticated = true`, `request.authVia = "principal"`.
 *   - a REJECT → 401 immediately (owned-invalid credential).
 *   - NONE → continue; the later cookie hook runs as today.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildAuthContext } from "./auth-context.js";
import { dispatchResolvers } from "./dispatch.js";
import type { ResolverRegistry } from "./resolver-registry.js";

export interface ResolverHookDeps {
  registry: ResolverRegistry;
  /** Identity enforced? (D21 — resolver active AND login provider registered). */
  isEnforced: () => boolean;
  /** Per-resolver timeout (ms) — config `identity.resolverTimeoutMs`. */
  timeoutMs: number;
  /** Configured public base URL for canonical `htu` (D6a); null → Host header. */
  getPublicBase: () => string | null | undefined;
  log?: (msg: string) => void;
}

/** Register the resolver-dispatch onRequest branch. */
export function registerResolverHook(fastify: FastifyInstance, deps: ResolverHookDeps): void {
  for (const [name, init] of [
    ["principal", null],
    ["principalExpiresAt", null],
  ] as const) {
    if (!fastify.hasRequestDecorator?.(name)) {
      try {
        fastify.decorateRequest(name, init);
      } catch {
        /* already decorated */
      }
    }
  }

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Inert (D21): identity not enforced ⇒ make no claim.
    if (!deps.isEnforced()) return;
    const authState = request as { principal?: unknown; isAuthenticated?: boolean; authVia?: string };
    // A paired-device bearer is a device, never a human principal (D2). Do not
    // let any resolver reinterpret an already-verified device credential.
    if (authState.isAuthenticated && authState.authVia === "device") return;
    // A prior principal claim already resolved this request (defensive).
    if (authState.principal != null) return;

    const ctx = buildAuthContext(
      {
        method: request.method,
        url: request.url,
        ip: request.ip,
        headers: request.headers as Record<string, string | string[] | undefined>,
        isAuthenticated: (request as { isAuthenticated?: boolean }).isAuthenticated,
      },
      deps.getPublicBase(),
    );

    const result = await dispatchResolvers(ctx, {
      resolvers: deps.registry.ordered(),
      timeoutMs: deps.timeoutMs,
      log: deps.log,
    });

    if (result.kind === "reject") {
      deps.log?.(`[identity] resolver '${result.pluginId}' rejected an owned credential; 401`);
      reply.code(401).send({ error: "invalid_credential" });
      return reply;
    }

    if (result.kind === "claim") {
      const r = request as {
        principal?: unknown;
        principalExpiresAt?: unknown;
        isAuthenticated?: boolean;
        authVia?: string;
      };
      r.principal = result.resolution.principal;
      r.principalExpiresAt = result.resolution.expiresAt;
      r.isAuthenticated = true;
      r.authVia = "principal";
    }
    // kind === "none": leave request untouched; cookie hook runs as today.
  });
}
