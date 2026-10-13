/**
 * Server identity verification via HTTP health check.
 * Replaces bare TCP port probes with identity-verified dashboard detection.
 *
 * Retry semantics (cherry-pick 2 of harvest-bootstrap-survivor-fixes):
 * the pre-wizard probe in Electron's main process fires while a *previous*
 * server instance may still be mid-bootstrap (jiti TypeScript transpile +
 * cold-cache extraction can block the event loop for 5–15 s). The default
 * 2 s timeout + 1 attempt produces false negatives in that window.
 * Callers can opt into a bounded retry loop via `opts.retries` /
 * `opts.timeoutMs` / `opts.retryDelayMs`. Defaults preserve legacy
 * behaviour (single attempt, 2 s timeout) so existing call sites are
 * unaffected.
 */
import { formatHostPort } from "./host-port.js";

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 500;

export interface DashboardStatus {
  /** Whether the dashboard server is running on this port */
  running: boolean;
  /** PID of the running server (if detected) */
  pid?: number;
  /** Server version from /api/health (when detected) */
  version?: string;
  /** Port is occupied by a non-dashboard service */
  portConflict?: boolean;
  /**
   * Rendezvous instance id published by `/api/health` (when detected). Lets a
   * caller prove ownership from the same response, with no second fetch.
   * See change: harden-dashboard-start-detection.
   */
  instanceId?: string;
  /**
   * No attempt produced a definitive outcome (success, conflict or refusal):
   * every attempt timed out or failed without ECONNREFUSED (reset, hang-up).
   * "Held but silent" — distinct from "nothing there". Absent on a refusal.
   * See change: harden-dashboard-start-detection (D1).
   */
  timedOut?: boolean;
}

export interface DashboardCheckOpts {
  /**
   * Per-attempt fetch timeout. Default 2000 ms — preserves legacy single-shot behaviour.
   * Bootstrap-aware callers should pass ~8000 ms to absorb event-loop hiccups
   * during cold-cache install.
   */
  timeoutMs?: number;
  /**
   * Number of additional attempts after the first. Default 0 (no retries).
   * The loop retries ONLY on `AbortError` (timeout) — a server may be
   * mid-jiti-bootstrap. Anything definitive short-circuits after one
   * attempt: `portConflict: true` (HTTP 200 with foreign JSON shape, which
   * includes ALL non-ok statuses — a 5xx is never retried) and a real
   * ECONNREFUSED refusal (internal flag; fix-autostart-discovery-precedence
   * F7/D1).
   */
  retries?: number;
  /** Sleep between retries. Default 500 ms. */
  retryDelayMs?: number;
  /**
   * Test seam: replace `setTimeout`-based sleep. Receives the configured
   * `retryDelayMs`. Must return a promise that resolves after the sleep.
   */
  _sleep?: (ms: number) => Promise<void>;
}

/**
 * Check if a dashboard server is running on the given port by hitting GET /api/health.
 * Returns identity-verified status instead of just "port is open".
 */
/**
 * Internal probe result — `refused` drives the retry short-circuit (F7/D1:
 * a refusal is definitive; retrying only delays a cold start) and is
 * deliberately STRIPPED from the public return shape. The public shape
 * distinguishes the two non-running outcomes through `timedOut` instead: it is
 * set when no attempt was definitive (silent), and absent on a refusal.
 */
type ProbeResult = DashboardStatus & { refused?: boolean };

export async function isDashboardRunning(
  port: number,
  host: string = "localhost",
  opts?: DashboardCheckOpts,
): Promise<DashboardStatus> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = opts?._sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const attempts = retries + 1;
  for (let i = 0; i < attempts; i++) {
    const result = await probeOnce(port, host, timeoutMs) as ProbeResult;
    // Success — return immediately.
    if (result.running) return result;
    // Deterministic conflict — short-circuit (retrying would mask it).
    if (result.portConflict) return result;
    // Definitive refusal — short-circuit, STRIPPED of the internal flag.
    if (result.refused) return { running: false };
    // Reaching here: not running, not a conflict, not a refusal — a timeout or
    // a reset/hang-up. Not definitive, so retry; if every attempt ends here
    // the port is held but silent.
    if (i < attempts - 1) await sleep(retryDelayMs);
  }
  return { running: false, timedOut: true };
}

async function probeOnce(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://${formatHostPort(host, port)}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { running: false, portConflict: true };
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (data && data.ok === true && typeof data.pid === "number") {
      const version = typeof data.version === "string" ? data.version : undefined;
      const result: ProbeResult = { running: true, pid: data.pid, version };
      if (typeof data.instanceId === "string") result.instanceId = data.instanceId;
      return result;
    }

    // HTTP 200 but not our format — another service
    return { running: false, portConflict: true };
  } catch (err: unknown) {
    clearTimeout(timer);
    // Connection refused or timeout — nothing running
    if (err instanceof Error && err.name === "AbortError") {
      return { running: false };
    }
    // Node's fetch surfaces a refusal as TypeError with cause.code ===
    // "ECONNREFUSED"; dual-stack (Happy Eyeballs) refusals surface as an
    // AggregateError whose errors[] carry the per-address codes. A refusal
    // is DEFINITIVE — flagged internally so the retry loop short-circuits
    // (F7/D1); stripped from the public return (see ProbeResult).
    return { running: false, refused: isRefusal(err) };
  }
}

/**
 * "Nothing can be listening there": a refusal, or an address family / route the
 * host does not have (an IPv6-less container refuses `::1` with EADDRNOTAVAIL,
 * not ECONNREFUSED). Without the latter, probing both loopbacks would report
 * every free port as "held but silent" on such hosts.
 * See change: harden-dashboard-start-detection.
 */
const REFUSAL_CODES = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "ENETUNREACH", "EAFNOSUPPORT"]);

function isRefusal(err: unknown): boolean {
  const e = err as {
    code?: string;
    cause?: { code?: string; errors?: Array<{ code?: string }> };
  };
  if (e?.code && REFUSAL_CODES.has(e.code)) return true;
  if (e?.cause?.code && REFUSAL_CODES.has(e.cause.code)) return true;
  return Array.isArray(e?.cause?.errors) &&
    e.cause.errors.some((x) => !!x?.code && REFUSAL_CODES.has(x.code));
}
