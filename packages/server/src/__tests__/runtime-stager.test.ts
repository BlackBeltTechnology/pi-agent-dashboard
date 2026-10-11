/**
 * Runtime stager: deterministic synthetic root, lockstep check, GitHub
 * sha512 integrity, interrupted staging. test-plan E7, E8, X1, X2.
 * See change: electron-runtime-overlay-updates (D1, D2, D5, D9).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRuntimeManifest } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/manifest.mjs";
import {
  readRuntimeRequest,
  selectRuntimeSource,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSyntheticRoot,
  lockstepCheck,
  type StagerDeps,
  stageRuntime,
} from "../runtime-overlay/runtime-stager.js";

const SCOPE = "@blackbelt-technology";
const X = "0.9.1";

const LOCK = {
  name: "pi-dashboard-runtime",
  version: X,
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "pi-dashboard-runtime",
      version: X,
      dependencies: {
        [`${SCOPE}/pi-dashboard-server`]: X,
        [`${SCOPE}/pi-dashboard-roles-plugin`]: X,
      },
    },
    [`node_modules/${SCOPE}/pi-dashboard-server`]: { version: X, integrity: "sha512-srv" },
    [`node_modules/${SCOPE}/pi-dashboard-roles-plugin`]: { version: X, integrity: "sha512-roles" },
  },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-stage-"));
  selectRuntimeSource(dir, { source: "npm" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePkg(root: string, rel: string, json: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, rel), { recursive: true });
  fs.writeFileSync(path.join(root, rel, "package.json"), JSON.stringify(json));
}

/** Fake `npm ci`: lays down an installed tree (optionally with one stale plugin). */
function fakeInstalledTree(root: string, opts: { stalePlugin?: boolean } = {}): void {
  writePkg(root, `node_modules/${SCOPE}/pi-dashboard-server`, {
    name: `${SCOPE}/pi-dashboard-server`,
    version: X,
    engines: { node: ">=22.19.0" },
    piDashboard: { minShellVersion: "0.9.0", bundledPlugins: ["roles-plugin"] },
  });
  writePkg(root, `node_modules/${SCOPE}/pi-dashboard-roles-plugin`, {
    name: `${SCOPE}/pi-dashboard-roles-plugin`,
    version: opts.stalePlugin ? "0.8.0" : X,
    "pi-dashboard-plugin": { id: "roles" },
    repository: { type: "git", url: "https://github.com/BlackBeltTechnology/pi-agent-dashboard", directory: "packages/roles-plugin" },
  });
  fs.mkdirSync(path.join(root, `node_modules/${SCOPE}/pi-dashboard-roles-plugin/node_modules/nested`), { recursive: true });
  writePkg(root, `node_modules/${SCOPE}/pi-dashboard-web`, { name: `${SCOPE}/pi-dashboard-web`, version: X });
  writePkg(root, "node_modules/@earendil-works/pi-coding-agent", { name: "@earendil-works/pi-coding-agent", version: "0.86.1" });
}

function npmDeps(over: Partial<StagerDeps> = {}): StagerDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    fetchRuntimeLock: async () => structuredClone(LOCK),
    runNpm: async (args, cwd) => {
      calls.push(args);
      fakeInstalledTree(cwd);
    },
    fetchGithubAsset: async () => {
      throw new Error("not used");
    },
    extractTgz: async () => {
      throw new Error("not used");
    },
    platform: "darwin",
    arch: "arm64",
    ...over,
  };
}

describe("buildSyntheticRoot (E8)", () => {
  it("is byte-identical for the same lock", () => {
    const a = buildSyntheticRoot(structuredClone(LOCK), X);
    const b = buildSyntheticRoot(structuredClone(LOCK), X);
    expect(a.packageJson).toBe(b.packageJson);
    expect(a.packageLock).toBe(b.packageLock);
    expect(JSON.parse(a.packageJson).dependencies).toEqual(LOCK.packages[""].dependencies);
    expect(JSON.parse(a.packageLock)).toEqual(LOCK);
  });

  it("refuses a lock for another version", () => {
    expect(() => buildSyntheticRoot({ ...LOCK, packages: { "": { ...LOCK.packages[""], version: "0.9.0" } } }, X)).toThrow(/lock_version_mismatch/);
  });
});

describe("stageRuntime — npm (E8)", () => {
  it("installs with `npm ci --omit=dev` (never install), materializes plugins, writes the manifest, sets pending", async () => {
    const deps = npmDeps();
    const res = await stageRuntime({ dir, version: X, source: "npm", deps });
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0][0]).toBe("ci");
    expect(deps.calls[0]).toContain("--omit=dev");
    // npm 12 defaults allow-remote=none; a release dep resolved from a URL
    // tarball (xlsx from cdn.sheetjs.com, integrity-pinned in the lock) must
    // still install. See change: electron-runtime-release-pipeline.
    expect(deps.calls[0]).toContain("--allow-remote=all");
    expect(deps.calls.flat()).not.toContain("install");

    const root = path.join(dir, "versions", X);
    expect(res.root).toBe(root);
    expect(fs.existsSync(path.join(dir, "versions", `${X}.partial`))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"))).toEqual(LOCK);
    expect(fs.existsSync(path.join(root, "resources", "plugins", "roles-plugin", "package.json"))).toBe(true);
    // the plugin's own nested node_modules is not copied
    expect(fs.existsSync(path.join(root, "resources", "plugins", "roles-plugin", "node_modules"))).toBe(false);
    expect(readRuntimeManifest(root)).toEqual({
      version: X,
      minShellVersion: "0.9.0",
      nodeEngines: ">=22.19.0",
      origin: "npm",
      integrity: "sha512-srv",
      piVersion: "0.86.1",
    });
    expect(readRuntimeRequest(dir)?.pending).toBe(X);
    expect(readRuntimeRequest(dir)?.pendingNonce).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("an already staged, valid version is not re-installed — but the explicit Update still gets a fresh pendingNonce", async () => {
    await stageRuntime({ dir, version: X, source: "npm", deps: npmDeps() });
    const n1 = readRuntimeRequest(dir)?.pendingNonce;
    const again = npmDeps();
    await stageRuntime({ dir, version: X, source: "npm", deps: again });
    expect(again.calls).toHaveLength(0);
    expect(readRuntimeRequest(dir)?.pendingNonce).not.toBe(n1);
  });
});

describe("lockstep (E7)", () => {
  it("lockstepCheck names the mismatched package", () => {
    const root = path.join(dir, "tree");
    fakeInstalledTree(root, { stalePlugin: true });
    expect(lockstepCheck(root, X)).toEqual([`${SCOPE}/pi-dashboard-roles-plugin@0.8.0`]);
  });

  it("finds a mismatched first-party package nested below an UNSCOPED dependency", () => {
    const root = path.join(dir, "tree-nested");
    fakeInstalledTree(root);
    writePkg(root, `node_modules/some-dep/node_modules/${SCOPE}/pi-dashboard-shared`, {
      name: `${SCOPE}/pi-dashboard-shared`,
      version: "0.7.0",
    });
    expect(lockstepCheck(root, X)).toEqual([`${SCOPE}/pi-dashboard-shared@0.7.0`]);
  });

  it("staging fails naming <plugin>@0.8.0; .partial removed; pending unchanged", async () => {
    const deps = npmDeps({
      runNpm: async (_args, cwd) => fakeInstalledTree(cwd, { stalePlugin: true }),
    });
    await expect(stageRuntime({ dir, version: X, source: "npm", deps })).rejects.toThrow(
      `lockstep_mismatch ${SCOPE}/pi-dashboard-roles-plugin@0.8.0`,
    );
    expect(fs.existsSync(path.join(dir, "versions", `${X}.partial`))).toBe(false);
    expect(fs.existsSync(path.join(dir, "versions", X))).toBe(false);
    expect(readRuntimeRequest(dir)?.pending).toBeUndefined();
  });

  it("a same-count SUBSTITUTE (undeclared plugin instead of the declared one) fails the stage", async () => {
    const deps = npmDeps({
      runNpm: async (_args, cwd) => {
        fakeInstalledTree(cwd);
        fs.rmSync(path.join(cwd, "node_modules", SCOPE, "pi-dashboard-roles-plugin"), { recursive: true });
        writePkg(cwd, `node_modules/${SCOPE}/pi-dashboard-evil-plugin`, {
          name: `${SCOPE}/pi-dashboard-evil-plugin`,
          version: X,
          "pi-dashboard-plugin": { id: "evil" },
          repository: { directory: "packages/evil-plugin" },
        });
      },
    });
    await expect(stageRuntime({ dir, version: X, source: "npm", deps })).rejects.toThrow(/plugin_set_mismatch.*roles-plugin/);
    expect(fs.existsSync(path.join(dir, "versions", X))).toBe(false);
  });

  it("a declared plugin missing from the tree fails the stage", async () => {
    const deps = npmDeps({
      runNpm: async (_args, cwd) => {
        fakeInstalledTree(cwd);
        fs.rmSync(path.join(cwd, "node_modules", SCOPE, "pi-dashboard-roles-plugin"), { recursive: true });
      },
    });
    await expect(stageRuntime({ dir, version: X, source: "npm", deps })).rejects.toThrow(/plugin_set_mismatch/);
  });
});

// A staged plugin's deps must resolve from the staged root; npm may nest a
// plugin-only dep under the plugin package, which materialization drops.
// See change: bundle-plugin-third-party-deps (design D4; test-plan X1–X3).
describe("stageRuntime — plugin dependency resolvability", () => {
  /** fakeInstalledTree + the roles plugin declaring `yaml`, placed by `where`. */
  const withYaml = (where: "nested" | "above" | "root") =>
    npmDeps({
      runNpm: async (_args, cwd) => {
        fakeInstalledTree(cwd);
        const pluginRel = `node_modules/${SCOPE}/pi-dashboard-roles-plugin`;
        const manifest = JSON.parse(fs.readFileSync(path.join(cwd, pluginRel, "package.json"), "utf8"));
        manifest.dependencies = { yaml: "^2.9.0" };
        fs.writeFileSync(path.join(cwd, pluginRel, "package.json"), JSON.stringify(manifest));
        const yamlPkg = { name: "yaml", version: "2.9.1" };
        if (where === "nested") writePkg(cwd, `${pluginRel}/node_modules/yaml`, yamlPkg);
        if (where === "above") writePkg(dir, "node_modules/yaml", yamlPkg);
        if (where === "root") writePkg(cwd, "node_modules/yaml", yamlPkg);
      },
    });

  it("a dep present only under the plugin's nested node_modules fails with plugin_deps_unresolved (test-plan #X1)", async () => {
    const before = readRuntimeRequest(dir)?.pending;
    await expect(stageRuntime({ dir, version: X, source: "npm", deps: withYaml("nested") })).rejects.toThrow(
      /plugin_deps_unresolved.*roles-plugin → yaml/,
    );
    expect(fs.existsSync(path.join(dir, "versions", `${X}.partial`))).toBe(false);
    expect(fs.existsSync(path.join(dir, "versions", X))).toBe(false);
    expect(readRuntimeRequest(dir)?.pending).toBe(before);
  });

  it("a dep only above the staged root does not count (test-plan #X2)", async () => {
    await expect(stageRuntime({ dir, version: X, source: "npm", deps: withYaml("above") })).rejects.toThrow(
      /plugin_deps_unresolved/,
    );
  });

  it("a dep at the staged root resolves and the stage succeeds (test-plan #X3)", async () => {
    await stageRuntime({ dir, version: X, source: "npm", deps: withYaml("root") });
    expect(fs.existsSync(path.join(dir, "versions", X))).toBe(true);
    expect(readRuntimeRequest(dir)?.pending).toBe(X);
  });
});

describe("stageRuntime — github (X1)", () => {
  function githubDeps(assetBytes: Buffer, published: string): StagerDeps {
    return {
      ...npmDeps(),
      fetchGithubAsset: async (_version, dest) => {
        fs.writeFileSync(dest, assetBytes);
        return { sha512: published, assetName: "pi-dashboard-runtime-0.9.1-darwin-arm64.tgz" };
      },
      extractTgz: async (_tgz, dest) => fakeInstalledTree(dest),
    };
  }

  it("verifies sha512 and stages", async () => {
    const bytes = Buffer.from("asset-bytes");
    const sha = createHash("sha512").update(bytes).digest("hex");
    const res = await stageRuntime({ dir, version: X, source: "github", deps: githubDeps(bytes, sha) });
    expect(readRuntimeManifest(res.root)).toMatchObject({ origin: "github", integrity: `sha512:${sha}` });
    expect(fs.existsSync(path.join(res.root, ".asset.tgz"))).toBe(false);
  });

  it("an extracted symlink escaping the runtime tree fails the stage (unsafe_archive)", async () => {
    const bytes = Buffer.from("asset-bytes");
    const sha = createHash("sha512").update(bytes).digest("hex");
    const deps = {
      ...githubDeps(bytes, sha),
      extractTgz: async (_tgz: string, dest: string) => {
        fakeInstalledTree(dest);
        fs.symlinkSync("/etc", path.join(dest, "node_modules", "evil"));
      },
    };
    await expect(stageRuntime({ dir, version: X, source: "github", deps })).rejects.toThrow(/unsafe_archive/);
    expect(fs.existsSync(path.join(dir, "versions", X))).toBe(false);
  });

  it("an extra plugin shipped by the archive in resources/plugins fails the stage (exact set)", async () => {
    const bytes = Buffer.from("asset-bytes");
    const sha = createHash("sha512").update(bytes).digest("hex");
    const deps = {
      ...githubDeps(bytes, sha),
      extractTgz: async (_tgz: string, dest: string) => {
        fakeInstalledTree(dest);
        writePkg(dest, "resources/plugins/smuggled", { name: "smuggled", "pi-dashboard-plugin": { id: "smuggled" } });
      },
    };
    // the fresh rebuild drops the smuggled dir → declared set only → staging succeeds without it
    const res = await stageRuntime({ dir, version: X, source: "github", deps });
    expect(fs.readdirSync(path.join(res.root, "resources", "plugins"))).toEqual(["roles-plugin"]);
  });

  it("X1: checksum mismatch → checksum_mismatch; no versions/X*; pending unchanged", async () => {
    const extract = vi.fn();
    const deps = { ...githubDeps(Buffer.from("tampered"), "0".repeat(128)), extractTgz: extract };
    await expect(stageRuntime({ dir, version: X, source: "github", deps })).rejects.toThrow(/checksum_mismatch/);
    expect(extract).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(dir, "versions"))).toEqual([]);
    expect(readRuntimeRequest(dir)?.pending).toBeUndefined();
  });
});

describe("interrupted staging (X2)", () => {
  it("a killed npm ci leaves nothing selectable; the next run starts clean and succeeds", async () => {
    const killed = npmDeps({
      runNpm: async (_args, cwd) => {
        fs.mkdirSync(path.join(cwd, "node_modules", "half-written"), { recursive: true });
        throw new Error("npm ci killed (SIGKILL)");
      },
    });
    await expect(stageRuntime({ dir, version: X, source: "npm", deps: killed })).rejects.toThrow(/SIGKILL/);
    expect(fs.readdirSync(path.join(dir, "versions"))).toEqual([]);

    // Simulate a crash that DID leave a .partial behind (app quit mid-stage).
    fs.mkdirSync(path.join(dir, "versions", `${X}.partial`, "node_modules", "stale"), { recursive: true });
    const res = await stageRuntime({ dir, version: X, source: "npm", deps: npmDeps() });
    expect(fs.existsSync(path.join(res.root, "node_modules", "stale"))).toBe(false);
    expect(fs.existsSync(path.join(res.root, "node_modules", "half-written"))).toBe(false);
    expect(readRuntimeRequest(dir)?.pending).toBe(X);
  });

  it("rejects a non-semver version before touching disk", async () => {
    await expect(stageRuntime({ dir, version: "../../etc", source: "npm", deps: npmDeps() })).rejects.toThrow(/invalid_version/);
    expect(fs.existsSync(path.join(dir, "versions"))).toBe(false);
  });
});
