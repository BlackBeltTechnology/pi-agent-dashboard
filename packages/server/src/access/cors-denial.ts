/**
 * CORS origin denial observer: turns an unknown cross-origin request into a
 * DEFERRED `cors`-plane denial for the access-grant coordinator (server-cors
 * spec "An origin denial may be answered by prompt"). The request itself is
 * never altered or suspended; `@fastify/cors` still decides the response.
 *
 * See change: add-access-grant-dialog.
 */
import type { FastifyRequest } from "fastify";
import { type CorsOriginOptions, classifyCorsOrigin, isSameOriginByHost } from "../auth/cors-origin.js";

/**
 * The origin to report as denied, or null. Null for: absent, empty, repeated
 * or `null` (opaque) Origin; any origin the CORS decision admits; and the
 * dashboard's own page served under a non-loopback name (same-origin by Host).
 */
export function deniedCorsOrigin(
  origin: string | string[] | undefined,
  hostHeader: string | undefined,
  opts: CorsOriginOptions,
): string | null {
  if (typeof origin !== "string" || origin === "" || origin === "null") return null;
  if (classifyCorsOrigin(origin, opts).kind !== "denied") return null;
  if (isSameOriginByHost(origin, hostHeader, opts)) return null;
  return origin;
}

/**
 * onRequest hook reporting each denied origin with the source ip. Register it
 * AFTER the host gate (a host-refused request never prompts) and before
 * `@fastify/cors`. An observer failure never affects the request.
 */
export function createCorsDenialObserver(
  opts: () => CorsOriginOptions,
  onDenied: (origin: string, ip: string) => void,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    try {
      const denied = deniedCorsOrigin(request.headers.origin, request.headers.host, opts());
      if (denied !== null) onDenied(denied, request.ip);
    } catch (err) {
      console.error(`[access-grant] cors denial observer failed: ${(err as Error).message}`);
    }
  };
}
