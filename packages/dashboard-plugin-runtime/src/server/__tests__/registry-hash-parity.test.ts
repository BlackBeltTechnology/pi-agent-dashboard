/**
 * Repo-level plugin-registry hash parity — folds test-plan scenario E4.
 *
 * The build-time hash and the server-side hash must be computed over the same
 * plugin set, so both equal the `PLUGIN_REGISTRY_HASH` committed in
 * `packages/client/src/generated/plugin-registry.tsx`. This is the regression
 * guard for the never-converging `PluginStalenessBanner`.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D0).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDiscoveryCache,
  discoverPlugins,
  findMonorepoRoot,
  pluginRegistryHash,
} from "../loader.js";
import { bundleRootsFor, selectClientRegistryPlugins } from "../client-registry-set.js";

const repoRoot = findMonorepoRoot();
if (!repoRoot) throw new Error("monorepo root not found from dashboard-plugin-runtime");

function embeddedRegistryHash(): string {
  const file = path.join(repoRoot!, "packages/client/src/generated/plugin-registry.tsx");
  const src = fs.readFileSync(file, "utf-8");
  const match = src.match(/PLUGIN_REGISTRY_HASH\s*=\s*"([0-9a-f]{64})"/);
  if (!match) throw new Error("embedded PLUGIN_REGISTRY_HASH not found");
  return match[1];
}

describe("plugin-registry hash parity (E4)", () => {
  it("build-side and runtime-side both equal the embedded PLUGIN_REGISTRY_HASH", () => {
    clearDiscoveryCache();
    const buildSet = selectClientRegistryPlugins(discoverPlugins(repoRoot!), {
      isProd: true,
      bundleRoots: bundleRootsFor(repoRoot!),
    });

    clearDiscoveryCache();
    const runtimeSet = selectClientRegistryPlugins(discoverPlugins(), {
      isProd: true,
      bundleRoots: bundleRootsFor(repoRoot!),
    });

    const embedded = embeddedRegistryHash();
    expect(buildSet.length).toBeGreaterThan(0);
    expect(pluginRegistryHash(buildSet)).toBe(embedded);
    expect(pluginRegistryHash(runtimeSet)).toBe(embedded);
  });

  it("the old runtime basis (no client-entry filter) diverged — the bug this closes", () => {
    clearDiscoveryCache();
    const discovered = discoverPlugins(repoRoot!);
    // Premise of the fix: this checkout has a client-less plugin (`mcp-server`
    // shape). If it ever gains a client entry, the divergence goes away and
    // this characterization test should be retired with it.
    expect(discovered.filter((p) => !p.clientEntryPath).length).toBeGreaterThan(0);
    const legacyRuntimeBasis = discovered.filter((p) => p.manifest.fixture !== true);
    expect(pluginRegistryHash(legacyRuntimeBasis)).not.toBe(embeddedRegistryHash());
  });
});
