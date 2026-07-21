/**
 * Pure CORS origin-allow decision, extracted from the `@fastify/cors` callback
 * in `server.ts` so it is unit-testable against the REAL implementation rather
 * than a hand-mirrored copy that silently drifts.
 *
 * CORS controls who may READ a cross-origin response; it grants no authority.
 * Auth (bearer / ticket / trusted-source-IP) gates every mutation separately.
 * Widening reads to already-trusted networks weakens nothing auth protected.
 *
 * See change: fix-remote-connect-cors-gates.
 */
import { isBypassedHost } from "./localhost-guard.js";

export interface CorsOriginOptions {
  /** Explicitly configured allowed origins (`cors.allowedOrigins`). */
  configuredOrigins: string[];
  /** Trusted-network entries (exact IP / CIDR / wildcard). LAN-to-LAN switching. */
  trustedNetworks: string[];
  /** Active zrok tunnel URL, read dynamically so rotation is picked up. */
  getTunnelUrl?: () => string | null;
}

/**
 * Decide whether `origin` may read a cross-origin response.
 *
 * Ordered branches (first match wins):
 *  1. No Origin (same-origin navigation) → allow.
 *  2. `Origin: null` (opaque sandboxed live-server iframe, D7) → DENY, always.
 *     Preserved intentionally; never relaxed. See improve-content-editor §6.5.
 *  3. Loopback host (any port) → allow.
 *  4. Active zrok tunnel URL → allow.
 *  5. Any `*.share.zrok.io` / `*.shares.zrok.io` (zrok v2) host → allow.
 *  6. Neutral static PWA shell `https://pi-dashboard.dev` → allow.
 *  7. Explicitly configured origin → allow.
 *  8. Origin host matches a trusted network (CIDR / wildcard / exact) → allow.
 *  9. Otherwise → deny (unknown-origin fallthrough).
 */
export function isCorsOriginAllowed(
  origin: string | undefined,
  opts: CorsOriginOptions,
): boolean {
  // 1. Same-origin navigation — no Origin header.
  if (!origin) return true;
  // 2. Opaque-origin document. Never echo an ACAO for it, so an embedded
  //    untrusted app cannot call dashboard APIs even cross-origin.
  if (origin === "null") return false;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    // 3. Loopback — any port.
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return true;
    }
    // 4. Active zrok tunnel URL (dynamic — rotation without restart).
    const tunnelUrl = opts.getTunnelUrl?.() ?? null;
    if (tunnelUrl && origin === tunnelUrl) return true;
    // 5. Any *.share.zrok.io (v1) or *.shares.zrok.io (v2) host.
    if (host.endsWith(".share.zrok.io") || host.endsWith(".shares.zrok.io")) return true;
    // 6. Neutral static PWA shell (D1/D8).
    if (origin === "https://pi-dashboard.dev") return true;
    // 8. Trusted-network origin — LAN-to-LAN switching. Same matcher the WS
    //    upgrade / network guard uses, so `trustedNetworks` governs both the
    //    auth bypass and this read allowance from a single operator decision.
    if (opts.trustedNetworks.length > 0 && isBypassedHost(host, opts.trustedNetworks)) {
      return true;
    }
  } catch {
    // Malformed origin → fall through to deny.
  }
  // 7. Explicitly configured origins.
  if (opts.configuredOrigins.includes(origin)) return true;
  // 9. Unknown cross-origin request — no CORS headers.
  return false;
}
