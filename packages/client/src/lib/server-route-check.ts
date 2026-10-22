/**
 * Route checker — proves ONE route of a server identity from this browser/renderer.
 *
 * A route is an address a server answers at (see `shared/server-routes.ts`). The
 * proof is the identity challenge (`challengeIdentity`: fresh nonce, signature
 * verified, fingerprint recomputed from the presented key); access is the guarded
 * `GET /api/health` (`403 network_not_allowed` still means "proven, network not
 * allowed"). Outcome table: design D2.
 *
 * - The challenge is the ONLY request a route receives until it proves the
 *   expected fingerprint: a refused, unprovable or unreachable route never sees
 *   anything else, and no credential header is ever sent (an advertised `fp` is
 *   a hint, not a proof). The health leg runs after a successful proof; this is
 *   the one deviation from D2's "two concurrent calls", made so a route that
 *   fails the proof is contacted exactly once.
 * - Latency is the challenge round trip.
 * - Each request is bounded to 2 s; at most 6 routes are checked at once and a
 *   {@link createRouteChecker} caches the result per route for the lifetime of
 *   the checker (one menu open).
 *
 * Pure of React; the selector and Settings own when a checker is created.
 *
 * See change: group-servers-by-identity (D2, D11; test-plan #X4, #X5, #P1).
 */
import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import { type RouteScheme, routeKey } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { canProveIdentity, challengeIdentity, IdentityChallengeError } from "./pairing/pair-protocol.js";

/** Per-request bound (the health probe's historical 2 s). */
const ROUTE_CHECK_TIMEOUT_MS = 2000;
/** At most this many routes are checked at once (browser per-host HTTP/1.1 limit, D11). */
export const ROUTE_CHECK_CONCURRENCY = 6;

export interface CheckableRoute {
  host: string;
  port: number;
  scheme: RouteScheme;
}

/** What the guarded health leg says about reaching the proven route from here. */
type RouteAccess = "ok" | "network-not-allowed" | "unavailable";

export type RouteCheck =
  /** The challenge proved the expected fingerprint (any valid proof when none was expected). */
  | { kind: "proven"; fingerprint: string; latencyMs: number; access: RouteAccess }
  /** A valid proof of ANOTHER identity: refused, never used, no credential sent. */
  | { kind: "different-identity"; fingerprint: string }
  /** Bad signature or unparseable key material: refused. */
  | { kind: "invalid-proof" }
  /** Answered, but without a proof (older server, 404): not offered as the route to open. */
  | { kind: "cant-prove" }
  /** This browser has no WebCrypto Ed25519: cannot prove, so cannot switch. */
  | { kind: "cant-prove-in-browser" }
  /** No answer within the bound (the server-side probe explains the cause). */
  | { kind: "unreachable" };

export interface RouteCheckOptions {
  /** The group's fingerprint; when absent a valid proof counts as `proven` and carries what it proved. */
  expectedFingerprint?: string;
  timeoutMs?: number;
  /** Monotonic clock in ms (tests inject one; default `performance.now`). */
  now?: () => number;
}

const defaultNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** `scheme://host[:port]` — IPv6 bracketed through `formatHostPort`. */
export function routeBaseUrl(route: CheckableRoute): string {
  return `${route.scheme}://${formatHostPort(route.host, route.port)}`;
}

/** Access leg: bounded GET, no credentials header, no redirect following. */
async function checkAccess(base: string, timeoutMs: number): Promise<RouteAccess> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ac.signal, redirect: "manual" });
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return body?.error === "network_not_allowed" ? "network-not-allowed" : "unavailable";
    }
    if (!res.ok) return "unavailable";
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/** Check one route (no concurrency bound, no cache). Never throws. */
export async function checkRoute(route: CheckableRoute, opts: RouteCheckOptions = {}): Promise<RouteCheck> {
  if (!canProveIdentity()) return { kind: "cant-prove-in-browser" };
  const timeoutMs = opts.timeoutMs ?? ROUTE_CHECK_TIMEOUT_MS;
  const now = opts.now ?? defaultNow;
  const base = routeBaseUrl(route);

  const started = now();
  let proof: Awaited<ReturnType<typeof challengeIdentity>>;
  try {
    proof = await challengeIdentity(base, timeoutMs);
  } catch (e) {
    if (e instanceof IdentityChallengeError) {
      if (e.reason === "unsupported") return { kind: "cant-prove-in-browser" };
      if (e.reason === "invalid-key") return { kind: "invalid-proof" };
      return { kind: "cant-prove" };
    }
    return { kind: "unreachable" };
  }
  const latencyMs = Math.max(0, now() - started);

  if (!proof.verified) return { kind: "invalid-proof" };
  if (opts.expectedFingerprint !== undefined && proof.fingerprint !== opts.expectedFingerprint) {
    return { kind: "different-identity", fingerprint: proof.fingerprint };
  }
  return { kind: "proven", fingerprint: proof.fingerprint, latencyMs, access: await checkAccess(base, timeoutMs) };
}

/** True when a check allows opening/switching to the route: proven and reachable under this network. */
export function isUsableCheck(check: RouteCheck | undefined): check is Extract<RouteCheck, { kind: "proven" }> {
  return check?.kind === "proven" && check.access === "ok";
}

export interface RouteChecker {
  /** Check a route once per checker (cached by scheme/host/port + expected fingerprint). */
  check(route: CheckableRoute, expectedFingerprint?: string): Promise<RouteCheck>;
}

export interface RouteCheckerOptions {
  concurrency?: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * A checker scoped to one menu open / one scan: results are cached for its
 * lifetime and at most `concurrency` routes are in flight (the rest queue).
 */
export function createRouteChecker(opts: RouteCheckerOptions = {}): RouteChecker {
  const limit = Math.max(1, opts.concurrency ?? ROUTE_CHECK_CONCURRENCY);
  const cache = new Map<string, Promise<RouteCheck>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  const acquire = (): Promise<void> =>
    active < limit
      ? ((active += 1), Promise.resolve())
      : new Promise<void>((resolve) => waiting.push(() => ((active += 1), resolve())));
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };

  return {
    check(route, expectedFingerprint) {
      const key = `${routeKey(route)}|${expectedFingerprint ?? ""}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = acquire().then(async () => {
          try {
            return await checkRoute(route, { expectedFingerprint, timeoutMs: opts.timeoutMs, now: opts.now });
          } finally {
            release();
          }
        });
        cache.set(key, pending);
      }
      return pending;
    },
  };
}
