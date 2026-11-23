/**
 * The bridge's session-shutdown path: ask pi to shut down, then arm a hard-exit
 * fallback in case nothing ends the process.
 *
 * pi 1.5.1+ exits by itself when `ctx.shutdown()` is called while idle, and its
 * `runtimeHost.dispose()` waits for an in-progress token refresh to be saved
 * (the provider already replaced the single-use refresh token). The fallback
 * therefore leaves 5 s, not 500 ms, and is `unref()`'d so it never keeps a
 * process alive that is otherwise done.
 *
 * See change: update-pi-core-1-6-adopt-apis (spec bridge-extension).
 */

/** How long pi gets to exit on its own after `ctx.shutdown()` before the bridge exits. */
export const BRIDGE_SHUTDOWN_FALLBACK_MS = 5000;

/** The slice of pi's extension context the shutdown path uses. */
export interface BridgeShutdownCtx {
  shutdown?: () => void;
}

/** Test seams; production uses `setTimeout` and `process.exit`. */
export interface BridgeShutdownDeps {
  exit?: (code: number) => void;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
}

/**
 * Call `ctx.shutdown()` (errors never escape: a stale ctx must not skip the
 * fallback), then arm the unref'd `exit(0)` fallback.
 */
export function runBridgeShutdown(
  ctx: BridgeShutdownCtx | null | undefined,
  deps: BridgeShutdownDeps = {},
): void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  try {
    ctx?.shutdown?.();
  } catch {
    // Stale or torn-down ctx: the fallback below is the only exit left.
  }
  setTimer(() => exit(0), BRIDGE_SHUTDOWN_FALLBACK_MS).unref?.();
}
