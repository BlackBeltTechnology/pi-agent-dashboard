/**
 * The server's runtime-client registry: decides, per discovered plugin, whether its client is
 * `bundled`, delivered at `runtime` (admitted), or `refused` with exactly one reason, and exposes the
 * content hash the pin is checked against.
 *
 * Admission (design D12) = served build declares its bundled ids ∧ plugin not bundled ∧ `clientBundle`
 * with a valid layout ∧ `hostApi` ok ∧ enabled (persisted) with its server entry loaded (if any) ∧ every
 * `dependsOn` id discovered + enabled + loaded ∧ an `auth.trustedPlugins` entry whose `clientSha256`
 * equals the CURRENT content hash. One reason, fixed precedence (`REFUSAL_PRECEDENCE`): structural, then
 * config, then consent. A trust entry without `clientSha256` is `untrusted` — no wildcard pin exists.
 *
 * Everything is derived at read time (`resolveClient` is installed as the status store's client
 * resolver); the only state is the per-file stat cache of the content hasher.
 *
 * See change: decouple-plugins-from-core (task 6.7, design D11/D12).
 */
import fs from "node:fs";
import path from "node:path";
import type {
  PluginClientRefusedReason,
  PluginClientStatus,
  PluginStatus,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { type ContentHasher, createContentHasher } from "./client-content-hash.js";
import { isBundledPlugin } from "./client-registry-set.js";
import { isWithin, realFileWithin } from "./confined-static.js";
import type { DiscoveredPlugin } from "./loader.js";

/** Reason order when several conditions fail (first wins). */
export const REFUSAL_PRECEDENCE: readonly PluginClientRefusedReason[] = [
  "build-undeclared",
  "no-bundle",
  "host-api",
  "disabled",
  "missing-dep",
  "untrusted",
  "pin-mismatch",
];

/** A trust entry as the registry reads it (structural subset of `TrustedPluginEntry`). */
export interface RuntimeTrustEntry {
  id: string;
  clientSha256?: string;
  server?: boolean;
}

export interface RuntimeClientDeps {
  /** Discovery winners (cached by the loader). */
  discover(): readonly DiscoveredPlugin[];
  /** The served declaration's `bundledPluginIds`; `undefined` = undeclared build. */
  declaredIds(): readonly string[] | undefined;
  /** Persisted-config enabled state (manifest `defaultEnabled` applied by the caller). */
  isEnabled(pluginId: string): boolean;
  /** Live `auth.trustedPlugins`. Read lazily, only when a plugin reaches the consent stage. */
  readTrust(): readonly RuntimeTrustEntry[];
  /** The stored (undecorated) status row of a plugin: `loaded` of its server entry. */
  getStoredStatus(pluginId: string): PluginStatus | undefined;
  /** Content hasher (injectable so tests can spy digests). */
  hasher?: ContentHasher;
}

/** One admitted runtime plugin: everything the listing and the asset route need. */
export interface AdmittedRuntimePlugin {
  id: string;
  displayName: string;
  plugin: DiscoveredPlugin;
  /** Current content hash of the asset root (64 hex). */
  sha256: string;
  /** Realpath of the served asset root. */
  assetRoot: string;
  /** Entry module path relative to the asset root, posix separators. */
  entry: string;
  /** Stylesheet path relative to the asset root, posix separators (when declared). */
  styles?: string;
}

export interface RuntimeClientRegistry {
  /** Resolve `PluginStatus.client` for a stored row (installed as the status store's resolver). `undefined` = keep stored. */
  resolveClient(status: PluginStatus): PluginClientStatus | undefined;
  /** Admitted runtime plugins, fresh hash on every call (the listing source). */
  getAdmittedRuntimePlugins(): AdmittedRuntimePlugin[];
  /** Realpath of `id`'s asset root iff `id` is admitted AND `sha256` is its current hash; else `undefined` (→ 404). */
  getAdmittedAssetRoot(id: string, sha256: string): string | undefined;
  /** Current content hash of `id`'s client asset root (independent of trust), `undefined` without a valid bundle dir. */
  currentContentHash(id: string): string | undefined;
  /** Drop the per-file digest cache (discovery refresh, package-operation completion). */
  clearContentHashCache(): void;
  /** Digests computed so far (test probe). */
  readonly digestCalls: number;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Asset-root-relative path of a package-relative `module`/entry path; `undefined` when it lies outside the root. */
export function assetRelPath(plugin: Pick<DiscoveredPlugin, "packageDir" | "clientBundleDir">, packageRelative: string): string | undefined {
  if (!plugin.clientBundleDir) return undefined;
  const abs = path.resolve(plugin.packageDir, packageRelative);
  if (!isWithin(abs, plugin.clientBundleDir) || abs === plugin.clientBundleDir) return undefined;
  return toPosix(path.relative(plugin.clientBundleDir, abs));
}

export function createRuntimeClientRegistry(deps: RuntimeClientDeps): RuntimeClientRegistry {
  const hasher = deps.hasher ?? createContentHasher();
  const refused = (refusedReason: PluginClientRefusedReason, sha256?: string): PluginClientStatus => ({
    delivery: "refused",
    refusedReason,
    ...(sha256 ? { sha256 } : {}),
  });

  /** Realpath of the asset root when the layout holds and the entry module is a real file inside it. */
  function bundleRoot(p: DiscoveredPlugin): string | undefined {
    if (!p.clientBundleDir || !p.clientBundlePath || p.clientLayoutError) return undefined;
    let root: string;
    let packageReal: string;
    try {
      root = fs.realpathSync(p.clientBundleDir);
      packageReal = fs.realpathSync(p.packageDir);
    } catch {
      return undefined;
    }
    if (!isWithin(root, packageReal) || root === packageReal) return undefined; // symlinked asset root escaping the package
    return realFileWithin(p.clientBundlePath, root) ? root : undefined;
  }

  const hostApiFailed = (p: DiscoveredPlugin): boolean => Boolean(p.hostApiRefusal) || p.hostApi?.compatible === false;

  function missingDep(p: DiscoveredPlugin, byId: Map<string, DiscoveredPlugin>): boolean {
    return (p.manifest.dependsOn ?? []).some((depId) => {
      if (!byId.has(depId) || !deps.isEnabled(depId)) return true;
      return deps.getStoredStatus(depId)?.loaded !== true;
    });
  }

  /** Disabled in config, or its server entry is not loaded (failed, refused, or re-enabled before a restart). */
  function notActive(p: DiscoveredPlugin): boolean {
    if (!deps.isEnabled(p.manifest.id)) return true;
    return Boolean(p.serverEntryPath) && deps.getStoredStatus(p.manifest.id)?.loaded !== true;
  }

  interface Verdict {
    client: PluginClientStatus;
    root?: string;
    sha256?: string;
  }

  /** First failing structural / config condition (`build-undeclared` … `missing-dep`), plus the asset root when it holds. */
  function gateRefusal(
    p: DiscoveredPlugin,
    byId: Map<string, DiscoveredPlugin>,
    declared: readonly string[] | undefined,
  ): { reason: PluginClientRefusedReason } | { root: string } {
    if (!declared) return { reason: "build-undeclared" };
    const root = bundleRoot(p);
    if (!root) return { reason: "no-bundle" };
    if (hostApiFailed(p)) return { reason: "host-api" };
    if (notActive(p)) return { reason: "disabled" };
    if (missingDep(p, byId)) return { reason: "missing-dep" };
    return { root };
  }

  /** The consent stage: the content hash against the operator's pin. */
  function consentVerdict(p: DiscoveredPlugin, root: string): Verdict {
    const sha256 = hasher.hashDir(root);
    if (!sha256) return { client: refused("no-bundle") };
    const entry = deps.readTrust().find((e) => e.id === p.manifest.id);
    if (!entry?.clientSha256) return { client: refused("untrusted", sha256) };
    if (entry.clientSha256 !== sha256) return { client: refused("pin-mismatch", sha256) };
    return { client: { delivery: "runtime", sha256 }, root, sha256 };
  }

  function evaluate(p: DiscoveredPlugin, byId: Map<string, DiscoveredPlugin>): Verdict | undefined {
    const declared = deps.declaredIds();
    if (declared && isBundledPlugin(p.manifest.id, { bundledPluginIds: declared })) {
      // The build's own claims render; a refused host API still refuses both halves (stored refusal kept).
      return p.hostApiRefusal ? undefined : { client: { delivery: "bundled" } };
    }
    // Only client-contributing plugins have a client status; a client-less plugin keeps its stored one.
    if (!p.clientEntryPath && !p.manifest.clientBundle) return undefined;
    const gate = gateRefusal(p, byId, declared);
    return "reason" in gate ? { client: refused(gate.reason) } : consentVerdict(p, gate.root);
  }

  const indexById = (plugins: readonly DiscoveredPlugin[]) => new Map(plugins.map((p) => [p.manifest.id, p] as const));

  function admitted(): AdmittedRuntimePlugin[] {
    const plugins = deps.discover();
    const byId = indexById(plugins);
    const out: AdmittedRuntimePlugin[] = [];
    for (const p of plugins) {
      const v = evaluate(p, byId);
      if (v?.client.delivery !== "runtime" || !v.root || !v.sha256) continue;
      const entry = assetRelPath(p, path.relative(p.packageDir, p.clientBundlePath as string));
      if (!entry) continue;
      const styles = p.clientStylesPath ? assetRelPath(p, path.relative(p.packageDir, p.clientStylesPath)) : undefined;
      out.push({
        id: p.manifest.id,
        displayName: p.manifest.displayName,
        plugin: p,
        sha256: v.sha256,
        assetRoot: v.root,
        entry,
        ...(styles ? { styles } : {}),
      });
    }
    return out;
  }

  return {
    resolveClient(status) {
      const plugins = deps.discover();
      const p = plugins.find((c) => c.manifest.id === status.id);
      return p ? evaluate(p, indexById(plugins))?.client : undefined;
    },
    getAdmittedRuntimePlugins: admitted,
    getAdmittedAssetRoot(id, sha256) {
      const plugins = deps.discover();
      const p = plugins.find((c) => c.manifest.id === id);
      const v = p ? evaluate(p, indexById(plugins)) : undefined;
      return v?.client.delivery === "runtime" && v.sha256 === sha256 ? v.root : undefined;
    },
    currentContentHash(id) {
      const p = deps.discover().find((c) => c.manifest.id === id);
      const root = p ? bundleRoot(p) : undefined;
      return root ? hasher.hashDir(root) : undefined;
    },
    clearContentHashCache: () => hasher.clear(),
    get digestCalls() {
      return hasher.digestCalls;
    },
  };
}
