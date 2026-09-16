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
import { isTier, TIERS } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type HostAdmissionOptions, isHostAdmitted } from "../auth/host-admission.js";
import type { ServerIdentity } from "../auth/identity.js";
import { signNonce } from "../auth/identity.js";
import { verifyLocalToken } from "../auth/local-token.js";
import { isGenuinelyLocal } from "../auth/localhost-guard.js";
import type { PairedDeviceRegistry, PairedDeviceView } from "../pairing/paired-devices.js";
import type { PairingManager } from "../pairing/pairing.js";
import { SUPPORTED_PAIRING_VERSIONS } from "../pairing/pairing.js";
import { localEndpoints } from "../tunnel/tunnel-endpoints.js";
import type { NetworkGuard } from "./route-deps.js";

/** Strip trailing slashes without a regex (avoids a polynomial-ReDoS shape). */
function stripTrailingSlashes(u: string): string {
  let end = u.length;
  while (end > 0 && u[end - 1] === "/") end -= 1;
  return u.slice(0, end);
}

/** URL prefixes of the PUBLIC device-facing pairing routes (auth-exempt). */
export const PUBLIC_PAIRING_PREFIXES = [
  "/api/pair/challenge",
  "/api/pair/redeem",
  "/api/pair/poll",
];

/**
 * Mint-label cap, in UTF-8 BYTES (not characters — `é` counts twice). The mint
 * route is the only caller that validates; `approve` is left as is (D4).
 */
export const MAX_DEVICE_LABEL_BYTES = 64;

/**
 * Operator guard for the token-mint route (D5).
 *
 * `networkGuard` is NOT enough here: it admits any paired-device bearer (so a
 * phone paired over a tunnel could mint unrevocable credentials past its own
 * revocation) and any trusted-network address with no credential at all. The
 * mint route admits exactly:
 *
 * 1. a dashboard login session (`authVia === "session"`), or
 * 2. a valid `X-Pi-Local-Token`, or
 * 3. `isGenuinelyLocal` — loopback with no forwarding headers, in ANY auth
 *    mode (the auth plugin already exempts such a request from login).
 *
 * AND, in every case, Host admission in ENFORCE semantics — regardless of the
 * global gate's report-only mode — closing the DNS-rebinding path that a
 * loopback-only check leaves open.
 */
export function createOperatorGuard(deps: {
  /** Expected `X-Pi-Local-Token` value; absent in most dev setups. */
  localToken?: string;
  /** Host-admission options, read LIVE per request. */
  hostAdmission: () => HostAdmissionOptions;
}) {
  return async function operatorGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const via = (request as any).authVia;
    const headers = request.headers as Record<string, unknown>;
    const isOperator =
      via === "session" ||
      (deps.localToken !== undefined && verifyLocalToken(headers, deps.localToken)) ||
      isGenuinelyLocal(request.ip, headers);
    if (!isOperator) {
      reply.code(401).send({ success: false, error: "operator credential required" });
      return;
    }
    if (!isHostAdmitted(request.headers.host, deps.hostAdmission())) {
      reply.code(403).send({ success: false, error: "host_not_admitted" });
      return;
    }
  };
}

export function registerPairingRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    identity: ServerIdentity;
    pairing: PairingManager;
    registry: PairedDeviceRegistry;
    /** `X-Pi-Local-Token` expected value, when configured. */
    localToken?: string;
    /** Host-admission options, read LIVE per request (D5 enforce semantics). */
    hostAdmission: () => HostAdmissionOptions;
    /**
     * Publicly-reachable base URLs (tunnel + configured public), already
     * TLS-gated by `PairingManager.reachableUrls()`. Used by
     * `GET /api/pair/reachable-urls`; defaults to the pairing manager's own
     * list so the browser Settings flow and the CLI share one source (D8).
     */
    getReachableUrls?: () => string[];
    /** Bound HTTP port, used to enumerate loopback/LAN endpoints. A thunk so
     * a `port: 0` server reports the real bound port per request. */
    getPort?: () => number;
  },
) {
  const { networkGuard, identity, pairing, registry, localToken, hostAdmission } = deps;
  const operatorGuard = createOperatorGuard({ localToken, hostAdmission });

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
  // Operator-only: a paired-DEVICE bearer must NOT approve a pairing, or it
  // could mint a second durable token that survives its own revocation
  // (CodeRabbit CWE-862). `operatorGuard` admits only a dashboard login session,
  // the local token, or a genuinely-local caller.
  fastify.post<{ Body: { code?: string; confirmCode?: string; label?: string; tier?: unknown } }>(
    "/api/pair/approve",
    { preHandler: operatorGuard },
    async (request, reply): Promise<ApiResponse<PairedDeviceView>> => {
      const { code, confirmCode, label, tier } = request.body ?? {};
      if (typeof code !== "string" || typeof confirmCode !== "string") {
        reply.code(400);
        return { success: false, error: "code and confirmCode required" };
      }
      if (tier !== undefined && !isTier(tier)) {
        reply.code(400);
        return { success: false, error: "invalid tier" };
      }
      const result = pairing.approve(
        code,
        confirmCode,
        typeof label === "string" ? label : undefined,
        isTier(tier) ? tier : undefined,
      );
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

  // ── Dashboard: mint a device token for an MCP client (operator-only) ──
  // Deliberately NOT in PUBLIC_PAIRING_PREFIXES: this route issues durable
  // credentials and requires an operator credential, not a pairing code (D5).
  fastify.post<{ Body: { label?: unknown; tier?: unknown } }>(
    "/api/paired-devices",
    { preHandler: operatorGuard },
    async (request, reply): Promise<ApiResponse<{ device: PairedDeviceView; token: string }>> => {
      const label = request.body?.label;
      const tier = request.body?.tier;
      if (typeof label !== "string") {
        reply.code(400);
        return { success: false, error: "label must be a string" };
      }
      // Validate the tier BEFORE touching the registry, so a refused request
      // never leaves a row behind (E6).
      if (tier !== undefined && !isTier(tier)) {
        reply.code(400);
        return { success: false, error: `tier must be one of ${TIERS.join(", ")}` };
      }
      const trimmed = label.trim();
      if (trimmed.length === 0 || Buffer.byteLength(trimmed, "utf8") > MAX_DEVICE_LABEL_BYTES) {
        reply.code(400);
        return {
          success: false,
          error: `label must be 1..${MAX_DEVICE_LABEL_BYTES} UTF-8 bytes`,
        };
      }
      // The plaintext token rides this ONE response and is never retrievable
      // again (D4) — same plaintext-once semantics as the pairing ceremony.
      // No tier → the manual source default (`observe`, D1).
      return { success: true, data: registry.add(trimmed, "manual", isTier(tier) ? tier : undefined) };
    },
  );

  // ── Dashboard: reachable base URLs for an agent client (D8) ────────────
  // The one `/api/pair/*` route with an MCP tool (`get_reachable_urls`): it
  // merges the public URLs the pairing payload already exposes with this
  // host's loopback + LAN endpoints, so a snippet minted in Settings works from
  // the machine that will run the agent. Not a public pairing prefix — it reads
  // addresses, it does not participate in the ceremony.
  fastify.get(
    "/api/pair/reachable-urls",
    { preHandler: networkGuard },
    async (): Promise<ApiResponse<string[]>> => {
      const publicUrls = deps.getReachableUrls?.() ?? pairing.reachableUrls();
      const local = localEndpoints(deps.getPort?.() ?? 0).map((e) => e.url);
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const raw of [...publicUrls, ...local]) {
        const url = stripTrailingSlashes(raw.trim());
        if (url.length === 0 || seen.has(url)) continue;
        seen.add(url);
        merged.push(url);
      }
      return { success: true, data: merged };
    },
  );
}
