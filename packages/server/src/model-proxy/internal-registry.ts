/**
 * Server-resident model registry built on pi-ai primitives.
 *
 * Composes pi-ai's built-in providers with custom providers (~/.pi/agent/providers.json),
 * custom models (~/.pi/agent/models.json), and auth state (~/.pi/agent/auth.json).
 * Only models whose provider has valid auth are exposed.
 *
 * See change: add-dashboard-model-proxy, design §1.
 */
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
}

export class InternalRegistry {
  private piAi: PiAiModule;
  private authStorage: InternalAuthStorage;
  private deps: InternalRegistryDeps;
  private cachedModels: any[] | null = null;
  private cachedAllModels: any[] | null = null;

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

  async getApiKeyAndHeaders(model: any): Promise<{ apiKey: string; headers: Record<string, string> }> {
    return this.authStorage.getApiKeyAndHeaders(model);
  }

  async refresh(): Promise<void> {
    this.cachedModels = null;
    this.cachedAllModels = null;
    await this.authStorage.reload();
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

    // 2. Custom provider models — register providers from providers.json
    const customProviders = this.deps.readProviders();
    for (const [name, entry] of Object.entries(customProviders)) {
      // Custom providers are already in providers.json; models from them
      // are added via models.json (step 3). The baseUrl/api is used when
      // the model references this provider.
    }

    // 3. Custom models from models.json
    const customModels = this.deps.readModels();
    for (const cm of customModels) {
      // Look up base URL from custom providers if available
      const providerEntry = customProviders[cm.provider];
      const baseUrl = cm.baseUrl || providerEntry?.baseUrl || "";
      const api = cm.api || providerEntry?.api || "openai-completions";

      const model: any = {
        id: cm.id,
        name: cm.id,
        api,
        provider: cm.provider,
        baseUrl,
        reasoning: cm.reasoning ?? false,
        input: cm.input ?? ["text"],
        cost: cm.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: cm.contextWindow ?? 128000,
        maxTokens: cm.maxTokens ?? 8192,
        oauthCompatible: cm.oauthCompatible ?? true,
        ...(cm.headers ? { headers: cm.headers } : {}),
      };
      models.push(model);
    }

    this.cachedAllModels = models;
    return models;
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
