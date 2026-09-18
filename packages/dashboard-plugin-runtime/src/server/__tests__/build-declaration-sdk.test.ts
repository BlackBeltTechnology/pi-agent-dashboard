/**
 * Build-declaration SDK tests — folds test-plan scenarios E5 and E6.
 *
 * See change: add-served-build-coherence-and-hash-parity (design D2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredPlugin } from "../loader.js";
import { computeBuildDeclaration } from "../build-declaration-sdk.js";
import { buildDeclarationPath, writeBuildDeclaration } from "../build-metadata.js";

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-decl-sdk-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function plugin(id: string, root = "/repo/packages"): DiscoveredPlugin {
  const packageDir = `${root}/${id}`;
  return {
    manifest: { id, displayName: id, claims: [{ slot: "settings-section", component: "X" }] },
    packageDir,
    packageName: id,
    clientEntryPath: `${packageDir}/src/client.tsx`,
  };
}

describe("computeBuildDeclaration (E5, E6)", () => {
  it("E5 is independent of plugin order and absolute root", () => {
    const forward = computeBuildDeclaration(
      [plugin("alpha"), plugin("beta"), plugin("gamma")],
      { isProd: true, bundleRoots: ["/repo/packages"] },
    );
    const reversedElsewhere = computeBuildDeclaration(
      [
        plugin("gamma", "/elsewhere/root/packages"),
        plugin("beta", "/elsewhere/root/packages"),
        plugin("alpha", "/elsewhere/root/packages"),
      ],
      { isProd: true, bundleRoots: ["/elsewhere/root/packages"] },
    );

    const dirA = tmpDir();
    const dirB = tmpDir();
    writeBuildDeclaration(dirA, forward);
    writeBuildDeclaration(dirB, reversedElsewhere);

    const bytesA = fs.readFileSync(buildDeclarationPath(dirA), "utf-8");
    const bytesB = fs.readFileSync(buildDeclarationPath(dirB), "utf-8");
    expect(bytesA).toBe(bytesB);
    expect(forward.pluginRegistryHash).toBe(reversedElsewhere.pluginRegistryHash);
  });

  it("E6 a set change changes the hash", () => {
    const base = computeBuildDeclaration([plugin("alpha"), plugin("beta"), plugin("gamma")], {
      isProd: true,
      bundleRoots: ["/repo/packages"],
    });
    const plusOne = computeBuildDeclaration(
      [plugin("alpha"), plugin("beta"), plugin("gamma"), plugin("delta")],
      { isProd: true, bundleRoots: ["/repo/packages"] },
    );

    expect(base.pluginRegistryHash).not.toBe(plusOne.pluginRegistryHash);
  });

  it("records the fixture policy for the build mode", () => {
    const plugins = [plugin("alpha"), plugin("demo", "/repo/packages")];
    plugins[1].manifest.fixture = true;

    expect(
      computeBuildDeclaration(plugins, { isProd: true, bundleRoots: ["/repo/packages"] }).fixturePolicy,
    ).toBe("excluded");
    expect(
      computeBuildDeclaration(plugins, { isProd: false, bundleRoots: ["/repo/packages"] }).fixturePolicy,
    ).toBe("included");
  });
});
