/**
 * Host API compatibility gate (design D7, R17): evaluates a manifest `hostApi`
 * range against `PLUGIN_HOST_API_VERSION` at discovery, keyed by the discovery
 * source. Pure — the loader applies the verdict (warn / refuse both halves).
 *
 * See change: decouple-plugins-from-core.
 */
import { PLUGIN_HOST_API_VERSION, satisfiesHostApi } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-api.js";
import type { PluginDiscoverySource, PluginHostApiStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";

export interface HostApiInput {
  source: PluginDiscoverySource;
  /** Manifest `hostApi` (already syntax-validated), or undefined. */
  range: string | undefined;
  /** Plugin ships a runtime client bundle (Phase 5 field; read raw from the manifest). */
  hasClientBundle: boolean;
}

export interface HostApiVerdict {
  /** Recorded on `PluginStatus.hostApi`; undefined when nothing was declared or required. */
  status?: PluginHostApiStatus;
  /** `installed` / `pi-package` mismatch: skip the server entry and refuse the client. */
  refuse: boolean;
  /** `workspace` / `bundled` mismatch: log at warn, load anyway. */
  warn: boolean;
  /** Human-readable cause (names `host-api`); set when `!status.compatible`. */
  reason?: string;
}

/** Sources whose code was NOT compiled with the host: a mismatch is fatal there. */
const RUNTIME_SOURCES: ReadonlySet<PluginDiscoverySource> = new Set(["installed", "pi-package"]);

export function evaluateHostApi({ source, range, hasClientBundle }: HostApiInput): HostApiVerdict {
  const required = source === "pi-package" || hasClientBundle;
  if (range === undefined && !required) return { refuse: false, warn: false };
  const compatible = range !== undefined && satisfiesHostApi(range);
  const status: PluginHostApiStatus = range === undefined ? { compatible } : { range, compatible };
  if (compatible) return { status, refuse: false, warn: false };
  const reason =
    range === undefined
      ? `host-api: manifest hostApi is required for ${source === "pi-package" ? "pi-package" : "clientBundle"} plugins (host API ${PLUGIN_HOST_API_VERSION})`
      : `host-api: plugin requires host API ${range}, host provides ${PLUGIN_HOST_API_VERSION}`;
  const refuse = RUNTIME_SOURCES.has(source);
  return { status, refuse, warn: !refuse, reason };
}
