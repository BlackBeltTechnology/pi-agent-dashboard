/**
 * Server-resident auth storage for the model proxy.
 *
 * Reads credentials from ~/.pi/agent/auth.json via provider-auth-storage.ts.
 * For OAuth providers, handles token refresh when expired. The refresh
 * coordinates with other auth.json writers (pi): locked snapshot, refresh
 * without holding the lock, compare-and-swap persist.
 * See change: harden-auth-json-lock-coordination (D3).
 *
 * See change: add-dashboard-model-proxy, design §1.
 */
import { isDeepStrictEqual } from "node:util";
import type { PiAiOAuthModule } from "@blackbelt-technology/pi-dashboard-shared/piai-compat/types.js";
import {
  type AuthCredential,
  type AuthData,
  AuthJsonCorruptError,
  type LockedCredentialRead,
  type OAuthCredential,
  readAuthJson,
  readCredentialLocked,
  writeRefreshedOAuth,
} from "../auth/provider-auth-storage.js";

/**
 * pi-ai OAuth dependency. Declared in the compatibility seam
 * (`packages/shared/src/piai-compat/types.ts`) and re-exported here for
 * existing importers. It is now a per-provider CAPABILITY FACADE, not a raw
 * module: >=0.85's `dist/oauth.js` is a type-only stub whose truthy `{}`
 * passed the old guard and then threw `TypeError`.
 * See change: adopt-piai-factory-api-registry (D7).
 */
export type { PiAiOAuthModule } from "@blackbelt-technology/pi-dashboard-shared/piai-compat/types.js";

/**
 * Provider-specific credential fields, i.e. everything that is NOT part of
 * either canonical naming trio.
 *
 * pi's `OAuthCredentials` carries an index signature, and one built-in consumer
 * depends on it: `github-copilot` stores and returns `enterpriseUrl`, then reads
 * it back on the NEXT refresh (`copilotEnterpriseDomain(credential)`) to pick
 * the enterprise endpoint. Rebuilding a fixed-shape credential object silently
 * drops it, redirecting an enterprise user's refresh to github.com.
 */
function opaqueCredentialFields(cred: Record<string, unknown>): Record<string, unknown> {
  const opaque: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cred)) {
    if (!STORAGE_CREDENTIAL_KEYS.has(key) && !RUNTIME_CREDENTIAL_KEYS.has(key)) {
      opaque[key] = value;
    }
  }
  return opaque;
}

/** auth.json field names. */
const STORAGE_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  "type",
  "accessToken",
  "refreshToken",
  "expiresAt",
]);
/** pi-ai's own `OAuthCredential` field names. */
const RUNTIME_CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["access", "refresh", "expires"]);

/** OAuth provider ID mapping — pi uses these internal IDs for auth.json keys. */
const OAUTH_PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  "openai-codex": "openai-codex",
  "github-copilot": "github-copilot",
};

/** Buffer before expiry to trigger preemptive refresh (30s). */
const REFRESH_BUFFER_MS = 30_000;

/**
 * Ceiling on a single OAuth refresh. Bounds the abort signal pi 0.84.0
 * requires — without it a provider that never answers would hang every request
 * routed through this credential.
 */
const REFRESH_TIMEOUT_MS = 30_000;

/**
 * Valid beyond the refresh buffer. ONE predicate decides both "a refresh is
 * needed" and "adopt what another writer stored", so the two cannot disagree.
 */
function isFresh(cred: AuthCredential): cred is OAuthCredential {
  return cred.type === "oauth" && !!cred.expires && cred.expires > Date.now() + REFRESH_BUFFER_MS;
}

/** Coordination outcome → error. Names the provider and outcome only, never token material. */
function outcomeError(provider: string, outcome: Exclude<LockedCredentialRead["outcome"], "ok">): Error {
  switch (outcome) {
    case "removed":
      return new Error(`OAuth credential for "${provider}" was removed from auth.json during refresh`);
    case "replaced":
      return new Error(`OAuth credential for "${provider}" was replaced by a non-OAuth credential`);
    case "corrupt":
      return new AuthJsonCorruptError(provider);
  }
}

function credentialOrThrow(provider: string, read: LockedCredentialRead): OAuthCredential {
  if (read.outcome === "ok") return read.credential;
  throw outcomeError(provider, read.outcome);
}

export class InternalAuthStorage {
  private oauthModule: PiAiOAuthModule | null;
  private cachedAuth: AuthData | null = null;
  /** Serializes concurrent refresh attempts per provider. */
  private refreshLocks = new Map<string, Promise<OAuthCredential>>();
  /**
   * Resolver for custom-provider api_key creds (providers.json#providers).
   * Custom-provider keys are not in auth.json, so routing a custom-provider
   * model falls back to this. See change: add-agent-role-model-tools.
   */
  private customProviderCreds: (() => Record<string, { type: "api_key"; key: string }>) | null;
  /** Abort ceiling for one refresh. Injectable so tests can drive the signal. */
  private refreshTimeoutMs: number;

  constructor(
    oauthModule: PiAiOAuthModule | null,
    customProviderCreds?: () => Record<string, { type: "api_key"; key: string }>,
    refreshTimeoutMs: number = REFRESH_TIMEOUT_MS,
  ) {
    this.oauthModule = oauthModule;
    this.customProviderCreds = customProviderCreds ?? null;
    this.refreshTimeoutMs = refreshTimeoutMs;
  }

  async getApiKeyAndHeaders(
    model: any,
  ): Promise<{ apiKey: string; headers: Record<string, string> }> {
    const auth = this.getAuth();
    let cred: AuthCredential | undefined = auth[model.provider];
    if (!cred && this.customProviderCreds) {
      cred = this.customProviderCreds()[model.provider];
    }
    if (!cred) {
      throw new Error(`No credentials for provider "${model.provider}"`);
    }

    const modelHeaders = model.headers ?? {};

    if (cred.type === "api_key") {
      return { apiKey: cred.key, headers: { ...modelHeaders } };
    }

    if (cred.type === "oauth") {
      const oauthCred = await this.ensureFreshOAuth(model.provider, cred);
      return { apiKey: oauthCred.access, headers: { ...modelHeaders } };
    }

    throw new Error(`Unknown credential type for provider "${model.provider}"`);
  }

  async reload(): Promise<void> {
    this.cachedAuth = null;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private getAuth(): AuthData {
    if (!this.cachedAuth) {
      this.cachedAuth = readAuthJson();
    }
    return this.cachedAuth;
  }

  private async ensureFreshOAuth(
    provider: string,
    cred: OAuthCredential,
  ): Promise<OAuthCredential> {
    if (isFresh(cred)) return cred;

    // Serialize concurrent refreshes for the same provider
    const existing = this.refreshLocks.get(provider);
    if (existing) return existing;

    const refreshPromise = this.refreshOAuth(provider);
    this.refreshLocks.set(provider, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.refreshLocks.delete(provider);
    }
  }

  private async refreshOAuth(provider: string): Promise<OAuthCredential> {
    try {
      return await this.coordinatedRefresh(provider);
    } finally {
      // Disk is authoritative after every coordination outcome: adopted,
      // written, or refused. The next request re-reads it.
      this.cachedAuth = null;
    }
  }

  /**
   * Design D3: locked snapshot → adopt if already fresh → refresh from the
   * SNAPSHOT (the on-disk refresh token, not the cached one) with the lock
   * NOT held → compare-and-swap persist → map the outcome. A refresh failure
   * takes one more locked read before it is surfaced.
   */
  private async coordinatedRefresh(provider: string): Promise<OAuthCredential> {
    const snapshot = credentialOrThrow(provider, await readCredentialLocked(provider));
    if (isFresh(snapshot)) return snapshot;

    let next: OAuthCredential;
    try {
      next = await this.refreshFromProvider(provider, snapshot);
    } catch (err) {
      return await this.recoverFailedRefresh(provider, snapshot, err);
    }

    // Lock exhaustion here propagates: the minted credential is DISCARDED, never
    // served unpersisted (D3 step 7).
    const result = await writeRefreshedOAuth(provider, next, snapshot);
    switch (result.outcome) {
      case "written":
        return result.credential;
      case "changed":
        if (isFresh(result.credential)) return result.credential;
        throw new Error(
          `OAuth credential for "${provider}" changed during refresh and is not valid beyond the refresh buffer; retry the request`,
        );
      default:
        throw outcomeError(provider, result.outcome);
    }
  }

  /**
   * D3 step 5 — after the provider rejected: adopt a DIFFERENT fresh credential
   * another writer stored; surface removed/replaced/corrupt (they explain the
   * rejection); otherwise rethrow the original. The re-read is best-effort: a
   * lock or I/O failure on it rethrows the original error.
   */
  private async recoverFailedRefresh(
    provider: string,
    snapshot: OAuthCredential,
    original: unknown,
  ): Promise<OAuthCredential> {
    let again: LockedCredentialRead;
    try {
      again = await readCredentialLocked(provider);
    } catch {
      throw original;
    }
    if (again.outcome !== "ok") throw outcomeError(provider, again.outcome);
    if (!isDeepStrictEqual(again.credential, snapshot) && isFresh(again.credential)) return again.credential;
    throw original;
  }

  /** One provider refresh from `cred`. Never touches auth.json. */
  private async refreshFromProvider(
    provider: string,
    cred: OAuthCredential,
  ): Promise<OAuthCredential> {
    const oauthId = OAUTH_PROVIDER_MAP[provider] ?? provider;

    // Gate on the facade's PER-PROVIDER capability, not on truthiness. The
    // old `if (!this.oauthModule)` check passed for >=0.85's `export {}` stub
    // and then threw `TypeError` on the first refresh. Degradation is partial
    // and diagnosable: api-key models keep routing, and this error names the
    // provider AND why its OAuth path is unreachable.
    // See change: adopt-piai-factory-api-registry (D7).
    if (!this.oauthModule?.isAvailable(oauthId)) {
      const reason =
        this.oauthModule?.unavailableReason?.(oauthId) ?? "pi-ai oauth module unavailable";
      throw new Error(`OAuth refresh needed for "${provider}" but it is unavailable: ${reason}`);
    }

    let refreshed: any;

    // pi 0.84.0 requires a concrete AbortSignal on every OAuth refresh. Own the
    // controller here so the timeout is enforced even when the provider ignores
    // the signal. See change: update-pi-core-0-84-adopt-apis.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.refreshTimeoutMs);
    // `...cred` so provider-specific fields reach the runtime. Constructing a
    // fixed three-field object here dropped them BEFORE the compatibility facade
    // could preserve them — `github-copilot` reads `credential.enterpriseUrl`
    // inside `refresh()`. The two canonical trios are then set explicitly, so a
    // stale alias can never win over the real values.
    // See change: adopt-piai-factory-api-registry.
    const credentials = {
      ...cred,
      accessToken: cred.access,
      refreshToken: cred.refresh,
      expiresAt: cred.expires,
    };

    // Aborting only NOTIFIES the provider — it does not settle the promise we
    // await. A provider that ignores its signal would hang this call forever
    // and hold `refreshLocks` for its provider indefinitely, so the deadline is
    // enforced HERE by racing rather than trusting the provider to honour it.
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error(`OAuth refresh for "${provider}" aborted before completing`)),
        { once: true },
      );
    });

    try {
      // Try provider-specific refresh via getOAuthProvider
      const oauthProvider = this.oauthModule.getOAuthProvider(oauthId);
      const pending = oauthProvider?.refreshToken
        ? oauthProvider.refreshToken(credentials, controller.signal)
        : // Fall back to generic refreshOAuthToken
          this.oauthModule.refreshOAuthToken(oauthId, credentials, controller.signal);
      // A rejection from `pending` after the deadline already won the race is
      // swallowed here rather than surfacing as an unhandled rejection.
      void Promise.resolve(pending).catch(() => {});
      refreshed = await Promise.race([pending, deadline]);
    } finally {
      clearTimeout(timer);
    }

    // A provider that ignores the signal can still answer after we gave up.
    // Persisting that answer would write a credential the caller already
    // discarded, so treat a fired signal as authoritative.
    if (controller.signal.aborted) {
      throw new Error(`OAuth refresh for "${provider}" aborted before completing`);
    }

    // A refresh that produced no access token is a FAILURE. The fallbacks below
    // exist to keep an unrotated refresh token / a provider-supplied expiry, NOT
    // to substitute the EXPIRED access token: doing so stamped a fresh expiry on
    // a credential that was never refreshed, so it was never retried for an hour.
    // Validated HERE, at the single persist site, so both the factory facade and
    // the legacy facade are covered. The message names no credential material.
    // See change: adopt-piai-factory-api-registry.
    const refreshedAccess = refreshed?.accessToken ?? refreshed?.access;
    if (typeof refreshedAccess !== "string" || !refreshedAccess) {
      throw new Error(
        `OAuth refresh for "${provider}" returned no access token; ` +
          "refusing to persist an unrefreshed credential",
      );
    }

    // Map refreshed credentials back to storage format.
    // `...cred` FIRST so opaque provider fields survive the write, then any
    // opaque field the refresh itself returned (an updated `enterpriseUrl`),
    // then the canonical fields last so nothing can override them.
    // See change: adopt-piai-factory-api-registry.
    return {
      ...cred,
      ...opaqueCredentialFields(refreshed),
      type: "oauth",
      refresh: refreshed.refreshToken ?? cred.refresh,
      access: refreshedAccess,
      expires: refreshed.expiresAt ?? refreshed.expires ?? Date.now() + 3600_000,
    };
  }
}
