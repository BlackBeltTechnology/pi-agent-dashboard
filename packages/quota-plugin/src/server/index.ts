/**
 * Provider Quota — dashboard server entry. No bridge, and NO peer extensions.
 *
 * Quota is an ACCOUNT-level fact, not per-session, so the server resolves
 * credentials through its own auth abstraction and calls each provider's usage
 * endpoint DIRECTLY. The contract lives in `./quotas/` — endpoints, headers and
 * payload parsing are all owned here.
 *
 * This replaced two user-installed peer extensions (`@latentminds/pi-quotas`,
 * `@hk_net/pi-usage-bars`). Owning the contract removed the whole class of
 * problems they caused: a provider could be enabled but unservable because the
 * needed peer was absent, failures were indistinguishable from each other, and
 * Anthropic never worked through one peer at all because its `sk-ant-` guard
 * misread the OAuth token as a direct API key.
 *
 * Two gates gate every fetch: the plugin must be enabled AND the specific
 * provider enabled — both server-owned config, both default-off.
 *
 * SECURITY: tokens never leave the server. Only derived `QuotaWindow[]` reach
 * the client; the logger records provider ids and failure KINDS, never a token
 * and never a raw upstream message (see `quotas/http.ts` scrubbing).
 *
 * See change: publish-quota-plugin.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type {
  ApiQuotaResponse,
  ProviderQuota,
  QuotaPluginConfig,
  QuotaRetryConfig,
  QuotaUnavailableDto,
} from "../types.js";
import { type AuthLike, type FetchResult, PROVIDER_FETCHERS, SUPPORTED_PROVIDERS } from "./quotas/fetchers.js";

/** Schema bounds (design D5), enforced again on read — the file is external. */
const RETRY_BOUNDS = {
  maxAttempts: { min: 0, max: 5, dflt: 3 },
  baseDelayMs: { min: 100, max: 10_000, dflt: 1_000 },
  maxDelayMs: { min: 100, max: 60_000, dflt: 60_000 },
} as const;

interface ClampedRetry {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Read + clamp the retry config to the schema bounds BEFORE any arithmetic or
 * timer (design D5). A hand-edited overflow/negative/NaN value is coerced to a
 * safe bound, so retry can never produce an unbounded wait or a timer overflow.
 */
export function clampRetry(retry: QuotaRetryConfig | undefined): ClampedRetry {
  const clamp = (v: unknown, b: { min: number; max: number; dflt: number }): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : b.dflt;
    return Math.min(b.max, Math.max(b.min, n));
  };
  return {
    enabled: retry?.enabled === true,
    maxAttempts: Math.round(clamp(retry?.maxAttempts, RETRY_BOUNDS.maxAttempts)),
    baseDelayMs: clamp(retry?.baseDelayMs, RETRY_BOUNDS.baseDelayMs),
    maxDelayMs: clamp(retry?.maxDelayMs, RETRY_BOUNDS.maxDelayMs),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One provider's fetch + bounded transient retry (design D1/D3/D6). One fetcher
 * invocation = one attempt. Stops early on success or a TERMINAL failure; else
 * retries up to `maxAttempts` times with delay `min(baseDelayMs·2^n, maxDelayMs)`.
 * The finite capped schedule IS the bound — no separate budget knob.
 */
async function fetchWithRetry(
  fetcher: (auth: AuthLike) => Promise<FetchResult>,
  auth: AuthLike,
  retry: ClampedRetry,
  provider: string,
  logger?: ServerPluginContext["logger"],
): Promise<FetchResult> {
  const maxRetries = retry.enabled ? retry.maxAttempts : 0;
  for (let attempt = 0; ; attempt++) {
    let result: FetchResult;
    try {
      result = await fetcher(auth);
    } catch {
      // Never log the error object — it can carry a URL or header. A thrown
      // error is terminal (a parse throw is already mapped to no-data upstream).
      logger?.warn?.(`quota fetch threw for ${provider}`);
      return { failure: "peer-rejected" };
    }
    if (!result.failure) return result; // success
    if (result.transient !== true) return result; // terminal — retry cannot help
    if (attempt >= maxRetries) return result; // schedule exhausted
    await sleep(Math.min(retry.baseDelayMs * 2 ** attempt, retry.maxDelayMs));
  }
}

/**
 * Adapt the host credential seams onto the 2-method shape the fetchers use.
 * `get` returns the raw stored credential (OAuth metadata such as the Codex
 * account id); `getApiKey` returns a fresh access token via the host's
 * OAuth-refreshing resolver.
 *
 * Both come from `ServerPluginContext` — NEVER a deep import into the server
 * package (this plugin ships to npm, where no such source tree exists) and
 * NEVER a hardcoded ~/.pi/agent/auth.json path. Degrades to "no quota" when
 * the host withholds either seam.
 */
function createAuthAdapter(ctx: ServerPluginContext): AuthLike {
  return {
    get: (provider: string) => ctx.providerAuth?.getCredential(provider),
    getApiKey: async (provider: string) => {
      try {
        const registry = await ctx.modelRuntime?.getModelRegistry();
        if (!registry) return undefined;
        const { apiKey } = await registry.getApiKeyAndHeaders({ provider, headers: {} });
        return apiKey || undefined;
      } catch {
        // Missing credential / degraded registry → the provider degrades to
        // "no quota" honestly. Never surfaces a token.
        return undefined;
      }
    },
  };
}

/** Providers eligible for a fetch: plugin enabled + that provider enabled. */
function enabledProviders(config: QuotaPluginConfig): string[] {
  if (config.enabled !== true) return [];
  return SUPPORTED_PROVIDERS.filter((p) => config.providers?.[p]?.enabled === true);
}

/**
 * Last successful snapshot per provider, retained across a failed refresh so a
 * throttled provider stays visible instead of vanishing from the bar. Bounded
 * in size by the supported-provider list; cleared per-provider on opt-out.
 */
const lastGood = new Map<string, ProviderQuota>();

/** Test seam: drop all retained snapshots. */
export function _resetQuotaRetention(): void {
  lastGood.clear();
}

/**
 * Compute the current quota snapshot.
 *
 * Makes ZERO network calls when the gates are closed. Each enabled provider is
 * fetched in parallel and can fail independently — one provider's failure never
 * breaks the snapshot.
 *
 * TRANSIENT FAILURES RETAIN THE PRIOR SNAPSHOT: a provider whose refresh fails
 * (throttled 429, network blip) keeps its last successful figures flagged
 * `stale`. Retention is dropped the moment the provider (or the plugin) is
 * disabled, so it can never outlive an opt-out.
 *
 * Enabled providers that yielded nothing AND have no retained snapshot are
 * reported in `unavailable` with a reason, so the settings UI can explain the
 * silence instead of leaving the user guessing.
 */
export async function computeQuota(
  config: QuotaPluginConfig,
  auth: AuthLike,
  logger?: ServerPluginContext["logger"],
): Promise<ApiQuotaResponse> {
  const enabled = new Set(enabledProviders(config));

  // Opt-out drops retention immediately: a disabled provider must not keep
  // showing figures, and re-enabling must not resurrect pre-opt-out data.
  for (const p of [...lastGood.keys()]) {
    if (!enabled.has(p)) lastGood.delete(p);
  }

  if (enabled.size === 0) return { providers: [] };

  const retry = clampRetry(config.retry);
  const order = [...enabled];
  const results = await Promise.all(
    order.map(async (provider): Promise<FetchResult> => {
      const fetcher = PROVIDER_FETCHERS[provider];
      if (!fetcher) return { failure: "no-adapter" };
      return fetchWithRetry(fetcher, auth, retry, provider, logger);
    }),
  );

  const providers: ProviderQuota[] = [];
  const unavailable: QuotaUnavailableDto[] = [];

  for (const [i, provider] of order.entries()) {
    const result = results[i];

    if (result.windows) {
      const quota: ProviderQuota = { provider, windows: result.windows };
      lastGood.set(provider, quota);
      providers.push(quota);
      continue;
    }

    logger?.warn?.(`quota unavailable for ${provider} (${result.failure})`);

    const retained = lastGood.get(provider);
    if (retained) {
      // Still visible (stale) → the user needs no explanation.
      providers.push({ ...retained, stale: true });
      continue;
    }
    unavailable.push({ provider, reason: result.failure });
  }

  return { providers, ...(unavailable.length > 0 ? { unavailable } : {}) };
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const auth = createAuthAdapter(ctx);

  const httpServer = (ctx.fastify as unknown as { server?: { listening?: boolean } }).server;
  if (httpServer?.listening) {
    ctx.logger?.warn?.("quota: Fastify already listening; skipping /api/quota route registration.");
    return;
  }

  try {
    ctx.fastify.get("/api/quota", async () => {
      const config = ctx.getPluginConfig<QuotaPluginConfig>();
      const snapshot = await computeQuota(config, auth, ctx.logger);
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
