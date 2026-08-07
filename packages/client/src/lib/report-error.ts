// The client's single error-reporting seam.
//
// The client has no central logging module — files call `console.error`
// directly — so "route the handler to the package's existing logging path" was
// undefined for this package. `reportError` defines it: every `.catch(handler)`
// introduced by the promise-handling cleanup reports through here, giving the
// handlers one observable seam a test can assert on.
//
// It is a *reporter*, never a sink: it forwards the reason object itself (not a
// stringified placeholder) so the console record keeps the message and stack.
//
// See change: cleanup-client-plugin-promises (design D1, D2).

/** Forward a rejection reason to the client's console-error path. */
export function reportError(reason: unknown, context?: string): void {
  if (context === undefined) {
    console.error("[pi-dashboard] unhandled error:", reason);
    return;
  }
  console.error(`[pi-dashboard] unhandled error in ${context}:`, reason);
}

/**
 * A `.catch` handler that names its site.
 *
 * `void p.catch(logRejection("X.load"))` is the discard form this change uses:
 * the discard is explicit, the handler is never empty, and the emitted record
 * names the owner — which a process-global handler cannot do.
 */
export function logRejection(context: string): (reason: unknown) => void {
  return (reason: unknown) => reportError(reason, context);
}

type RejectionEvent = Event & { reason?: unknown };

/**
 * Install the global unhandled-rejection reporter — the change's regression
 * guard. An escaped rejection stops being silent and becomes an observable
 * console record.
 *
 * Deliberately does NOT call `preventDefault()`: the browser's own
 * `unhandledrejection` reporting (and any E2E listener asserting on it) must
 * still see the event. This is a net, not a sink.
 *
 * @returns an uninstall function (used by tests; the app never uninstalls).
 */
export function installUnhandledRejectionReporter(
  target: EventTarget = window,
): () => void {
  const onRejection = (event: Event): void => {
    reportError((event as RejectionEvent).reason, "unhandled rejection");
  };
  target.addEventListener("unhandledrejection", onRejection);
  return () => target.removeEventListener("unhandledrejection", onRejection);
}
