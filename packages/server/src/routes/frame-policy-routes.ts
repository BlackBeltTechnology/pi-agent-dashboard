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
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** A loopback Origin is the dashboard's own only when it carries a port this server serves. */
function isOwnLoopbackPort(u: URL, ownPorts: readonly number[]): boolean {
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return ownPorts.some((p) => String(p) === port);
}

function matchesOwnOrigin(origin: string, ownOrigins: readonly string[]): boolean {
  // A malformed own origin is ignored.
  return ownOrigins.some((own) => tryParseUrl(own)?.origin === origin);
}

/** The request's browser `Origin` when it is one of the dashboard's own, else null. */
function dashboardOriginOf(raw: unknown, ownPorts: readonly number[], ownOrigins: readonly string[]): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const u = tryParseUrl(raw);
  if (!u) return null;
  if (u.origin === "null" || raw !== u.origin) return null; // a browser sends the serialised origin only
  if ((u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname)) {
    return isOwnLoopbackPort(u, ownPorts) ? u.origin : null;
  }
  return matchesOwnOrigin(u.origin, ownOrigins) ? u.origin : null;
}

/** Per-principal cache key, or null when the target origin did not parse (nothing to cache). */
function cacheKeyOf(principal: string, targetOrigin: string | null, dashboardOrigin: string): string | null {
  return targetOrigin ? JSON.stringify([principal, targetOrigin, dashboardOrigin]) : null;
}

/** The body's `origin` when it is a non-empty string within the length cap, else null. */
function rawOriginOf(body: unknown): string | null {
  const raw = (body as { origin?: unknown } | null)?.origin;
  return typeof raw === "string" && raw && raw.length <= MAX_ORIGIN_CHARS ? raw : null;
}

/** Host (for logs) and canonical origin of the raw target; `"invalid"` / null when unparseable. */
function describeTarget(raw: string): { host: string; targetOrigin: string | null } {
  const u = tryParseUrl(raw);
  return u ? { host: u.hostname, targetOrigin: u.origin } : { host: "invalid", targetOrigin: null };
}

interface Rejection {
  code: number;
  error: string;
}

/** A request whose probe is about to run (all gates passed). */
interface ProbeCall {
  raw: string;
  dashboardOrigin: string;
  bucket: string;
  /** Cache key, or null when the target origin did not parse. */
  key: string | null;
  host: string;
  started: number;
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

  const cacheGet = (key: string | null): ProbeVerdict | null => {
    if (key === null) return null;
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

  /** Admission: the global and per-principal in-flight caps. Null = admitted. */
  const inflightRejection = (bucket: string): Rejection | null => {
    if (inflight >= FRAME_POLICY_MAX_CONCURRENT) return { code: 503, error: "busy" };
    if ((inflightBy.get(bucket) ?? 0) >= FRAME_POLICY_MAX_PER_PRINCIPAL) {
      return { code: 429, error: "too many probes in flight" };
    }
    return null;
  };

  const runProbe = async (call: ProbeCall): Promise<{ verdict: ProbeVerdict }> => {
    const { raw, dashboardOrigin, bucket, key, host, started } = call;
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
  };

  const rejectWith = (reply: FastifyReply, code: number, error: string) => {
    reply.code(code);
    return { success: false, error };
  };

  fastify.post(
    "/api/web/frame-policy",
    { preHandler: deps.networkGuard, bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const dashboardOrigin = dashboardOriginOf(request.headers.origin, deps.ownPorts(), deps.ownOrigins());
      if (!dashboardOrigin) return rejectWith(reply, 400, "own browser Origin required");
      const principal = principalOf(request);
      // Without a real principal every local caller shares one bucket per address.
      const bucket = principal === "local-operator" ? `${principal}@${request.ip}` : principal;
      if (!limiter.take(bucket)) return rejectWith(reply, 429, "rate limited");
      const raw = rawOriginOf(request.body);
      if (raw === null) return rejectWith(reply, 400, "origin required");

      const { host, targetOrigin } = describeTarget(raw);
      const key = cacheKeyOf(principal, targetOrigin, dashboardOrigin);
      const started = now();

      const cached = cacheGet(key);
      if (cached) {
        console.log(formatLog(cached, 0, 0, host, hashHost, true));
        return { verdict: cached };
      }
      const rejection = inflightRejection(bucket);
      if (rejection) return rejectWith(reply, rejection.code, rejection.error);
      return runProbe({ raw, dashboardOrigin, bucket, key, host, started });
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
