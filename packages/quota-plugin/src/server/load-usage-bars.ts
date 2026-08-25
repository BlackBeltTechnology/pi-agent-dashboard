/**
 * Runtime loader for the `@hk_net/pi-usage-bars` PEER pi extension — the source
 * that can serve Anthropic.
 *
 * Same peer contract as load-pi-quotas.ts: NOT an npm dependency (the package
 * ships only `pi.extensions[]`, no `main`/`exports`), so it is user-installed
 * and resolved at RUNTIME from the user's pi install. Absent → `null`, and the
 * caller degrades to "no quota from this source". Never throws.
 *
 * Why this peer exists alongside `@latentminds/pi-quotas`: pi-quotas guards
 * Anthropic with `token.startsWith("sk-ant-")` and so treats an OAuth
 * subscription token (`sk-ant-oat01-…`) as a direct API key, returning
 * `not_applicable` unconditionally. This peer gates on the auth SOURCE instead,
 * so Anthropic works. See sources.ts for the capability table.
 */
import path from "node:path";
import { resolvePiPackage } from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";

/** The peer's per-provider usage payload (subset we consume). */
export interface UsageBarsData {
  session: number;
  weekly: number;
  sessionResetsAt?: string;
  weeklyResetsAt?: string;
  sessionLabel?: string;
  weeklyLabel?: string;
  sessionHidden?: boolean;
  weeklyHidden?: boolean;
  quotaHidden?: boolean;
  error?: string;
}

type Fetcher = (token: string, config?: Record<string, unknown>) => Promise<UsageBarsData>;

/** The slice of the peer's `core` surface this plugin consumes. */
export interface UsageBarsLib {
  /** Canonical-provider-id → fetcher. Only providers we route here are present. */
  fetchers: Record<string, Fetcher>;
}

export const USAGE_BARS_PACKAGE = "@hk_net/pi-usage-bars";

/**
 * Canonical provider id → the peer's exported fetcher name. Keys MUST match the
 * `usage-bars` rows of `PROVIDER_SOURCES` in sources.ts.
 */
const FETCHER_NAMES: Record<string, string> = {
  anthropic: "fetchClaudeUsage",
  "openai-codex": "fetchCodexUsage",
  openrouter: "fetchOpenRouterUsage",
  zai: "fetchZaiUsage",
  "kimi-coding": "fetchKimiUsage",
  deepseek: "fetchDeepSeekBalance",
  minimax: "fetchMiniMaxUsage",
};

/** Only a SUCCESSFUL load is memoized — see the rationale in load-pi-quotas.ts. */
let cached: UsageBarsLib | undefined;

const warned = new Set<string>();
function warnOnce(reason: string): null {
  if (!warned.has(reason)) {
    warned.add(reason);
    console.warn(`[plugin:quota] ${USAGE_BARS_PACKAGE} unavailable — ${reason}`);
  }
  return null;
}

/**
 * Resolve + import the peer's `extensions/usage-bars/core` module. The package
 * exposes no `exports` map, so we target the module inside the resolved package
 * dir; the server runs under jiti, which loads the raw TypeScript.
 *
 * `reset` is for tests only.
 */
export async function loadUsageBars(opts: { reset?: boolean } = {}): Promise<UsageBarsLib | null> {
  if (opts.reset) {
    cached = undefined;
    warned.clear();
  }
  if (cached) return cached;

  try {
    const resolved = resolvePiPackage(USAGE_BARS_PACKAGE);
    if (!resolved) {
      return warnOnce("not installed as a pi extension (install it from the Packages tab)");
    }
    const mod = (await import(
      path.join(resolved.packageDir, "extensions", "usage-bars", "core.ts")
    )) as Record<string, unknown>;

    const fetchers: Record<string, Fetcher> = {};
    for (const [provider, exportName] of Object.entries(FETCHER_NAMES)) {
      const fn = mod[exportName];
      if (typeof fn === "function") fetchers[provider] = fn as Fetcher;
    }
    if (Object.keys(fetchers).length === 0) {
      // Peer present but its export surface changed — treat as unavailable
      // rather than silently serving nothing per provider.
      return warnOnce("resolved but exports no known usage fetcher (peer version drift?)");
    }

    cached = { fetchers };
    return cached;
  } catch (err) {
    // Never surface the error object: it can carry a URL or header.
    return warnOnce(
      `import failed (${err instanceof Error ? err.name : "unknown error"})`,
    );
  }
}
