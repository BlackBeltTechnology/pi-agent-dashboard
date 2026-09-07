/**
 * Host implementation of the `ServerPluginContext.isPiExtensionInstalled`
 * capability (design D2).
 *
 * Answers from the UNION of the host's global and local installed scopes —
 * deliberately a superset of the `piExtensions` probe's current global-only
 * wiring — matched with the probe's own `installedMatchesName` logic. The
 * answer is boolean-only: no package records cross this seam.
 *
 * Successful scans are cached for ~30 s (mirroring `requirement-probes.ts`,
 * the only other cache layer). A scan failure REJECTS — it never resolves
 * `false`, which a caller could not distinguish from an authoritative
 * not-installed answer — and a rejection never occupies the cache, so a
 * recovered registry answers on the next call.
 *
 * See change: add-blackhole-session-pipeline.
 */
import {
  installedMatchesName,
  type InstalledPackageRecord,
} from "./requirement-probes.js";

export interface IsPiExtensionInstalledDeps {
  /** Lists pi extensions in the "global" scope (host: `packageManagerWrapper.listInstalled("global")`). */
  listGlobal: () => Promise<InstalledPackageRecord[]>;
  /** Lists pi extensions in the "local" scope (host: `packageManagerWrapper.listInstalled("local")`). */
  listLocal: () => Promise<InstalledPackageRecord[]>;
  /** Injectable clock (tests). Defaults to `Date.now`. */
  now?: () => number;
  /** Cache window in ms (tests inject). Defaults to ~30 s, like the requirement probe. */
  ttlMs?: number;
}

interface CachedScan {
  records: InstalledPackageRecord[];
  at: number;
}

export function createIsPiExtensionInstalled(
  deps: IsPiExtensionInstalledDeps,
): (name: string) => Promise<boolean> {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? 30_000;
  // Success-only cache: a rejected scan leaves this null, so the next call
  // rescans (a recovered registry answers immediately).
  let cache: CachedScan | null = null;

  return async (name: string): Promise<boolean> => {
    if (cache === null || now() - cache.at > ttlMs) {
      const [global, local] = await Promise.all([deps.listGlobal(), deps.listLocal()]);
      cache = { records: [...global, ...local], at: now() };
    }
    return cache.records.some((record) => installedMatchesName(record, name));
  };
}
