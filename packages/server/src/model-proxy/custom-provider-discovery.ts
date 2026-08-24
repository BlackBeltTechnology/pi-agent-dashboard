/**
 * Server-side custom-provider discovery.
 *
 * The dashboard bridge extension registers custom providers into every pi
 * session's registry via `pi.registerProvider()`. The dashboard SERVER process
 * is NOT a pi session, so its `InternalRegistry` must discover custom-provider
 * models itself: for each `providers.json#providers` entry, fetch `/v1/models`
 * and turn each id into a `CustomModelEntry` carrying the provider's
 * `baseUrl`/`api` (non-empty `baseUrl` so the model-proxy can route it).
 *
 * NO `models.json` is read or written — `providers.json` is the sole dashboard
 * store for custom providers.
 *
 * See change: add-agent-role-model-tools (Approach C).
 */
import { isFullyAdvertised } from "@blackbelt-technology/pi-dashboard-shared/provider-model-metadata.js";
import { listProviderModels, type ProbeApi, readProvidersFromDisk, resolveProbeApiKey } from "../package/provider-probe.js";
import type { CustomModelEntry, CustomProviderEntry } from "./internal-registry.js";

const KNOWN_PROBE_APIS: ReadonlySet<string> = new Set<ProbeApi>([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);

// Api-appropriate fallback capability floors, mirroring the extension's
// enrichModelMetadata FALLBACK_DEFAULTS. Applied PER FIELD, only where the
// provider advertised nothing (or something malformed) for that field —
// metadata-rich proxies DO advertise context_length / max_completion_tokens /
// capabilities, so an unconditional stamp would discard real data.
// See change: fix-custom-provider-model-metadata (design D3).
const FALLBACK: Record<string, { contextWindow: number; maxTokens: number }> = {
  "anthropic-messages": { contextWindow: 200_000, maxTokens: 64_000 },
  "google-generative-ai": { contextWindow: 1_000_000, maxTokens: 65_536 },
  "openai-completions": { contextWindow: 128_000, maxTokens: 16_384 },
};

/**
 * Discover models for a single custom provider. Resolves its apiKey
 * (literal / `$ENV` / stored) then lists `/v1/models`. Returns [] on any
 * failure so one unreachable provider cannot break the whole catalogue.
 */
export async function discoverProviderModels(
  name: string,
  entry: CustomProviderEntry,
): Promise<CustomModelEntry[]> {
  const api = (entry.api && KNOWN_PROBE_APIS.has(entry.api) ? entry.api : "openai-completions") as ProbeApi;
  const baseUrl = entry.baseUrl?.trim() ?? "";
  if (!baseUrl) return [];

  const resolved = resolveProbeApiKey({ apiKey: entry.apiKey ?? "", name, readProviders: readProvidersFromDisk });
  if (!resolved.ok) return [];

  const discovered = await listProviderModels({ baseUrl, apiKey: resolved.key, api });
  const floor = FALLBACK[api] ?? FALLBACK["openai-completions"];
  return discovered.map(({ id, advertised }) => ({
    id,
    provider: name,
    api,
    baseUrl,
    contextWindow: advertised.contextWindow ?? floor.contextWindow,
    maxTokens: advertised.maxTokens ?? floor.maxTokens,
    reasoning: advertised.reasoning ?? false,
    input: advertised.input ?? ["text"],
    // No probed provider advertises pricing; inventing it is out of scope.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Weakest adopted tier: "endpoint" only when every projected field came
    // from the provider, else "fallback" — so a floor value is never presented
    // as confirmed. See change: fix-custom-provider-model-metadata (D6).
    metadataSource: isFullyAdvertised(advertised) ? ("endpoint" as const) : ("fallback" as const),
  }));
}

/**
 * Discover models for every custom provider in `providers.json#providers`.
 * Runs providers concurrently; a failure for one yields [] for that one.
 */
export async function discoverAllCustomProviders(
  providers: Record<string, CustomProviderEntry>,
): Promise<CustomModelEntry[]> {
  const results = await Promise.all(
    Object.entries(providers).map(([name, entry]) => discoverProviderModels(name, entry)),
  );
  return results.flat();
}
