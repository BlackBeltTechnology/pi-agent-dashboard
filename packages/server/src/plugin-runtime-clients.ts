/**
 * Server wiring of the runtime-client registry (`dashboard-plugin-runtime/server`): production deps
 * (discovery winners, the served declaration's ids, persisted enabled state, live `auth.trustedPlugins`,
 * the status store) and the process-wide singleton the routes call.
 *
 * `installRuntimeClientRegistry()` also installs the registry as the status store's `client` resolver, so
 * EVERY status read (`GET /api/plugins`, `/api/health.plugins[]` — which strips `sha256` — and each
 * `plugins_changed` broadcast) shows the live admission verdict and the live content hash.
 *
 * Route surface (6.10–6.12, `routes/plugin-runtime-client-routes.ts` + `registerPluginAssetsRoute`):
 * `getRuntimeClientRegistry()` → `getAdmittedRuntimePlugins()`, `getAdmittedAssetRoot(id, sha)`,
 * `currentContentHash(id)`, `clearContentHashCache()`. `logRuntimeAdmissions` is the 6.20 admission log.
 *
 * See change: decouple-plugins-from-core (task 6.7).
 */
import {
  createRuntimeClientRegistry,
  discoverPlugins,
  getDeclaredBundledPluginIds,
  getPluginStatusStore,
  type RuntimeClientRegistry,
  resolvePluginEnabled,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { getPluginConfig, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { readTrustedPlugins } from "./auth/plugin-trust-store.js";

/** 12-hex prefix of a content hash: the only form that ever reaches a log line. */
export const hashPrefix = (sha256: string | undefined): string => (sha256 ? sha256.slice(0, 12) : "-");

export interface AdmissionLog {
  info(message: string): void;
}

/**
 * One structured line per runtime-eligible plugin (client `runtime` or `refused`): id, source, delivery,
 * reason and the 12-hex hash prefix; never the full hash, a bearer or a request body. Called after each
 * discovery refresh and each trust change (`trigger`). See change: decouple-plugins-from-core (task 6.20).
 */
export function logRuntimeAdmissions(log: AdmissionLog, trigger: "refresh" | "trust"): void {
  for (const status of getPluginStatusStore().listAll()) {
    const client = status.client;
    if (client?.delivery !== "runtime" && client?.delivery !== "refused") continue;
    log.info(
      `[plugin-runtime] admission trigger=${trigger} id=${status.id} source=${status.source ?? "-"} delivery=${client.delivery} reason=${client.refusedReason ?? "-"} sha=${hashPrefix(client.sha256)}`,
    );
  }
}

export interface RuntimeClientsOptions {
  /** Explicit discovery root (tests); production passes none. */
  repoRoot?: string;
  /** Override the served declaration's ids (tests); default: the loader's process-wide declared ids. */
  declaredIds?: () => readonly string[] | undefined;
}

/** Build a registry over the production deps (no singleton, no store hook). */
export function createServerRuntimeClients(opts: RuntimeClientsOptions = {}): RuntimeClientRegistry {
  const discover = () => discoverPlugins(opts.repoRoot);
  return createRuntimeClientRegistry({
    discover,
    declaredIds: opts.declaredIds ?? getDeclaredBundledPluginIds,
    isEnabled: (id) => {
      const manifest = discover().find((p) => p.manifest.id === id)?.manifest;
      return resolvePluginEnabled(getPluginConfig(loadConfig(), id) as Record<string, unknown>, manifest?.defaultEnabled);
    },
    readTrust: readTrustedPlugins,
    getStoredStatus: (id) => getPluginStatusStore().getStoredStatus(id),
  });
}

let _registry: RuntimeClientRegistry | undefined;

/** Create the singleton and install it as the status store's client resolver. */
export function installRuntimeClientRegistry(opts: RuntimeClientsOptions = {}): RuntimeClientRegistry {
  _registry = createServerRuntimeClients(opts);
  getPluginStatusStore().setClientResolver((status) => _registry?.resolveClient(status));
  return _registry;
}

/** The installed registry, or `undefined` before boot wiring (routes treat that as "nothing admitted"). */
export function getRuntimeClientRegistry(): RuntimeClientRegistry | undefined {
  return _registry;
}

/** Remove the singleton and the resolver (tests). */
export function resetRuntimeClientRegistry(): void {
  _registry = undefined;
  getPluginStatusStore().setClientResolver(null);
}
