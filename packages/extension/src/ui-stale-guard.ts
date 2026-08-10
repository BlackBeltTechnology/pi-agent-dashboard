/**
 * Guard for `ctx.ui` access that may land AFTER the extension context was
 * invalidated.
 *
 * WHY THIS EXISTS
 * ---------------
 * `autoStartServer()` in `bridge.ts` is long-running and asynchronous. Its
 * `notify` / `onLaunchStart` / `onLaunchEnd` callbacks and its terminal
 * `.then()` / `.catch()` continuation all capture the extension `ctx` and touch
 * `ctx.ui`. Any of them can run after the session has been replaced or reloaded.
 *
 * Since pi 0.84, `AgentSession.dispose()` calls
 * `extensionRunner.invalidate(...)`, after which EVERY `ctx.ui` getter throws
 * (`ExtensionRunner.assertActive`). Inside a floating-promise continuation that
 * throw has no owner: it surfaces as an unhandled rejection and kills the pi
 * process mid-session. Observed as a session that answers a prompt and then
 * dies, leaving the composer disabled — which broke every faux browser-E2E
 * round-trip.
 *
 * WHY ATTEMPT-AND-SWALLOW
 * -----------------------
 * Staleness is not observable. `assertActive()` throws rather than returning a
 * verdict, `staleMessage` is internal, and pi exposes no `isActive` / `isStale`
 * predicate on the public surface. There is no test-then-call option, so the
 * only available guard is to attempt the call and absorb the failure.
 *
 * That is sound here because every guarded call site is UI presentation for a
 * session that no longer exists: the widget was torn down with the old session
 * and the notification has no surface left to render on. Dropping the work is
 * the correct outcome, not merely the safe one.
 *
 * SCOPE — keep this tight
 * -----------------------
 * Wrap ONLY `ctx.ui` access. Auto-start's own failures (discovery, launching,
 * port reconciliation) must keep travelling to their existing `.catch()`
 * handler; routing them through here would hide real faults.
 *
 * See change: fix-bridge-stale-ctx-crash.
 */

/**
 * Run a `ctx.ui` thunk, absorbing the failure if the context has been
 * invalidated. Returns the thunk's value, or `undefined` when it could not run.
 *
 * Any throw from a UI call is absorbed, not just the invalidation error:
 * matching pi's message text would silently re-arm the crash the moment that
 * copy changed, and a presentation call failing is never worth terminating the
 * process over.
 */
export function runUiSafely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    // Context invalidated by session replacement / reload, or the TUI is gone.
    // Nothing to present to — drop the call.
    return undefined;
  }
}
