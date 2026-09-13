/**
 * The Host-admission gate (issue #637, design D1/D4/D5/D8).
 *
 * One `onRequest` hook on the dashboard listener that refuses a `Host` header
 * the dashboard cannot justify answering on — including requests with NO
 * `Origin`, which is the half `fix-ws-origin-cswsh` could not reach. A
 * report-only rollout (default) logs `would-refuse`; `enforce` refuses with a
 * self-describing 403. Also holds the refusal ring + the rate-limited log line
 * the operator UI reads.
 *
 * Pure decisions (`resolveHostGateMode`, `admittedHostRows`) are separated from
 * I/O (the hook, the sink) so they are unit-testable.
 *
 * See change: add-host-allowlist-admission.
 */

import type { HostGateMode } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  type HostGateResponse,
  hostnameFromUrl,
  parseHostname,
} from "@blackbelt-technology/pi-dashboard-shared/host-admission.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sanitizeHeaderForLog } from "./cors-origin.js";
import {
  type AdmittedSource,
  classifyAdmittedHostname,
  type HostAdmissionOptions,
  isHostAdmitted,
  safeLiveTunnelOrigins,
} from "./host-admission.js";

export type { HostGateMode };

/** How a refusal is reported: enforced (`refused`) or report-only (`would-refuse`). */
export type HostGateOutcome = "refused" | "would-refuse";

export interface ResolvedHostGateMode {
  mode: HostGateMode;
  /** True when `PI_DASHBOARD_HOST_GATE` supplied a recognised value. */
  envOverridden: boolean;
}

/**
 * Resolve the mode: a recognised env value wins; an unrecognised one
 * contributes nothing (and is warned about once at boot); else the live config
 * value; else `report`.
 */
export function resolveHostGateMode(
  env: string | undefined,
  configMode: HostGateMode | undefined,
): ResolvedHostGateMode {
  if (env === "report" || env === "enforce") return { mode: env, envOverridden: true };
  return { mode: configMode ?? "report", envOverridden: false };
}

/**
 * The one-time boot warning for a typo'd env value. Returns `null` when the
 * value is absent, empty, or recognised.
 */
export function hostGateEnvWarning(env: string | undefined): string | null {
  if (env === undefined || env === "" || env === "report" || env === "enforce") return null;
  return `[host-gate] ignoring PI_DASHBOARD_HOST_GATE=${sanitizeHeaderForLog(env)} (expected report|enforce)`;
}

export interface HostGateRefusal {
  host: string;
  count: number;
  lastSeen: number;
  outcome: HostGateOutcome;
}

const WINDOW_MS = 60_000;
const GLOBAL_CAP = 60;
const MAX_LOG_HOSTS = 256;
const RING_MAX = 50;

export interface HostGateStateOptions {
  now?: () => number;
  sink?: (line: string) => void;
}

/**
 * Refusal bookkeeping: the operator-facing ring (counts EVERY refusal) and the
 * rate-limited log limiter (at most one line per hostname per minute, at most
 * 60 lines per minute overall, one `suppressed <n>` summary at the window
 * close). Header values are already sanitized before they reach `recordRefusal`.
 */
export class HostGateState {
  private readonly ring = new Map<string, HostGateRefusal>();
  private readonly logHosts = new Map<string, number>();
  private windowStart = 0;
  private windowCount = 0;
  private suppressed = 0;

  constructor(private readonly opts: HostGateStateOptions = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private emit(line: string): void {
    (this.opts.sink ?? console.error)(line);
  }

  /**
   * Record one non-admissible Host: bump the ring (always) and emit at most one
   * rate-limited log line. `detail` is the already-sanitized remainder of the
   * line (`origin=… METHOD url` or `origin=… scope=…`).
   */
  recordRefusal(rawHost: string | undefined, outcome: HostGateOutcome, detail: string): void {
    const host = parseHostname(rawHost) ?? "(malformed)";
    const ts = this.now();

    const existing = this.ring.get(host);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = ts;
      existing.outcome = outcome;
      this.ring.delete(host); // re-insert for most-recent-first ordering
      this.ring.set(host, existing);
    } else {
      this.ring.set(host, { host, count: 1, lastSeen: ts, outcome });
      while (this.ring.size > RING_MAX) {
        const oldest = this.ring.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.ring.delete(oldest);
      }
    }

    this.rotateWindow(ts);
    const lastLogged = this.logHosts.get(host);
    if (
      this.windowCount >= GLOBAL_CAP ||
      (lastLogged !== undefined && ts - lastLogged < WINDOW_MS)
    ) {
      this.suppressed += 1;
      return;
    }
    this.emit(`[host-gate] ${outcome} host=${sanitizeHeaderForLog(host)} ${detail}`);
    this.windowCount += 1;
    this.logHosts.delete(host);
    this.logHosts.set(host, ts);
    while (this.logHosts.size > MAX_LOG_HOSTS) {
      const oldest = this.logHosts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.logHosts.delete(oldest);
    }
  }

  private rotateWindow(ts: number): void {
    if (this.windowStart !== 0 && ts - this.windowStart < WINDOW_MS) return;
    if (this.windowStart !== 0 && this.suppressed > 0) {
      this.emit(`[host-gate] suppressed ${this.suppressed} refusal lines`);
    }
    this.windowStart = ts;
    this.windowCount = 0;
    this.suppressed = 0;
    this.logHosts.clear();
  }

  /**
   * Close the current window early. The server calls this on a 60 s interval so
   * the `suppressed <n>` summary lands even when no further refusal arrives;
   * tests call it after advancing a fake clock past the window.
   */
  flush(now = this.now()): void {
    if (this.windowStart === 0) return;
    if (now - this.windowStart < WINDOW_MS) return;
    this.rotateWindow(now);
  }

  /** Most recent distinct refusals first. */
  recent(): HostGateRefusal[] {
    return [...this.ring.values()].reverse();
  }
}

export interface HostGateContext {
  admission: HostAdmissionOptions;
  mode: HostGateMode;
  /** True when `PI_DASHBOARD_HOST_GATE` supplied the mode. */
  envOverridden: boolean;
}

/** The `GET /api/host-gate` body (D8). */
export function buildHostGateResponse(
  ctx: HostGateContext,
  state: HostGateState,
): HostGateResponse {
  return {
    success: true,
    mode: ctx.mode,
    envOverridden: ctx.envOverridden,
    admitted: admittedHostRows(ctx.admission),
    recent: state.recent(),
  };
}

export type HostGateVerdict = "admit" | "report" | "refuse";

/**
 * The shared decision behind both the REST hook and the WS upgrade check: admit
 * an admissible Host; otherwise record the refusal and either proceed (report)
 * or refuse (enforce).
 */
export function evaluateHostGate(
  hostHeader: string | undefined,
  ctx: HostGateContext,
  state: HostGateState,
  detail: string,
): HostGateVerdict {
  if (isHostAdmitted(hostHeader, ctx.admission)) return "admit";
  const outcome: HostGateOutcome = ctx.mode === "enforce" ? "refused" : "would-refuse";
  state.recordRefusal(hostHeader, outcome, detail);
  return ctx.mode === "enforce" ? "refuse" : "report";
}

/** HTML iff the `Accept` header's FIRST media type is `text/html` (D8). */
export function wantsHtml(accept: string | undefined): boolean {
  if (!accept) return false;
  const first = accept.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
  return first === "text/html";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The JSON 403 body (D4), same self-describing shape as `network_not_allowed`. */
export function hostGateRefusalBody(): {
  success: false;
  error: string;
  reason: string;
  hint: string;
} {
  return {
    success: false,
    error: "host_not_allowed",
    reason: "Host header is not an admitted hostname.",
    hint: "Add it to allowedHosts, or add the URL to publicBaseUrls.",
  };
}

/**
 * The static refusal page. No script, no `/assets/` reference, and it does NOT
 * enumerate admitted hostnames / tunnel origins / bind addresses — a rebinding
 * page is same-origin with the refused Host and can read this body (D8). The
 * received Host is attacker-controlled, so it is HTML-escaped.
 */
export function renderHostGateHtml(hostHeader: string | undefined, port: number): string {
  const received = escapeHtml(hostHeader?.trim() || "(none)");
  const localhost = `localhost:${port}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This address is not allowed</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#1c1f23}
main{max-width:34rem;padding:2.5rem 1.75rem}
h1{font-size:1.4rem;margin:0 0 .75rem}
p{margin:.6rem 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(127,127,127,.16);padding:.1rem .35rem;border-radius:.25rem}
ul{margin:.6rem 0;padding-left:1.25rem}
li{margin:.4rem 0}
.received{font-weight:600}
@media (prefers-color-scheme:dark){body{background:#16181c;color:#e8eaed}}
</style>
</head>
<body>
<main>
<h1>This address is not allowed</h1>
<p>This dashboard received a request for the host <span class="received">${received}</span>, which is not one of the hostnames it may answer on.</p>
<p>Three ways in:</p>
<ul>
<li>Open <code>http://${localhost}</code> from this machine.</li>
<li>Add this hostname to the <code>allowedHosts</code> config key.</li>
<li>Add this URL to the <code>publicBaseUrls</code> config key.</li>
</ul>
</main>
</body>
</html>
`;
}

/** Normalize a bind-address / allowedHosts entry the way a parsed Host is. */
function normalizeName(value: string): string {
  let v = value.trim().toLowerCase();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  return v.replace(/\.$/, "");
}

/**
 * The operator-visible `admitted` list (D8): pattern rows for loopback / any IP
 * / `.local`, plus one derived row per named hostname in first-match order.
 */
export function admittedHostRows(
  opts: HostAdmissionOptions,
): Array<{ host: string; source: AdmittedSource }> {
  const rows: Array<{ host: string; source: AdmittedSource }> = [
    { host: "localhost", source: "loopback" },
    { host: "any IP address", source: "ip-address" },
    { host: "*.local", source: "local" },
  ];
  const seen = new Set(rows.map((r) => r.host));
  const add = (host: string | null, source: AdmittedSource): void => {
    if (!host || seen.has(host)) return;
    seen.add(host);
    rows.push({ host, source });
  };

  if (opts.bindHost) {
    const bind = normalizeName(opts.bindHost);
    // A bind that is itself an IP / loopback / `.local` is covered by a pattern
    // row; only a genuine name gets its own bind-address row.
    if (bind && classifyAdmittedHostname(bind, {}) === null) add(bind, "bind-address");
  }
  for (const raw of opts.publicBaseUrls ?? []) add(hostnameFromUrl(raw), "public-base-url");
  for (const raw of opts.configuredOrigins ?? []) add(hostnameFromUrl(raw), "cors-origin");
  for (const raw of safeLiveTunnelOrigins(opts)) add(hostnameFromUrl(raw), "live-tunnel");
  for (const raw of opts.allowedHosts ?? []) add(normalizeName(raw), "allowed-host");
  return rows;
}

/**
 * The `onRequest` hook factory. Registered BEFORE `@fastify/cors` so an
 * enforced refusal carries no `Access-Control-Allow-Origin`.
 */
export function createHostGate(
  getCtx: () => HostGateContext,
  state: HostGateState,
  port: () => number,
) {
  return function hostGate(
    req: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void,
  ): void {
    const ctx = getCtx();
    const detail = `origin=${sanitizeHeaderForLog(req.headers.origin)} ${sanitizeHeaderForLog(
      req.method,
    )} ${sanitizeHeaderForLog(req.url)}`;
    if (evaluateHostGate(req.headers.host, ctx, state, detail) !== "refuse") return done();

    if (wantsHtml(req.headers.accept)) {
      reply.code(403).type("text/html; charset=utf-8").send(renderHostGateHtml(req.headers.host, port()));
    } else {
      reply.code(403).send(hostGateRefusalBody());
    }
  };
}
