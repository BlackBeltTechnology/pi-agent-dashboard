/**
 * Local-proof bootstrap routes (always registered; strict mode or not).
 *
 * `POST /api/local-proof`   — admitted ONLY by `X-Pi-Local-Token`; mints a one-time
 *                              code (60 s TTL, single use).
 * `GET  /auth/local-proof`  — redeems the code, sets the httpOnly `pi_dash_local`
 *                              proof cookie, redirects to `/`.
 *
 * Used by `pi-dashboard open` and Electron so the same-desktop browser can prove
 * it is local under `requireLocalProof` and can approve pairings (D6).
 * See change: harden-trust-and-credential-boundaries (D2/D6).
 */
import type { FastifyInstance } from "fastify";
import {
  LOCAL_PROOF_COOKIE,
  LOCAL_PROOF_MAX_AGE_S,
  type LocalProofCodeStore,
  type LocalTrustContext,
  signLocalProof,
} from "../auth/local-proof.js";
import { verifyLocalToken } from "../auth/local-token.js";

export function registerLocalProofRoutes(
  fastify: FastifyInstance,
  deps: { codes: LocalProofCodeStore; ctx: LocalTrustContext },
): void {
  fastify.post("/api/local-proof", async (request, reply) => {
    if (!verifyLocalToken(request.headers as Record<string, unknown>, deps.ctx.localToken)) {
      reply.code(401);
      return { success: false as const, error: "local token required" };
    }
    return { success: true as const, data: { code: deps.codes.mint() } };
  });

  fastify.get("/auth/local-proof", async (request, reply) => {
    const code = (request.query as { code?: unknown } | undefined)?.code;
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
    return reply.redirect("/");
  });
}
