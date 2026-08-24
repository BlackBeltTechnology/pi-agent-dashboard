/**
 * Provider Quota — dashboard server entry. No bridge.
 *
 * Quota is an ACCOUNT-level fact, not per-session, so the server resolves
 * credentials through its OWN auth abstraction and fetches directly via
 * `@latentminds/pi-quotas` (which owns per-provider TTL caching + in-flight
 * dedup). Three gates guard every fetch: the plugin must be enabled, the ToS
 * acknowledged, and the specific provider enabled — all server-owned config,
 * all default-OFF, none migrated on.
 *
 * Tokens NEVER leave the server: only derived `QuotaWindow[]` reach the client,
 * and the logger records provider ids + error KINDS only (never a message that
 * could carry a URL/header). Anthropic is excluded (pi blocks Claude
 * subscription inference server-side; API-key sessions return `not_applicable`).
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
// Host auth abstraction — deep-imported from the server package (no `exports`
// map, so subpaths resolve; server runs via jiti). NEVER a hardcoded
// ~/.pi/agent/auth.json path in this plugin.
import { readAuthJson } from "@blackbelt-technology/pi-dashboard-server/src/auth/provider-auth-storage.js";
import { getModelRegistry } from "@blackbelt-technology/pi-dashboard-server/src/model-proxy/registry-singleton.js";
// Pinned raw-TS deep import — see src/pi-quotas.d.ts + design.md "Packaging".
import {
  clearQuotaCache,
  fetchProviderQuotas,
  SUPPORTED_PROVIDERS,
} from "@latentminds/pi-quotas/src/lib/quotas.js";
import type { ApiQuotaResponse, ProviderQuota, QuotaPluginConfig, QuotaWindowDto } from "../types.js";

/** Anthropic is excluded from the subscription tracker (see file header). */
const EXCLUDED = "anthropic";

/**
 * Minimal 2-method `AuthStorage` shape `@latentminds/pi-quotas` consumes,
 * adapted onto the host's own resolver. `get` returns the raw stored
 * credential (OAuth metadata such as the Codex account id); `getApiKey`
 * returns a fresh access token via the host's OAuth-refreshing resolver.
 */
function createAuthAdapter(): { get: (p: string) => unknown; getApiKey: (p: string) => Promise<string | undefined> } {
  return {
    get: (provider: string) => readAuthJson()[provider],
    getApiKey: async (provider: string) => {
      try {
        const registry = await getModelRegistry();
        const { apiKey } = await registry.getApiKeyAndHeaders({ provider, headers: {} });
        return apiKey || undefined;
      } catch {
        // Missing credential / degraded registry → provider fetch degrades to
        // "no quota" honestly. Never surfaces a token.
        return undefined;
      }
    },
  };
}

/** Providers eligible for a fetch given current config: enabled, acked, per-provider on, never Anthropic. */
function enabledProviders(config: QuotaPluginConfig): string[] {
  if (config.enabled !== true || config.acknowledgedToS !== true) return [];
  return SUPPORTED_PROVIDERS.filter(
    (p) => p !== EXCLUDED && config.providers?.[p]?.enabled === true,
  );
}

/** Normalize one lib window to the wire DTO. Drops windows without a usable pace basis. */
function toDto(w: {
  label: string;
  usedPercent: number;
  resetsAt: Date;
  windowSeconds: number;
  isCurrency?: boolean;
  usedValue?: number;
  limitValue?: number;
}): QuotaWindowDto | null {
  if (!Number.isFinite(w.windowSeconds) || w.windowSeconds <= 0) return null;
  const resetsAt = w.resetsAt instanceof Date ? w.resetsAt : new Date(w.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) return null;
  const usedPercent = Number.isFinite(w.usedPercent)
    ? Math.min(100, Math.max(0, w.usedPercent))
    : 0;
  const dto: QuotaWindowDto = {
    label: w.label,
    usedPercent,
    resetsAt: resetsAt.toISOString(),
    windowSeconds: w.windowSeconds,
  };
  if (w.isCurrency) dto.isCurrency = true;
  if (Number.isFinite(w.usedValue as number)) dto.usedValue = w.usedValue;
  if (Number.isFinite(w.limitValue as number)) dto.limitValue = w.limitValue;
  return dto;
}

/** Fetch + normalize one provider. Returns null on not_applicable/error/empty (never throws). */
async function fetchOneProvider(
  provider: string,
  authAdapter: ReturnType<typeof createAuthAdapter>,
  logger?: ServerPluginContext["logger"],
): Promise<ProviderQuota | null> {
  try {
    const result = await fetchProviderQuotas(authAdapter, provider);
    if (!result.success) {
      // `not_applicable` (API-key session), errors, timeouts → silently omit.
      if (result.error.kind !== "not_applicable") {
        logger?.warn?.(`quota fetch failed for ${provider} (kind=${result.error.kind})`);
      }
      return null;
    }
    const windows = result.data.windows.map(toDto).filter((w): w is QuotaWindowDto => w !== null);
    return windows.length > 0 ? { provider, windows } : null;
  } catch {
    // Never let one provider's failure break the snapshot; never log the error
    // object (could carry a header/URL).
    logger?.warn?.(`quota fetch threw for ${provider}`);
    return null;
  }
}

/**
 * Compute the current quota snapshot. Makes ZERO endpoint calls when the gates
 * are closed. Clears the lib cache for any provider not currently enabled so a
 * disabled provider's data does not linger.
 */
export async function computeQuota(
  config: QuotaPluginConfig,
  authAdapter: ReturnType<typeof createAuthAdapter>,
  logger?: ServerPluginContext["logger"],
): Promise<ApiQuotaResponse> {
  const enabled = new Set(enabledProviders(config));

  // Drop cached quota for anything not currently enabled (incl. Anthropic).
  for (const p of SUPPORTED_PROVIDERS) {
    if (!enabled.has(p)) {
      try {
        clearQuotaCache(p);
      } catch {
        /* never throw from cache maintenance */
      }
    }
  }

  if (enabled.size === 0) return { providers: [] };

  const results = await Promise.all(
    [...enabled].map((provider) => fetchOneProvider(provider, authAdapter, logger)),
  );
  return { providers: results.filter((p): p is ProviderQuota => p !== null) };
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const authAdapter = createAuthAdapter();

  const httpServer = (ctx.fastify as unknown as { server?: { listening?: boolean } }).server;
  if (httpServer?.listening) {
    ctx.logger?.warn?.("quota: Fastify already listening; skipping /api/quota route registration.");
    return;
  }

  try {
    ctx.fastify.get("/api/quota", async () => {
      const config = ctx.getPluginConfig<QuotaPluginConfig>();
      const snapshot = await computeQuota(config, authAdapter, ctx.logger);
      // Optional live push for subscribed clients.
      try {
        (ctx as unknown as { broadcastToSubscribers?: (m: unknown) => void }).broadcastToSubscribers?.({
          type: "quota_update",
          providers: snapshot.providers,
        });
      } catch {
        /* never throw from broadcast */
      }
      return snapshot;
    });
  } catch (err) {
    ctx.logger?.warn?.(
      `quota: route registration failed (${err instanceof Error ? err.message : String(err)}).`,
    );
  }

  ctx.logger?.info?.("quota server entry ready");
}
