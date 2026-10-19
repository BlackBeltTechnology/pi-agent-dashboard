/**
 * Fallback provider catalogue derived from the server's OWN pi `ModelRuntime`.
 *
 * The api-key rows of `GET /api/provider-auth/status` normally come from the
 * catalogue a pi session's bridge pushes. On a fresh install no session exists
 * yet, so there is no catalogue and no api-key row — and onboarding cannot
 * create a session without a provider (a deadlock). This module projects the
 * runtime's provider list onto `ProviderInfo[]` so the pure `_buildAuthStatus`
 * keeps ONE implementation of the row rules.
 *
 * Structural types only: `auth/` must not import `model-proxy/`, and the server
 * never imports pi-ai. `checkAuth` is public, async, refreshes no OAuth token
 * and writes nothing (design D1).
 *
 * Never throws: any failure degrades to `[]` (the OAuth rows keep serving).
 *
 * See change: fix-provider-catalogue-first-run (D1).
 */
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { AuthData } from "./provider-auth-storage.js";

/** pi-ai `AuthCheck` slice. */
export interface AuthCheckLike {
  source?: string;
  type: "api_key" | "oauth";
}

/** The slice of pi's `ModelRuntime` the fallback reads. `checkAuth` is REQUIRED. */
export interface RuntimeCatalogueSource {
  getProviders(): readonly { id: string; name?: string; auth?: { oauth?: unknown } }[];
  checkAuth(providerId: string): Promise<AuthCheckLike | undefined>;
}

export interface RuntimeCatalogueOptions {
  /** Ids registered from `providers.json`; their rows are the LLM Providers section's. */
  customIds: ReadonlySet<string> | readonly string[];
  /** The caller's single auth.json read. `null` = unparseable → resolve `[]`. */
  authData: AuthData | null;
  env: Readonly<Record<string, string | undefined>>;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** First env-var-shaped name in a pi auth label (`"A_KEY, B_KEY"`) that is actually set. */
function deriveEnvVar(
  label: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (!label) return undefined;
  return label
    .split(",")
    .map((n) => n.trim())
    .find((n) => ENV_NAME.test(n) && !!env[n]);
}

/** True when the runtime offers the surface the fallback needs. */
export function isRuntimeCatalogueSource(rt: unknown): rt is RuntimeCatalogueSource {
  const r = rt as Partial<RuntimeCatalogueSource> | null | undefined;
  return typeof r?.getProviders === "function" && typeof r?.checkAuth === "function";
}

export async function buildRuntimeCatalogue(
  source: RuntimeCatalogueSource | undefined,
  opts: RuntimeCatalogueOptions,
): Promise<ProviderInfo[]> {
  try {
    if (!isRuntimeCatalogueSource(source)) return [];
    // Unparseable auth.json: every credential-store read would fall to the
    // locked path (~40 lock acquisitions + quarantine attempts). Skip the
    // checks; the OAuth rows still render.
    if (opts.authData === null) return [];
    const authData = opts.authData;
    const customIds = new Set(opts.customIds);
    const providers = source.getProviders();
    return await Promise.all(
      providers.map(async (p): Promise<ProviderInfo> => {
        const info: ProviderInfo = {
          id: p.id,
          displayName: p.name || p.id,
          hasOAuth: !!p.auth?.oauth,
          configured: false,
        };
        if (customIds.has(p.id)) info.custom = true;
        let check: AuthCheckLike | undefined;
        try {
          check = await source.checkAuth(p.id);
        } catch {
          check = undefined;
        }
        // A stored OAuth credential is not api-key evidence.
        if (!check || check.type === "oauth") return info;
        info.configured = true;
        if (authData[p.id]) {
          info.source = "stored";
          return info;
        }
        info.source = "environment";
        if (check.source) info.authLabel = check.source;
        const envVar = deriveEnvVar(check.source, opts.env);
        if (envVar) info.envVar = envVar;
        return info;
      }),
    );
  } catch {
    return [];
  }
}
