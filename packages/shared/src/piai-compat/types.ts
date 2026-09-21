/**
 * Types for the pi-ai compatibility seam.
 *
 * `PiAiModule` / `PiAiOAuthModule` moved here from
 * `packages/server/src/model-proxy/{internal-registry,internal-auth-storage}.ts`
 * and are re-exported from those modules for existing importers. They live in
 * `shared` (not `server`) because `packages/extension` depends only on
 * `shared` + `bus-client`.
 *
 * See change: adopt-piai-factory-api-registry (design D1).
 */

/**
 * Minimal surface the dashboard consumes from pi-ai. On a legacy (≤0.75.x)
 * runtime this IS the resolved module; on a factory (≥0.85) runtime it is
 * synthesized by the seam. `any` for `Model<Api>` because pi-ai types are not
 * available at compile time.
 */
export interface PiAiModule {
  registerBuiltInApiProviders: () => void;
  getModels: (provider: string) => any[];
  getProviders: () => string[];
  getModel: (provider: string, modelId: string) => any;
  registerApiProvider: (provider: any, sourceId?: string) => void;
  unregisterApiProviders: (sourceId: string) => void;
  streamSimple: (model: any, context: any, options?: any) => AsyncIterable<any>;
}

/** Credential shape `InternalAuthStorage` hands pi-ai and expects back. */
export interface OAuthRefreshCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  [key: string]: unknown;
}

/**
 * OAuth dependency of `InternalAuthStorage`.
 *
 * `isAvailable(providerId)` is PER-PROVIDER (design D7): the ≥0.85 loaders are
 * a per-provider map, and a single global boolean cannot express "anthropic
 * refreshes, kimi-coding does not". Gating on it replaces the old truthiness
 * check, which passed for the `export {}` stub and then threw `TypeError`.
 *
 * pi 0.84.0 BREAKING: `refreshToken(credentials, signal)` must accept and
 * honor a concrete abort signal. See change: update-pi-core-0-84-adopt-apis.
 */
export interface PiAiOAuthModule {
  /** Whether an OAuth implementation could be located for this provider. */
  isAvailable: (providerId: string) => boolean;
  /** Per-provider reason when `isAvailable` is false. Diagnostics only. */
  unavailableReason?: (providerId: string) => string | undefined;
  getOAuthProvider: (
    id: string,
  ) =>
    | {
        refreshToken: (
          creds: OAuthRefreshCredentials,
          signal: AbortSignal,
        ) => Promise<OAuthRefreshCredentials>;
      }
    | undefined;
  refreshOAuthToken: (
    providerId: string,
    credentials: OAuthRefreshCredentials,
    signal: AbortSignal,
  ) => Promise<OAuthRefreshCredentials>;
}

/** Which pi-ai generation the seam detected. */
export type PiAiGeneration = "legacy" | "factory";

/** What `adaptPiAi` returns. */
export interface AdaptedPiAi {
  generation: PiAiGeneration;
  /** The `PiAiModule` surface. On the legacy branch this is the input identity. */
  module: PiAiModule;
  /** OAuth capability facade (design D7). */
  oauth: PiAiOAuthModule;
}

/** Injectable loader so tests can drive the seam without a real runtime. */
export interface AdaptDeps {
  /** Dynamic import of an absolute filesystem path. */
  importPath?: (absPath: string) => Promise<any>;
  /** Existence probe for a derived subpath. */
  exists?: (absPath: string) => boolean;
}
