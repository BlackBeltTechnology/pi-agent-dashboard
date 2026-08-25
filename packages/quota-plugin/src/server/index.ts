/**
 * Provider Quota — dashboard server entry. No bridge.
 *
 * Quota is an ACCOUNT-level fact, not per-session, so the server resolves
 * credentials through its OWN auth abstraction and fetches via up to TWO PEER
 * pi extensions, both user-installed, NOT bundled:
 *   - `@latentminds/pi-quotas`  — broad coverage; cannot serve Anthropic.
 *   - `@hk_net/pi-usage-bars`   — the only source that can serve Anthropic OAuth.
 * BOTH must be installed (`requires.piExtensions`); each enabled
 * provider is routed to the first installed source that can serve it, per the
 * capability table in ../sources.ts. Two gates guard every fetch: the plugin
 * must be enabled and the specific provider enabled — both server-owned config.
 *
 * Tokens NEVER leave the server: only derived `QuotaWindow[]` reach the client,
 * and the logger records provider ids + error KINDS only (never a message that
 * could carry a URL/header). Every provider the peer supports is trackable,
 * Anthropic included; API-key sessions return `not_applicable` and are omitted.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
// Host auth abstraction — deep-imported from the server package (no `exports`
// map, so subpaths resolve; server runs via jiti). NEVER a hardcoded
// ~/.pi/agent/auth.json path in this plugin.
import { readAuthJson } from "@blackbelt-technology/pi-dashboard-server/src/auth/provider-auth-storage.js";
import { getModelRegistry } from "@blackbelt-technology/pi-dashboard-server/src/model-proxy/registry-singleton.js";
import type { ApiQuotaResponse, ProviderQuota, QuotaPluginConfig, QuotaWindowDto } from "../types.js";
// Peer pi extension, resolved at runtime from the user's pi install (never a
// bundled npm dependency of this plugin).
import {
  ALL_SOURCES,
  type QuotaSourceId,
  resolveSource,
  SOURCE_PACKAGES,
  TRACKED_PROVIDERS,
} from "../sources.js";
import { loadUsageBars, type UsageBarsLib } from "./load-usage-bars.js";
import { loadPiQuotas, type PiQuotasLib } from "./load-pi-quotas.js";

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

/** Providers eligible for a fetch given current config: plugin enabled + that provider enabled. */
function enabledProviders(config: QuotaPluginConfig, supported: string[]): string[] {
  if (config.enabled !== true) return [];
  return supported.filter((p) => config.providers?.[p]?.enabled === true);
}

/**
 * Fetch one provider through the `usage-bars` peer and normalize to our DTO.
 * Returns null on absent fetcher / missing credential / error (never throws).
 *
 * The peer reports two fixed windows (session + weekly) as percentages with ISO
 * reset stamps; a window is dropped when hidden or missing its reset stamp,
 * since pace needs `resetsAt` + `windowSeconds`.
 */
async function fetchFromUsageBars(
  lib: UsageBarsLib,
  provider: string,
  authAdapter: ReturnType<typeof createAuthAdapter>,
  logger?: ServerPluginContext["logger"],
): Promise<ProviderQuota | null> {
  const fetcher = lib.fetchers[provider];
  if (!fetcher) return null;
  try {
    const token = await authAdapter.getApiKey(provider);
    if (!token) return null; // No credential → honest "no quota", no call made.
    const data = await fetcher(token);
    if (data.error || data.quotaHidden) return null;

    const windows: QuotaWindowDto[] = [];
    const push = (
      usedPercent: number | undefined,
      resetsAt: string | undefined,
      label: string,
      windowSeconds: number,
      hidden?: boolean,
    ) => {
      if (hidden || typeof usedPercent !== "number" || !resetsAt) return;
      if (!Number.isFinite(usedPercent)) return;
      windows.push({
        label,
        usedPercent: Math.max(0, Math.min(100, usedPercent)),
        resetsAt,
        windowSeconds,
      });
    };
    push(data.session, data.sessionResetsAt, data.sessionLabel ?? "Session", 5 * 3600, data.sessionHidden);
    push(data.weekly, data.weeklyResetsAt, data.weeklyLabel ?? "Weekly", 7 * 86400, data.weeklyHidden);

    return windows.length > 0 ? { provider, windows } : null;
  } catch {
    // Never log the error object (could carry a header/URL).
    logger?.warn?.(`quota fetch threw for ${provider} (source=usage-bars)`);
    return null;
  }
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
  lib: PiQuotasLib,
  provider: string,
  authAdapter: ReturnType<typeof createAuthAdapter>,
  logger?: ServerPluginContext["logger"],
): Promise<ProviderQuota | null> {
  try {
    const result = await lib.fetchProviderQuotas(authAdapter, provider);
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
 * Compute the current quota snapshot across BOTH peer sources.
 *
 * Makes ZERO endpoint calls when the gates are closed or no peer is installed.
 * Each enabled provider is routed to the first INSTALLED source that can serve
 * it (`resolveSource`), so one peer alone still yields its own coverage and both
 * together yield the union. A provider no installed source can serve is skipped
 * silently — the settings UI already disables its checkbox.
 *
 * Clears the pi-quotas cache for any provider not currently enabled so disabled
 * data does not linger.
 */
export async function computeQuota(
  config: QuotaPluginConfig,
  authAdapter: ReturnType<typeof createAuthAdapter>,
  logger?: ServerPluginContext["logger"],
): Promise<ApiQuotaResponse> {
  const [lib, barsLib] = await Promise.all([loadPiQuotas(), loadUsageBars()]);

  const installed: QuotaSourceId[] = [];
  if (lib) installed.push("pi-quotas");
  if (barsLib) installed.push("usage-bars");

  // Always report source availability, even when nothing is installed: the
  // settings UI needs it to explain WHY a checkbox is disabled.
  const sources = ALL_SOURCES.map((id) => ({
    id,
    package: SOURCE_PACKAGES[id],
    installed: installed.includes(id),
  }));

  if (installed.length === 0) {
    // No peer installed → the Packages UI shows the [Install] prompt via
    // `requires.piExtensions`; here we degrade silently.
    return { providers: [], sources };
  }

  const enabled = new Set(enabledProviders(config, TRACKED_PROVIDERS));

  if (lib) {
    for (const p of lib.SUPPORTED_PROVIDERS) {
      if (!enabled.has(p)) {
        try {
          lib.clearQuotaCache(p);
        } catch {
          /* never throw from cache maintenance */
        }
      }
    }
  }

  if (enabled.size === 0) return { providers: [], sources };

  const results = await Promise.all(
    [...enabled].map((provider) => {
      const source = resolveSource(provider, installed);
      // No installed source can serve it → skip without a call.
      if (source === "pi-quotas" && lib) {
        return fetchOneProvider(lib, provider, authAdapter, logger);
      }
      if (source === "usage-bars" && barsLib) {
        return fetchFromUsageBars(barsLib, provider, authAdapter, logger);
      }
      return null;
    }),
  );
  return {
    providers: results.filter((p): p is ProviderQuota => p !== null),
    sources,
  };
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
