/**
 * Trusted Types / CSP violation channel (change: harden-client-sinks, design D8).
 *
 *   POST /api/csp-violations  — the client's batched report
 *                               `{ entries: [{directive,sink,source,count}], overflow? }`
 *   GET  /api/csp-violations  — the in-memory counters, for operators
 *
 * Behind the network guard (authenticated callers only; browser `report-to`
 * reports carry no credentials, which is why this is not a `report-uri`).
 * 8 KiB body cap, schema-checked, per-principal limit (burst 3, 12 / min) —
 * an excess report gets 429 and changes nothing. Counters only: unknown
 * fields (a content `sample`) are dropped, nothing is persisted, and a
 * rejected body is never logged. Counters are an LRU of 500 keys.
 *
 * Unrelated to the live-preview `/__pi/csp-report` sink.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requestPrincipalKey } from "../auth/request-principal.js";
import type { NetworkGuard } from "./route-deps.js";

export const CSP_VIOLATIONS_BODY_LIMIT = 8192;
export const MAX_COUNTER_KEYS = 500;
const MAX_ENTRIES = 50;
const BURST = 3;
const PER_MINUTE = 12;
const WINDOW_MS = 60_000;
const REFILL_MS = WINDOW_MS / PER_MINUTE;
const MAX_COUNT = 1_000_000;

interface Entry {
  directive: string;
  sink: string;
  source: string;
  count: number;
}

export interface CspViolationRoutesDeps {
  networkGuard: NetworkGuard;
  /** Principal key for rate limiting (default: {@link requestPrincipalKey}). */
  principalOf?: (request: FastifyRequest) => string;
  now?: () => number;
  log?: { warn(msg: string): void };
}

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_COUNT;

/** Validate and normalize a report; unknown fields are dropped. `null` → 400. */
function parseReport(body: unknown): { entries: Entry[]; overflow: number } | null {
  if (!body || typeof body !== "object") return null;
  const { entries, overflow } = body as { entries?: unknown; overflow?: unknown };
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) return null;
  if (overflow !== undefined && !isCount(overflow)) return null;
  const out: Entry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") return null;
    const { directive, sink, source, count } = e as Record<string, unknown>;
    if (!isStr(directive, 128) || !isStr(sink, 64) || !isStr(source, 512) || !isCount(count)) return null;
    out.push({ directive, sink, source, count });
  }
  return { entries: out, overflow: (overflow as number | undefined) ?? 0 };
}

/** Per-principal limiter: a burst bucket (3, refill 1 / 5 s) AND a 60 s sliding window (12). */
class ReportLimiter {
  private readonly state = new Map<string, { tokens: number; at: number; recent: number[] }>();
  private readonly now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }

  take(key: string): boolean {
    const t = this.now();
    const s = this.state.get(key) ?? { tokens: BURST, at: t, recent: [] };
    s.tokens = Math.min(BURST, s.tokens + (t - s.at) / REFILL_MS);
    s.at = t;
    s.recent = s.recent.filter((x) => t - x < WINDOW_MS);
    this.state.delete(key);
    this.state.set(key, s);
    if (this.state.size > MAX_COUNTER_KEYS) this.state.delete(this.state.keys().next().value as string);
    if (s.tokens < 1 || s.recent.length >= PER_MINUTE) return false;
    s.tokens -= 1;
    s.recent.push(t);
    return true;
  }
}

export function registerCspViolationRoutes(fastify: FastifyInstance, deps: CspViolationRoutesDeps): void {
  const now = deps.now ?? Date.now;
  const principalOf = deps.principalOf ?? requestPrincipalKey;
  const limiter = new ReportLimiter(now);
  /** LRU: re-inserted on every bump, oldest evicted past {@link MAX_COUNTER_KEYS}. */
  const counters = new Map<string, Entry>();

  const bump = (e: Entry) => {
    const key = `${e.directive}\u0000${e.sink}\u0000${e.source}`;
    const prev = counters.get(key);
    counters.delete(key);
    counters.set(key, { ...e, count: Math.min(Number.MAX_SAFE_INTEGER, (prev?.count ?? 0) + e.count) });
    if (counters.size > MAX_COUNTER_KEYS) counters.delete(counters.keys().next().value as string);
  };

  fastify.post(
    "/api/csp-violations",
    {
      preHandler: deps.networkGuard,
      bodyLimit: CSP_VIOLATIONS_BODY_LIMIT,
      // A rejected body is never echoed or logged.
      errorHandler: (err, _req, reply) => {
        const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 400;
        deps.log?.warn(`csp-violations: rejected report (${status})`);
        void reply.code(status).send({ success: false, error: "invalid report" });
      },
    },
    async (request, reply) => {
      const report = parseReport(request.body);
      if (!report) return reply.code(400).send({ success: false, error: "invalid report" });
      if (!limiter.take(principalOf(request))) return reply.code(429).send({ success: false, error: "rate limited" });
      for (const e of report.entries) bump(e);
      if (report.overflow > 0) bump({ directive: "report", sink: "overflow", source: "client", count: report.overflow });
      return { success: true };
    },
  );

  fastify.get("/api/csp-violations", { preHandler: deps.networkGuard }, async () => ({
    success: true,
    counters: [...counters.values()],
  }));
}
