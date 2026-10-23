/**
 * Baseline CSP violation report sink — `POST /__pi/csp-report/:policy`
 * (`:policy` ∈ baseline | strict | trusted-types) — and the operator reset
 * `POST /api/csp-reports/reset`.
 *
 * The sink is mounted at the root, OUTSIDE guard jurisdiction, and is public to the OAuth
 * gate (`auth-plugin.ts`) so signed-out pages can report. It is unauthenticated, so it is
 * hardened: 8 KiB cap by its OWN byte-counting read (chunked bodies included, independent of
 * `Content-Length`, `bodyLimit` and parser registration order — it lives in an encapsulated
 * Fastify scope with only a pass-through stream parser), exact content types, a dedicated
 * per-socket-peer token bucket (capacity 20, 1 token/s; loopback NOT exempt), a 5 s body
 * deadline, compressed bodies refused undecompressed. Nothing from a report is reflected in a
 * response or logged; the only log line is `[csp] violation policy=<label> directive=<x>`.
 *
 * Order of refusal: 404 (label) → 405 (method) → 429 → 415 → 413 / 408 / 400. Refused-by-limiter,
 * size cap or deadline reports bump the persisted `dropped` counter.
 *
 * See change: harden-cors-and-csp-reporting (D8).
 */

import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { NetworkGuard } from "../routes/route-deps.js";
import { CSP_REPORT_PREFIX, type CspReportPolicy, isCspReportPolicy } from "./csp-report-paths.js";
import { type CspReportStore, normalizeDirective } from "./csp-report-store.js";

const CSP_REPORT_MAX_BYTES = 8 * 1024;
const BODY_DEADLINE_MS = 5_000;
const LIMITER_CAPACITY = 20;
/** Integer bucket arithmetic: one token = 1000 units, refilled 1 unit per ms (exact; no float drift). */
const TOKEN = 1_000;
const CAPACITY_UNITS = LIMITER_CAPACITY * TOKEN;
/** Hard bound on tracked peers; the oldest-inserted entries go first once the idle sweep frees nothing. */
const MAX_LIMITER_PEERS = 100_000;
const SWEEP_EVERY_MS = 1_000;
/** One `[csp] violation` line per policy × directive per window. */
const LOG_THROTTLE_MS = 60_000;
const MAX_LOG_KEYS = 128;

const REPORT_TYPES = new Set(["application/csp-report", "application/reports+json"]);
const SINK_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;

/** Per-peer token bucket: capacity {@link LIMITER_CAPACITY}, refilled 1 token/s; full + idle entries are evicted. */
class PeerLimiter {
  private readonly peers = new Map<string, { units: number; at: number }>();
  private lastSweep = 0;
  private readonly now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }

  get size(): number {
    return this.peers.size;
  }

  take(peer: string): boolean {
    const t = this.now();
    this.sweep(t);
    const prev = this.peers.get(peer);
    const units = prev ? Math.min(CAPACITY_UNITS, prev.units + (t - prev.at)) : CAPACITY_UNITS;
    const ok = units >= TOKEN;
    this.peers.delete(peer);
    this.peers.set(peer, { units: ok ? units - TOKEN : units, at: t });
    return ok;
  }

  /** Drop entries whose bucket would be full again; bound the map even under a wide peer flood. */
  private sweep(t: number): void {
    if (t - this.lastSweep < SWEEP_EVERY_MS && this.peers.size < MAX_LIMITER_PEERS) return;
    this.lastSweep = t;
    for (const [peer, s] of this.peers) {
      if (s.units + (t - s.at) >= CAPACITY_UNITS) this.peers.delete(peer);
    }
    while (this.peers.size >= MAX_LIMITER_PEERS) this.peers.delete(this.peers.keys().next().value as string);
  }
}

/**
 * After a 413 the rest of the upload is drained (and discarded) so the refusal reaches the client, but only for a
 * bounded time: an endless chunked body must not pin the connection. Destroyed once `ms` elapses unless it ended.
 */
function boundedDrain(raw: IncomingMessage, ms: number): void {
  if (raw.readableEnded || raw.destroyed) return;
  const timer = setTimeout(() => raw.destroy(), ms);
  timer.unref?.();
  const clear = () => clearTimeout(timer);
  raw.once("end", clear);
  raw.once("close", clear);
  raw.resume();
}

type ReadResult = { kind: "ok"; body: Buffer } | { kind: "too-large" } | { kind: "timeout" } | { kind: "aborted" };

/** Read at most `cap` bytes of `raw`, counting what arrives; stops listening at the cap or the deadline. */
function readCapped(
  raw: IncomingMessage,
  cap: number,
  deadlineMs: number,
  onBytes?: (total: number) => void,
): Promise<ReadResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (r: ReadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      raw.off("data", onData);
      raw.off("end", onEnd);
      raw.off("error", onAbort);
      raw.off("aborted", onAbort);
      raw.off("close", onAbort);
      // Keep draining (and discarding) what the client still sends, so the refusal reaches it and the
      // connection stays usable; nothing is buffered or counted from here on.
      raw.resume();
      onBytes?.(total);
      if (r.kind === "too-large") boundedDrain(raw, deadlineMs);
      resolve(r);
    };
    const onData = (c: Buffer | string) => {
      const b = typeof c === "string" ? Buffer.from(c) : c;
      total += b.length;
      if (total > cap) return finish({ kind: "too-large" });
      chunks.push(b);
    };
    const onEnd = () => finish({ kind: "ok", body: Buffer.concat(chunks) });
    const onAbort = () => finish({ kind: "aborted" });
    const timer = setTimeout(() => finish({ kind: "timeout" }), deadlineMs);
    timer.unref?.();
    if (raw.readableEnded) return finish({ kind: "ok", body: Buffer.alloc(0) });
    raw.on("data", onData);
    raw.on("end", onEnd);
    raw.on("error", onAbort);
    raw.on("aborted", onAbort);
    raw.on("close", onAbort);
    raw.resume();
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The report objects in a parsed body: legacy `{ "csp-report": {…} }`, or a Reporting API
 * array (or single element) of `{ type: "csp-violation", body: {…} }`. `null` = not a CSP report.
 */
function extractReports(json: unknown): Record<string, unknown>[] | null {
  const items = Array.isArray(json) ? json : [json];
  const out: Record<string, unknown>[] = [];
  for (const it of items) {
    if (!isObj(it)) continue;
    if (isObj(it["csp-report"])) out.push(it["csp-report"]);
    else if (isObj(it.body) && (it.type === undefined || it.type === "csp-violation")) out.push(it.body);
  }
  return out.length > 0 ? out : null;
}

/** The report objects in a request body, or `null` when it is not JSON or not a CSP report. */
function parseReports(body: Buffer): Record<string, unknown>[] | null {
  try {
    return extractReports(JSON.parse(body.toString("utf8")));
  } catch {
    return null;
  }
}

/** `effective-directive` / `effectiveDirective`, else the first token of `violated-directive`; lowercased. */
function directiveOf(r: Record<string, unknown>): string {
  const eff = str(r["effective-directive"]) ?? str(r.effectiveDirective);
  if (eff) return eff.trim().toLowerCase();
  const violated = str(r["violated-directive"]) ?? str(r.violatedDirective);
  return violated?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/** Path (no query/fragment) of the report's document, or undefined. */
function documentPathOf(r: Record<string, unknown>): string | undefined {
  const uri = str(r["document-uri"]) ?? str(r.documentURL) ?? str(r.documentUri);
  if (!uri) return undefined;
  try {
    return new URL(uri).pathname;
  } catch {
    return undefined;
  }
}

export interface CspReportSinkDeps {
  store: CspReportStore;
  /** Guards the operator reset route (the sink itself is unauthenticated by design). */
  networkGuard: NetworkGuard;
  /** Clock for the limiter and the log throttle (default `Date.now`). */
  now?: () => number;
  /** Body read deadline (default {@link BODY_DEADLINE_MS}). */
  bodyDeadlineMs?: number;
  /** Log sink for the throttled violation line (default `console.warn`). */
  log?: (msg: string) => void;
  /** Observer: total bytes the sink read for one request (test/ops hook; never carries content). */
  onBodyRead?: (bytes: number) => void;
}

function refuse(reply: FastifyReply, code: number, error: string, closeConnection = false): FastifyReply {
  // Only a stalled body (408) ends the connection; draining a trickle would hold it for as long as the client likes.
  if (closeConnection) reply.header("connection", "close");
  return reply.code(code).send({ error });
}

/**
 * Register the sink (encapsulated scope) and the operator reset route on `fastify`.
 * The store is flushed when the server closes. The handle exposes the limiter's tracked-peer count (tests/ops).
 */
export function registerCspReportSink(fastify: FastifyInstance, deps: CspReportSinkDeps): { trackedPeers(): number } {
  const { store, networkGuard } = deps;
  const now = deps.now ?? Date.now;
  const deadline = deps.bodyDeadlineMs ?? BODY_DEADLINE_MS;
  const log = deps.log ?? ((m: string) => console.warn(m));
  const limiter = new PeerLimiter(now);
  const lastLogged = new Map<string, number>();

  const logViolation = (policy: CspReportPolicy, directive: string) => {
    const key = `${policy}\u0000${directive}`;
    const t = now();
    const prev = lastLogged.get(key);
    if (prev !== undefined && t - prev < LOG_THROTTLE_MS) return;
    if (lastLogged.size >= MAX_LOG_KEYS) lastLogged.clear();
    lastLogged.set(key, t);
    log(`[csp] violation policy=${policy} directive=${directive}`);
  };

  fastify.addHook("onClose", async () => store.close());

  fastify.register(async (scope) => {
    // This scope owns body handling: drop whatever parsers the root (or the live sink) registered
    // and hand the raw stream to the handler, which reads it with its own counting reader.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

    /** Refusals on the request line: 404 (label) → 405 (method) → 429 (limiter). */
    const admit = (request: FastifyRequest, reply: FastifyReply, policy: string): FastifyReply | null => {
      if (!isCspReportPolicy(policy)) return refuse(reply, 404, "not found");
      if (request.method !== "POST") {
        reply.header("allow", "POST");
        return refuse(reply, 405, "method not allowed");
      }
      if (limiter.take(request.socket?.remoteAddress ?? request.ip)) return null;
      store.recordDropped();
      return refuse(reply, 429, "too many reports");
    };

    /** Refusals from the headers, before the body is read: 415 → compressed 400 → declared-size 413. */
    const screen = (request: FastifyRequest, reply: FastifyReply): FastifyReply | null => {
      const mediaType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!REPORT_TYPES.has(mediaType)) return refuse(reply, 415, "unsupported media type");
      const encoding = String(request.headers["content-encoding"] ?? "").trim().toLowerCase();
      if (encoding && encoding !== "identity") return refuse(reply, 400, "invalid report");
      const declared = Number(request.headers["content-length"]);
      if (!Number.isFinite(declared) || declared <= CSP_REPORT_MAX_BYTES) return null;
      deps.onBodyRead?.(0);
      store.recordDropped();
      boundedDrain(request.raw, deadline);
      return refuse(reply, 413, "report too large");
    };

    /** The reply for a body read that did not complete. */
    const refuseUnfinished = (reply: FastifyReply, kind: "too-large" | "timeout" | "aborted"): FastifyReply => {
      // Client went away: nothing counted; the reply goes nowhere.
      if (kind === "aborted") return reply.code(400).send();
      store.recordDropped();
      return kind === "too-large" ? refuse(reply, 413, "report too large") : refuse(reply, 408, "request timeout", true);
    };

    scope.route({
      method: [...SINK_METHODS],
      url: `${CSP_REPORT_PREFIX}:policy`,
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const { policy } = request.params as { policy: string };
        const early = admit(request, reply, policy) ?? screen(request, reply);
        if (early) return early;

        const read = await readCapped(request.raw, CSP_REPORT_MAX_BYTES, deadline, deps.onBodyRead);
        if (read.kind !== "ok") return refuseUnfinished(reply, read.kind);

        const reports = parseReports(read.body);
        if (!reports) return refuse(reply, 400, "invalid report");
        for (const r of reports) {
          const directive = directiveOf(r);
          store.record(policy as CspReportPolicy, directive, documentPathOf(r));
          // Log the allow-set form only, never report text.
          logViolation(policy as CspReportPolicy, normalizeDirective(directive));
        }
        return reply.code(204).send();
      },
    });
  });

  // Operator reset: tier `operate` (route-tiers.ts), behind the network guard like every /api route.
  fastify.post("/api/csp-reports/reset", { preHandler: networkGuard }, async () => ({
    success: true,
    since: store.reset(),
  }));

  return { trackedPeers: () => limiter.size };
}
