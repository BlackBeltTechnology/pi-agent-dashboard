/**
 * Local-proof bootstrap routes (always registered; strict mode or not).
 *
 * `POST /api/local-proof`   — admitted ONLY by a verified local credential (`X-Pi-Local-Proof`, or the legacy raw token); mints a one-time
 *                              code (60 s TTL, single use).
 * `GET  /auth/local-proof`  — redeems the code, sets the httpOnly `pi_dash_local`
 *                              proof cookie, redirects to `sanitizeReturnUrl(next)`
 *                              (same-origin path, else `/`).
 *
 * Used by `pi-dashboard open` and Electron so the same-desktop browser can prove
 * it is local under `requireLocalProof` and can approve pairings (D6).
 * See change: harden-trust-and-credential-boundaries (D2/D6); fix-pairing-approval-credential (D6).
 */
import type { FastifyInstance } from "fastify";
import { sanitizeReturnUrl } from "../auth/auth-plugin.js";
import { hasLocalCredential } from "../auth/local-credential.js";
import {
  LOCAL_PROOF_COOKIE,
  LOCAL_PROOF_MAX_AGE_S,
  type LocalProofCodeStore,
  type LocalTrustContext,
  signLocalProof,
} from "../auth/local-proof.js";

export function registerLocalProofRoutes(
  fastify: FastifyInstance,
  deps: { codes: LocalProofCodeStore; ctx: LocalTrustContext },
): void {
  fastify.post("/api/local-proof", async (request, reply) => {
    if (!hasLocalCredential(request.headers)) {
      reply.code(401);
      return { success: false as const, error: "local token required" };
    }
    return { success: true as const, data: { code: deps.codes.mint() } };
  });

  fastify.get("/auth/local-proof", async (request, reply) => {
    const query = (request.query as { code?: unknown; next?: unknown } | undefined) ?? {};
    const code = query.code;
    if (!deps.codes.redeem(code)) {
      reply.code(403);
      return { success: false as const, error: "invalid_or_expired_code" };
    }
    reply.setCookie(LOCAL_PROOF_COOKIE, signLocalProof(deps.ctx), {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      maxAge: LOCAL_PROOF_MAX_AGE_S,
    });
    // `next` is the one same-origin return-path predicate shared with the OAuth
    // `return` param: anything off-origin, with control chars, or non-string → `/`.
    return reply.redirect(sanitizeReturnUrl(query.next));
  });
}
