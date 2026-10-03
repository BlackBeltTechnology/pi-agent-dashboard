/**
 * Singleton accessor for the server-resident model registry.
 *
 * Lazy initialization: on first call, obtains the server's single pi
 * `ModelRuntime` (`server-model-runtime.ts`), wraps it in the
 * `InternalAuthStorage` + `InternalRegistry` facades, and caches the instance.
 *
 * See changes: add-dashboard-model-proxy (design §1), collapse-model-proxy-onto-modelruntime (D5, D6).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { flattenModelsJson } from "@blackbelt-technology/pi-dashboard-shared/models-json-reader.js";
import { readAuthJson } from "../auth/provider-auth-storage.js";
import { readProvidersFromDisk, resolveProbeApiKey } from "../package/provider-probe.js";
import { discoverAllCustomProviders } from "./custom-provider-discovery.js";
import { InternalAuthStorage } from "./internal-auth-storage.js";
import { type CustomModelEntry, type CustomProviderEntry, InternalRegistry } from "./internal-registry.js";
import {
  disposeServerModelRuntime,
  getServerModelRuntime,
  type ServerModelRuntime,
} from "./server-model-runtime.js";

let cachedRegistry: InternalRegistry | null = null;
let cachedRuntime: ServerModelRuntime | null = null;
let lastError: string | null = null;

// ── Disk readers ──────────────────────────────────────────────────────────────

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");

function readProviders(): Record<string, CustomProviderEntry> {
  if (!existsSync(PROVIDERS_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8"));
    return raw.providers ?? {};
  } catch {
    return {};
  }
}

/** Exported for unit tests. Reads $HOME/.pi/agent/models.json via the shared reader. */
export function readModels(): CustomModelEntry[] {
  if (!existsSync(MODELS_PATH)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(MODELS_PATH, "utf-8"));
  } catch (err) {
    // A syntax error is no longer silent — warn so a broken file is diagnosable.
    console.warn(`[model-proxy] models.json parse failed: ${(err as Error).message}`);
    return [];
  }
  // Native nested `providers.<p>.models[]` + legacy top-level shapes, via the
  // single shared reader both registry paths use. See change:
  // honor-native-models-json-metadata.
  return flattenModelsJson(raw) as CustomModelEntry[];
}

/**
 * Synthetic api_key credentials for custom providers, keyed by provider name.
 * Custom-provider apiKeys live in providers.json#providers (not auth.json), so
 * the registry's auth-filter (canRouteModel) and the proxy's key resolution
 * would otherwise treat every discovered custom model as unauthenticated and
 * exclude it from `getAvailable()`. Resolves literal / `$ENV` keys.
 * See change: add-agent-role-model-tools.
 */
function readCustomProviderCreds(): Record<string, { type: "api_key"; key: string }> {
  const out: Record<string, { type: "api_key"; key: string }> = {};
  for (const [name, entry] of Object.entries(readProviders())) {
    const resolved = resolveProbeApiKey({ apiKey: entry.apiKey ?? "", name, readProviders: readProvidersFromDisk });
    if (resolved.ok && resolved.key) out[name] = { type: "api_key", key: resolved.key };
  }
  return out;
}

/** auth.json credentials plus synthetic custom-provider api_key creds. */
function readAugmentedAuth(): Record<string, any> {
  return { ...readAuthJson(), ...readCustomProviderCreds() };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** In-flight first initialization: concurrent first callers share ONE registry (one projection owner). */
let pendingRegistry: Promise<InternalRegistry> | null = null;

export function getModelRegistry(): Promise<InternalRegistry> {
  if (cachedRegistry) return Promise.resolve(cachedRegistry);
  pendingRegistry ??= initModelRegistry().finally(() => {
    pendingRegistry = null;
  });
  return pendingRegistry;
}

async function initModelRegistry(): Promise<InternalRegistry> {
  try {
    const { runtime } = await getServerModelRuntime();
    const authStorage = new InternalAuthStorage(runtime, readCustomProviderCreds);
    cachedRuntime = runtime;
    cachedRegistry = new InternalRegistry(runtime, authStorage, {
      readProviders,
      readModels,
      readAuth: readAugmentedAuth,
      discoverCustomProviders: discoverAllCustomProviders,
    });
    // Fire-and-forget initial custom-provider discovery so /api/models reflects
    // providers.json without waiting on the first request. Non-fatal on error.
    cachedRegistry.discover().catch(() => {});
    lastError = null;
    return cachedRegistry;
  } catch (err) {
    lastError = (err as Error).message;
    throw err;
  }
}

export async function refreshModelRegistry(): Promise<void> {
  if (!cachedRegistry) return;
  await cachedRegistry.refresh();
}

export function disposeModelRegistry(): void {
  cachedRegistry = null;
  pendingRegistry = null;
  cachedRuntime = null;
  lastError = null;
  disposeServerModelRuntime();
}

export interface StreamSimpleOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  /** Accepted for caller compatibility; never forwarded (see `getStreamSimpleFn`). */
  apiKey?: unknown;
}

export type RuntimeStreamSimpleFn = (model: any, context: any, options?: StreamSimpleOptions) => AsyncIterable<any>;

/**
 * The runtime's `streamSimple`, once the registry is initialized; `null`
 * before. An `apiKey` in the options is DROPPED: the facade already resolved
 * (and, if needed, refreshed) the credential, and the runtime re-reads it
 * through the store and applies the provider's own auth path — an OAuth access
 * token passed as an api-key override would be sent as the wrong header.
 * See change: collapse-model-proxy-onto-modelruntime (D5).
 */
export function getStreamSimpleFn(): RuntimeStreamSimpleFn | null {
  const runtime = cachedRuntime;
  if (!runtime) return null;
  return (model, context, options = {}) => {
    const { apiKey: _apiKey, ...rest } = options;
    return runtime.streamSimple(model, context, rest);
  };
}

export interface ModelProxyStatus {
  status: "ready" | "degraded";
  reason?: string;
}

export function getModelProxyStatus(): ModelProxyStatus {
  if (cachedRegistry) return { status: "ready" };
  if (lastError) return { status: "degraded", reason: lastError };
  return { status: "degraded", reason: "Model registry not yet initialized" };
}
