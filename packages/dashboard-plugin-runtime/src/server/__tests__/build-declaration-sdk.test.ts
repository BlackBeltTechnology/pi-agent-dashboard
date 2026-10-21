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
import { buildDeclarationPath, readBuildDeclaration, validateBuildDeclaration, writeBuildDeclaration } from "../build-metadata.js";

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
    source: "workspace",
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

// task 6.2 / E71: `bundledPluginIds` in the declaration.
describe("bundledPluginIds (E71)", () => {
  it("lists the sorted selected ids, byte-identical across directories", () => {
    const a = computeBuildDeclaration([plugin("goal"), plugin("flows")], { isProd: true, bundleRoots: ["/repo/packages"] });
    const b = computeBuildDeclaration([plugin("flows", "/x/packages"), plugin("goal", "/x/packages")], { isProd: true, bundleRoots: ["/x/packages"] });
    expect(a.bundledPluginIds).toEqual(["flows", "goal"]);
    const [dirA, dirB] = [tmpDir(), tmpDir()];
    writeBuildDeclaration(dirA, a);
    writeBuildDeclaration(dirB, b);
    expect(fs.readFileSync(buildDeclarationPath(dirA), "utf-8")).toBe(fs.readFileSync(buildDeclarationPath(dirB), "utf-8"));
  });

  it("excludes plugins the selector drops (client-less, fixtures under prod)", () => {
    const fixture = plugin("demo");
    fixture.manifest.fixture = true;
    const clientless = { ...plugin("mcp-server"), clientEntryPath: undefined };
    const decl = computeBuildDeclaration([plugin("flows"), fixture, clientless], { isProd: true, bundleRoots: ["/repo/packages"] });
    expect(decl.bundledPluginIds).toEqual(["flows"]);
  });

  it("an older declaration (schema 1, no field) stays valid and declares no set", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      buildDeclarationPath(dir),
      JSON.stringify({ schemaVersion: 1, pluginRegistryHash: "a".repeat(64), fixturePolicy: "excluded" }),
    );
    const read = readBuildDeclaration(dir);
    expect(read.kind).toBe("valid");
    if (read.kind === "valid") expect(read.declaration.bundledPluginIds).toBeUndefined();
  });

  it("validates the field under schema 1; a non-string-array reads as absent, not malformed", () => {
    const base = { schemaVersion: 1, pluginRegistryHash: "b".repeat(64), fixturePolicy: "included" };
    const ok = validateBuildDeclaration({ ...base, bundledPluginIds: ["goal", "flows", "goal"] });
    expect(ok.kind === "valid" && ok.declaration.bundledPluginIds).toEqual(["flows", "goal"]);
    const bad = validateBuildDeclaration({ ...base, bundledPluginIds: [1, "a"] });
    expect(bad.kind === "valid" && bad.declaration.bundledPluginIds).toBeUndefined();
    expect(bad.kind).toBe("valid");
  });
});
