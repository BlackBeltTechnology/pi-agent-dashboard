/**
 * Quota SOURCES and the provider→source capability table.
 *
 * This plugin draws quota from TWO complementary PEER pi extensions, neither
 * bundled, each user-installed. BOTH are required (declared as
 * `requires.piExtensions`); together their coverage is the union.
 *
 *  - `pi-quotas`  (@latentminds/pi-quotas)   — the broad peer. CANNOT serve
 *    Anthropic: it guards on `token.startsWith("sk-ant-")` and classifies every
 *    Anthropic credential as a direct API key, so an OAuth subscription token
 *    (`sk-ant-oat01-…`) returns `not_applicable` unconditionally. Structural,
 *    not configurable — hence Anthropic is absent from its provider list here.
 *  - `usage-bars` (@hk_net/pi-usage-bars)    — gates on the AUTH SOURCE rather
 *    than a token prefix, so Anthropic OAuth works (verified against
 *    api.anthropic.com/api/oauth/usage). Has no Copilot/Synthetic/OpenCode-Go.
 *
 * `PROVIDER_SOURCES` is the single source of truth for BOTH the server (which
 * source to fetch a provider from) and the settings UI (whether a provider's
 * checkbox is tickable at all, and which peer to name when it is not). Order is
 * PREFERENCE: the first installed source wins.
 *
 * See change: add-provider-quota-plugin.
 */

/** Stable id of a quota source. */
export type QuotaSourceId = "pi-quotas" | "usage-bars";

/** npm package that must be installed as a pi extension to supply each source. */
export const SOURCE_PACKAGES: Record<QuotaSourceId, string> = {
  "pi-quotas": "@latentminds/pi-quotas",
  "usage-bars": "@hk_net/pi-usage-bars",
};

export const ALL_SOURCES: QuotaSourceId[] = ["pi-quotas", "usage-bars"];

/**
 * Which source(s) can serve each provider, in preference order.
 *
 * `pi-quotas` is preferred wherever both can serve, because it is the peer this
 * plugin shipped with and is already proven in the field for those providers.
 * Anthropic lists ONLY `usage-bars` (see the header note on the prefix guard).
 */
export const PROVIDER_SOURCES: Record<string, QuotaSourceId[]> = {
  // usage-bars only — pi-quotas' sk-ant- guard makes Anthropic impossible there.
  anthropic: ["usage-bars"],
  // Either peer; pi-quotas preferred (incumbent, proven).
  "openai-codex": ["pi-quotas", "usage-bars"],
  openrouter: ["pi-quotas", "usage-bars"],
  zai: ["pi-quotas", "usage-bars"],
  "kimi-coding": ["pi-quotas", "usage-bars"],
  // pi-quotas only — usage-bars has no adapter for these.
  "github-copilot": ["pi-quotas"],
  synthetic: ["pi-quotas"],
  "opencode-go": ["pi-quotas"],
  // usage-bars only.
  deepseek: ["usage-bars"],
  minimax: ["usage-bars"],
};

/** Canonical provider ids this plugin can track, in display order. */
export const TRACKED_PROVIDERS = Object.keys(PROVIDER_SOURCES);

/**
 * Provider id as each peer names it. Absent entry → the peer's own id equals
 * ours. `usage-bars` uses `claude`/`kimi` where we use `anthropic`/`kimi-coding`.
 */
const PEER_PROVIDER_ALIASES: Partial<Record<QuotaSourceId, Record<string, string>>> = {
  "usage-bars": {
    anthropic: "claude",
    "openai-codex": "codex",
    "kimi-coding": "kimi",
  },
};

/** Translate a canonical provider id into the id `source` uses. */
export function peerProviderId(source: QuotaSourceId, provider: string): string {
  return PEER_PROVIDER_ALIASES[source]?.[provider] ?? provider;
}

/**
 * The source that should serve `provider` given the installed set, or null when
 * none can. Preference order from `PROVIDER_SOURCES`.
 */
export function resolveSource(
  provider: string,
  installed: Iterable<QuotaSourceId>,
): QuotaSourceId | null {
  const have = new Set(installed);
  for (const candidate of PROVIDER_SOURCES[provider] ?? []) {
    if (have.has(candidate)) return candidate;
  }
  return null;
}

/**
 * True when at least one installed source can serve `provider` — the predicate
 * the settings UI uses to enable/disable a provider's checkbox.
 */
export function isProviderServable(
  provider: string,
  installed: Iterable<QuotaSourceId>,
): boolean {
  return resolveSource(provider, installed) !== null;
}

/**
 * Packages that could serve `provider` (for a "requires X" hint next to a
 * disabled checkbox). Independent of what is installed.
 */
export function requiredPackagesFor(provider: string): string[] {
  return (PROVIDER_SOURCES[provider] ?? []).map((s) => SOURCE_PACKAGES[s]);
}
