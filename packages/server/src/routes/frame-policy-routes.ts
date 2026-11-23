/**
 * `POST /api/web/frame-policy` — may the dashboard frame this origin?
 *
 *   body  { origin: "https://<host>" }   (the target ORIGIN only — never a path or query)
 *   200   { verdict: "allowed" | "refused" | "undetermined" | "ineligible" }
 *   400   no/invalid body, or the request `Origin` is missing / not one of the dashboard's own
 *   403   cross-site (mutation-origin gate) or tier below `control` (route tier gate)
 *   429   30/min per principal, or 2 probes of that principal already in flight;  503  8 probes already in flight
 *
 * The outbound work (SSRF defence, DNS pinning, redirects, deadline) lives in
 * `lib/frame-policy-probe.ts`; this module owns request gating, the per-principal
 * cache, limits and host-only logging. The response carries the verdict and nothing
 * else. See change: rich-chat-links (design D12, tasks 3.15).
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CorsOriginOptions } from "../auth/cors-origin.js";
import { requestPrincipalKey } from "../auth/request-principal.js";
import { createLookupGate, type ProbeDeps, type ProbeVerdict, probeFramePolicy } from "../lib/frame-policy-probe.js";
import { createWindowLimiter } from "../lib/resolve-mentions-batch.js";
import type { NetworkGuard } from "./route-deps.js";

export const FRAME_POLICY_RATE_PER_MINUTE = 30;
export const FRAME_POLICY_MAX_CONCURRENT = 8;
export const FRAME_POLICY_MAX_PER_PRINCIPAL = 2;
export const FRAME_POLICY_CACHE_ENTRIES = 500;
export const FRAME_POLICY_CACHE_TTL_MS = 10 * 60_000;
const BODY_LIMIT = 2 * 1024;
const MAX_ORIGIN_CHARS = 512;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface FramePolicyRoutesDeps {
  networkGuard: NetworkGuard;
  /** Live CORS/admission options (same object the mutation-origin gate and CORS use). */
  corsOpts: () => CorsOriginOptions;
  /** Dashboard-own non-loopback origins: tunnels, public base URLs, configured CORS origins. */
  ownOrigins: () => readonly string[];
  /** Ports this server serves browsers on (HTTP and TLS); a loopback Origin must carry one. */
  ownPorts: () => readonly number[];
  principalOf?: (request: FastifyRequest) => string;
  /** Outbound seams + deadline; the defaults are the production transport. */
  probe?: Partial<Pick<ProbeDeps, "lookup" | "request" | "deadlineMs">>;
  now?: () => number;
}

/** The request's browser `Origin` when it is one of the dashboard's own, else null. */
function dashboardOriginOf(raw: unknown, ownPorts: readonly number[], ownOrigins: readonly string[]): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.origin === "null" || raw !== u.origin) return null; // a browser sends the serialised origin only
  if ((u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname)) {
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return ownPorts.some((p) => String(p) === port) ? u.origin : null;
  }
  for (const own of ownOrigins) {
    try {
      if (new URL(own).origin === u.origin) return u.origin;
    } catch {
      /* ignore a malformed own origin */
    }
  }
  return null;
}

export function registerFramePolicyRoutes(fastify: FastifyInstance, deps: FramePolicyRoutesDeps): void {
  const principalOf = deps.principalOf ?? requestPrincipalKey;
  const now = deps.now ?? Date.now;
  const limiter = createWindowLimiter(FRAME_POLICY_RATE_PER_MINUTE, now);
  // Per-process salt: internal host names stay out of logs, repeated scans stay visible.
  const salt = crypto.randomBytes(16);
  const hashHost = (host: string): string => crypto.createHash("sha256").update(salt).update(host).digest("hex").slice(0, 12);
  const cache = new Map<string, { verdict: ProbeVerdict; at: number }>();
  let inflight = 0;
  const inflightBy = new Map<string, number>();
  // One gate per registration: outstanding DNS lookups (incl. abandoned ones) stay under the libuv pool size.
  const lookupGate = createLookupGate();

  const cacheGet = (key: string): ProbeVerdict | null => {
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    if (now() - hit.at >= FRAME_POLICY_CACHE_TTL_MS) return null;
    cache.set(key, hit); // most recently used
    return hit.verdict;
  };
  const cacheSet = (key: string, verdict: ProbeVerdict): void => {
    cache.delete(key);
    cache.set(key, { verdict, at: now() });
    if (cache.size > FRAME_POLICY_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  };

  fastify.post(
    "/api/web/frame-policy",
    { preHandler: deps.networkGuard, bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const dashboardOrigin = dashboardOriginOf(request.headers.origin, deps.ownPorts(), deps.ownOrigins());
      if (!dashboardOrigin) {
        reply.code(400);
        return { success: false, error: "own browser Origin required" };
      }
      const principal = principalOf(request);
      // Without a real principal every local caller shares one bucket per address.
      const bucket = principal === "local-operator" ? `${principal}@${request.ip}` : principal;
      if (!limiter.take(bucket)) {
        reply.code(429);
        return { success: false, error: "rate limited" };
      }
      const raw = (request.body as { origin?: unknown } | null)?.origin;
      if (typeof raw !== "string" || !raw || raw.length > MAX_ORIGIN_CHARS) {
        reply.code(400);
        return { success: false, error: "origin required" };
      }

      let host = "invalid";
      let targetOrigin: string | null = null;
      try {
        const u = new URL(raw);
        host = u.hostname;
        targetOrigin = u.origin;
      } catch {
        /* ineligible below */
      }
      const key = targetOrigin ? JSON.stringify([principal, targetOrigin, dashboardOrigin]) : null;
      const started = now();

      const cached = key ? cacheGet(key) : null;
      if (cached) {
        console.log(formatLog(cached, 0, 0, host, hashHost, true));
        return { verdict: cached };
      }
      if (inflight >= FRAME_POLICY_MAX_CONCURRENT) {
        reply.code(503);
        return { success: false, error: "busy" };
      }
      if ((inflightBy.get(bucket) ?? 0) >= FRAME_POLICY_MAX_PER_PRINCIPAL) {
        reply.code(429);
        return { success: false, error: "too many probes in flight" };
      }
      inflight++;
      inflightBy.set(bucket, (inflightBy.get(bucket) ?? 0) + 1);
      try {
        const result = await probeFramePolicy(raw, dashboardOrigin, {
          ownOrigins: deps.ownOrigins(),
          corsOpts: deps.corsOpts(),
          lookupGate,
          ...deps.probe,
        });
        // A transient `undetermined` is never cached, so "Try to embed" re-probes.
        if (key && (result.verdict === "allowed" || result.verdict === "refused")) cacheSet(key, result.verdict);
        console.log(formatLog(result.verdict, result.hops, now() - started, host, hashHost, false));
        return { verdict: result.verdict };
      } finally {
        inflight--;
        const left = (inflightBy.get(bucket) ?? 1) - 1;
        if (left > 0) inflightBy.set(bucket, left);
        else inflightBy.delete(bucket);
      }
    },
  );
}

/** One line: verdict, hops, ms. Host only (never path/query); `ineligible` logs a salted hash instead. */
function formatLog(
  verdict: ProbeVerdict,
  hops: number,
  ms: number,
  host: string,
  hashHost: (h: string) => string,
  cached: boolean,
): string {
  const who = verdict === "ineligible" ? `hostHash=${hashHost(host)}` : `host=${host}`;
  return `[frame-policy] verdict=${verdict} hops=${hops} ms=${ms} ${who}${cached ? " cached=1" : ""}`;
}
