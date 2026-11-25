/**
 * Tier-5 CORS preflight (D8, P6): `OPTIONS /preview/<valid pid>/…` with `Origin: null` is answered 204 with
 * `Access-Control-Allow-Origin: null` and NO credentials. Registered BEFORE `@fastify/cors` (which denies `null` and
 * would send nothing). Only a VALID pid qualifies; everything else — an unknown pid, `/api`, `/ws`, `/auth`, a
 * non-null Origin — falls through to the normal chain unchanged.
 *
 * See change: serve-live-previews-on-capability-origin (D8).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { isLocallyTrusted } from "../auth/localhost-guard.js";
import { parsePreviewPath } from "./preview-path.js";
import type { PreviewPathStore } from "./preview-path-store.js";

const DEFAULT_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE";
/** Echo only header names that are plain tokens (no CR/LF, no separators beyond `,`). */
const SAFE_HEADER_LIST = /^[A-Za-z0-9!#$%&'*+.^_`|~, -]{1,512}$/;

export function createPreviewPreflight(getStore: () => PreviewPathStore | undefined) {
  return async function previewPreflight(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.method !== "OPTIONS" || request.headers.origin !== "null" || !request.url.startsWith("/preview/")) return;
    const path = parsePreviewPath(request.url);
    const store = getStore();
    if (!path || !store) return;
    // A preflight is not an accepted request: peek, never extend the idle expiry.
    const grant = store.validate(
      path.pid,
      { genuinelyLocal: isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }) },
      false,
    );
    if (!grant) return;
    const reqHeaders = request.headers["access-control-request-headers"];
    reply
      .code(204)
      .header("access-control-allow-origin", "null")
      .header("access-control-allow-methods", DEFAULT_METHODS)
      .header("vary", "Origin, Access-Control-Request-Headers")
      .header("access-control-max-age", "600");
    if (typeof reqHeaders === "string" && SAFE_HEADER_LIST.test(reqHeaders)) reply.header("access-control-allow-headers", reqHeaders);
    return reply.send();
  };
}
