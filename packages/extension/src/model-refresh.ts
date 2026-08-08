/**
 * Shared handling for pi 0.84.0's `ModelRegistry.refresh()` contract.
 *
 * BREAKING in 0.84.0: `refresh()` takes `ModelsRefreshOptions` and returns
 * `Promise<ModelsRefreshResult>` — `{ aborted, errors }` — instead of
 * discarding cancellation and per-provider errors. Both dashboard call sites
 * (`command-handler.ts` request_models, `bridge.ts` credentials reload)
 * previously fire-and-forgot it, so a refresh that failed for one provider was
 * indistinguishable from a clean one.
 *
 * A failed refresh is NOT fatal: the registry still serves its last-known
 * catalogue. The contract here is therefore "surface it, keep going" — never
 * "swallow it".
 *
 * See change: update-pi-core-0-84-adopt-apis (design D-refresh).
 */

/** `ModelsRefreshResult` as pi-ai declares it. */
export interface ModelsRefreshResultLike {
  aborted: boolean;
  errors: ReadonlyMap<string, Error>;
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Await a refresh and report its outcome. Returns the result when one was
 * produced, or `undefined` when the refresh threw (already reported).
 *
 * Never rethrows: callers treat a failed catalogue refresh as degraded, not
 * broken.
 */
export async function reportRefresh(
  pending: Promise<ModelsRefreshResultLike | undefined> | undefined,
  label = "model refresh",
): Promise<ModelsRefreshResultLike | undefined> {
  if (!pending) return undefined;
  let result: ModelsRefreshResultLike | undefined;
  try {
    result = await pending;
  } catch (err) {
    console.warn(`[dashboard] ${label} threw:`, errText(err));
    return undefined;
  }
  if (!result) return undefined;

  if (result.aborted) {
    console.warn(`[dashboard] ${label} aborted before completing`);
  }
  // `errors` is keyed by provider id — name the provider, never a bare "failed".
  if (result.errors && result.errors.size > 0) {
    for (const [providerId, err] of result.errors) {
      console.warn(`[dashboard] ${label} failed for provider '${providerId}':`, errText(err));
    }
  }
  return result;
}

/** True when the refresh completed with no abort and no provider error. */
export function refreshFullySucceeded(result: ModelsRefreshResultLike | undefined): boolean {
  return !!result && !result.aborted && result.errors.size === 0;
}
