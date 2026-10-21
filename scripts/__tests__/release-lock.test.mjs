/**
 * Release-lock helpers (change: pin-electron-bundle-dependency-tree):
 * rebase (D3), installed-tree audit (D4), lock fetch (D2), pre-publish lint
 * (D6) and the post-bundle assertion (D1).
 *
 * Pure fixtures — no network, no npm. Test-plan #E1–#E12, #E18, #E19, #X1, #X2.
 */

import { execFileSync } from "node:child_process"; // ban:child_process-ok — builds real tarball fixtures with the system tar
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkReleaseLockBundle } from "../../packages/electron/scripts/assert-release-lock-bundle.mjs";
import {
  auditInstalledTree,
  fetchPublishedLock,
  parseReleaseLockArgs,
  readBundledWorkspaceDirs,
  readBundledWorkspaces,
  rebaseRuntimeLock,
  withTempLockFile,
} from "../../packages/electron/scripts/lib/release-lock.mjs";
import { collectPluginRuntimeDeps as collectBundlePluginDeps, readBundledPluginIds } from "../../packages/shared/src/runtime-overlay/materialize-plugins.mjs";
import { pluginRuntimeDeps } from "../lib/runtime-release.mjs";
import { lintRuntimeLock } from "../lint-runtime-lock.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SC = "@blackbelt-technology/";
const X = "0.10.0";

// ── fixtures ──────────────────────────────────────────────────────────────

const tp = (name, version, extra = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`,
  integrity: "sha512-AAAA",
  ...extra,
});

function workspaces(...dirs) {
  const m = new Map();
  for (const dir of dirs) {
    m.set(`${SC}pi-dashboard-${dir}`, {
      dir,
      manifest: {
        name: `${SC}pi-dashboard-${dir}`,
        version: X,
        license: "MIT",
        dependencies: { foo: "^1.0.0" },
        peerDependencies: { bar: "*" },
        devDependencies: { vitest: "^1" },
      },
    });
  }
  return m;
}

/** Minimal published lock: root + the given extra entries. */
function lockWith(entries, rootDeps = { foo: "^1.0.0" }) {
  return {
    name: "pi-dashboard-runtime",
    version: X,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "pi-dashboard-runtime", version: X, dependencies: { [`${SC}pi-dashboard-server`]: X, ...rootDeps } },
      "node_modules/foo": tp("foo", "1.2.0"),
      ...entries,
    },
  };
}

const ctx = (over = {}) => ({
  workspaces: workspaces("server", "shared"),
  bundledPlugins: new Set([`${SC}pi-dashboard-roles-plugin`]),
  pluginUnion: { foo: "^1.0.0" },
  version: X,
  ...over,
});

// ── rebase ────────────────────────────────────────────────────────────────

describe("rebaseRuntimeLock (design D3)", () => {
  it("E1: a bundled workspace becomes a link, its package entry comes from the manifest, nested entries are re-keyed", () => {
    const nested = tp("baz", "3.0.0");
    const { lock } = rebaseRuntimeLock(
      lockWith({
        [`node_modules/${SC}pi-dashboard-server`]: { version: X, resolved: "http://x/server.tgz" },
        [`node_modules/${SC}pi-dashboard-server/node_modules/baz`]: nested,
      }),
      ctx(),
    );
    expect(lock.packages[`node_modules/${SC}pi-dashboard-server`]).toEqual({ resolved: "packages/server", link: true });
    expect(lock.packages["packages/server"]).toEqual({
      version: X,
      license: "MIT",
      dependencies: { foo: "^1.0.0" },
      peerDependencies: { bar: "*" },
    });
    expect(lock.packages["packages/server/node_modules/baz"]).toEqual(nested);
    expect(lock.packages[`node_modules/${SC}pi-dashboard-server/node_modules/baz`]).toBeUndefined();
  });

  it("E2: a package that is both a workspace and a bundled plugin is linked (rule 1), not removed (rule 3)", () => {
    const name = `${SC}pi-dashboard-mcp-client-plugin`;
    const w = new Map([[name, { dir: "mcp-client-plugin", manifest: { name, version: X } }]]);
    const { lock } = rebaseRuntimeLock(
      lockWith({ [`node_modules/${name}`]: tp(name, X) }),
      ctx({ workspaces: w, bundledPlugins: new Set([name]) }),
    );
    expect(lock.packages[`node_modules/${name}`]).toEqual({ resolved: "packages/mcp-client-plugin", link: true });
  });

  it("E3: a bundled workspace with no entry in the published lock still gets its link and package entry", () => {
    const { lock } = rebaseRuntimeLock(lockWith({}), ctx());
    expect(lock.packages[`node_modules/${SC}pi-dashboard-shared`]).toEqual({ resolved: "packages/shared", link: true });
    expect(lock.packages["packages/shared"]).toBeDefined();
  });

  it("E4: pi-dashboard-web and its nested entries are removed", () => {
    const web = `node_modules/${SC}pi-dashboard-web`;
    const { lock } = rebaseRuntimeLock(
      lockWith({ [web]: tp("web", X), [`${web}/node_modules/react`]: tp("react", "19.0.0") }),
      ctx(),
    );
    expect(Object.keys(lock.packages).filter((k) => k.includes("pi-dashboard-web"))).toEqual([]);
    expect(Object.keys(lock.packages).filter((k) => k.includes("react"))).toEqual([]);
  });

  it("E5: a bundled plugin that is not a workspace and its nested entries are removed; root third-party entries stay", () => {
    const plugin = `node_modules/${SC}pi-dashboard-roles-plugin`;
    const { lock } = rebaseRuntimeLock(
      lockWith({ [plugin]: tp("roles", X), [`${plugin}/node_modules/qux`]: tp("qux", "1.0.0") }),
      ctx(),
    );
    expect(lock.packages[plugin]).toBeUndefined();
    expect(lock.packages[`${plugin}/node_modules/qux`]).toBeUndefined();
    expect(lock.packages["node_modules/foo"]).toBeDefined();
  });

  it("E6: an unmapped first-party package throws and names it", () => {
    expect(() =>
      rebaseRuntimeLock(lockWith({ [`node_modules/${SC}pi-dashboard-unknown`]: tp("unknown", X) }), ctx()),
    ).toThrow(`${SC}pi-dashboard-unknown`);
  });

  it("E6: a first-party package nested under a third-party or workspace owner throws (rule 4 at every depth)", () => {
    const sc = `${SC}pi-dashboard-shared`;
    expect(() =>
      rebaseRuntimeLock(lockWith({ [`node_modules/foo/node_modules/${sc}`]: tp("shared", X) }), ctx()),
    ).toThrow(/nested at node_modules\/foo\/node_modules/);
    expect(() =>
      rebaseRuntimeLock(lockWith({ [`node_modules/${SC}pi-dashboard-server/node_modules/${sc}`]: tp("shared", X) }), ctx()),
    ).toThrow(/nested at/);
  });

  describe("E7: third-party entry sources and integrity", () => {
    const attempt = (entry) => rebaseRuntimeLock(lockWith({ "node_modules/zed": entry }), ctx());

    it("(a) https with integrity is kept byte-identical", () => {
      const entry = tp("zed", "1.0.0");
      expect(attempt(entry).lock.packages["node_modules/zed"]).toEqual(entry);
    });
    it("(b) https without integrity throws naming the entry", () => {
      const { integrity: _i, ...entry } = tp("zed", "1.0.0");
      expect(() => attempt(entry)).toThrow(/node_modules\/zed.*no integrity/);
    });
    it("(c) git+https source throws", () => {
      expect(() => attempt({ ...tp("zed", "1.0.0"), resolved: "git+https://github.com/x/zed.git#abc" })).toThrow("node_modules/zed");
    });
    it("(d) file: source throws", () => {
      expect(() => attempt({ ...tp("zed", "1.0.0"), resolved: "file:../zed.tgz" })).toThrow("node_modules/zed");
    });
    it("(e) non-loopback http throws; loopback http (the nightly Verdaccio) is accepted", () => {
      expect(() => attempt({ ...tp("zed", "1.0.0"), resolved: "http://registry.example.com/zed.tgz" })).toThrow("node_modules/zed");
      const ok = { ...tp("zed", "1.0.0"), resolved: "http://127.0.0.1:4873/zed/-/zed-1.0.0.tgz" };
      expect(attempt(ok).lock.packages["node_modules/zed"]).toEqual(ok);
    });
    it("an inBundle entry (no resolved/integrity of its own) is exempt", () => {
      const entry = { version: "1.0.0", inBundle: true, optional: true };
      expect(attempt(entry).lock.packages["node_modules/zed"]).toEqual(entry);
    });
  });

  describe("E8: root", () => {
    it("equal unions → synthetic name, version X, bundle workspaces and the union", () => {
      const { lock } = rebaseRuntimeLock(lockWith({}), ctx());
      expect(lock.packages[""]).toEqual({
        name: "pi-dashboard-bundled-server",
        version: X,
        workspaces: ["packages/server", "packages/shared"],
        dependencies: { foo: "^1.0.0" },
      });
      expect(lock.name).toBe("pi-dashboard-bundled-server");
    });
    it("a union that differs by one dependency throws and names it", () => {
      expect(() => rebaseRuntimeLock(lockWith({}), ctx({ pluginUnion: { foo: "^1.0.0", extra: "^2.0.0" } }))).toThrow("extra");
      expect(() => rebaseRuntimeLock(lockWith({}, { foo: "^1.0.0", lockOnly: "^1" }), ctx())).toThrow("lockOnly");
    });
    it("a lock for another version throws", () => {
      expect(() => rebaseRuntimeLock(lockWith({}), ctx({ version: "0.9.0" }))).toThrow(/0\.9\.0/);
    });
  });

  it("E9: workspace names come from each manifest, not the directory name", () => {
    const w = readBundledWorkspaces(REPO_ROOT, ["bus-client"]);
    expect([...w.keys()]).toEqual([`${SC}pi-dashboard-bus-client`]);
    const { lock } = rebaseRuntimeLock(
      lockWith({ [`node_modules/${SC}pi-dashboard-bus-client`]: tp("bus-client", X) }),
      ctx({ workspaces: w }),
    );
    expect(lock.packages[`node_modules/${SC}pi-dashboard-bus-client`]).toEqual({ resolved: "packages/bus-client", link: true });
  });
});

// ── audit ─────────────────────────────────────────────────────────────────

describe("auditInstalledTree (design D4)", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const pkg = (rel, name, version) => {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, "package.json"), JSON.stringify({ name, version }));
  };
  const { lock } = rebaseRuntimeLock(
    lockWith({ "node_modules/foo/node_modules/bar": tp("bar", "2.0.0"), "node_modules/pruned": tp("pruned", "1.0.0", { dev: true }) }),
    ctx(),
  );
  const ws = ctx().workspaces;
  const link = (name, dirName) => {
    fs.mkdirSync(path.join(dir, "node_modules", path.dirname(name)), { recursive: true });
    fs.mkdirSync(path.join(dir, "packages", dirName), { recursive: true });
    fs.symlinkSync(path.join(dir, "packages", dirName), path.join(dir, "node_modules", name), "dir");
  };
  const install = () => {
    pkg("node_modules/foo", "foo", "1.2.0");
    pkg("node_modules/foo/node_modules/bar", "bar", "2.0.0");
    link(`${SC}pi-dashboard-server`, "server");
    link(`${SC}pi-dashboard-shared`, "shared");
  };

  it("E10a: every installed third-party package is in the lock (pruned / dev entries absent) → passes with counts", () => {
    install();
    const r = auditInstalledTree({ bundleDir: dir, lock, workspaces: ws });
    expect(r).toMatchObject({ thirdParty: 2, firstParty: 2 });
    expect(r.lockEntries).toBeGreaterThan(2);
  });

  it("E10b: an installed version the lock does not pin fails and names it", () => {
    install();
    pkg("node_modules/foo", "foo", "2.0.0");
    expect(() => auditInstalledTree({ bundleDir: dir, lock, workspaces: ws })).toThrow("foo@2.0.0");
  });

  it("E10c: an installed package absent from the lock fails", () => {
    install();
    pkg("node_modules/stranger", "stranger", "1.0.0");
    expect(() => auditInstalledTree({ bundleDir: dir, lock, workspaces: ws })).toThrow("stranger@1.0.0");
  });

  it("E11a: first-party entries that are symlinks to packages/<dir> pass", () => {
    install();
    expect(() => auditInstalledTree({ bundleDir: dir, lock, workspaces: ws })).not.toThrow();
  });

  it("E11b: a first-party entry that is a real directory (from the registry) fails naming it", () => {
    install();
    fs.rmSync(path.join(dir, "node_modules", SC, "pi-dashboard-shared"), { force: true });
    pkg(`node_modules/${SC}pi-dashboard-shared`, `${SC}pi-dashboard-shared`, "0.9.0");
    expect(() => auditInstalledTree({ bundleDir: dir, lock, workspaces: ws })).toThrow(`${SC}pi-dashboard-shared`);
  });

  it("E11c: a packages/<dir>/node_modules fails naming the directory", () => {
    install();
    fs.mkdirSync(path.join(dir, "packages", "server", "node_modules"), { recursive: true });
    expect(() => auditInstalledTree({ bundleDir: dir, lock, workspaces: ws })).toThrow("packages/server/node_modules");
  });
});

// ── union parity (E12) and lint (X2) ──────────────────────────────────────

describe("bundle ↔ runtime lock plugin-union parity (design D3 rule 6)", () => {
  /** The bundle's union, computed exactly as `bundle-server.mjs` does. */
  const bundleUnion = (root, dirs = readBundledWorkspaceDirs(root)) =>
    collectBundlePluginDeps({
      ids: readBundledPluginIds(path.join(root, "packages", "server", "package.json")),
      resolveSource: (id) => path.join(root, "packages", id),
      workspaceManifests: dirs.map((d) => JSON.parse(fs.readFileSync(path.join(root, "packages", d, "package.json"), "utf8"))),
    });

  it("E12: the bundle's union equals the runtime lock's root union for the repo", () => {
    expect(bundleUnion(REPO_ROOT)).toEqual(pluginRuntimeDeps(REPO_ROOT));
  });

  it("E12: a third-party dependency added to a bundle-only workspace diverges the two computations, naming it", () => {
    // Plugin `p` needs ws@^7; bundle workspace `kb` (not part of the lock's workspace set) declares ws@^8.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
    try {
      const write = (rel, json) => {
        fs.mkdirSync(path.join(root, "packages", rel), { recursive: true });
        fs.writeFileSync(path.join(root, "packages", rel, "package.json"), JSON.stringify(json));
      };
      write("server", { name: `${SC}pi-dashboard-server`, piDashboard: { bundledPlugins: ["p"] } });
      write("p", { name: `${SC}p`, dependencies: { ws: "^7" } });
      write("kb", { name: `${SC}pi-dashboard-kb`, dependencies: { ws: "^8" } });
      expect(() => bundleUnion(root, ["kb"])).toThrow("ws");
      expect(pluginRuntimeDeps(root)).toEqual({ ws: "^7" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("E12: a lock root dependency the bundle's union lacks fails the rebase naming it", () => {
    const real = pluginRuntimeDeps(REPO_ROOT);
    expect(() => rebaseRuntimeLock(lockWith({}, { ...real, onlyInLock: "^1.0.0" }), ctx({ pluginUnion: real }))).toThrow("onlyInLock");
  });

  it("X2: lintRuntimeLock rejects a lock with an unmapped first-party entry, naming it", () => {
    const real = pluginRuntimeDeps(REPO_ROOT);
    const lock = lockWith({ [`node_modules/${SC}pi-dashboard-unmapped`]: tp("unmapped", X) }, real);
    lock.packages[""].version = X;
    expect(() => lintRuntimeLock({ repoRoot: REPO_ROOT, lock, version: X })).toThrow(`${SC}pi-dashboard-unmapped`);
  });
});

// ── fetch (D2) ────────────────────────────────────────────────────────────

describe("fetchPublishedLock (design D2)", () => {
  const noSleep = async () => {};
  const base = { version: X, attempts: 3, sleep: noSleep };
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** deps backed by a real tarball built from `files` (member path → content). */
  function tarballDeps(files, { extraTar } = {}) {
    const src = path.join(tmp, "src");
    fs.mkdirSync(src, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
      fs.writeFileSync(path.join(src, rel), content);
    }
    extraTar?.(src);
    const tgz = path.join(tmp, "server.tgz");
    execFileSync("tar", ["-czf", tgz, "-C", src, "."]);
    return {
      pack: (_spec, destDir) => {
        const out = path.join(destDir, "s.tgz");
        fs.copyFileSync(tgz, out);
        return out;
      },
      listArchive: (t) => ({
        names: execFileSync("tar", ["-tzf", t], { encoding: "utf8" }).replace(/^\.\//gm, ""),
        verbose: execFileSync("tar", ["-tvzf", t], { encoding: "utf8" }),
      }),
      extractMember: (t, member, destDir) => {
        execFileSync("tar", ["-xzf", t, "-C", destDir]);
        return fs.readFileSync(path.join(destDir, member), "utf8");
      },
    };
  }

  it("returns the lock when the tarball carries one for X", async () => {
    const lock = lockWith({});
    const deps = tarballDeps({ "package/runtime-lock.json": JSON.stringify(lock), "package/package.json": "{}" });
    await expect(fetchPublishedLock({ ...base, deps })).resolves.toEqual(lock);
  });

  it("E18a: npm pack failing every attempt → bounded retries, then an error naming server@X", async () => {
    let calls = 0;
    const deps = {
      pack: () => {
        calls += 1;
        throw new Error("E404");
      },
    };
    await expect(fetchPublishedLock({ ...base, deps })).rejects.toThrow(`${SC}pi-dashboard-server@${X}`);
    expect(calls).toBe(3);
  });

  it("E18b: a tarball without runtime-lock.json fails naming it", async () => {
    const deps = tarballDeps({ "package/package.json": "{}" });
    await expect(fetchPublishedLock({ ...base, deps })).rejects.toThrow("runtime-lock.json");
  });

  it("E18c: a lock for another version fails naming both versions", async () => {
    const stale = { ...lockWith({}), packages: { "": { version: "0.9.0" } } };
    const deps = tarballDeps({ "package/runtime-lock.json": JSON.stringify(stale) });
    await expect(fetchPublishedLock({ ...base, deps })).rejects.toThrow(/0\.9\.0.*0\.10\.0/);
  });

  it("E18: retries succeed once npm pack recovers", async () => {
    const lock = lockWith({});
    const good = tarballDeps({ "package/runtime-lock.json": JSON.stringify(lock) });
    let calls = 0;
    const deps = { ...good, pack: (s, d) => (++calls < 3 ? (() => { throw new Error("stale packument"); })() : good.pack(s, d)) };
    await expect(fetchPublishedLock({ ...base, deps })).resolves.toEqual(lock);
  });

  it("E19: an absolute-path member is refused", async () => {
    const deps = {
      ...tarballDeps({ "package/runtime-lock.json": "{}" }),
      listArchive: () => ({ names: "/etc/passwd\npackage/runtime-lock.json\n", verbose: "" }),
    };
    await expect(fetchPublishedLock({ ...base, deps })).rejects.toThrow("unsafe_archive");
  });

  it("E19: a `..` member is refused", async () => {
    const deps = {
      ...tarballDeps({ "package/runtime-lock.json": "{}" }),
      listArchive: () => ({ names: "package/../../escape\npackage/runtime-lock.json\n", verbose: "" }),
    };
    await expect(fetchPublishedLock({ ...base, deps })).rejects.toThrow("unsafe_archive");
  });

  it("E19: a real tarball with a symlink member is refused before extraction", async () => {
    const deps = tarballDeps(
      { "package/runtime-lock.json": JSON.stringify(lockWith({})) },
      { extraTar: (src) => fs.symlinkSync("/etc", path.join(src, "package", "evil")) },
    );
    await expect(fetchPublishedLock({ ...base, deps })).rejects.toThrow("unsafe_archive link member");
  });
});

// ── post-bundle assertion (X1) ────────────────────────────────────────────

describe("checkReleaseLockBundle (design D1)", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = (m) => fs.writeFileSync(path.join(dir, "runtime-manifest.json"), JSON.stringify(m));

  it("X1: a missing manifest fails", () => {
    expect(checkReleaseLockBundle(dir, X)).toMatch(/runtime-manifest\.json/);
  });
  it("X1: installMode floating fails naming installMode", () => {
    manifest({ installMode: "floating" });
    expect(checkReleaseLockBundle(dir, X)).toMatch(/installMode/);
  });
  it("X1: a lockVersion that is not X fails naming lockVersion", () => {
    manifest({ installMode: "release-lock", lockVersion: "0.9.0" });
    expect(checkReleaseLockBundle(dir, X)).toMatch(/lockVersion/);
  });
  it("X1: matching values pass", () => {
    manifest({ installMode: "release-lock", lockVersion: X });
    expect(checkReleaseLockBundle(dir, X)).toBeNull();
  });
  it("X1: an empty release version fails instead of passing vacuously", () => {
    manifest({ installMode: "release-lock", lockVersion: "" });
    expect(checkReleaseLockBundle(dir, "")).not.toBeNull();
  });
});

// ── temporary lock lifecycle (review B1) and argv ─────────────────────────

describe("withTempLockFile (no package-lock.json may remain)", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "templock-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = () => path.join(dir, "package-lock.json");

  it("removes a stale lock before running fn", async () => {
    fs.writeFileSync(file(), "stale");
    await withTempLockFile(file(), async () => {
      expect(fs.existsSync(file())).toBe(false);
    });
  });

  it("removes the lock after success", async () => {
    await withTempLockFile(file(), async () => fs.writeFileSync(file(), "{}"));
    expect(fs.existsSync(file())).toBe(false);
  });

  it("removes the lock when fn throws (npm ci / audit failure) and rethrows", async () => {
    await expect(
      withTempLockFile(file(), async () => {
        fs.writeFileSync(file(), "{}");
        throw new Error("audit failed");
      }),
    ).rejects.toThrow("audit failed");
    expect(fs.existsSync(file())).toBe(false);
  });
});

describe("parseReleaseLockArgs duplicates", () => {
  it("rejects --release-lock given twice instead of silently using the first", () => {
    expect(() => parseReleaseLockArgs([`--release-lock=${X}`, "--release-lock=0.0.1"], { serverVersion: X })).toThrow(/2 times/);
  });
});
