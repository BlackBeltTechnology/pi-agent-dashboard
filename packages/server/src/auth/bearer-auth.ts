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
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PairedDeviceRegistry } from "../pairing/paired-devices.js";

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
/** 400 days — `PairedDeviceRegistry` rows carry no expiry; revocation is the kill switch. */
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** Pathname of a request URL (no query/fragment). */
function pathnameOf(url: string): string {
  const q = url.search(/[?#]/);
  return q < 0 ? url : url.slice(0, q);
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
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    if ((request as any).isAuthenticated) return;
    const headerToken = parseBearerHeader(request.headers.authorization);
    // Authorization wins. The cookie is a fallback for `/api/*` URLs only and is
    // never consulted when an Authorization header is present.
    const cookieToken =
      !request.headers.authorization && pathnameOf(request.url).startsWith("/api/")
        ? ((request.cookies as Record<string, string | undefined> | undefined)?.[DEVICE_COOKIE] ?? null)
        : null;
    const token = headerToken ?? cookieToken;
    const verified = token ? deps.registry.verify(token) : null;
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
    if (!bearer || !deps.registry.verify(bearer)) {
      reply.code(401);
      return { success: false as const, error: "device bearer required" };
    }
    reply.setCookie(DEVICE_COOKIE, bearer, {
      path: "/api/",
      httpOnly: true,
      sameSite: "strict",
      secure: deps.isSecure(),
      maxAge: DEVICE_COOKIE_MAX_AGE_S,
    });
    return { success: true as const };
  });

  fastify.delete("/api/device-session", async (_request, reply) => {
    reply.clearCookie(DEVICE_COOKIE, { path: "/api/" });
    return { success: true as const };
  });
}
