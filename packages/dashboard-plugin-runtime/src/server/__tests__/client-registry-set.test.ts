/**
 * `selectClientRegistryPlugins` unit tests — the shared selector every hash
 * producer uses. Folds test-plan scenarios E1–E3.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D0).
 */
import { describe, expect, it } from "vitest";
import type { DiscoveredPlugin } from "../loader.js";
import { pluginRegistryHash } from "../loader.js";
import { selectClientRegistryPlugins } from "../client-registry-set.js";

const BUNDLE_ROOT = "/repo/packages";
const BUNDLE_ROOTS = [BUNDLE_ROOT];

function plugin(
  id: string,
  opts: { dir?: string; client?: boolean; fixture?: boolean } = {},
): DiscoveredPlugin {
  const packageDir = opts.dir ?? `${BUNDLE_ROOT}/${id}`;
  return {
    manifest: {
      id,
      displayName: id,
      claims: [{ slot: "settings-section", component: "X" }],
      ...(opts.fixture ? { fixture: true } : {}),
    },
    packageDir,
    packageName: id,
    clientEntryPath:
      opts.client === false ? undefined : `${packageDir}/src/client.tsx`,
  };
}

describe("selectClientRegistryPlugins (E1–E3)", () => {
  it("E1 drops client-less plugins and the hash matches the client-bearing subset", () => {
    const withClientA = plugin("alpha");
    const withClientB = plugin("beta");
    const clientless = plugin("mcp-server", { client: false });

    const selected = selectClientRegistryPlugins(
      [withClientA, withClientB, clientless],
      { isProd: true, bundleRoots: BUNDLE_ROOTS },
    );

    expect(selected.map((p) => p.manifest.id)).toEqual(["alpha", "beta"]);
    expect(pluginRegistryHash(selected)).toBe(
      pluginRegistryHash([withClientA, withClientB]),
    );
    // The old runtime basis (no client filter) differs — the bug being fixed.
    expect(pluginRegistryHash(selected)).not.toBe(
      pluginRegistryHash([withClientA, withClientB, clientless]),
    );
  });

  it("E2 applies the fixture policy and changes no other row", () => {
    const normal = plugin("alpha");
    const fixture = plugin("demo", { fixture: true });

    const prod = selectClientRegistryPlugins([normal, fixture], {
      isProd: true,
      bundleRoots: BUNDLE_ROOTS,
    });
    const dev = selectClientRegistryPlugins([normal, fixture], {
      isProd: false,
      bundleRoots: BUNDLE_ROOTS,
    });

    expect(prod.map((p) => p.manifest.id)).toEqual(["alpha"]);
    expect(dev.map((p) => p.manifest.id)).toEqual(["alpha", "demo"]);
  });

  it("E3 drops a plugin discovered only from a runtime-only root under both policies", () => {
    const inRepo = plugin("in-repo");
    const runtimeOnly = plugin("user-plugin", {
      dir: "/home/u/.pi/dashboard/plugins/user-plugin",
    });

    for (const isProd of [true, false]) {
      const selected = selectClientRegistryPlugins([inRepo, runtimeOnly], {
        isProd,
        bundleRoots: BUNDLE_ROOTS,
      });
      expect(selected.map((p) => p.manifest.id)).toEqual(["in-repo"]);
    }
  });
});
