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
 * Hard bound on how long a catalogue refresh may block its caller.
 *
 * `request_models` is dispatched from the bridge's SERIALIZED inbound pump
 * (`serialize-bridge-message-pump`), which awaits each handler to completion.
 * A `refresh()` that never settles therefore wedges the pump forever: every
 * later browser message — including `send_prompt` — is queued and never
 * dispatched, so the composer's optimistic bubble never gets its
 * `prompt_received` ack and hangs at `sending`.
 * See change: fix-optimistic-prompt-stuck-sending.
 */
export const REFRESH_TIMEOUT_MS = 10_000;

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
  // Keep the caller's own rejection handling AND make sure a late rejection of
  // the abandoned promise never surfaces as an unhandled rejection.
  pending.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol("refresh-timeout");
  let result: ModelsRefreshResultLike | undefined | typeof TIMED_OUT;
  try {
    result = await Promise.race([
      pending,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), REFRESH_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn(`[dashboard] ${label} threw:`, errText(err));
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (result === TIMED_OUT) {
    // Degraded, never broken: the registry still serves its last-known
    // catalogue, and the caller (and the message pump behind it) moves on.
    console.warn(`[dashboard] ${label} timed out after ${REFRESH_TIMEOUT_MS}ms — using the last-known catalogue`);
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

/**
 * Refresh after a `credentials_updated` reload of providers.json.
 *
 * Diff touched providers (added/changed) -> scoped refresh of exactly those.
 * Empty touched set -> the change was credential-only (auth.json: OAuth login,
 * built-in provider key) or removal-only; the affected provider is unknown, so
 * recompute availability for all, locally (`allowNetwork:false`, ~6 ms).
 * See change: refresh-models-on-provider-change (D2).
 */
export async function refreshAfterCredentialsReload(
  registry: { refresh?: (opts: object) => Promise<ModelsRefreshResultLike | undefined> } | undefined,
  diff: { added: string[]; changed: string[] },
): Promise<ModelsRefreshResultLike | undefined> {
  const touched = [...new Set([...diff.added, ...diff.changed])];
  return touched.length > 0
    ? reportRefresh(registry?.refresh?.({ providers: touched }), `credentials reload refresh (${touched.join(", ")})`)
    : reportRefresh(registry?.refresh?.({ allowNetwork: false }), "credentials reload refresh (full, local)");
}

/**
 * Bound on the providers.json re-apply `list_models` runs before its local
 * refresh. When hit, discovery continues in the background on `reloadChain`.
 * See change: list-models-auto-resync (design D1).
 */
export const PROVIDERS_RESYNC_TIMEOUT_MS = 5_000;

/**
 * Resync the in-process registry from global config before `list_models`
 * reads it: (1) bounded, signal-aware `reloadProviders` re-apply; (2) skip if
 * aborted; (3) local `refresh({allowNetwork:false})` bounded by
 * `REFRESH_TIMEOUT_MS`. The signal is never passed into `refresh` — aborting a
 * shared full refresh would supersede a concurrent `request_models` pass; the
 * caller stops waiting by racing the signal instead. Never rejects.
 * See change: list-models-auto-resync (design D1).
 */
export async function resyncForListModels(
  registry: { refresh?: (opts: object) => Promise<ModelsRefreshResultLike | undefined> },
  opts: { reloadProviders?: () => Promise<unknown>; signal?: AbortSignal } = {},
): Promise<ModelsRefreshResultLike | undefined> {
  const { reloadProviders, signal } = opts;
  if (reloadProviders) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const pending = Promise.resolve().then(reloadProviders);
      pending.catch(() => {});
      const TIMED_OUT = Symbol("resync-timeout");
      const outcome = await Promise.race([
        pending,
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), PROVIDERS_RESYNC_TIMEOUT_MS);
        }),
        new Promise<void>((resolve) => {
          if (!signal) return;
          onAbort = () => resolve();
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      if (outcome === TIMED_OUT) {
        console.warn(`[dashboard] list_models providers re-sync timed out after ${PROVIDERS_RESYNC_TIMEOUT_MS}ms — continuing`);
      }
    } catch (err) {
      console.warn("[dashboard] list_models providers re-sync failed:", errText(err));
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }
  if (signal?.aborted) return undefined;
  let pending: Promise<ModelsRefreshResultLike | undefined> | undefined;
  try {
    pending = registry.refresh?.({ allowNetwork: false });
  } catch (err) {
    console.warn("[dashboard] list_models refresh threw:", errText(err));
    return undefined;
  }
  return reportRefresh(pending, "list_models refresh");
}

/** Map a refresh result to `{provider,message}[]`; `[]` when aborted or absent. */
export function toRefreshErrors(
  result: ModelsRefreshResultLike | undefined,
): { provider: string; message: string }[] {
  if (!result || result.aborted || !result.errors) return [];
  return [...result.errors].map(([provider, err]) => ({ provider, message: errText(err) }));
}
