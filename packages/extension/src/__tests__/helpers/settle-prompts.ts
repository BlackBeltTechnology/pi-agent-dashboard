/**
 * Settle helper for deliberately-in-flight `PromptBus.request` calls in tests.
 *
 * Why this exists: `PromptBus.request` is `new Promise((resolve) => …)` — it has
 * no reject path, so a floating `bus.request(...)` could never raise an
 * unhandled rejection. `noFloatingPromises` still flags it, and in a test file
 * the fix vocabulary is `await` / `return` only: `void` and `.catch` are banned
 * because they would hide the very failure a test exists to detect.
 *
 * The catch is that the typical fire-then-assert site is answered by no mock
 * adapter, so a bare `await` would hang to the Vitest timeout. Cancelling
 * through the public API resolves the request with `{ cancelled: true }`, which
 * makes the promise awaitable without changing what the test proves — every
 * assertion runs *before* the settle.
 *
 * See change: cleanup-async-semantics-server-extension (design D1, D3).
 */
import type { PromptBus, PromptResponse } from "../../prompt-bus.js";

/**
 * Cancel every request still pending on `bus`, then await `pending`.
 *
 * Call this as the last statement of a test that fired a request it never
 * answered. Assertions must precede it: cancelling notifies adapters via
 * `onCancel` and the dashboard via `onDashboardCancel`.
 *
 * Ids come from the bus's internal `pending` map, not from the public
 * `getPendingRequests()`. That accessor is a dashboard-replay view: it skips any
 * entry without a resolved component, and `request()` only resolves the
 * generic-dialog fallback when `onDashboardRequest` is configured
 * (`prompt-bus.ts`). A bus built without that callback therefore reports no
 * pending requests, and cancelling from it would leave the promise unsettled
 * forever. Reading the map matches how these suites already recover prompt ids.
 */
export async function settlePrompts(
  bus: PromptBus,
  ...pending: Array<Promise<PromptResponse>>
): Promise<void> {
  const inflight = (bus as unknown as { pending: Map<string, unknown> }).pending;
  for (const id of [...inflight.keys()]) bus.cancel(id);
  await Promise.all(pending);
}
