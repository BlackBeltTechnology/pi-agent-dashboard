/**
 * Build the curated, bounded `AuthContext` handed to principal resolvers
 * (openspec §4.2 / design D6, D6a). Resolvers NEVER receive the raw Fastify
 * request — only this allowlist: `{ method, url, authorization?, cookie?,
 * dpop?, isAuthenticated, ip }`.
 *
 * `url` is the externally-visible request URL the browser would have signed
 * into a DPoP proof (`htu`): `scheme://host[:port]/path` with query and
 * fragment stripped (RFC 9449 compares `htu` without them). Scheme+host derive
 * from the configured public base URL, NOT the raw socket, so a proxied request
 * reconstructs the same `htu` the browser used (D6a). When no base is
 * configured we use a fixed localhost origin rather than trusting the request
 * Host header; a later `htu` mismatch rejects rather than guesses.
 */

import type { AuthContext } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** The minimal request surface the builder reads — a subset of FastifyRequest. */
export interface RequestLike {
  method: string;
  url: string;
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  isAuthenticated?: boolean;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Strip query + fragment from a request path/url, keeping only the path. */
function pathOnly(rawUrl: string): string {
  const q = rawUrl.indexOf("?");
  const h = rawUrl.indexOf("#");
  let end = rawUrl.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return rawUrl.slice(0, end);
}

/**
 * Reconstruct the canonical external `scheme://host[:port]` origin.
 * @param publicBase configured public base URL (e.g. resolveRedirectBase().base)
 */
export function canonicalOrigin(publicBase: string | null | undefined): string {
  if (publicBase) {
    try {
      const u = new URL(publicBase);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* fall through to host header */
    }
  }
  return "http://localhost";
}

/**
 * Build the curated context. `publicBase` is the configured external base URL
 * (or null to fall back to the request Host). Nothing outside the allowlist is
 * exposed; the returned object is a fresh plain object each call.
 */
export function buildAuthContext(req: RequestLike, publicBase: string | null | undefined): AuthContext {
  const origin = canonicalOrigin(publicBase);
  const url = `${origin}${pathOnly(req.url)}`;
  const authorization = firstHeader(req.headers.authorization);
  const cookie = firstHeader(req.headers.cookie);
  const dpop = firstHeader(req.headers.dpop);
  return {
    method: req.method,
    url,
    ...(authorization !== undefined ? { authorization } : {}),
    ...(cookie !== undefined ? { cookie } : {}),
    ...(dpop !== undefined ? { dpop } : {}),
    isAuthenticated: req.isAuthenticated === true,
    ip: req.ip,
  };
}
