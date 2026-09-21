/**
 * OAuth capability facade (design D7).
 *
 * Three boundaries move between pi-ai generations and only one of them is a
 * module-shape change:
 *
 * 1. ≤0.75.x `dist/oauth.js` re-exports `getOAuthProvider` / `refreshOAuthToken`.
 * 2. ≥0.85 `dist/oauth.js` is a TYPE-ONLY stub (`export {};`). Holding it as a
 *    truthy `{}` is exactly the bug: every refresh throws `TypeError`.
 * 3. The real implementations moved to `dist/auth/oauth/*.js` behind ASYNC
 *    loaders (`load<Provider>OAuth()`), a path NOT in the package `exports`
 *    map.
 *
 * The facade resolves per provider, pre-loads the async loaders during
 * `adaptPiAi` so `InternalAuthStorage`'s synchronous `getOAuthProvider(id)`
 * call shape survives, and translates the `{access,refresh,expires}` /
 * `refresh(credential, signal)` contract to the storage's
 * `{accessToken,refreshToken,expiresAt}` / `refreshToken(creds, signal)`.
 *
 * Degradation is PARTIAL and EXPLICIT: an unreachable provider reports
 * `isAvailable(id) === false` with a reason; api-key models keep routing.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { derivePiAiSubpath } from "./subpath.js";
import type { AdaptDeps, OAuthRefreshCredentials, PiAiOAuthModule } from "./types.js";

/** Members a legacy `dist/oauth.js` must export to be usable. */
const LEGACY_OAUTH_MEMBERS = ["getOAuthProvider", "refreshOAuthToken"] as const;

/**
 * Provider id → loader export in `dist/auth/oauth/load.js`.
 *
 * `loadRadiusOAuth` is deliberately absent: it requires a config argument the
 * dashboard has no way to supply, so radius reports unavailable rather than
 * being called wrong.
 */
export const OAUTH_LOADER_EXPORTS: Readonly<Record<string, string>> = {
  anthropic: "loadAnthropicOAuth",
  "openai-codex": "loadOpenAICodexOAuth",
  "github-copilot": "loadGitHubCopilotOAuth",
  openrouter: "loadOpenRouterOAuth",
  "kimi-coding": "loadKimiCodingOAuth",
  meta: "loadMetaOAuth",
  xai: "loadXaiOAuth",
};

/** pi-ai's `OAuthAuth` credential shape. */
interface PiAiOAuthCredential {
  access?: string;
  refresh?: string;
  expires?: number;
  /** Opaque provider fields (e.g. `enterpriseUrl`) must survive. */
  [key: string]: unknown;
}

interface PiAiOAuthAuth {
  refresh: (credential: PiAiOAuthCredential, signal: AbortSignal) => Promise<PiAiOAuthCredential>;
}

function isUsableLegacyOAuth(mod: unknown): boolean {
  if (!mod || typeof mod !== "object") return false;
  const rec = mod as Record<string, unknown>;
  return LEGACY_OAUTH_MEMBERS.every((m) => typeof rec[m] === "function");
}

/**
 * Wrap a pi-ai `OAuthAuth` in the storage's `refreshToken` contract.
 *
 * Field names differ in BOTH directions, so the translation is symmetric — and
 * it must preserve OPAQUE fields while renaming the canonical three. pi's
 * `OAuthCredentials` carries an index signature, and one built-in consumer
 * depends on it: `github-copilot` reads `credential.enterpriseUrl` back at
 * refresh time (`copilotEnterpriseDomain(credential)`). Rebuilding a
 * three-field object would send an enterprise user's refresh to github.com
 * instead of their enterprise domain, and the persisted credential would lose
 * the metadata permanently.
 */
function toStorageProvider(auth: PiAiOAuthAuth) {
  return {
    refreshToken: async (
      creds: OAuthRefreshCredentials,
      signal: AbortSignal,
    ): Promise<OAuthRefreshCredentials> => {
      // Rename the canonical trio, carry every other field through untouched.
      const { accessToken, refreshToken, expiresAt, ...extras } = creds;
      const refreshed = await auth.refresh(
        {
          ...extras,
          access: accessToken as string | undefined,
          refresh: refreshToken as string | undefined,
          expires: expiresAt as number | undefined,
        },
        signal,
      );

      // A refresh that yields no access token is a FAILURE, not a no-op. The
      // storage's `?? cred.access` fallback would otherwise reuse the expired
      // token while stamping a fresh expiry on it — persisting a silently
      // broken credential that will not be retried for an hour. The message
      // carries no credential material.
      if (typeof refreshed?.access !== "string" || !refreshed.access) {
        throw new Error(
          "OAuth provider returned no access token; refusing to persist an unrefreshed credential",
        );
      }

      const { access, refresh, expires, ...refreshedExtras } = refreshed;
      return { ...refreshedExtras, accessToken: access, refreshToken: refresh, expiresAt: expires };
    },
  };
}

/** A facade in which no provider has a reachable OAuth implementation. */
export function unavailableOAuthFacade(reason: string): PiAiOAuthModule {
  return {
    isAvailable: () => false,
    unavailableReason: () => reason,
    getOAuthProvider: () => undefined,
    refreshOAuthToken: async (providerId) => {
      throw new Error(`OAuth refresh for "${providerId}" is unavailable: ${reason}`);
    },
  };
}

/** Wrap a usable legacy `dist/oauth.js` — it already speaks the storage contract. */
export function legacyOAuthFacade(mod: Record<string, any>): PiAiOAuthModule {
  return {
    isAvailable: (providerId: string) =>
      typeof mod.getOAuthProvider === "function" &&
      (mod.getOAuthProvider(providerId) !== undefined || typeof mod.refreshOAuthToken === "function"),
    unavailableReason: () => undefined,
    getOAuthProvider: (id: string) => mod.getOAuthProvider(id),
    refreshOAuthToken: (providerId, credentials, signal) =>
      mod.refreshOAuthToken(providerId, credentials, signal),
  };
}

/**
 * Build the OAuth facade for a resolved pi-ai.
 *
 * Resolution order per design D7: usable legacy `oauth.js` → relocated async
 * loaders → unavailable. Every step PROBES; nothing is assumed reachable,
 * because `dist/auth/oauth/*` is outside the package `exports` map and may
 * move on any minor release.
 */
export async function buildOAuthFacade(
  resolvedPath: string,
  deps: Required<Pick<AdaptDeps, "importPath" | "exists">>,
): Promise<PiAiOAuthModule> {
  // 1. Legacy oauth.js — only when it ACTUALLY exports the expected functions.
  //    A ≥0.85 `export {}` stub is truthy but unusable; that is the bug.
  const legacyPath = safeDerive(resolvedPath, "oauth.js");
  if (legacyPath && deps.exists(legacyPath)) {
    try {
      const mod = await deps.importPath(legacyPath);
      if (isUsableLegacyOAuth(mod)) return legacyOAuthFacade(mod as Record<string, any>);
    } catch {
      // fall through to the relocated loaders
    }
  }

  // 2. Relocated async loaders under dist/auth/oauth/load.js.
  const loadPath = safeDerive(resolvedPath, "auth/oauth/load.js");
  if (!loadPath || !deps.exists(loadPath)) {
    return unavailableOAuthFacade(
      `no usable OAuth implementation found for the pi-ai resolved at "${resolvedPath}" ` +
        `(dist/oauth.js exports no refresh functions and dist/auth/oauth/load.js is absent)`,
    );
  }

  let loaders: Record<string, unknown>;
  try {
    loaders = (await deps.importPath(loadPath)) as Record<string, unknown>;
  } catch (err) {
    return unavailableOAuthFacade(
      `failed to load "${loadPath}": ${(err as Error).message}`,
    );
  }

  // Pre-load every provider's OAuthAuth so the storage keeps a SYNCHRONOUS
  // `getOAuthProvider(id)`. A loader that rejects degrades only its provider.
  const resolved = new Map<string, ReturnType<typeof toStorageProvider>>();
  const reasons = new Map<string, string>();
  await Promise.all(
    Object.entries(OAUTH_LOADER_EXPORTS).map(async ([providerId, exportName]) => {
      const loader = loaders[exportName];
      if (typeof loader !== "function") {
        reasons.set(providerId, `"${exportName}" is not exported by ${loadPath}`);
        return;
      }
      try {
        const auth = (await (loader as () => Promise<PiAiOAuthAuth>)()) as PiAiOAuthAuth;
        if (!auth || typeof auth.refresh !== "function") {
          reasons.set(providerId, `"${exportName}" resolved without a refresh() function`);
          return;
        }
        resolved.set(providerId, toStorageProvider(auth));
      } catch (err) {
        reasons.set(providerId, `"${exportName}" failed to load: ${(err as Error).message}`);
      }
    }),
  );

  return {
    isAvailable: (providerId: string) => resolved.has(providerId),
    unavailableReason: (providerId: string) =>
      resolved.has(providerId)
        ? undefined
        : (reasons.get(providerId) ??
          `provider "${providerId}" has no OAuth loader in ${loadPath}`),
    getOAuthProvider: (id: string) => resolved.get(id),
    refreshOAuthToken: async (providerId, credentials, signal) => {
      const provider = resolved.get(providerId);
      if (!provider) {
        throw new Error(
          `OAuth refresh for "${providerId}" is unavailable: ` +
            (reasons.get(providerId) ?? `no loader mapped for "${providerId}"`),
        );
      }
      return provider.refreshToken(credentials, signal);
    },
  };
}

/** Derivation must never turn a bad path into a throw here — report unavailable instead. */
function safeDerive(resolvedPath: string, relative: string): string | null {
  try {
    return derivePiAiSubpath(resolvedPath, relative);
  } catch {
    return null;
  }
}
