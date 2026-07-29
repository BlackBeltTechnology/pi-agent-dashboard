/**
 * Server-resident model registry built on pi-ai primitives.
 *
 * Composes pi-ai's built-in providers with custom providers (~/.pi/agent/providers.json),
 * custom models (~/.pi/agent/models.json), and auth state (~/.pi/agent/auth.json).
 * Only models whose provider has valid auth are exposed.
 *
 * See change: add-dashboard-model-proxy, design §1.
 */
import { parseModelId } from "@blackbelt-technology/pi-dashboard-shared/model-id.js";
import type { InternalAuthStorage } from "./internal-auth-storage.js";
import { isOauthIncompatible } from "./oauth-compat.js";

/**
 * Minimal surface expected from the pi-ai module (runtime-resolved).
 * Using `any` for Model<Api> since pi-ai types are not available at compile time.
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

export interface CustomProviderEntry {
  baseUrl: string;
  apiKey: string;
  api?: string;
}

export interface CustomModelEntry {
  id: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** Native per-model thinking-level override table (pi 0.72+). See change: honor-native-models-json-metadata. */
  thinkingLevelMap?: Record<string, unknown>;
  /** Opaque runtime request-formatting hints. Carried for proxy routing; NEVER emitted over /api/models. See change: honor-native-models-json-metadata. */
  compat?: Record<string, unknown>;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  input?: string[];
  headers?: Record<string, string>;
  /** Routable over an OAuth credential. Default true when absent. See change: filter-oauth-incompatible-models. */
  oauthCompatible?: boolean;
}

export interface InternalRegistryDeps {
  readProviders: () => Record<string, CustomProviderEntry>;
  readModels: () => CustomModelEntry[];
  readAuth: () => Record<string, any>;
  /**
   * Discover models for every custom provider in `providers.json#providers`
   * (live `/v1/models` fetch). Optional so tests can inject a fake; when
   * absent the registry only exposes built-in + `readModels()` models.
   * See change: add-agent-role-model-tools.
   */
  discoverCustomProviders?: (
    providers: Record<string, CustomProviderEntry>,
  ) => Promise<CustomModelEntry[]>;
}

export class InternalRegistry {
  private piAi: PiAiModule;
  private authStorage: InternalAuthStorage;
  private deps: InternalRegistryDeps;
  private cachedModels: any[] | null = null;
  private cachedAllModels: any[] | null = null;
  /** Custom-provider models discovered from providers.json (Approach C). */
  private discoveredCustomModels: CustomModelEntry[] = [];

  constructor(piAi: PiAiModule, authStorage: InternalAuthStorage, deps: InternalRegistryDeps) {
    this.piAi = piAi;
    this.authStorage = authStorage;
    this.deps = deps;
    // Ensure built-in providers are registered
    this.piAi.registerBuiltInApiProviders();
  }

  /**
   * Models with valid auth (api_key or oauth) in auth.json.
   */
  async getAvailable(): Promise<any[]> {
    if (this.cachedModels) return this.cachedModels;
    const all = this.getAllModels();
    const auth = this.deps.readAuth();
    const filtered = all.filter((m: any) => this.canRouteModel(m, auth[m.provider]));
    this.cachedModels = filtered;
    return filtered;
  }

  async find(provider: string, modelId: string): Promise<any | null> {
    const available = await this.getAvailable();
    return available.find((m: any) => m.provider === provider && m.id === modelId) ?? null;
  }

  /**
   * Walk an ordered list of fully-qualified `provider/id`s, returning the first
   * entry present in `getAvailable()`. Bare labels (no provider) are skipped.
   * Returns null for an empty list or when none is available.
   * See change: fix-and-prefer-model-proxy-resolution.
   */
  async firstAvailable(preferred: string[]): Promise<any | null> {
    if (!preferred || preferred.length === 0) return null;
    const available = await this.getAvailable();
    for (const label of preferred) {
      const { provider, modelId } = parseModelId(label);
      if (!provider) continue;
      const m = available.find((x: any) => x.provider === provider && x.id === modelId);
      if (m) return m;
    }
    return null;
  }

  async getApiKeyAndHeaders(model: any): Promise<{ apiKey: string; headers: Record<string, string> }> {
    return this.authStorage.getApiKeyAndHeaders(model);
  }

  async refresh(): Promise<void> {
    this.cachedModels = null;
    this.cachedAllModels = null;
    await this.authStorage.reload();
    await this.discover();
  }

  /**
   * Discover custom-provider models from providers.json and cache them.
   * No-op when no `discoverCustomProviders` dep is supplied. Invalidates the
   * model caches so the next `getAllModels()` merges the fresh set.
   * See change: add-agent-role-model-tools.
   */
  async discover(): Promise<void> {
    if (!this.deps.discoverCustomProviders) return;
    try {
      this.discoveredCustomModels = await this.deps.discoverCustomProviders(this.deps.readProviders());
    } catch {
      this.discoveredCustomModels = [];
    }
    this.cachedModels = null;
    this.cachedAllModels = null;
  }

  /** All models regardless of auth state (diagnostics). */
  getAll(): any[] {
    return this.getAllModels();
  }

  /**
   * All models annotated with the reason each is excluded from getAvailable().
   * null = included; "no-credential" = provider has no usable credential;
   * "oauth-incompatible" = only an OAuth credential and model flagged
   * oauthCompatible:false. Diagnostics only. See change: filter-oauth-incompatible-models.
   */
  getAllAnnotated(): Array<{ model: any; excludedReason: null | "no-credential" | "oauth-incompatible" }> {
    const all = this.getAllModels();
    const auth = this.deps.readAuth();
    return all.map((model: any) => {
      let excludedReason: null | "no-credential" | "oauth-incompatible" = null;
      if (!this.hasAuth(model.provider, auth)) {
        excludedReason = "no-credential";
      } else if (!this.canRouteModel(model, auth[model.provider])) {
        excludedReason = "oauth-incompatible";
      }
      return { model, excludedReason };
    });
  }

  // ── Private ─────────────────────────────────────────────────────────

  private getAllModels(): any[] {
    if (this.cachedAllModels) return this.cachedAllModels;

    const models: any[] = [];

    // 1. Built-in models from pi-ai (shallow-copied so we can annotate
    //    oauthCompatible without mutating pi-ai's shared model objects).
    for (const provider of this.piAi.getProviders()) {
      try {
        for (const model of this.piAi.getModels(provider)) {
          models.push({ ...model, oauthCompatible: !isOauthIncompatible(provider, model.id) });
        }
      } catch {
        // Provider may not have models registered
      }
    }

    // 2. Custom-provider models — field-level outer join on `provider/id`.
    //    Routing (`baseUrl`, `api`, `oauthCompatible`) comes from live
    //    `/v1/models` discovery; capabilities (`contextWindow`, `maxTokens`,
    //    `reasoning`, `thinkingLevelMap`, `compat`, `input`, `cost`) come from
    //    the user-authored native `models.json` and WIN on overlap. Native-only
    //    entries still surface (outer join, routing from providers.json);
    //    discovered-only entries keep their api-typed fallback floors. A native
    //    `models.json` entry NEVER overrides `oauthCompatible` (the native
    //    format has no such field — defaulting it true would bypass the
    //    OAuth-incompat filter). See change: honor-native-models-json-metadata.
    const customProviders = this.deps.readProviders();
    const discoveredByKey = new Map<string, CustomModelEntry>();
    for (const d of this.discoveredCustomModels) discoveredByKey.set(`${d.provider}/${d.id}`, d);
    const nativeByKey = new Map<string, CustomModelEntry>();
    for (const n of this.deps.readModels()) nativeByKey.set(`${n.provider}/${n.id}`, n);

    for (const key of new Set([...discoveredByKey.keys(), ...nativeByKey.keys()])) {
      const routing = discoveredByKey.get(key); // discovery = routing authority (+ fallback floors)
      const caps = nativeByKey.get(key); // native models.json = capabilities (win)
      const base = (routing ?? caps) as CustomModelEntry;
      const provider = base.provider;
      const id = base.id;
      const providerEntry = customProviders[provider];
      const baseUrl = routing?.baseUrl || providerEntry?.baseUrl || caps?.baseUrl || "";
      const api = routing?.api || providerEntry?.api || caps?.api || "openai-completions";

      const headers = caps?.headers ?? routing?.headers;
      const model: any = {
        id,
        name: id,
        api,
        provider,
        baseUrl,
        reasoning: caps?.reasoning ?? routing?.reasoning ?? false,
        input: caps?.input ?? routing?.input ?? ["text"],
        cost: caps?.cost ?? routing?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: caps?.contextWindow ?? routing?.contextWindow ?? 128000,
        maxTokens: caps?.maxTokens ?? routing?.maxTokens ?? 8192,
        // oauthCompatible is a ROUTING field: from discovery when the model was
        // discovered, else the native-only entry's own value (default true).
        // Never taken from native to override a discovered value.
        oauthCompatible: routing ? (routing.oauthCompatible ?? true) : (caps?.oauthCompatible ?? true),
        ...(caps?.thinkingLevelMap ? { thinkingLevelMap: caps.thinkingLevelMap } : {}),
        ...(caps?.compat ? { compat: caps.compat } : {}),
        ...(headers ? { headers } : {}),
      };
      models.push(model);
    }

    // Dedup by fully-qualified `provider/id`, keeping the FIRST occurrence.
    // Push order above encodes precedence: built-in → merged-custom (each
    // custom fqid already unique post-merge). Guarantees at most one entry per
    // fqid and makes `find` deterministic by design, so a custom `models.json`
    // entry authored under a built-in provider name never overrides the
    // built-in. See change: fix-and-prefer-model-proxy-resolution.
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const m of models) {
      const fqid = `${m.provider}/${m.id}`;
      if (seen.has(fqid)) continue;
      seen.add(fqid);
      deduped.push(m);
    }

    this.cachedAllModels = deduped;
    return deduped;
  }

  private hasAuth(provider: string, auth: Record<string, any>): boolean {
    const cred = auth[provider];
    if (!cred) return false;
    if (cred.type === "api_key" && cred.key) return true;
    if (cred.type === "oauth" && (cred.access || cred.refresh)) return true;
    return false;
  }

  /**
   * Can the given provider credential route this model?
   * api_key routes everything; oauth routes only when the model is not flagged
   * OAuth-incompatible (oauthCompatible !== false). See change: filter-oauth-incompatible-models, design §D1.
   */
  private canRouteModel(model: any, cred: any): boolean {
    if (!cred) return false;
    if (cred.type === "api_key" && cred.key) return true;
    if (cred.type === "oauth" && (cred.access || cred.refresh)) {
      return model.oauthCompatible !== false;
    }
    return false;
  }
}
