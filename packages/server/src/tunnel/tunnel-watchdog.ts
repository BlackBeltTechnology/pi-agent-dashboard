/**
 * Tunnel watchdog: periodically probes the public tunnel URL through the
 * zrok edge and recycles the tunnel when consecutive failures (5xx, network
 * errors, timeouts) exceed a threshold.
 *
 * The zrok `share` subprocess can stay running for days while its connection
 * to the zrok edge silently goes stale, returning HTTP 502 from the public
 * URL even though the local upstream is healthy. The fix is a `deleteTunnel`
 * + `createTunnel` cycle (preserves the reserved token, so the URL stays the
 * same).
 *
 * Probe semantics: we treat ONLY 5xx and network/timeout failures as bad.
 * Any 2xx/3xx/4xx response proves zrok edge ↔ local server connectivity is
 * fine and counts as success — even if the local route is auth-gated.
 */

export interface TunnelWatchdogDeps {
  /** Returns the active public tunnel URL, or null if no tunnel is up. */
  getUrl: () => string | null;
  /** Recycle the tunnel: delete and recreate. Returns the new URL or null. */
  recycle: () => Promise<string | null>;
  /** Optional fetch override for tests. */
  fetchFn?: typeof fetch;
  /** Optional logger; defaults to console. */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface TunnelWatchdogConfig {
  /** Master switch. Default: true. */
  enabled: boolean;
  /** Probe cadence. Default: 60_000. */
  intervalMs: number;
  /** Consecutive failures before recycling. Default: 2. */
  failureThreshold: number;
  /** Per-probe HTTP timeout. Default: 10_000. */
  probeTimeoutMs: number;
}

export const DEFAULT_TUNNEL_WATCHDOG_CONFIG: TunnelWatchdogConfig = {
  enabled: true,
  intervalMs: 60_000,
  failureThreshold: 2,
  probeTimeoutMs: 10_000,
};

export interface TunnelWatchdogStatus {
  running: boolean;
  intervalMs: number;
  failureThreshold: number;
  probeTimeoutMs: number;
  lastProbeAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  lastRecycleAt: number | null;
  recycleCount: number;
}

interface WatchdogState {
  cfg: TunnelWatchdogConfig;
  deps: TunnelWatchdogDeps;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  recycling: boolean;
  /** Current backoff multiplier applied after a recycle failure (1, 2, 4, …, capped). */
  backoffMultiplier: number;
  status: TunnelWatchdogStatus;
}

let state: WatchdogState | null = null;

const MAX_BACKOFF_MULTIPLIER = 8;

function defaultLog(level: "info" | "warn" | "error", msg: string): void {
  const prefix = "[tunnel-watchdog]";
  if (level === "warn") console.warn(prefix, msg);
  else if (level === "error") console.error(prefix, msg);
  else console.log(prefix, msg);
}

function makeInitialStatus(cfg: TunnelWatchdogConfig): TunnelWatchdogStatus {
  return {
    running: false,
    intervalMs: cfg.intervalMs,
    failureThreshold: cfg.failureThreshold,
    probeTimeoutMs: cfg.probeTimeoutMs,
    lastProbeAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    consecutiveFailures: 0,
    lastRecycleAt: null,
    recycleCount: 0,
  };
}

/** Probe outcome: ok=true on 2xx/3xx/4xx, false on 5xx/network/timeout. */
export async function probeTunnel(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const probeUrl = url.replace(/\/+$/, "") + "/api/health";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(probeUrl, { method: "GET", signal: ctrl.signal });
    if (res.status >= 500) {
      return { ok: false, status: res.status, reason: `http ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? `timeout ${timeoutMs}ms` : (err?.message || "network error");
    return { ok: false, reason };
  } finally {
    clearTimeout(t);
  }
}

function scheduleNext(): void {
  if (!state) return;
  const delay = state.cfg.intervalMs * state.backoffMultiplier;
  state.timer = setTimeout(() => { void tick(); }, delay);
  // Don't keep the event loop alive for the watchdog alone.
  if (typeof (state.timer as any).unref === "function") (state.timer as any).unref();
}

async function tick(): Promise<void> {
  if (!state) return;
  if (state.inFlight) { scheduleNext(); return; }
  state.inFlight = true;
  try {
    const url = state.deps.getUrl();
    if (!url) {
      // No tunnel up — nothing to probe; keep ticking in case it comes up.
      return;
    }
    const fetchFn = state.deps.fetchFn ?? fetch;
    state.status.lastProbeAt = Date.now();
    const result = await probeTunnel(url, state.cfg.probeTimeoutMs, fetchFn);
    if (result.ok) {
      state.status.lastSuccessAt = Date.now();
      state.status.consecutiveFailures = 0;
      state.backoffMultiplier = 1;
      return;
    }
    state.status.lastFailureAt = Date.now();
    state.status.lastFailureReason = result.reason ?? "unknown";
    state.status.consecutiveFailures += 1;
    (state.deps.log ?? defaultLog)(
      "warn",
      `probe failed (${state.status.consecutiveFailures}/${state.cfg.failureThreshold}): ${state.status.lastFailureReason}`,
    );
    if (state.status.consecutiveFailures >= state.cfg.failureThreshold && !state.recycling) {
      await runRecycle();
    }
  } finally {
    state.inFlight = false;
    if (state) scheduleNext();
  }
}

async function runRecycle(): Promise<void> {
  if (!state) return;
  state.recycling = true;
  const log = state.deps.log ?? defaultLog;
  log("warn", `recycling tunnel after ${state.status.consecutiveFailures} consecutive failures`);
  try {
    const newUrl = await state.deps.recycle();
    state.status.lastRecycleAt = Date.now();
    state.status.recycleCount += 1;
    state.status.consecutiveFailures = 0;
    if (newUrl) {
      log("info", `tunnel recycled: ${newUrl}`);
      state.backoffMultiplier = 1;
    } else {
      log("error", "tunnel recycle returned no URL — backing off");
      state.backoffMultiplier = Math.min(state.backoffMultiplier * 2 || 2, MAX_BACKOFF_MULTIPLIER);
    }
  } catch (err: any) {
    log("error", `tunnel recycle threw: ${err?.message ?? err}`);
    state.backoffMultiplier = Math.min(state.backoffMultiplier * 2 || 2, MAX_BACKOFF_MULTIPLIER);
  } finally {
    state.recycling = false;
  }
}

export function startTunnelWatchdog(
  deps: TunnelWatchdogDeps,
  cfg: Partial<TunnelWatchdogConfig> = {},
): void {
  if (state) return; // already running
  const merged: TunnelWatchdogConfig = { ...DEFAULT_TUNNEL_WATCHDOG_CONFIG, ...cfg };
  if (!merged.enabled) return;
  state = {
    cfg: merged,
    deps,
    timer: null,
    inFlight: false,
    recycling: false,
    backoffMultiplier: 1,
    status: makeInitialStatus(merged),
  };
  state.status.running = true;
  scheduleNext();
}

export function stopTunnelWatchdog(): void {
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.status.running = false;
  state = null;
}

export function getTunnelWatchdogStatus(): TunnelWatchdogStatus | null {
  if (!state) return null;
  return { ...state.status };
}

/** Test-only: force a tick now (returns when the tick completes). */
export async function _runTickForTest(): Promise<void> {
  await tick();
}

/** Test-only: reset module-level state. */
export function _resetForTest(): void {
  if (state?.timer) clearTimeout(state.timer);
  state = null;
}
