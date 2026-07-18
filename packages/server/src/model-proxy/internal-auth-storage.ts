/**
 * Server-resident auth storage for the model proxy.
 *
 * Reads credentials from ~/.pi/agent/auth.json via provider-auth-storage.ts.
 * For OAuth providers, handles token refresh when expired and persists
 * the new token via the existing writeCredential writer (single-writer contract).
 *
 * See change: add-dashboard-model-proxy, design §1.
 */
import {
  readAuthJson,
  writeCredential,
  type AuthData,
  type AuthCredential,
  type OAuthCredential,
} from "../auth/provider-auth-storage.js";

/** Minimal pi-ai OAuth module surface (runtime-resolved from pi-ai/oauth). */
export interface PiAiOAuthModule {
  getOAuthProvider: (id: string) => { refreshToken: (creds: any) => Promise<any> } | undefined;
  refreshOAuthToken: (providerId: string, credentials: any) => Promise<any>;
}

/** OAuth provider ID mapping — pi uses these internal IDs for auth.json keys. */
const OAUTH_PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  "openai-codex": "openai-codex",
  "github-copilot": "github-copilot",
};

/** Buffer before expiry to trigger preemptive refresh (30s). */
const REFRESH_BUFFER_MS = 30_000;

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

  constructor(
    oauthModule: PiAiOAuthModule | null,
    customProviderCreds?: () => Record<string, { type: "api_key"; key: string }>,
  ) {
    this.oauthModule = oauthModule;
    this.customProviderCreds = customProviderCreds ?? null;
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
    const now = Date.now();
    if (cred.expires && cred.expires > now + REFRESH_BUFFER_MS) {
      return cred;
    }

    // Serialize concurrent refreshes for the same provider
    const existing = this.refreshLocks.get(provider);
    if (existing) return existing;

    const refreshPromise = this.refreshOAuth(provider, cred);
    this.refreshLocks.set(provider, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.refreshLocks.delete(provider);
    }
  }

  private async refreshOAuth(
    provider: string,
    cred: OAuthCredential,
  ): Promise<OAuthCredential> {
    if (!this.oauthModule) {
      throw new Error(`OAuth refresh needed for "${provider}" but pi-ai oauth module unavailable`);
    }

    const oauthId = OAUTH_PROVIDER_MAP[provider] ?? provider;
    let refreshed: any;

    // Try provider-specific refresh via getOAuthProvider
    const oauthProvider = this.oauthModule.getOAuthProvider(oauthId);
    if (oauthProvider?.refreshToken) {
      refreshed = await oauthProvider.refreshToken({
        accessToken: cred.access,
        refreshToken: cred.refresh,
        expiresAt: cred.expires,
      });
    } else {
      // Fall back to generic refreshOAuthToken
      refreshed = await this.oauthModule.refreshOAuthToken(oauthId, {
        accessToken: cred.access,
        refreshToken: cred.refresh,
        expiresAt: cred.expires,
      });
    }

    // Map refreshed credentials back to storage format
    const newCred: OAuthCredential = {
      type: "oauth",
      refresh: refreshed.refreshToken ?? cred.refresh,
      access: refreshed.accessToken ?? refreshed.access ?? cred.access,
      expires: refreshed.expiresAt ?? refreshed.expires ?? Date.now() + 3600_000,
    };

    // Persist via existing single-writer path
    writeCredential(provider, newCred);

    // Invalidate cache so next read picks up the new token
    this.cachedAuth = null;

    return newCred;
  }
}
