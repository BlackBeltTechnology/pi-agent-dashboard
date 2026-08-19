/**
 * Per-provider readiness — what is installed, enrolled and connected.
 *
 * The board composes the three predicates the provider seam ALREADY declares,
 * which all four providers already implement. `detectBinary` and `isEnrolled`
 * previously had one consumer each — connect-time preconditions — and nothing
 * surfaced them, so the Gateway's provider chips rendered from a hardcoded list
 * and looked identical whether a provider was installed or absent.
 *
 * Two corrections to "this needs no new detection logic", both found at source:
 *
 *  1. `status().active` is in-memory state recording only whether THIS process
 *     completed a `connect()`. A daemon started in a terminal reads
 *     `disconnected` forever; a daemon that died reads `connected` forever.
 *     Daemon providers therefore use `probeLive()`.
 *  2. `registry.rescan()` cannot reach a provider's module-scope binary memo.
 *     zrok and ngrok both hold one, so readiness calls their public
 *     invalidation entry point too.
 *
 * Every predicate is bounded below the poll interval and failure is per
 * provider: a throwing OR hung predicate degrades its own row and never blanks
 * the board.
 *
 * See change: add-zrok-custom-reserved-name (D6).
 */
import {
  type AsyncEnrollmentCheck,
  type BinaryCacheInvalidation,
  type DaemonLivenessProbe,
  hasAsyncEnrollmentCheck,
  hasBinaryCacheInvalidation,
  hasLivenessProbe,
  type ProviderReadiness,
  READINESS_PREDICATE_TIMEOUT_MS,
  type TunnelEndpoint,
  type TunnelProvider,
  type TunnelProviderId,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

/** Marks a predicate that exceeded its bound, distinct from one that returned false. */
const TIMED_OUT = Symbol("timed-out");

/**
 * Run `fn` under a hard bound.
 *
 * Returns {@link TIMED_OUT} rather than throwing so a timeout stays
 * distinguishable from a genuine `false`: the board reports the false-branch
 * state either way, but only one of them is `stale`.
 *
 * The timer is always cleared, including on the winning path — an uncleared
 * 4s timer per provider per 5s tick would keep the event loop hot for the life
 * of the dialog.
 */
async function withBound<T>(
  fn: () => T | Promise<T>,
  ms: number = READINESS_PREDICATE_TIMEOUT_MS,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Evaluate one provider.
 *
 * Short-circuits in predicate order, which is not merely an optimisation: when
 * the binary is absent, `isEnrolled()` and the liveness probe are shell-outs
 * that would fail slowly and tell us nothing we do not already know.
 */
export async function evaluateProvider(
  provider: TunnelProvider,
  opts: { timeoutMs?: number; rescan?: (id: TunnelProviderId) => void } = {},
): Promise<ProviderReadiness> {
  const id = provider.id;
  const bound = <T>(fn: () => T | Promise<T>) => withBound(fn, opts.timeoutMs);
  const empty: TunnelEndpoint[] = [];

  // A registry rescan alone leaves a provider's own module-scope memo stale, so
  // both are invalidated before the binary is probed.
  try {
    opts.rescan?.(id);
    if (hasBinaryCacheInvalidation(provider)) {
      (provider as unknown as BinaryCacheInvalidation).invalidateBinaryCache();
    }
  } catch {
    // Invalidation is an optimisation; failing it must not fail the row.
  }

  // ── 1. installed? ──────────────────────────────────────────────────
  let installed: boolean | typeof TIMED_OUT;
  try {
    installed = await bound(() => provider.detectBinary());
  } catch (err) {
    return { provider: id, state: "not-installed", endpoints: empty, stale: true, reason: reasonOf("detectBinary", err) };
  }
  if (installed === TIMED_OUT) {
    return { provider: id, state: "not-installed", endpoints: empty, stale: true, reason: "detectBinary timed out" };
  }
  if (!installed) return { provider: id, state: "not-installed", endpoints: empty, reason: "detectBinary false" };

  // ── 2. enrolled? ───────────────────────────────────────────────────
  // Prefer the ASYNC variant where a provider offers one. `isEnrolled()` is
  // synchronous, and for the daemon providers it shells out with a 30s exec
  // timeout — a synchronous call blocks the event loop, so racing it against a
  // timer bounds NOTHING and a hung CLI freezes the whole server, not one row.
  let enrolled: boolean | typeof TIMED_OUT;
  try {
    enrolled = await bound(() =>
      hasAsyncEnrollmentCheck(provider)
        ? (provider as unknown as AsyncEnrollmentCheck).isEnrolledAsync()
        : provider.isEnrolled(),
    );
  } catch (err) {
    return { provider: id, state: "not-set", endpoints: empty, stale: true, reason: reasonOf("isEnrolled", err) };
  }
  if (enrolled === TIMED_OUT) {
    return { provider: id, state: "not-set", endpoints: empty, stale: true, reason: "isEnrolled timed out" };
  }
  if (!enrolled) return { provider: id, state: "not-set", endpoints: empty, reason: "isEnrolled false" };

  // ── 3. live? ───────────────────────────────────────────────────────
  // A daemon's liveness is a property of the DAEMON, not of this process's
  // memory, so `status()` cannot answer it in either direction.
  const useProbe = provider.kind === "daemon" && hasLivenessProbe(provider);
  try {
    const endpoints = await bound<TunnelEndpoint[]>(() => {
      if (useProbe) return (provider as unknown as DaemonLivenessProbe).probeLive();
      // ONE snapshot. Calling `status()` twice can straddle a recycle and
      // report `active: true` alongside an empty endpoint list — a state that
      // never existed.
      const snapshot = provider.status();
      return snapshot.active ? snapshot.endpoints : [];
    });
    if (endpoints === TIMED_OUT) {
      return {
        provider: id,
        state: "disconnected",
        endpoints: empty,
        stale: true,
        reason: `${useProbe ? "probeLive" : "status"} timed out`,
      };
    }
    return endpoints.length > 0
      ? { provider: id, state: "connected", endpoints, reason: useProbe ? "probeLive endpoints" : "status active" }
      : { provider: id, state: "disconnected", endpoints: empty, reason: useProbe ? "probeLive empty" : "status inactive" };
  } catch (err) {
    return {
      provider: id,
      state: "disconnected",
      endpoints: empty,
      stale: true,
      reason: reasonOf(useProbe ? "probeLive" : "status", err),
    };
  }
}

function reasonOf(predicate: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `${predicate} threw: ${msg.slice(0, 120)}`;
}

/**
 * Evaluate every provider.
 *
 * Concurrent by construction, and `allSettled` rather than `all`: `all` would
 * let one rejected provider reject the whole board, which is precisely the
 * failure mode the per-provider isolation exists to prevent. The tick returns
 * the providers that answered rather than waiting for the slowest.
 */
export async function evaluateReadiness(
  providers: TunnelProvider[],
  opts: { timeoutMs?: number; rescan?: (id: TunnelProviderId) => void } = {},
): Promise<ProviderReadiness[]> {
  const results = await Promise.allSettled(providers.map((p) => evaluateProvider(p, opts)));
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          provider: providers[i].id,
          state: "not-installed" as const,
          endpoints: [],
          stale: true,
          reason: reasonOf("evaluate", r.reason),
        },
  );
}
