/**
 * Small helper that composes a timeout with an optional external abort signal
 * into one signal, plus a `done()` to clear the timer. Shared by the grammar
 * backends so the abort/timeout wiring lives in one place.
 * See change: add-composer-grammar-check.
 */
export function withTimeoutSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
