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
import type { WsRouteScope } from "./ws-ticket.js";

export interface CorsOriginOptions {
  /** Explicitly configured allowed origins (`cors.allowedOrigins`). */
  configuredOrigins: string[];
  /** Trusted-network entries (exact IP / CIDR / wildcard). LAN-to-LAN switching. */
  trustedNetworks: string[];
  /** Active zrok tunnel URL, read dynamically so rotation is picked up. */
  getTunnelUrl?: () => string | null;
  /**
   * Every CURRENTLY connected tunnel origin, across all live providers.
   *
   * Read dynamically, so the allowance follows tunnels as they come and go: a
   * provider that disconnects stops being allowed. Distinct from
   * `getTunnelUrl`, which is the PRIMARY only — CORS and the OAuth redirect
   * base answer different questions. CORS asks "may this origin, already in the
   * address bar, read a response?"; the redirect base asks "which single origin
   * do we mint OAuth URIs and set cookies for?". Widening the first must never
   * widen the second. See change: add-zrok-custom-reserved-name (D4).
   */
  getLiveTunnelOrigins?: () => string[];
  /**
   * Allow ANY `*.share.zrok.io` / `*.shares.zrok.io` host (branch 5).
   *
   * `true` (default) for CORS readability, where the allowance shipped and is
   * load-bearing for tunnel-URL rotation. `false` for ADMISSION (WS upgrade,
   * mutating REST): zrok shares are free and self-service, so a stranger share
   * is very likely same-site to the victim's tunnel and the wildcard would let
   * it defeat even the OAuth'd gate. Tunnels the dashboard itself runs are live
   * tunnel origins (branch 4/4b) and stay admitted.
   * See change: fix-ws-origin-cswsh (D1 rule 2).
   */
  allowZrokWildcard?: boolean;
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
 *  4b. Any CURRENTLY connected tunnel origin (any provider) → allow.
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
    // 4b. Any live tunnel's origin, for every provider. Compared as ORIGINS,
    //     not as URLs: a provider reports `https://host/path`, and a browser
    //     sends `https://host`, so a string equality against the raw URL would
    //     silently never match for any provider that carries a path.
    for (const raw of opts.getLiveTunnelOrigins?.() ?? []) {
      let candidate: string;
      try {
        candidate = new URL(raw).origin;
      } catch {
        continue;
      }
      if (candidate === u.origin) return true;
    }
    // 5. Any *.share.zrok.io (v1) or *.shares.zrok.io (v2) host.
    if (
      opts.allowZrokWildcard !== false &&
      (host.endsWith(".share.zrok.io") || host.endsWith(".shares.zrok.io"))
    ) {
      return true;
    }
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

// ─── Admission: who may OPEN a socket / MUTATE state ────────────────────────
//
// CORS answers "may this origin READ a response". Admission answers "may this
// origin ACT". They share one decision so they cannot drift, with two deltas
// (design D1): a same-origin-by-Host rule, and no blanket zrok wildcard.
// See change: fix-ws-origin-cswsh.

/** Control characters and over-long values never reach a log line (D5). */
export function sanitizeHeaderForLog(value: string | undefined, max = 256): string {
  if (!value) return "-";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

/**
 * Is the Origin's `host[:port]` the same as the request's `Host` header?
 *
 * True means the calling page was served by THIS dashboard at whatever name
 * the user typed — an mDNS hostname (`http://mac.local:8000`), a plain-LAN
 * address — neither of which `isBypassedHost` (IP literals only) matches.
 * Compared after `new URL()` normalization on both sides, using the ORIGIN's
 * scheme for the Host so default ports elide identically.
 */
function isSameOriginByHost(origin: string, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // Positive allowlist, not a reject-list: a `Host` is only ever host[:port]
  // (letters, digits, `.`, `-`, IPv6 `[]:`). `new URL()` would happily
  // normalize `evil.com#`, `evil.com?x` or `user@evil.com` into a bare host, so
  // fail-closed here is structural rather than emergent from parser quirks.
  if (!/^[A-Za-z0-9.\-[\]:]+$/.test(hostHeader)) return false;
  try {
    const o = new URL(origin);
    const h = new URL(`${o.protocol}//${hostHeader}`);
    return h.host !== "" && o.host === h.host;
  } catch {
    return false;
  }
}

/**
 * The shared admission decision for WS upgrades and mutating REST requests.
 *
 * Absent Origin → allow: every non-browser local client (bridge, CLI, curl,
 * the `pi-dashboard` skill) sends none, and browsers cannot omit it. An EMPTY
 * Origin header is not an absent one — no browser sends it, so it denies.
 */
export function isOriginAdmitted(
  origin: string | undefined,
  hostHeader: string | undefined,
  opts: CorsOriginOptions,
): boolean {
  if (origin === undefined) return true;
  if (origin === "") return false;
  // `new URL()` silently trims surrounding whitespace, so ` http://localhost:8000`
  // would normalize into a loopback match. No browser sends padding — deny it
  // rather than normalize an attacker-shaped value into a trusted one.
  if (origin !== origin.trim()) return false;
  if (isSameOriginByHost(origin, hostHeader)) return true;
  return isCorsOriginAllowed(origin, { ...opts, allowZrokWildcard: false });
}

/**
 * WS upgrade admission, per route scope.
 *
 * `live` admits the opaque `Origin: null` — the sandboxed preview iframe is its
 * only intended client and rejecting it would silently break HMR (D3). Every
 * other scope (including `bridge` and the unrouted `null` scope) is strict.
 */
export function isWsOriginTrusted(
  origin: string | undefined,
  hostHeader: string | undefined,
  scope: WsRouteScope | null,
  opts: CorsOriginOptions,
): boolean {
  if (scope === "live" && origin === "null") return true;
  return isOriginAdmitted(origin, hostHeader, opts);
}

/** Mutating-REST admission (`/api/*` + `POST /auth/logout`). No `null` carve-out. */
export function isMutationOriginTrusted(
  origin: string | undefined,
  hostHeader: string | undefined,
  opts: CorsOriginOptions,
): boolean {
  return isOriginAdmitted(origin, hostHeader, opts);
}
