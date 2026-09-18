/**
 * The single "client-registry plugin set" selector.
 *
 * Defines which discovered plugins take part in the plugin-registry hash.
 * Every producer selects through this module — the vite-plugin build path,
 * its dev regeneration, `scripts/generate-plugin-registry.mjs`, the server's
 * `/api/health.bundleHash`, and the build-declaration SDK — so build-time and
 * runtime hashes are computed over structurally identical sets.
 *
 * Before this module the two sides applied different filters: the build
 * dropped client-less plugins (`Boolean(p.clientEntryPath)`) while the runtime
 * kept them, so `PluginStalenessBanner` could never converge (`mcp-server` is
 * the plugin with no `client` field). Missing any one producer reintroduces
 * the split this module exists to close.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D0).
 */

import path from "node:path";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";

/** Minimal shape this selector reads — a structural subset of `DiscoveredPlugin`. */
export interface ClientRegistryCandidate {
  manifest: PluginManifest;
  packageDir: string;
  clientEntryPath?: string;
}

export interface SelectClientRegistryOptions {
  /**
   * The fixture policy to select under. `true` drops `fixture: true` plugins
   * (e.g. `packages/demo-plugin`), matching a production build; `false` keeps
   * them, matching a dev build. Callers pass the policy of the artifact they
   * are producing or reconstructing (design D1/D4).
   */
  isProd: boolean;
  /**
   * Bundle-eligible discovery roots — the roots a build can actually emit
   * import statements for. A plugin discovered only from a runtime-only root
   * (`~/.pi/dashboard/plugins` shape) is excluded from **both** hashes because
   * no build can bundle it, so counting it only fabricates staleness.
   *
   * Omitted ⇒ every discovered root is treated as eligible (pure-function and
   * unit-test use). Omitted must never be a production call site's default —
   * each producer passes its roots explicitly. `[]` ⇒ nothing is eligible.
   */
  bundleRoots?: readonly string[];
}

/** True when `dir` is `root` itself or nested under it. */
function isUnder(dir: string, root: string): boolean {
  const rel = path.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Select the client-registry plugin set from a discovery result.
 *
 * Order is preserved from the input; the digest consumers apply
 * (`pluginRegistryHash`) is order-normalised independently, so callers need
 * only equal *sets*.
 */
export function selectClientRegistryPlugins<T extends ClientRegistryCandidate>(
  discovered: readonly T[],
  opts: SelectClientRegistryOptions,
): T[] {
  const { isProd, bundleRoots } = opts;
  return discovered.filter((p) => {
    // A build can only emit an import for a plugin that declares a client entry.
    if (!p.clientEntryPath) return false;
    // Fixture plugins are dropped from production builds but kept in dev.
    if (isProd && p.manifest.fixture === true) return false;
    // Runtime-only roots cannot enter any bundle.
    if (bundleRoots && !bundleRoots.some((root) => isUnder(p.packageDir, root))) {
      return false;
    }
    return true;
  });
}

/**
 * Bundle-eligible roots for a build rooted at `repoRoot` — the monorepo
 * `packages/` directory, which is the only root the vite plugin discovers
 * from (`discoverPlugins(repoRoot)`). See design D0.
 */
export function bundleRootsFor(repoRoot: string): string[] {
  return [path.join(repoRoot, "packages")];
}
