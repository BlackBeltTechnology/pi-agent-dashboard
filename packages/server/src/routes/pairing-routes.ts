/**
 * REST routes for server-identity challenge + device pairing.
 *
 * Route trust model:
 *  - Device-facing bootstrap routes (`/challenge`, `/redeem`, `/poll`) are
 *    PUBLIC (a pairing device has no credential yet). They are protected by the
 *    short-lived one-time code, rate-limiting, and the operator approval step —
 *    the code is NOT itself the credential (D6).
 *  - Dashboard routes (`/payload`, `/approve`, paired-device list/revoke)
 *    require an authenticated browser session (networkGuard). Approval (D12)
 *    additionally must not honor the loopback/tunnel exemption — realized fully
 *    once the D10 IPC allowlist lands (Phase C).
 */

import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import type { ServerIdentity } from "../auth/identity.js";
import { signNonce } from "../auth/identity.js";
import type { PairedDeviceRegistry, PairedDeviceView } from "../pairing/paired-devices.js";
import type { PairingManager } from "../pairing/pairing.js";
import { SUPPORTED_PAIRING_VERSIONS } from "../pairing/pairing.js";
import type { NetworkGuard } from "./route-deps.js";

/** URL prefixes of the PUBLIC device-facing pairing routes (auth-exempt). */
export const PUBLIC_PAIRING_PREFIXES = [
  "/api/pair/challenge",
  "/api/pair/redeem",
  "/api/pair/poll",
];

export function registerPairingRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    identity: ServerIdentity;
    pairing: PairingManager;
    registry: PairedDeviceRegistry;
  },
) {
  const { networkGuard, identity, pairing, registry } = deps;

  // ── Server-identity challenge (public) — Task 1.2 ──────────────────────
  // Client sends a nonce; server signs it so the client can verify against the
  // pinned public key and detect an impostor on a reused URL.
  fastify.post<{ Body: { nonce?: string } }>(
    "/api/pair/challenge",
    async (request, reply): Promise<ApiResponse<{ fingerprint: string; publicKey: string; signature: string; v: number }>> => {
      const nonce = request.body?.nonce;
      if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 512) {
        reply.code(400);
        return { success: false, error: "nonce must be an 8..512 char string" };
      }
      return {
        success: true,
        data: {
          fingerprint: identity.fingerprint,
          publicKey: identity.publicKeyB64,
          signature: signNonce(identity, nonce),
          v: Math.max(...SUPPORTED_PAIRING_VERSIONS),
        },
      };
    },
  );

  // ── Dashboard: mint a pairing payload (authenticated) — Task 2.3 ───────
  fastify.get(
    "/api/pair/payload",
    { preHandler: networkGuard },
    async (): Promise<ApiResponse<ReturnType<PairingManager["createPayload"]>>> => {
      const payload = pairing.createPayload();
      if (!payload) {
        return {
          success: false,
          error: "no_reachable_endpoint",
        };
      }
      return { success: true, data: payload };
    },
  );

  // ── Device: redeem a code → pending device + confirm code (public) ─────
  fastify.post<{ Body: { code?: string } }>(
    "/api/pair/redeem",
    async (request, reply): Promise<ApiResponse<{ pendingId: string; confirmCode: string }>> => {
      const code = request.body?.code;
      if (typeof code !== "string") {
        reply.code(400);
        return { success: false, error: "code required" };
      }
      const result = pairing.redeem(code);
      if (!result.ok) {
        reply.code(result.error === "rate_limited" ? 429 : 400);
        return { success: false, error: result.error };
      }
      return { success: true, data: { pendingId: result.pendingId, confirmCode: result.confirmCode } };
    },
  );

  // ── Dashboard: approve a pending device by typed confirm code (auth) ───
  // D12: active typed compare-and-match; authenticated session only.
  fastify.post<{ Body: { code?: string; confirmCode?: string; label?: string } }>(
    "/api/pair/approve",
    { preHandler: networkGuard },
    async (request, reply): Promise<ApiResponse<PairedDeviceView>> => {
      const { code, confirmCode, label } = request.body ?? {};
      if (typeof code !== "string" || typeof confirmCode !== "string") {
        reply.code(400);
        return { success: false, error: "code and confirmCode required" };
      }
      const result = pairing.approve(code, confirmCode, typeof label === "string" ? label : undefined);
      if (!result.ok) {
        reply.code(result.error === "locked_out" ? 429 : 400);
        return { success: false, error: result.error };
      }
      return { success: true, data: result.device };
    },
  );

  // ── Device: poll for approval + collect the bearer token (public) ──────
  fastify.post<{ Body: { pendingId?: string } }>(
    "/api/pair/poll",
    async (request, reply): Promise<ApiResponse<{ status: string; token?: string }>> => {
      const pendingId = request.body?.pendingId;
      if (typeof pendingId !== "string") {
        reply.code(400);
        return { success: false, error: "pendingId required" };
      }
      const result = pairing.poll(pendingId);
      return { success: true, data: result };
    },
  );

  // ── Dashboard: list + revoke paired devices (authenticated) — Task 6.1 ─
  fastify.get(
    "/api/paired-devices",
    { preHandler: networkGuard },
    async (): Promise<ApiResponse<PairedDeviceView[]>> => {
      return { success: true, data: registry.list() };
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/paired-devices/:id",
    { preHandler: networkGuard },
    async (request, reply): Promise<ApiResponse> => {
      const removed = registry.revoke(request.params.id);
      if (!removed) {
        reply.code(404);
        return { success: false, error: "device not found" };
      }
      return { success: true };
    },
  );
}
