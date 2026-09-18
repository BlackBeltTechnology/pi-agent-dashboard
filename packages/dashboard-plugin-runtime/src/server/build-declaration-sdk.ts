/**
 * Build-declaration SDK — computes a declaration from an **explicitly supplied**
 * plugin list.
 *
 * The declared set is selected by the shared client-registry selector and the
 * digest is delegated to the existing `pluginRegistryHash`, so the declaration
 * hash and the embedded `PLUGIN_REGISTRY_HASH` are equal by construction rather
 * than by a second serializer's goodwill (design D2).
 *
 * See change: add-served-build-coherence-and-hash-parity.
 */

import {
  type ClientRegistryCandidate,
  selectClientRegistryPlugins,
} from "./client-registry-set.js";
import { pluginRegistryHash } from "./loader.js";
import {
  BUILD_DECLARATION_SCHEMA_VERSION,
  type BuildDeclaration,
} from "./build-metadata.js";

export interface ComputeBuildDeclarationOptions {
  /** Fixture policy the build applied (`true` = production build). */
  isProd: boolean;
  /** Bundle-eligible roots; see `selectClientRegistryPlugins`. */
  bundleRoots?: readonly string[];
}

/**
 * Build the declaration for the given discovery result.
 *
 * No paths, timestamps, or host data enter the returned object — only the
 * selected plugin *identities* (via the order-normalised serialization) and the
 * closed-enum fixture policy.
 */
export function computeBuildDeclaration(
  plugins: readonly ClientRegistryCandidate[],
  opts: ComputeBuildDeclarationOptions,
): BuildDeclaration {
  const selected = selectClientRegistryPlugins(plugins, {
    isProd: opts.isProd,
    bundleRoots: opts.bundleRoots,
  });
  return {
    schemaVersion: BUILD_DECLARATION_SCHEMA_VERSION,
    pluginRegistryHash: pluginRegistryHash(selected),
    fixturePolicy: opts.isProd ? "excluded" : "included",
  };
}
