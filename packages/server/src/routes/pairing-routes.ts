/**
 * REST routes for server-identity challenge + device pairing.
 *
 * Route trust model:
 *  - Device-facing bootstrap routes (`/challenge`, `/redeem`, `/poll`) are
 *    PUBLIC (a pairing device has no credential yet). They are protected by the
 *    short-lived one-time code, rate-limiting, and the operator approval step —
 *    the code is NOT itself the credential (D6).
 *  - Dashboard routes (`/payload`, `/approve`, paired-device list/revoke)
 *    require an OPERATOR credential (`operatorGuard`): a login session, a
 *    valid `X-Pi-Local-Token`, or a genuinely-local caller. A paired-device
 *    bearer is refused outright (401) regardless of network position — a
 *    device must never mint, approve, or revoke (harden-server-request-surfaces
 *    D2).
 */

import type { TLSSocket } from "node:tls";
import type { PairPollData } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { isTier, TIERS } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/tls-only-token.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { describeApprovalRefusal } from "../auth/approval-refusal.js";
import { auditLine, auditPrefix, auditRequestFields } from "../auth/audit-log.js";
import { parseBearerHeader, ROTATE_ROUTE } from "../auth/bearer-auth.js";
import { type HostAdmissionOptions, isHostAdmitted } from "../auth/host-admission.js";
import type { ServerIdentity } from "../auth/identity.js";
import { signNonce } from "../auth/identity.js";
import { hasLocalCredential } from "../auth/local-credential.js";
import { bearerChannelOf, isProvenChannel } from "../auth/proven-tls.js";
import { createLocalTrustContext, hasLocalProof, type LocalTrustContext } from "../auth/local-proof.js";
import { isLocallyTrusted, type LanInterface } from "../auth/localhost-guard.js";
import {
  admitKnock,
  createRefusalLogger,
  headerString,
  KnockLimiter,
  knockPeerInput,
  knockPeerState,
} from "../pairing/knock-admission.js";
import { BRIDGE_TOKEN_REQUIRES_HTTPS, type PairedDeviceRegistry, type PairedDeviceView } from "../pairing/paired-devices.js";
import type { ApproveResult, PairingManager, PendingDeviceView } from "../pairing/pairing.js";
import { SUPPORTED_PAIRING_VERSIONS } from "../pairing/pairing.js";
import { localEndpoints } from "../tunnel/tunnel-endpoints.js";
import type { NetworkGuard } from "./route-deps.js";

/**
 * The `https:` origins of the reachable list, de-duplicated, in order. `wss://`
 * and the `PI_E2E_SEED` loopback `http` origin that `reachableUrls()` admits for
 * the QR payload are NOT routes. See change: group-servers-by-identity (D7).
 */
function httpsOrigins(urls: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol === "https:" && !out.includes(url.origin)) out.push(url.origin);
  }
  return out;
}

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
  // Device-initiated knock: public like `redeem`; the admission gates in
  // `admitKnock` (not the network guard) decide. See change: add-lan-knock-pairing.
  "/api/pair/request",
];

/**
 * Device-label cap, in UTF-8 BYTES (not characters — `é` counts twice).
 * Validated by the mint route AND the approve route (harden D2).
 */
export const MAX_DEVICE_LABEL_BYTES = 64;

/** Trimmed label when it is a 1..MAX_DEVICE_LABEL_BYTES UTF-8 string, else null. */
function validLabel(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (trimmed.length === 0 || Buffer.byteLength(trimmed, "utf8") > MAX_DEVICE_LABEL_BYTES) return null;
  return trimmed;
}

/** Map a failed approve to status + body; `mismatch` carries `attemptsLeft` (D2). */
function approveFailure(
  result: Exclude<ApproveResult, { ok: true }>,
  reply: FastifyReply,
): ApiResponse<never> & { attemptsLeft?: number } {
  reply.code(result.error === "locked_out" ? 429 : result.error === "no_pending" ? 404 : 400);
  return result.error === "mismatch"
    ? { success: false, error: result.error, attemptsLeft: result.attemptsLeft }
    : { success: false, error: result.error };
}

/**
 * Operator guard for the credential-bearing pairing routes (D5): mint,
 * approve, pending list, deny, revoke.
 *
 * `networkGuard` is NOT enough here: it admits any paired-device bearer (so a
 * phone paired over a tunnel could mint unrevocable credentials past its own
 * revocation) and any trusted-network address with no credential at all. A
 * request whose ONLY credential is a paired-device bearer (`authVia ===
 * "device"`) is refused 401 BEFORE any admission clause — independent of the
 * caller's network position (harden D2). Otherwise the guard admits exactly:
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
  /** Strict local-proof context (`requireLocalProof`). */
  localTrust?: LocalTrustContext;
}) {
  return async function operatorGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const via = (request as any).authVia;
    // A paired-device bearer is NEVER an operator credential — refuse it on
    // the strength of the credential alone, before the loopback exemption
    // could admit it (harden D2).
    if (via === "device") {
      reply.code(401).send({ success: false, error: "operator credential required" });
      return;
    }
    const headers = request.headers as Record<string, unknown>;
    const isOperator =
      via === "session" ||
      (deps.localToken !== undefined && hasLocalCredential(headers)) ||
      isLocallyTrusted({ ip: request.ip, headers }, deps.localTrust);
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

/**
 * Approval guard for `POST /api/pair/approve` and `/approve-pending` (D6).
 *
 * Stricter than {@link createOperatorGuard}: NO bare-loopback branch in any mode
 * (the `qr-device-pairing` spec: approval honors no loopback/tunnel exemption).
 * Admits a login session, a valid local-proof cookie, or a valid
 * `X-Pi-Local-Token`; a device bearer is refused first; Host admission in
 * enforce semantics. See change: harden-trust-and-credential-boundaries (D6).
 */
function createApprovalGuard(deps: {
  localToken?: string;
  hostAdmission: () => HostAdmissionOptions;
  localTrust?: LocalTrustContext;
  /** Live "is a usable login method configured" check (drives the `sign-in` remedy). */
  loginAvailable?: () => boolean;
  /** The server's configured port, read per refusal (drives the `authorize-browser` remedy). */
  getConfigPort?: () => number;
}) {
  const proofCtx = deps.localTrust ?? (deps.localToken ? createLocalTrustContext(deps.localToken, () => false) : undefined);
  /**
   * The 401 body. `reason`/`remedies` are attached only when the request's Host is
   * admitted (same predicate and options as the 403 check below), so a non-admitted
   * Host still gets the legacy two-key body. Best-effort: a failure here never
   * turns the 401 into a 5xx. See change: fix-pairing-approval-credential (D5).
   */
  const refusalBody = (request: FastifyRequest) => {
    const legacy = { success: false as const, error: "operator credential required" as const };
    try {
      const refusal = describeApprovalRefusal(request, {
        hostAdmitted: isHostAdmitted(request.headers.host, deps.hostAdmission()),
        loginAvailable: deps.loginAvailable,
        configPort: deps.getConfigPort?.(),
        localTrust: proofCtx,
      });
      return refusal ? { ...legacy, ...refusal } : legacy;
    } catch {
      return legacy;
    }
  };
  return async function approvalGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const via = (request as any).authVia;
    if (via === "device") {
      reply.code(401).send(refusalBody(request));
      return;
    }
    const headers = request.headers as Record<string, unknown>;
    const ok = via === "session" || (proofCtx !== undefined && hasLocalProof(headers, proofCtx));
    if (!ok) {
      reply.code(401).send(refusalBody(request));
      return;
    }
    if (!isHostAdmitted(request.headers.host, deps.hostAdmission())) {
      reply.code(403).send({ success: false, error: "host_not_admitted" });
      return;
    }
  };
}

/**
 * `POST /api/paired-devices/rotate` — a browser-held device bearer rotates ITSELF.
 *
 * Authenticated ONLY by `Authorization: Bearer`: a cookie, local proof, operator
 * session or nothing is 401 `bearer_required`, and any device id in the body is
 * ignored (the bearer identifies the row). Deliberately no `networkGuard`: the
 * bearer is the sole credential, so no network position can stand in for it.
 * The registry does the work synchronously (no await between verify and write),
 * so two same-tick rotations with one bearer serialise (second → 409
 * `bearer_superseded`). Success returns `{token, expiresAt}` with `no-store`.
 * An EXPIRED bearer is refused earlier by the bearer hook (401 `bearer_expired`).
 * See change: harden-auth-credentials (D5).
 */
export function registerBearerRotateRoute(fastify: FastifyInstance, deps: { registry: PairedDeviceRegistry }): void {
  const { registry } = deps;
  fastify.post<{ Body: unknown }>(ROTATE_ROUTE, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const presented = parseBearerHeader(request.headers.authorization);
    if (!presented) {
      reply.code(401);
      return { success: false, error: "bearer_required", code: "bearer_required" };
    }
    const body = request.body;
    // Only the exact string "browser" is a declaration; anything else is none (A-G11).
    const declared =
      body !== null && typeof body === "object" && (body as Record<string, unknown>).holder === "browser";
    const result = registry.rotate(presented, declared, { channel: bearerChannelOf(request.raw) });
    if (result.ok) {
      auditLine("pairing", "rotated", { id: auditPrefix(result.id), ip: request.ip });
      return { token: result.token, expiresAt: result.expiresAt };
    }
    const refuse = (status: number, code: string) => {
      if (result.id !== undefined) {
        auditLine("pairing", "rotate_refused", { id: auditPrefix(result.id), reason: code, ip: request.ip });
      }
      reply.code(status);
      return { success: false, error: code, code };
    };
    switch (result.reason) {
      case "expired":
        return refuse(401, "bearer_expired");
      case "superseded":
        return refuse(409, "bearer_superseded");
      case "holder_declaration_required":
        return refuse(409, "holder_declaration_required");
      case "persist_failed":
        return refuse(500, "rotation_failed");
      case "tls_only_untrusted_channel":
        return refuse(401, TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL);
      case "rate_limited":
        reply.header("Retry-After", String(result.retryAfterS ?? 60));
        return refuse(429, "rate_limited");
      default:
        // Unknown / revoked / superseded-after-grace: a plain 401, byte-equal to every other route's.
        reply.code(401);
        return { success: false, error: "unauthorized" };
    }
  });
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
    /** Strict local-proof context (`requireLocalProof`). */
    localTrust?: LocalTrustContext;
    /** Host-admission options, read LIVE per request (D5 enforce semantics). */
    hostAdmission: () => HostAdmissionOptions;
    /**
     * Publicly-reachable base URLs (tunnel + configured public), already
     * TLS-gated by `PairingManager.reachableUrls()`. Used by
     * `GET /api/pair/reachable-urls`; defaults to the pairing manager's own
     * list so the browser Settings flow and the CLI share one source (D8).
     */
    getReachableUrls?: () => string[];
    /** Certificate-backed `https://` URLs of the native TLS listener (named in a refused bridge-token issue). */
    getTlsListenerUrls?: () => string[];
    /** Bound HTTP port, used to enumerate loopback/LAN endpoints. A thunk so
     * a `port: 0` server reports the real bound port per request. */
    getPort?: () => number;
    /**
     * Live "is a usable login method configured" check — the same instance the vault
     * and services routes receive. Absent ⇒ the approval refusal omits `sign-in`.
     * See change: fix-pairing-approval-credential (D5).
     */
    loginAvailable?: () => boolean;
    /** Live `pairing.acceptLanRequests` (read per request, no restart). Absent = off. */
    getAcceptLanRequests?: () => boolean;
    /** Non-internal interface addresses the server's bind covers (for the on-link gate). */
    getLanInterfaces?: () => LanInterface[];
    /** Raw configured list for the knock address rule's list branch (both trust modes). See change: retire-trusted-networks-bypass (D7). */
    getKnockEligibleNetworks?: () => string[];
    /** Injectable limiter / refusal logger (tests). */
    knockLimiter?: KnockLimiter;
    logKnockRefusal?: ReturnType<typeof createRefusalLogger>;
  },
) {
  const { networkGuard, identity, pairing, registry, localToken, hostAdmission } = deps;
  const operatorGuard = createOperatorGuard({ localToken, hostAdmission, localTrust: deps.localTrust });
  const approvalGuard = createApprovalGuard({
    localToken,
    hostAdmission,
    localTrust: deps.localTrust,
    loginAvailable: deps.loginAvailable,
    getConfigPort: deps.getPort,
  });
  const knockLimiter = deps.knockLimiter ?? new KnockLimiter();
  const logKnockRefusal = deps.logKnockRefusal ?? createRefusalLogger();
  // Denial / lockout start the source's cooldown; approve + expiry do not (D12).
  // Guarded: many route tests hand in a partially-stubbed manager; a real
  // PairingManager always has the subscription.
  if (typeof pairing.onKnockResolved === "function") {
    pairing.onKnockResolved((sourceKey, outcome) => knockLimiter.onResolved(sourceKey, outcome));
  }

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
  fastify.post<{ Body: { code?: string; holder?: unknown } }>(
    "/api/pair/redeem",
    async (request, reply): Promise<ApiResponse<{ pendingId: string; confirmCode: string }>> => {
      const code = request.body?.code;
      if (typeof code !== "string") {
        reply.code(400);
        return { success: false, error: "code required" };
      }
      // Redeemer metadata is untrusted display text for the operator dialog;
      // the manager bounds it and never uses it for a decision (D4).
      const result = pairing.redeem(code, {
        userAgent: headerString(request.headers["user-agent"]),
        host: headerString(request.headers.host),
        remoteAddress: request.ip,
        forwardedFor: headerString(request.headers["x-forwarded-for"]),
        // Only the exact string "browser" is a holder declaration (the manager enforces it).
        holder: request.body?.holder,
      });
      if (!result.ok) {
        reply.code(result.error === "rate_limited" ? 429 : 400);
        return { success: false, error: result.error };
      }
      return { success: true, data: { pendingId: result.pendingId, confirmCode: result.confirmCode } };
    },
  );

  // ── Device: knock — ask the dashboard for access (public, admission-gated) ─
  // Not `operatorGuard` (it 401s every non-operator) and not `networkGuard`: the
  // caller has no credential by definition. The foreign-origin CSRF gate and the
  // JSON body parser already ran; `admitKnock` evaluates Host admission (enforce
  // semantics), the LAN gates, the switch and the limits. Admission uses the
  // SOCKET peer address — never `request.ip` — and that same address is recorded
  // as the pending device's remote address.
  fastify.post<{ Body: { name?: unknown; holder?: unknown } | null }>(
    "/api/pair/request",
    async (
      request,
      reply,
    ): Promise<
      ApiResponse<{ pendingId: string; confirmCode: string; expiresAt: number; fingerprint: string }> & {
        retryAfter?: number;
      }
    > => {
      // Fastify's default parsers also accept `text/plain` (a CORS "simple"
      // content type that needs no preflight), so the JSON-only rule is enforced
      // here, ahead of every gate: a body that is not JSON is 415.
      const contentType = headerString(request.headers["content-type"]);
      if (contentType !== undefined && !/^application\/json\b/i.test(contentType)) {
        reply.code(415);
        return { success: false, error: "unsupported_media_type" };
      }
      const decision = admitKnock(
        knockPeerInput(request),
        {
          ...knockPeerState({
            hostAdmission,
            getLanInterfaces: deps.getLanInterfaces ?? (() => []),
            getKnockEligibleNetworks: deps.getKnockEligibleNetworks,
          }),
          acceptLanRequests: deps.getAcceptLanRequests?.() === true,
          liveKnocks: pairing.liveKnocks(),
          limiter: knockLimiter,
        },
      );
      if (!decision.ok) {
        logKnockRefusal(decision.error);
        reply.code(decision.status);
        return decision.retryAfter === undefined
          ? { success: false, error: decision.error }
          : { success: false, error: decision.error, retryAfter: decision.retryAfter };
      }
      const result = pairing.knock({
        sourceKey: decision.sourceKey,
        name: request.body?.name,
        unencrypted: !(request.raw.socket as TLSSocket).encrypted,
        meta: {
          userAgent: headerString(request.headers["user-agent"]),
          host: headerString(request.headers.host),
          remoteAddress: decision.sourceKey,
          holder: request.body?.holder,
        },
      });
      return {
        success: true,
        data: {
          pendingId: result.pendingId,
          confirmCode: result.confirmCode,
          expiresAt: result.expiresAt,
          fingerprint: identity.fingerprint,
        },
      };
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
    { preHandler: approvalGuard },
    async (request, reply): Promise<ApiResponse<PairedDeviceView>> => {
      const { code, confirmCode, tier } = request.body ?? {};
      if (typeof code !== "string" || typeof confirmCode !== "string") {
        reply.code(400);
        return { success: false, error: "code and confirmCode required" };
      }
      if (tier !== undefined && !isTier(tier)) {
        reply.code(400);
        return { success: false, error: "invalid tier" };
      }
      // Label bound, mirroring the mint route (harden D2): a SUPPLIED
      // non-string label is 400 — never silently treated as absent — and a
      // string is trimmed, refused when empty or over MAX_DEVICE_LABEL_BYTES
      // UTF-8 bytes. Only a genuinely absent key keeps the pending label.
      // Validated HERE, not in PairingManager: the bound is transport-level.
      const body = request.body as Record<string, unknown> | null | undefined;
      let label: string | undefined;
      if (body !== null && typeof body === "object" && "label" in body) {
        if (typeof body.label !== "string") {
          reply.code(400);
          return { success: false, error: "label must be a string" };
        }
        const trimmed = validLabel(body.label);
        if (trimmed === null) {
          reply.code(400);
          return { success: false, error: `label must be 1..${MAX_DEVICE_LABEL_BYTES} UTF-8 bytes` };
        }
        label = trimmed;
      }
      const result = pairing.approve(code, confirmCode, label, isTier(tier) ? tier : undefined);
      if (!result.ok) {
        // Status codes unchanged for this route (no_pending stays 400); a
        // mismatch additionally carries `attemptsLeft` (additive, D2).
        reply.code(result.error === "locked_out" ? 429 : 400);
        return result.error === "mismatch"
          ? ({ success: false, error: result.error, attemptsLeft: result.attemptsLeft } as ApiResponse<PairedDeviceView>)
          : { success: false, error: result.error };
      }
      return { success: true, data: result.device };
    },
  );

  // ── Dashboard: pending-request feed for the app-wide approval dialog ───
  // Operator-only (never networkGuard, which admits a paired-device bearer):
  // the list carries redeemer UA/IP/host. Never a pairing or confirm code (R5).
  fastify.get(
    "/api/pair/pending",
    { preHandler: operatorGuard },
    async (): Promise<ApiResponse<PendingDeviceView[]>> => ({ success: true, data: pairing.listPending() }),
  );

  // ── Dashboard: approve by pendingId (typed confirm code, operator-only) ─
  fastify.post<{ Body: { pendingId?: unknown; confirmCode?: unknown; label?: unknown; tier?: unknown } }>(
    "/api/pair/approve-pending",
    { preHandler: approvalGuard },
    async (request, reply): Promise<ApiResponse<PairedDeviceView> & { attemptsLeft?: number }> => {
      const { pendingId, confirmCode, label, tier } = request.body ?? {};
      if (typeof pendingId !== "string" || typeof confirmCode !== "string") {
        reply.code(400);
        return { success: false, error: "pendingId and confirmCode required" };
      }
      // An optional tier is validated BEFORE delegating, so a refused tier
      // leaves the pending device pending (and spends no approval attempt).
      // Absent → the pairing default. See change: add-lan-knock-pairing (D7).
      if (tier !== undefined && !isTier(tier)) {
        reply.code(400);
        return { success: false, error: "invalid tier" };
      }
      // Validate the label BEFORE delegating so a refused name never pairs (D2).
      const name = label === undefined ? undefined : validLabel(label);
      if (name === null) {
        reply.code(400);
        return { success: false, error: `label must be 1..${MAX_DEVICE_LABEL_BYTES} UTF-8 bytes` };
      }
      const result = pairing.approvePending(pendingId, confirmCode, name, isTier(tier) ? tier : undefined);
      if (!result.ok) return approveFailure(result, reply);
      return { success: true, data: result.device };
    },
  );

  // ── Dashboard: deny a pending device (approval credential, D3/D11) ────
  // Same guard as approve: "Denial SHALL require the same operator authentication
  // as approval" — a bare-loopback caller must not burn a pairing code.
  fastify.post<{ Body: { pendingId?: unknown } }>(
    "/api/pair/deny",
    { preHandler: approvalGuard },
    async (request, reply): Promise<ApiResponse> => {
      const pendingId = request.body?.pendingId;
      if (typeof pendingId !== "string") {
        reply.code(400);
        return { success: false, error: "pendingId required" };
      }
      const result = pairing.deny(pendingId);
      if (!result.ok) {
        reply.code(404);
        return { success: false, error: result.error };
      }
      return { success: true };
    },
  );

  // ── Device: poll for approval + collect the bearer token (public) ──────
  fastify.post<{ Body: { pendingId?: string; holder?: unknown } }>(
    "/api/pair/poll",
    async (request, reply): Promise<ApiResponse<PairPollData>> => {
      const pendingId = request.body?.pendingId;
      if (typeof pendingId !== "string") {
        reply.code(400);
        return { success: false, error: "pendingId required" };
      }
      const result = pairing.poll(pendingId, request.body?.holder, bearerChannelOf(request.raw));
      // Route delegation (D7): the one approved answer that carries the token also
      // names the server's https origins. Filtered here, not in PairingManager.poll,
      // so knock and QR redemption both get it and the QR payload `urls` stay as minted.
      if (result.status === "approved") {
        return {
          success: true,
          data: {
            status: "approved",
            token: result.token,
            // Present only for a browser-held (expiring) row; epoch ms.
            ...(result.expiresAt !== undefined ? { expiresAt: result.expiresAt } : {}),
            routes: httpsOrigins(pairing.reachableUrls()),
          },
        };
      }
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

  // Revoke is operator-only (harden D2): a paired-device bearer must not
  // revoke — not even its own row — so the operator guard, never networkGuard.
  fastify.delete<{ Params: { id: string } }>(
    "/api/paired-devices/:id",
    { preHandler: operatorGuard },
    async (request, reply): Promise<ApiResponse> => {
      const removed = registry.revoke(request.params.id);
      if (!removed) {
        reply.code(404);
        return { success: false, error: "device not found" };
      }
      // Audit: id prefix + actor + socket peer only — never a bearer or hash (D2).
      auditLine("pairing", "revoked", { id: auditPrefix(request.params.id), ...auditRequestFields(request) });
      return { success: true };
    },
  );

  // ── Browser device: rotate its own bearer (bearer-only credential) ────
  registerBearerRotateRoute(fastify, { registry });

  // ── Dashboard: mint a device token for an MCP client (operator-only) ──
  // Deliberately NOT in PUBLIC_PAIRING_PREFIXES: this route issues durable
  // credentials and requires an operator credential, not a pairing code (D5).
  fastify.post<{ Body: { label?: unknown; tier?: unknown; purpose?: unknown } }>(
    "/api/paired-devices",
    { preHandler: operatorGuard },
    async (request, reply): Promise<ApiResponse<{ device: PairedDeviceView; token: string }> & { httpsUrl?: string }> => {
      const label = request.body?.label;
      const tier = request.body?.tier;
      const purpose = request.body?.purpose;
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
      const trimmed = validLabel(label);
      if (trimmed === null) {
        reply.code(400);
        return {
          success: false,
          error: `label must be 1..${MAX_DEVICE_LABEL_BYTES} UTF-8 bytes`,
        };
      }
      // `purpose` is absent or "bridge" (D9); `bridge` forces tier `operate`, which bridge-ticket
      // minting needs. Both are validated BEFORE the registry is touched, so a refusal leaves no row.
      if (purpose !== undefined && purpose !== "bridge") {
        reply.code(400);
        return { success: false, error: 'purpose must be "bridge" when present' };
      }
      if (purpose === "bridge" && tier !== undefined && tier !== "operate") {
        reply.code(400);
        return { success: false, error: "a bridge token is always tier operate" };
      }
      const channel = bearerChannelOf(request.raw);
      if (purpose === "bridge" && !isProvenChannel(channel)) {
        // A bridge token is never handed out plain-and-exposed by accident.
        const httpsUrl = deps.getTlsListenerUrls?.()[0];
        reply.code(403);
        return { success: false, error: BRIDGE_TOKEN_REQUIRES_HTTPS, ...(httpsUrl ? { httpsUrl } : {}) };
      }
      // The plaintext token rides this ONE response and is never retrievable
      // again (D4) — same plaintext-once semantics as the pairing ceremony.
      // No tier → the manual source default (`observe`, D1). The delivering channel decides exposure.
      const minted = registry.add(trimmed, "manual", isTier(tier) ? tier : undefined, undefined, {
        channel,
        ...(purpose === "bridge" ? { purpose: "bridge" as const } : {}),
      });
      auditLine("pairing", "minted", {
        id: auditPrefix(minted.device.id),
        tier: minted.device.tier,
        ...auditRequestFields(request),
      });
      return { success: true, data: minted };
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
