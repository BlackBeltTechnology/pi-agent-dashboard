/**
 * Client boot gate for the MEMORY subcard (design D4) — mechanism #6's
 * resolution of the five failed gate attempts.
 *
 * The manifest-level `shouldRenderMemorySubcard` reads a module-level boolean
 * SYNCHRONOUSLY and fails closed until the boot check resolves (F1) — no
 * promise, no throw, no async gate path. `resolveInstalled()` fetches the
 * plugin's own `/status` route; anything other than a well-formed
 * `200 { installed: boolean }` (network error, any non-200 incl. the 404 of a
 * disabled plugin, malformed body) is TRANSIENT: it retries with capped
 * backoff (3 attempts), then continues at a slow fixed interval UNTIL the
 * first success — it never gives up, so a transient failure is never a
 * permanent false negative (mechanism-5 defect #3). After the first success
 * the value is final for the page lifetime; no re-poll. A successful resolve
 * bumps the runtime's slot-claims invalidation store (D3) so gates on idle
 * sessions that never broadcast again re-evaluate (F2).
 *
 * The module-scope kick in the client entry is GUARDED so it does not run
 * under vitest/jsdom (mechanism-5 defect #2 — the bare `fetch` broke the whole
 * test suite). The guard detects vitest specifically — `import.meta.vitest` or
 * a typeof-guarded `process.env.VITEST` read, NOT `import.meta.env.MODE`,
 * which a custom `--mode` run bypasses. The `typeof process` guard is
 * load-bearing: `process` does not exist in the browser bundle, and an
 * unguarded read at module scope would throw in production — the mirror image
 * of the breakage it prevents.
 *
 * See change: add-blackhole-session-pipeline.
 */
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
import { STATUS_ROUTE } from "./routes.js";

/** Module-level gate value. `null` = unresolved → fail closed (F1). */
let installed: boolean | null = null;

/**
 * Synchronous gate named in the manifest's `shouldRender` string. `false`
 * until the boot check resolves — closed by default, including for sessions
 * whose extension never loaded (spec: no-activity-yet state, not a hidden
 * subcard — that distinction lives in the subcard, not the gate).
 */
export function shouldRenderMemorySubcard(
  _session?: unknown,
): boolean {
  return installed === true;
}

export interface ResolveInstalledOptions {
  /** Injectable fetch (tests inject; production uses global fetch). */
  fetchImpl?: typeof fetch;
  /** Capped-backoff schedule for transient failures (ms). Default 1s/2s/4s. */
  backoffMs?: number[];
  /** Slow fixed interval after backoff is exhausted (ms). Default 60s. */
  slowIntervalMs?: number;
}

/**
 * True when running under vitest — the module-scope kick checks this and does
 * nothing in tests (F4). Both probes are intentional: `import.meta.vitest` is
 * vitest's own flag; `process.env.VITEST` covers configs that disable the
 * transform. The `typeof process` guard keeps the browser bundle safe.
 * `override` lets tests exercise both branches.
 */
export function isTestEnvironment(override?: boolean): boolean {
  if (override !== undefined) return override;
  if (
    typeof import.meta !== "undefined" &&
    (import.meta as { vitest?: unknown }).vitest === true
  ) {
    return true;
  }
  return typeof process !== "undefined" && (process as { env?: Record<string, string | undefined> }).env?.VITEST === "true";
}

interface ActivePolling {
  timer: ReturnType<typeof setTimeout> | null;
}

let active: ActivePolling | null = null;

/**
 * Kick the boot check. Never throws. Transient failures (network error,
 * non-200, malformed body) retry with capped backoff, then at the slow
 * interval, until the first success — which finalizes the value, bumps the
 * slot-claims store exactly once, and stops all polling.
 */
export function resolveInstalled(opts: ResolveInstalledOptions = {}): void {
  // Already resolved: the value is final for the page lifetime (no re-poll,
  // no second bump). A repeated kick is a no-op.
  if (installed !== null) return;
  const fetchImpl =
    opts.fetchImpl ??
    ((...args: Parameters<typeof fetch>) => fetch(...args));
  const backoff = opts.backoffMs ?? [1_000, 2_000, 4_000];
  const slowIntervalMs = opts.slowIntervalMs ?? 60_000;

  // One polling chain at a time: a second call (e.g. HMR) replaces the first.
  if (active?.timer) clearTimeout(active.timer);
  const state: ActivePolling = { timer: null };
  active = state;

  let attempt = 0; // completed attempts
  const tick = (): void => {
    fetchImpl(STATUS_ROUTE)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as { installed?: unknown }).installed !== "boolean"
        ) {
          throw new Error("malformed status body");
        }
        return (body as { installed: boolean }).installed;
      })
      .then((value) => {
        // A newer chain superseded this one (HMR): stay silent — the winner
        // owns the bump and the value.
        if (active !== state) return;
        // Success finalizes the page-lifetime value. No re-poll: the timer
        // chain ends here, so nothing is scheduled after this point.
        installed = value;
        state.timer = null;
        if (active === state) active = null;
        // D3: nudge every mounted gate wrapper — including idle/ended
        // sessions that will never emit session_updated again.
        bumpSlotClaimsVersion();
      })
      .catch(() => {
        // Transient (X2): value stays unresolved → the gate stays closed.
        // NEVER give up: backoff is capped, then a slow fixed interval runs
        // until the first success (X1).
        const delay = attempt < backoff.length ? backoff[attempt] : slowIntervalMs;
        attempt += 1;
        state.timer = setTimeout(tick, delay);
      });
  };
  tick();
}

/** Test-only: reset module state between tests. */
export function __resetInstalledGateForTests(): void {
  if (active?.timer) clearTimeout(active.timer);
  active = null;
  installed = null;
}
