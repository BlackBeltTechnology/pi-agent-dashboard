/**
 * Singleton accessor for the server-resident model registry.
 *
 * Lazy initialization: on first call, resolves pi-ai via ToolRegistry,
 * constructs InternalAuthStorage + InternalRegistry, and caches the instance.
 *
 * See change: add-dashboard-model-proxy, design §1.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonc } from "@blackbelt-technology/pi-dashboard-shared/jsonc.js";
import { flattenModelsJson } from "@blackbelt-technology/pi-dashboard-shared/models-json-reader.js";
import { getDefaultRegistry, ModuleResolutionError } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { readAuthJson } from "../auth/provider-auth-storage.js";
import { readProvidersFromDisk, resolveProbeApiKey } from "../package/provider-probe.js";
import { discoverAllCustomProviders } from "./custom-provider-discovery.js";
import { InternalAuthStorage, type PiAiOAuthModule } from "./internal-auth-storage.js";
import { type CustomModelEntry, type CustomProviderEntry, InternalRegistry, type PiAiModule } from "./internal-registry.js";

let cachedRegistry: InternalRegistry | null = null;
let cachedPiAi: PiAiModule | null = null;
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
    // JSONC, not JSON: pi's own loader strips comments before parsing, so a
    // commented models.json is a supported authoring format. See jsonc.ts.
    raw = parseJsonc(readFileSync(MODELS_PATH, "utf-8"));
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

export async function getModelRegistry(): Promise<InternalRegistry> {
  if (cachedRegistry) return cachedRegistry;

  try {
    const { resolution, module: piAi } = await getDefaultRegistry().resolveModule<PiAiModule>("pi-ai");

    // Resolve oauth subpath
    let oauthModule: PiAiOAuthModule | null = null;
    if (resolution.path) {
      const oauthPath = resolution.path.replace(/\/dist\/index\.js$/, "/dist/oauth.js");
      try {
        oauthModule = (await import(pathToFileURL(oauthPath).href)) as PiAiOAuthModule;
      } catch {
        // OAuth subpath may not exist; non-fatal
      }
    }

    const authStorage = new InternalAuthStorage(oauthModule, readCustomProviderCreds);
    cachedPiAi = piAi;
    cachedRegistry = new InternalRegistry(piAi, authStorage, {
      readProviders,
      readModels,
      readAuth: readAugmentedAuth,
      discoverCustomProviders: discoverAllCustomProviders,
    });
    // Fire-and-forget initial custom-provider discovery so /api/models reflects
    // providers.json without waiting on the first request. Non-fatal on error.
    void cachedRegistry.discover().catch(() => {});
    lastError = null;
    return cachedRegistry;
  } catch (err) {
    const msg = err instanceof ModuleResolutionError
      ? err.message
      : (err as Error).message;
    lastError = msg;
    throw err;
  }
}

export async function refreshModelRegistry(): Promise<void> {
  if (!cachedRegistry) return;
  await cachedRegistry.refresh();
}

export function disposeModelRegistry(): void {
  cachedRegistry = null;
  cachedPiAi = null;
  lastError = null;
}

/**
 * Returns pi-ai's streamSimple after registry is initialized.
 * Throws if registry has not been initialized.
 */
export function getStreamSimpleFn(): PiAiModule["streamSimple"] | null {
  return cachedPiAi?.streamSimple ?? null;
}

export function getModelProxyStatus(): { status: "ready" | "degraded"; reason?: string } {
  if (cachedRegistry) return { status: "ready" };
  if (lastError) return { status: "degraded", reason: lastError };
  return { status: "degraded", reason: "Model registry not yet initialized" };
}
