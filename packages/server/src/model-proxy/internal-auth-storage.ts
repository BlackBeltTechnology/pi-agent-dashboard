/**
 * Auth resolution facade for the model proxy, backed by the server's single
 * pi `ModelRuntime`.
 *
 * The public shape (`getApiKeyAndHeaders`) is unchanged; the body
 * delegates to `runtime.getAuth`. OAuth refresh runs inside the runtime and
 * persists through `DashboardCredentialStore` (locked snapshot, refresh with
 * the file lock released, compare-and-swap persist). What stays here:
 *   - presence + kind from `auth.json` (+ custom-provider keys), so an ambient
 *     env key never makes an unlisted provider routable;
 *   - a named missing-OAuth-capability error instead of pi's silent
 *     `undefined` when a stored OAuth credential's provider has no OAuth;
 *   - per-provider single-flight: concurrent requests join ONE resolution, so
 *     a refresh is attempted once, also when it fails. The flight is NOT tied to
 *     any caller's signal (pi >= 1.1.0: a started refresh ignores the caller's
 *     abort and persists a rotated token, so a cancelled caller cannot discard
 *     the only valid refresh token); each caller races its OWN signal instead;
 *   - a bounded signal on every resolution, and `ModelsError.cause` unwrap so
 *     the store's named coordination errors reach the caller (D2).
 *
 * See changes: add-dashboard-model-proxy, collapse-model-proxy-onto-modelruntime (D1, D2, D5).
 */
import { type AuthCredential, readAuthJson } from "../auth/provider-auth-storage.js";
import type { ServerModelRuntime } from "./server-model-runtime.js";

/**
 * Ceiling on one auth resolution: the refresh-path lock window (20 s) plus
 * pi's 15 s refresh abort, with margin. Without it a provider that never
 * answers would hold the per-provider flight indefinitely.
 */
const AUTH_RESOLUTION_TIMEOUT_MS = 40_000;

/** A stored OAuth credential whose runtime provider exposes no OAuth implementation. */
export class MissingOAuthCapabilityError extends Error {
  readonly code = "model_proxy.missing_oauth_capability";
  readonly provider: string;
  constructor(provider: string) {
    super(
      `"${provider}" holds an OAuth credential but the model runtime exposes no OAuth implementation for it (missing OAuth capability)`,
    );
    this.name = "MissingOAuthCapabilityError";
    this.provider = provider;
  }
}

/**
 * pi-ai wraps credential-store failures as `ModelsError("auth", …, { cause })`.
 * Surface the store's own named error (removed / replaced / corrupt / changed,
 * lock contention) instead of the wrapper.
 */
export function unwrapRuntimeAuthError(err: unknown): unknown {
  const e = err as { name?: unknown; code?: unknown; cause?: unknown } | null;
  if (e?.name === "ModelsError" && e.code === "auth" && e.cause instanceof Error) return e.cause;
  return err;
}

type RuntimeAuth = Pick<ServerModelRuntime, "getAuth" | "getProvider">;

/**
 * Settle with `promise`, or reject with the abort reason once `signal` fires.
 * The underlying promise is left running either way (the shared flight).
 */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export class InternalAuthStorage {
  private runtime: RuntimeAuth;
  /**
   * Resolver for custom-provider api_key creds (providers.json#providers).
   * Custom-provider keys are not in auth.json. See change: add-agent-role-model-tools.
   */
  private customProviderCreds: (() => Record<string, { type: "api_key"; key: string }>) | null;
  private resolutionTimeoutMs: number;
  /** One in-flight resolution per provider; joined by concurrent requests, never aborted by a caller. */
  private flights = new Map<string, Promise<string>>();

  constructor(
    runtime: RuntimeAuth,
    customProviderCreds?: () => Record<string, { type: "api_key"; key: string }>,
    resolutionTimeoutMs: number = AUTH_RESOLUTION_TIMEOUT_MS,
  ) {
    this.runtime = runtime;
    this.customProviderCreds = customProviderCreds ?? null;
    this.resolutionTimeoutMs = resolutionTimeoutMs;
  }

  /** Providers holding an OAuth credential whose runtime provider has no OAuth implementation (diagnostics). */
  getMissingOAuthProviders(): string[] {
    return Object.entries(readAuthJson())
      .filter(([provider, cred]) => cred?.type === "oauth" && !this.runtime.getProvider(provider)?.auth?.oauth)
      .map(([provider]) => provider)
      .sort();
  }

  async getApiKeyAndHeaders(
    model: any,
    signal?: AbortSignal,
  ): Promise<{ apiKey: string; headers: Record<string, string> }> {
    const provider: string = model.provider;
    let cred: AuthCredential | undefined = readAuthJson()[provider];
    if (!cred && this.customProviderCreds) cred = this.customProviderCreds()[provider];
    if (!cred) throw new Error(`No credentials for provider "${provider}"`);
    if (cred.type === "oauth" && !this.runtime.getProvider(provider)?.auth?.oauth) {
      throw new MissingOAuthCapabilityError(provider);
    }

    const apiKey = await this.joinOrStart(model, provider, signal);
    return { apiKey, headers: { ...(model.headers ?? {}) } };
  }

  /**
   * Join the provider's in-flight resolution, or start one. The flight carries
   * no caller signal: pi >= 1.1.0 lets a started OAuth refresh run to completion
   * and persist its rotated credential, so tying the flight to one request's
   * disconnect would either be a no-op or — worse — invite a second concurrent
   * refresh with the same refresh token. Every caller waits only as long as its
   * OWN signal allows. See change: update-pi-core-1-1-adopt-apis.
   */
  private joinOrStart(model: any, provider: string, signal: AbortSignal | undefined): Promise<string> {
    // An already-cancelled request must not start (or join) any work.
    if (signal?.aborted) return Promise.reject(signal.reason);
    const flight = this.flights.get(provider) ?? this.start(model, provider);
    return raceSignal(flight, signal);
  }

  private start(model: any, provider: string): Promise<string> {
    const promise = this.resolve(model);
    this.flights.set(provider, promise);
    const clear = () => {
      if (this.flights.get(provider) === promise) this.flights.delete(provider);
    };
    promise.then(clear, clear);
    return promise;
  }

  private async resolve(model: any): Promise<string> {
    const ceiling = AbortSignal.timeout(this.resolutionTimeoutMs);
    let result: Awaited<ReturnType<RuntimeAuth["getAuth"]>>;
    try {
      result = await this.runtime.getAuth(model, { signal: ceiling });
    } catch (err) {
      throw unwrapRuntimeAuthError(err);
    }
    if (!result) throw new Error(`No credentials for provider "${model.provider}"`);
    return result.auth.apiKey ?? "";
  }
}
