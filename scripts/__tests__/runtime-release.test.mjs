/**
 * Unit tests for the runtime release producer scripts (change:
 * electron-runtime-release-pipeline, tasks 2.1–2.5).
 *
 * Pure logic only — no network, no npm, no GitHub:
 *   - lib: bundled-plugin id → package-name mapping against the real repo,
 *     asset naming identical to the consumer (`runtime-io.ts`).
 *   - generate-runtime-lock: root manifest shape + lock finalization
 *     (server self-reference rewrite, lockstep, no `file:` left, every
 *     required package present).
 *   - assert-bundled-plugins-published (test-plan #X17): stubbed `npm view`
 *     → missing package named, non-zero; all present → zero; retries.
 *   - assert-runtime-release (test-plan #X16): asset + .sha512 per platform,
 *     `beta` dist-tag = X on prerelease, manifest version = X.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { checkPublished } from "../assert-bundled-plugins-published.mjs";
import { checkRuntimeRelease } from "../assert-runtime-release.mjs";
import { pruneBinLinks, sha512Line } from "../build-runtime-asset.mjs";
import { buildRuntimeRootManifest, finalizeRuntimeLock, serverTarballUrl } from "../generate-runtime-lock.mjs";
import {
  bundledPluginPackages,
  RUNTIME_ASSET_TARGETS,
  RUNTIME_BASE_PACKAGES,
  runtimeAssetName,
  SERVER_PACKAGE,
} from "../lib/runtime-release.mjs";
import {
  assertLoopback,
  publishOrder,
  readWorkspaces,
  rewriteManifest,
  runtimeClosure,
  runtimeE2eVersions,
  verdaccioConfig,
} from "../runtime-e2e-registry.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const V = "1.2.3";
const SCOPE = "@blackbelt-technology";

describe("lib/runtime-release", () => {
  it("maps every declared bundledPlugins id to its workspace package name", () => {
    const server = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages/server/package.json"), "utf8"));
    const ids = server.piDashboard.bundledPlugins;
    const pkgs = bundledPluginPackages(REPO_ROOT);
    expect(pkgs.map((p) => p.id)).toEqual(ids);
    for (const { id, name } of pkgs) {
      const pj = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages", id, "package.json"), "utf8"));
      expect(name).toBe(pj.name);
      // The consumer maps a plugin by repository.directory — must agree.
      expect(pj.repository?.directory).toBe(`packages/${id}`);
    }
  });

  it("names the asset exactly like the consumer's githubAssetName", () => {
    expect(runtimeAssetName(V, "darwin", "arm64")).toBe(`pi-dashboard-runtime-${V}-darwin-arm64.tgz`);
    const io = fs.readFileSync(path.join(REPO_ROOT, "packages/server/src/runtime-overlay/runtime-io.ts"), "utf8");
    expect(io).toContain("`pi-dashboard-runtime-${version}-${platform}-${arch}.tgz`");
  });

  it("publish.yml runtime-asset matrix equals RUNTIME_ASSET_TARGETS (asset assertion stays in sync)", () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8");
    const job = yml.slice(yml.indexOf("\n  runtime-asset:"), yml.indexOf("\n  github-release:"));
    const legs = [...job.matchAll(/platform:\s*(\w+),\s*arch:\s*(\w+)/g)].map((m) => `${m[1]}-${m[2]}`);
    expect(legs.sort()).toEqual(RUNTIME_ASSET_TARGETS.map((t) => `${t.platform}-${t.arch}`).sort());
  });

  it("base package set excludes the meta package (design R1)", () => {
    expect(RUNTIME_BASE_PACKAGES).toContain(SERVER_PACKAGE);
    expect(RUNTIME_BASE_PACKAGES).not.toContain(`${SCOPE}/pi-agent-dashboard`);
    expect(RUNTIME_ASSET_TARGETS.length).toBeGreaterThan(0);
  });
});

describe("generate-runtime-lock", () => {
  const plugins = [`${SCOPE}/pi-dashboard-roles-plugin`, `${SCOPE}/pi-dashboard-kb-plugin`];

  it("root manifest pins every package at exactly X; server from the local tarball", () => {
    const m = buildRuntimeRootManifest({ version: V, packages: [...RUNTIME_BASE_PACKAGES, ...plugins], serverSpec: "file:server.tgz" });
    expect(m).toMatchObject({ name: "pi-dashboard-runtime", version: V, private: true });
    expect(m.dependencies[SERVER_PACKAGE]).toBe("file:server.tgz");
    for (const p of [...RUNTIME_BASE_PACKAGES, ...plugins].filter((p) => p !== SERVER_PACKAGE)) {
      expect(m.dependencies[p]).toBe(V);
    }
  });

  const rawLock = () => ({
    name: "pi-dashboard-runtime",
    version: V,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "pi-dashboard-runtime",
        version: V,
        dependencies: Object.fromEntries([
          ...RUNTIME_BASE_PACKAGES.map((p) => [p, p === SERVER_PACKAGE ? "file:server.tgz" : V]),
          ...plugins.map((p) => [p, V]),
        ]),
      },
      ...Object.fromEntries(
        [...RUNTIME_BASE_PACKAGES, ...plugins, `${SCOPE}/pi-dashboard-shared`].map((p) => [
          `node_modules/${p}`,
          p === SERVER_PACKAGE
            ? { version: V, resolved: "file:server.tgz", integrity: "sha512-local", dependencies: { fastify: "^5" } }
            : { version: V, resolved: `https://registry.npmjs.org/${p}/-/x-${V}.tgz`, integrity: "sha512-reg" },
        ]),
      ),
      "node_modules/fastify": { version: "5.0.0", resolved: "https://registry.npmjs.org/fastify/-/fastify-5.0.0.tgz", integrity: "sha512-f" },
    },
  });

  it("rewrites the server self-reference to the registry tarball without integrity", () => {
    const lock = finalizeRuntimeLock(rawLock(), { version: V, packages: [...RUNTIME_BASE_PACKAGES, ...plugins] });
    expect(lock.packages[""].dependencies[SERVER_PACKAGE]).toBe(V);
    const server = lock.packages[`node_modules/${SERVER_PACKAGE}`];
    expect(server.resolved).toBe(serverTarballUrl("https://registry.npmjs.org", SERVER_PACKAGE, V));
    expect(server.resolved).toBe(`https://registry.npmjs.org/${SERVER_PACKAGE}/-/pi-dashboard-server-${V}.tgz`);
    expect(server.integrity).toBeUndefined();
    expect(server.dependencies).toEqual({ fastify: "^5" });
    // Every other entry keeps its registry integrity.
    expect(lock.packages["node_modules/fastify"].integrity).toBe("sha512-f");
    expect(JSON.stringify(lock)).not.toContain("file:");
  });

  it("uses the given registry for the server URL (verdaccio fixture)", () => {
    const lock = finalizeRuntimeLock(rawLock(), { version: V, packages: [...RUNTIME_BASE_PACKAGES, ...plugins], registry: "http://localhost:4873/" });
    expect(lock.packages[`node_modules/${SERVER_PACKAGE}`].resolved).toBe(`http://localhost:4873/${SERVER_PACKAGE}/-/pi-dashboard-server-${V}.tgz`);
  });

  it("rejects a first-party package not at X anywhere in the tree (lockstep)", () => {
    const raw = rawLock();
    raw.packages[`node_modules/foo/node_modules/${SCOPE}/pi-dashboard-shared`] = { version: "1.2.2", integrity: "x" };
    expect(() => finalizeRuntimeLock(raw, { version: V, packages: plugins })).toThrow(/pi-dashboard-shared@1\.2\.2/);
  });

  it("rejects a lock that lacks a required package", () => {
    const raw = rawLock();
    delete raw.packages[`node_modules/${plugins[1]}`];
    expect(() => finalizeRuntimeLock(raw, { version: V, packages: [...RUNTIME_BASE_PACKAGES, ...plugins] })).toThrow(plugins[1]);
  });

  it("rejects any other local (file:) resolution", () => {
    const raw = rawLock();
    raw.packages["node_modules/fastify"].resolved = "file:../fastify";
    expect(() => finalizeRuntimeLock(raw, { version: V, packages: plugins })).toThrow(/fastify/);
  });

  it("rejects a lock whose root is not at X", () => {
    const raw = rawLock();
    raw.packages[""].version = "9.9.9";
    expect(() => finalizeRuntimeLock(raw, { version: V, packages: plugins })).toThrow(/9\.9\.9/);
  });
});

describe("assert-bundled-plugins-published (test-plan #X17)", () => {
  const names = [`${SCOPE}/a`, `${SCOPE}/b`, `${SCOPE}/c`];
  const noSleep = async () => {};

  it("all present → ok, no retries", async () => {
    let calls = 0;
    const r = await checkPublished({ names, version: V, view: async () => (calls++, V), sleep: noSleep });
    expect(r).toEqual({ ok: true, missing: [] });
    expect(calls).toBe(3);
  });

  it("one missing after retries → not ok, names it", async () => {
    let bCalls = 0;
    const view = async (name) => {
      if (name === `${SCOPE}/b`) {
        bCalls++;
        throw new Error("E404");
      }
      return V;
    };
    const r = await checkPublished({ names, version: V, view, sleep: noSleep, attempts: 4 });
    expect(r).toEqual({ ok: false, missing: [`${SCOPE}/b`] });
    expect(bCalls).toBe(4);
  });

  it("propagation delay: succeeds on a later attempt", async () => {
    let n = 0;
    const r = await checkPublished({ names: [`${SCOPE}/a`], version: V, view: async () => (++n < 3 ? "" : V), sleep: noSleep, attempts: 5 });
    expect(r.ok).toBe(true);
    expect(n).toBe(3);
  });

  it("CLI exits non-zero naming the missing package", async () => {
    const { execFileSync } = await import("node:child_process");
    const stub = path.join(__dirname, "fixtures", "npm-view-stub.mjs");
    let err;
    try {
      execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/assert-bundled-plugins-published.mjs"), "--version", V], {
        env: { ...process.env, RUNTIME_GATE_NPM_VIEW: stub, RUNTIME_GATE_STUB_MISSING: `${SCOPE}/pi-dashboard-kb-plugin`, RUNTIME_GATE_ATTEMPTS: "1", GITHUB_STEP_SUMMARY: "" },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      err = e;
    }
    expect(err?.status).toBe(1);
    expect(`${err?.stdout}${err?.stderr}`).toContain(`${SCOPE}/pi-dashboard-kb-plugin`);
  });

  it("CLI exits zero when every package resolves", async () => {
    const { execFileSync } = await import("node:child_process");
    const stub = path.join(__dirname, "fixtures", "npm-view-stub.mjs");
    const out = execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/assert-bundled-plugins-published.mjs"), "--version", V], {
      env: { ...process.env, RUNTIME_GATE_NPM_VIEW: stub, RUNTIME_GATE_STUB_MISSING: "", RUNTIME_GATE_ATTEMPTS: "1", GITHUB_STEP_SUMMARY: "" },
      encoding: "utf8",
    });
    expect(out).toMatch(/all \d+ bundled plugin/);
  });
});

describe("build-runtime-asset", () => {
  const mk = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rt-asset-test-"));

  it.skipIf(process.platform === "win32")("prunes .bin symlinks at any depth, keeps files", () => {
    const root = mk();
    fs.mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules/a/node_modules/.bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/a/cli.js"), "");
    fs.symlinkSync("../a/cli.js", path.join(root, "node_modules/.bin/a"));
    fs.symlinkSync("../../cli.js", path.join(root, "node_modules/a/node_modules/.bin/b"));
    fs.writeFileSync(path.join(root, "node_modules/.bin/a.cmd"), "");
    expect(pruneBinLinks(root)).toBe(2);
    expect(fs.readdirSync(path.join(root, "node_modules/.bin"))).toEqual(["a.cmd"]);
    expect(fs.existsSync(path.join(root, "node_modules/a/cli.js"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("refuses a symlink outside .bin (consumer would reject the asset)", () => {
    const root = mk();
    fs.mkdirSync(path.join(root, "node_modules/a"), { recursive: true });
    fs.symlinkSync("/etc", path.join(root, "node_modules/a/evil"));
    expect(() => pruneBinLinks(root)).toThrow(/node_modules[\\/]a[\\/]evil/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it(".sha512 body: first whitespace token is the hex digest (consumer contract)", () => {
    const line = sha512Line("ab".repeat(64), "x.tgz");
    expect(line.trim().split(/\s+/)[0]).toBe("ab".repeat(64));
    expect(line).toBe(`${"ab".repeat(64)}  x.tgz\n`);
  });
});

describe("runtime-e2e-registry (task 3.1 fixture)", () => {
  it("derives good/broken above the bundled base", () => {
    expect(runtimeE2eVersions("0.8.0")).toEqual({ base: "0.8.0", good: "0.8.1", broken: "0.8.2" });
    expect(runtimeE2eVersions("0.9.0-beta.1")).toEqual({ base: "0.9.0-beta.1", good: "0.9.1", broken: "0.9.2" });
  });

  it("closure over the real repo covers the runtime set + bundled plugins + their first-party deps, server last", () => {
    const ws = readWorkspaces(REPO_ROOT);
    const roots = [...RUNTIME_BASE_PACKAGES, ...bundledPluginPackages(REPO_ROOT).map((p) => p.name)];
    const closure = runtimeClosure(ws, roots);
    for (const r of roots) expect(closure).toContain(r);
    expect(closure).toContain(`${SCOPE}/pi-dashboard-shared`);
    expect(closure).not.toContain(`${SCOPE}/pi-agent-dashboard`);
    const order = publishOrder(ws, closure);
    expect(order.at(-1)).toBe(SERVER_PACKAGE);
    expect(new Set(order)).toEqual(new Set(closure));
    // Every first-party prod dep precedes its dependent.
    for (const [i, name] of order.entries()) {
      for (const dep of Object.keys(ws.get(name).manifest.dependencies ?? {})) {
        if (closure.includes(dep) && dep !== SERVER_PACKAGE) expect(order.indexOf(dep)).toBeLessThan(i);
      }
    }
  });

  it("rewrites version + first-party specs only, drops pack lifecycle scripts", () => {
    const m = rewriteManifest(
      { name: "x", version: "0.8.0", dependencies: { [`${SCOPE}/a`]: "^0.8.0", fastify: "^5" }, peerDependencies: { [`${SCOPE}/a`]: "*" }, scripts: { prepack: "x", postinstall: "y" } },
      { version: "0.8.1", workspaceNames: new Set([`${SCOPE}/a`]) },
    );
    expect(m.version).toBe("0.8.1");
    expect(m.dependencies).toEqual({ [`${SCOPE}/a`]: "0.8.1", fastify: "^5" });
    expect(m.peerDependencies).toEqual({ [`${SCOPE}/a`]: "0.8.1" });
    expect(m.scripts).toEqual({ postinstall: "y" });
  });

  it("refuses a non-loopback registry", () => {
    expect(() => assertLoopback("https://registry.npmjs.org")).toThrow(/loopback/);
    expect(() => assertLoopback("http://localhost.evil.com")).toThrow(/loopback/);
    expect(() => assertLoopback("http://localhost:4873")).not.toThrow();
  });

  it("verdaccio config keeps first-party packages local (no proxy)", () => {
    const cfg = verdaccioConfig("/tmp/s");
    const scoped = cfg.slice(cfg.indexOf("'@blackbelt-technology/*'"), cfg.indexOf("'**'"));
    expect(scoped).not.toContain("proxy");
    expect(cfg).toContain('storage: "/tmp/s"');
  });
});

describe("assert-runtime-release (test-plan #X16)", () => {
  const targets = [
    { platform: "darwin", arch: "arm64" },
    { platform: "linux", arch: "x64" },
  ];
  const assets = targets.flatMap((t) => [runtimeAssetName(V, t.platform, t.arch), `${runtimeAssetName(V, t.platform, t.arch)}.sha512`]);

  it("prerelease: assets + sha512 present, beta = X, manifest = X → no problems", () => {
    expect(checkRuntimeRelease({ version: V, prerelease: true, targets, assets, distTags: { latest: "1.2.2", beta: V }, manifestVersion: V })).toEqual([]);
  });

  it("reports a missing .sha512, a stale beta tag and a wrong manifest version", () => {
    const problems = checkRuntimeRelease({
      version: V,
      prerelease: true,
      targets,
      assets: assets.filter((a) => a !== `${runtimeAssetName(V, "linux", "x64")}.sha512`),
      distTags: { latest: "1.2.2", beta: "1.2.2" },
      manifestVersion: "1.2.2",
    });
    expect(problems.join("\n")).toContain(`${runtimeAssetName(V, "linux", "x64")}.sha512`);
    expect(problems.join("\n")).toMatch(/beta/);
    expect(problems.join("\n")).toMatch(/manifest/);
  });

  it("stable: latest must be X; beta not required", () => {
    expect(checkRuntimeRelease({ version: V, prerelease: false, targets, assets, distTags: { latest: V }, manifestVersion: V })).toEqual([]);
    expect(checkRuntimeRelease({ version: V, prerelease: false, targets, assets, distTags: { latest: "1.2.2" }, manifestVersion: V }).join()).toMatch(/latest/);
  });
});
