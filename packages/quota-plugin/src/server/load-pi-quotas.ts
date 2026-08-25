/**
 * Runtime loader for the `@latentminds/pi-quotas` PEER pi extension.
 *
 * `@latentminds/pi-quotas` is NOT an npm dependency of this plugin: it ships
 * only `pi.extensions[]` (no `main`, no `exports`), so it is meant to be
 * INSTALLED BY THE USER as a pi extension — not vendored into the dashboard's
 * node_modules. The manifest declares it via
 * `pi-dashboard-plugin.requires.piExtensions`, which makes the Packages UI
 * render "requires pi extension @latentminds/pi-quotas [Install]" and keeps
 * this plugin inert until the user installs it.
 *
 * Consequence: we resolve it at RUNTIME from the user's pi install (via the
 * shared pi-package resolver) rather than importing it statically. A plain
 * `require.resolve` cannot find it — see pi-package-resolver.ts.
 *
 * Absent → `loadPiQuotas()` returns null and the caller degrades to "no quota"
 * honestly. Never throws.
 */
import path from "node:path";
import { resolvePiPackage } from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";

/** One normalized usage window as the peer reports it. */
export interface PiQuotaWindow {
  provider: string;
  label: string;
  usedPercent: number;
  resetsAt: Date;
  windowSeconds: number;
  usedValue: number;
  limitValue: number;
  isCurrency?: boolean;
}

/** The peer's per-provider result discriminated union. */
export type PiQuotasResult =
  | { success: true; data: { windows: PiQuotaWindow[]; provider: string } }
  | { success: false; error: { message: string; kind: string } };

/** The slice of the peer's `lib/quotas` surface this plugin consumes. */
export interface PiQuotasLib {
  SUPPORTED_PROVIDERS: string[];
  clearQuotaCache: (provider?: string) => void;
  fetchProviderQuotas: (authStorage: unknown, provider: string) => Promise<PiQuotasResult>;
}

export const PI_QUOTAS_PACKAGE = "@latentminds/pi-quotas";

/**
 * Only a SUCCESSFUL load is memoized. A negative answer is deliberately NOT
 * cached: the user can install the peer from the Packages UI at any time, and
 * caching "absent" would keep the plugin dead until the whole dashboard was
 * restarted. A miss costs one `resolvePiPackage` per poll (~60s) — cheap.
 */
let cached: PiQuotasLib | undefined;

/** Log each distinct failure reason once, so a miss is diagnosable but not spammy. */
const warned = new Set<string>();
function warnOnce(reason: string): null {
  if (!warned.has(reason)) {
    warned.add(reason);
    console.warn(`[plugin:quota] ${PI_QUOTAS_PACKAGE} unavailable — ${reason}`);
  }
  return null;
}

/**
 * Resolve + import the peer's `src/lib/quotas` module. `reset` is for tests only.
 */
export async function loadPiQuotas(opts: { reset?: boolean } = {}): Promise<PiQuotasLib | null> {
  if (opts.reset) {
    cached = undefined;
    warned.clear();
  }
  if (cached) return cached;

  try {
    const resolved = resolvePiPackage(PI_QUOTAS_PACKAGE);
    if (!resolved) {
      return warnOnce("not installed as a pi extension (install it from the Packages tab)");
    }
    // The peer exposes no `exports` map, so target the lib module inside the
    // resolved package dir. The server runs under jiti, which loads raw TS.
    const entry = path.join(resolved.packageDir, "src", "lib", "quotas.ts");
    const mod = (await import(entry)) as Partial<PiQuotasLib>;
    if (typeof mod.fetchProviderQuotas !== "function" || !Array.isArray(mod.SUPPORTED_PROVIDERS)) {
      return warnOnce(`incompatible module surface at ${entry}`);
    }
    cached = {
      SUPPORTED_PROVIDERS: mod.SUPPORTED_PROVIDERS,
      clearQuotaCache: typeof mod.clearQuotaCache === "function" ? mod.clearQuotaCache : () => {},
      fetchProviderQuotas: mod.fetchProviderQuotas,
    };
    warned.clear();
    return cached;
  } catch (err) {
    return warnOnce(err instanceof Error ? err.message : String(err));
  }
}
