/**
 * Bearer device-auth branch (D5/D7).
 *
 * A single additive `onRequest` hook that validates a paired-device bearer
 * token and, on success, sets `request.isAuthenticated = true` — feeding the
 * SAME decision the OAuth cookie and network guard already read. Registered
 * whether or not OAuth is configured, and BEFORE the OAuth plugin so its hook
 * can early-return on an already-authenticated request. Never touches the
 * loopback, trusted-network, or cookie paths.
 *
 * REST: `Authorization: Bearer <token>`, or — for `/api/*` URLs only, when no
 *       Authorization header is present — the httpOnly `pi_dash_device` cookie
 *       the browser obtains by exchanging its bearer once (`POST
 *       /api/device-session`). Same `authVia`/tier/revocation. The cookie is
 *       `Path=/api/` so it never rides `/ws*`, `/live`, `/auth`, `/mcp`.
 *       See change: harden-trust-and-credential-boundaries (D5).
 * WS:   the durable bearer NEVER rides the WebSocket (F6). A client mints a
 *       short-lived single-use ticket via an authenticated REST call
 *       (`/api/ws-ticket`) and presents only that ticket on the socket
 *       (see `ws-ticket.ts`).
 */
import type { TLSSocket } from "node:tls";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/tls-only-token.js";
import type { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { auditLine, auditPrefix } from "./audit-log.js";
import { hasProxyForwardingHeaders } from "./localhost-guard.js";
import { isLoopbackRange } from "./loopback.js";
import { bearerChannelOf } from "./proven-tls.js";
import { isSecureOrigin } from "./secure-origin.js";

/** Extract a `Bearer` token from an Authorization header, or null. */
export function parseBearerHeader(authorization: string | undefined): string | null {
  if (!authorization) return null;
  // Linear slice parse, not a regex: `\s+(.+)` is polynomial on `"bearer "` + many spaces
  // (CodeQL js/polynomial-redos) and this header is attacker-controlled.
  const trimmed = authorization.trim();
  if (trimmed.slice(0, 6).toLowerCase() !== "bearer") return null;
  const rest = trimmed.slice(6);
  if (!/^\s/.test(rest)) return null;
  const token = rest.trim();
  return token === "" ? null : token;
}

export const DEVICE_COOKIE = "pi_dash_device";
/** Route pattern of the browser-bearer rotation (the one route whose refusals are audited, D2). */
export const ROTATE_ROUTE = "/api/paired-devices/rotate";
/** 401 body for an expired browser bearer (distinct from revoked/unknown, which carry no `code`). */
/** 401 body for a `pi_tls_` bearer presented off a proven channel (a named cause, not "unpaired or revoked"). */
const TLS_ONLY_UNTRUSTED_BODY = {
  success: false as const,
  error: TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL,
  code: TLS_ONLY_TOKEN_UNTRUSTED_CHANNEL,
};
const BEARER_EXPIRED_BODY = { success: false as const, error: "bearer_expired", code: "bearer_expired" as const };
/** 400 days — `PairedDeviceRegistry` rows carry no expiry; revocation is the kill switch. */
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * `Secure` attribute for the device cookie, from the exchanging request's own
 * transport: always `Secure` over a TLS socket; NOT `Secure` for a direct
 * plain-http connection (no forwarding header) from a peer outside the loopback range (a browser paired
 * over `http://<lan-ip>` would otherwise silently drop the cookie and lose its
 * single-use bearer); otherwise the global resolved-base rule — so a tunnel / TLS
 * reverse proxy that forwards plain http on the loopback hop still gets `Secure`.
 * Uses the SOCKET peer, never `request.ip`. See change: add-lan-knock-pairing (D15).
 */
function deviceCookieSecure(request: FastifyRequest, globalSecure: () => boolean): boolean {
  const socket = request.raw.socket as TLSSocket;
  if (socket.encrypted) return true;
  const peer = socket.remoteAddress;
  // DIRECT only: a request carrying proxy-forwarding headers came through a TLS-terminating
  // proxy that may sit on another host/container (peer 172.x), and keeps the global rule.
  if (peer && !isLoopbackRange(peer) && !hasProxyForwardingHeaders(request.headers)) return false;
  // The global rule is the ONE predicate shared with the OAuth state + session cookies:
  // https base || loopback socket peer + Host equal to a live https tunnel origin.
  // See change: harden-auth-credentials (D3).
  return isSecureOrigin(request, globalSecure());
}

/** Pathname of a request URL (no query/fragment). */
function pathnameOf(url: string): string {
  const q = url.search(/[?#]/);
  return q < 0 ? url : url.slice(0, q);
}

/**
 * The device cookie's bearer. Authorization wins: the cookie is a fallback for
 * `/api/*` URLs only and is never consulted when an Authorization header is present.
 */
function deviceCookieToken(request: FastifyRequest): string | null {
  if (request.headers.authorization || !pathnameOf(request.url).startsWith("/api/")) return null;
  return (request.cookies as Record<string, string | undefined> | undefined)?.[DEVICE_COOKIE] ?? null;
}

/** 401 `bearer_expired`; a refused ROTATION of a known device is also audited (A-G4): id prefix, reason, socket peer only. */
function refuseExpired(request: FastifyRequest, reply: FastifyReply, deviceId: string): FastifyReply {
  if (request.method === "POST" && request.routeOptions?.url === ROTATE_ROUTE) {
    auditLine("pairing", "rotate_refused", { id: auditPrefix(deviceId), reason: "bearer_expired", ip: request.ip });
  }
  return reply.code(401).send(BEARER_EXPIRED_BODY);
}

/** Register the REST bearer onRequest branch. */
export function registerBearerAuth(
  fastify: FastifyInstance,
  deps: { registry: PairedDeviceRegistry },
): void {
  // Ensure the decorator exists even if the OAuth plugin isn't registered.
  if (!fastify.hasRequestDecorator?.("isAuthenticated")) {
    try {
      fastify.decorateRequest("isAuthenticated", false);
    } catch {
      /* already decorated by another plugin */
    }
  }
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if ((request as any).isAuthenticated) return;
    const headerToken = parseBearerHeader(request.headers.authorization);
    const token = headerToken ?? deviceCookieToken(request);
    // The channel is judged from the request itself and the registry records any off-channel use.
    const verdict = token ? deps.registry.verifyDetailed(token, bearerChannelOf(request.raw)) : null;
    // A TLS-only bearer off a proven channel is marked, then refused with a distinct, named cause.
    // See change: prove-vault-bridge-tls (D4, D9).
    if (verdict?.status === "tls_only_refused") return reply.code(401).send(TLS_ONLY_UNTRUSTED_BODY);
    // A PRESENTED Authorization bearer is always judged, before any network
    // trust: an expired browser bearer is a distinct 401 the client re-pairs
    // on, even from a loopback / trusted peer. (A cookie-carried bearer that
    // expired falls through unauthenticated, like a revoked one.) Revoked,
    // unknown and superseded-after-grace bearers stay a plain denial.
    // See change: harden-auth-credentials (D5, A-G12).
    if (verdict?.status === "expired" && headerToken) return refuseExpired(request, reply, verdict.id);
    const verified = verdict?.status === "ok" ? verdict : null;
    if (verified) {
      (request as any).isAuthenticated = true;
      // Additive marker: HOW the request authenticated. `operatorGuard` on the
      // token-mint route reads it to REFUSE a device bearer (a paired device
      // must not mint unrevocable credentials). `route-tier-gate` reads it to
      // scope the REST tier check to bearer-admitted requests.
      (request as any).authVia = "device";
      // The credential's tier and id, so the REST tier gate can refuse a route
      // above the bearer's tier and name the device in the refusal log (D1b).
      (request as any).principalTier = verified.tier;
      (request as any).principalDeviceId = verified.id;
    }
  });
}

/**
 * `POST /api/device-session` — exchange a device bearer (Authorization header) for
 * the httpOnly `pi_dash_device` cookie. `DELETE` clears it. Tier `observe` so any
 * paired device can exchange. Cookie: `SameSite=Strict`, `Path=/api/`.
 */
export function registerDeviceSessionRoutes(
  fastify: FastifyInstance,
  deps: { registry: PairedDeviceRegistry; isSecure: () => boolean },
): void {
  fastify.post("/api/device-session", async (request, reply) => {
    const bearer = parseBearerHeader(request.headers.authorization);
    if (!bearer || !deps.registry.verify(bearer, bearerChannelOf(request.raw))) {
      reply.code(401);
      return { success: false as const, error: "device bearer required" };
    }
    reply.setCookie(DEVICE_COOKIE, bearer, {
      path: "/api/",
      httpOnly: true,
      sameSite: "strict",
      secure: deviceCookieSecure(request, deps.isSecure),
      maxAge: DEVICE_COOKIE_MAX_AGE_S,
    });
    return { success: true as const };
  });

  fastify.delete("/api/device-session", async (_request, reply) => {
    reply.clearCookie(DEVICE_COOKIE, { path: "/api/" });
    return { success: true as const };
  });
}
