/**
 * mcp-client-plugin · CORE adapter version-floor probe.
 *
 * Moved from `mcp-server-plugin` so `mcp-client` is the single owner of the
 * `pi-mcp-adapter` floor. Probes the USER's installed adapter under the resolved
 * agent directory — `dirname(getPiGlobalConfigPath())/{npm/,}node_modules/…`,
 * so `PI_CODING_AGENT_DIR` / a custom config dir is honoured — with a 30s TTL
 * cache. `unknown` is returned only by consumers when the service is absent.
 *
 * See change: extract-mcp-client-plugin (design D3).
 */

import { dirname, join } from "node:path";
import type { AdapterPort, AdapterVerdict, ConfigIO } from "./types.js";

/** Minimum `pi-mcp-adapter` that speaks the protocol the dashboard requires. */
export const ADAPTER_VERSION_FLOOR = "2.20.0";

/** Compare dotted numeric versions; prerelease suffixes are ignored (includePrerelease). */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Diagnose an installed version string against the floor. The point is the
 * DIAGNOSTIC: without it a below-floor adapter fails as a silent
 * legacy-handshake hang. `null` means not installed.
 */
export function probeAdapterVersion(
  installed: string | null,
  floor: string = ADAPTER_VERSION_FLOOR,
): AdapterVerdict {
  if (installed === null) {
    return {
      kind: "absent",
      floor,
      message: `pi-mcp-adapter is not installed. The dashboard requires >= ${floor}.`,
    };
  }
  if (!/^\d+\.\d+\.\d+/.test(installed)) {
    return {
      kind: "unparseable",
      installed,
      floor,
      message: `Could not parse the installed pi-mcp-adapter version ("${installed}"). Required: >= ${floor}.`,
    };
  }
  if (compareSemver(installed, floor) < 0) {
    return {
      kind: "below-floor",
      installed,
      floor,
      message: `pi-mcp-adapter ${installed} is below the required floor ${floor}; upgrade with: pi ext update pi-mcp-adapter`,
    };
  }
  return { kind: "ok", installed, floor };
}

const DEFAULT_TTL_MS = 30_000;

export interface AdapterVerdictProbeDeps {
  configIO: ConfigIO;
  /** Only the path helper is used; the loaders are never consulted. */
  adapter: Pick<AdapterPort, "getPiGlobalConfigPath">;
  ttlMs?: number;
  now?: () => number;
}

export interface AdapterVerdictProbe {
  adapterVerdict(opts?: { fresh?: boolean }): AdapterVerdict;
}

/** Probe candidates under the resolved agent dir: npm-installed first, then local. */
export function adapterProbePaths(
  agentDir: string,
): string[] {
  return [
    join(agentDir, "npm", "node_modules", "pi-mcp-adapter", "package.json"),
    join(agentDir, "node_modules", "pi-mcp-adapter", "package.json"),
  ];
}

export function createAdapterVerdictProbe(deps: AdapterVerdictProbeDeps): AdapterVerdictProbe {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? Date.now;
  let cached: { at: number; verdict: AdapterVerdict } | null = null;

  function readInstalled(): string | null {
    const agentDir = dirname(deps.adapter.getPiGlobalConfigPath());
    for (const path of adapterProbePaths(agentDir)) {
      const raw = deps.configIO.readFile(path);
      if (raw === null) continue;
      try {
        const version = (JSON.parse(raw) as { version?: unknown }).version;
        if (typeof version === "string") return version;
      } catch {
        /* not installed / malformed here; try the next location */
      }
    }
    return null;
  }

  function probe(): AdapterVerdict {
    return probeAdapterVersion(readInstalled());
  }

  return {
    adapterVerdict(opts = {}) {
      const t = now();
      if (!opts.fresh && cached && t - cached.at < ttlMs) return cached.verdict;
      const verdict = probe();
      cached = { at: t, verdict };
      return verdict;
    },
  };
}
