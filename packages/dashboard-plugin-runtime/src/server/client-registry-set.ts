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

import crypto from "node:crypto";
import path from "node:path";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { PluginDiscoverySource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { pluginRegistryHash } from "./loader.js";

/** Minimal shape this selector reads — a structural subset of `DiscoveredPlugin`. */
export interface ClientRegistryCandidate {
  manifest: PluginManifest;
  packageDir: string;
  clientEntryPath?: string;
  /** Discovery source of the winning copy (`workspace`/`bundled` = a copy the build was made from). */
  source?: PluginDiscoverySource;
  /** Set by the loader when the host API gate refused the plugin; it is never listed. */
  hostApiRefusal?: string;
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
    // A plugin built for another host API contributes no client at all.
    if (p.hostApiRefusal) return false;
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

/** The slice of a served build declaration the bundled rule reads. */
export interface BundledDeclaration {
  bundledPluginIds?: readonly string[];
  pluginRegistryHash?: string;
}

/**
 * The ONE bundled-vs-runtime predicate (design D11): a discovered plugin is *bundled* iff its id is
 * in the served build declaration's `bundledPluginIds`, independent of filesystem roots. Delivery
 * decision, `PluginStatus.client.delivery` and the server staleness hash all use it. A missing
 * declaration or a declaration without the field declares nothing bundled.
 *
 * See change: decouple-plugins-from-core (task 6.2).
 */
export function isBundledPlugin(id: string, declaration: BundledDeclaration | undefined | null): boolean {
  return declaration?.bundledPluginIds?.includes(id) === true;
}

export interface ServerRegistryHashOptions {
  isProd: boolean;
  /** Served declaration (`undefined` = none / undeclared → the pre-change selection). */
  declaration?: BundledDeclaration;
  /** Monorepo root when one resolves (`findMonorepoRoot()`), else null/undefined. */
  monorepoRoot?: string | null;
}

/** Sources whose copy is one the build itself was made from. */
const BUILD_COPY_SOURCES: ReadonlySet<PluginDiscoverySource> = new Set(["workspace", "bundled"]);

/**
 * The server's staleness hash over the discovery WINNERS, defined once so `/api/health.bundleHash`,
 * `clientBuild` and the parity tests cannot diverge (design D11, spec plugin-manifest-staleness).
 *
 * - No `bundledPluginIds` → today's computation: the shared selector, `bundleRootsFor(root)` where a
 *   monorepo root resolves (R19).
 * - Every declared id has a build copy on disk (`workspace`/`bundled` winner) → those winners plus the
 *   client-contributing plugins under `bundleRootsFor(root)` (a new, not-yet-built workspace plugin
 *   still raises the banner).
 * - Some declared id lacks a build copy (npm-global ships no `resources/plugins`) → do NOT hash a foreign
 *   copy: the declared subset contributes the declaration's own `pluginRegistryHash`, so the comparison
 *   is against the declaration. Extra plugins under a resolvable root (undeclared ids) still perturb it.
 */
export function serverRegistryHash(
  discovered: readonly ClientRegistryCandidate[],
  opts: ServerRegistryHashOptions,
): string {
  const { isProd, declaration, monorepoRoot } = opts;
  const rootSelect = { isProd, ...(monorepoRoot ? { bundleRoots: bundleRootsFor(monorepoRoot) } : {}) };
  const declared = declaration?.bundledPluginIds;
  if (!declared) return pluginRegistryHash(selectClientRegistryPlugins(discovered, rootSelect));

  const declaredSet = new Set(declared);
  const byId = new Map(discovered.map((p) => [p.manifest.id, p] as const));
  const allHaveBuildCopy = declared.every((id) => {
    const winner = byId.get(id);
    return winner?.source !== undefined && BUILD_COPY_SOURCES.has(winner.source);
  });
  // Plugins under the monorepo bundle root whose id is not declared (undeclared / not yet built).
  const extras = monorepoRoot
    ? selectClientRegistryPlugins(discovered, rootSelect).filter((p) => !declaredSet.has(p.manifest.id))
    : [];

  if (allHaveBuildCopy) {
    const winners = declared.flatMap((id) => selectClientRegistryPlugins([byId.get(id) as ClientRegistryCandidate], { isProd }));
    return pluginRegistryHash([...winners, ...extras]);
  }
  const declaredHash = declaration?.pluginRegistryHash ?? pluginRegistryHash([]);
  if (extras.length === 0) return declaredHash;
  return crypto.createHash("sha256").update(`${declaredHash}\n${pluginRegistryHash(extras)}`).digest("hex");
}
