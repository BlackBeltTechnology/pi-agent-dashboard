/**
 * Tests for loadPiPackageManager() resolution chain in package-manager-wrapper.ts.
 *
 * Separate from package-manager-wrapper.test.ts because that file mocks
 * "@earendil-works/pi-coding-agent" so direct-import succeeds and the
 * fallback paths never execute.
 *
 * These tests exercise the managed-install and global-npm fallbacks.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  OverridesStore,
  registerDefaultTools,
  ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

// Force the direct import to fail so resolution falls through to the
// managed-install / global-npm paths. vi.mock is hoisted; the factory
// throws at import time which mimics pi not being an installed dependency.
vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("not installed as direct dependency");
});

/** Override os.homedir() by setting the env vars libuv reads. */
function withHome(tmpHome: string): () => void {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  return () => {
    if (prev.HOME === undefined) delete process.env.HOME; else process.env.HOME = prev.HOME;
    if (prev.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prev.USERPROFILE;
  };
}

describe("loadPiPackageManager resolution chain", () => {
  const cleanupPaths: string[] = [];
  const restoreFns: Array<() => void> = [];

  afterEach(() => {
    for (const r of restoreFns) r();
    restoreFns.length = 0;
    vi.restoreAllMocks();
    vi.resetModules();
    for (const p of cleanupPaths) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanupPaths.length = 0;
  });

  // SKIPPED: bareImportStrategy now ships a filesystem dir-walk fallback
  // for packages whose exports map omits the `"require"` condition
  // (@earendil-works/pi-* — live repro: /api/packages/installed broken).
  // Consequence: from any test cwd inside this repo the walk finds the
  // real `node_modules/@earendil-works/pi-coding-agent/package.json` and
  // bare-import succeeds before the managed slot runs. Same condition as
  // the sibling test below; proper fix requires an injectable registry
  // entry-point in package-manager-wrapper.ts (tracked alongside the
  // sibling's Phase 4 platform/ consolidation note).
  // See change: fix-node-resolution-under-electron (follow-up).
  it.skip("resolves pi from managed install at ~/.pi-dashboard/node_modules/ when direct import fails", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dash-home-managed-"));
    cleanupPaths.push(tmpHome);

    // Create a fake managed pi install with a real ESM entry file
    const fakeDistDir = path.join(
      tmpHome,
      ".pi-dashboard",
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
    );
    fs.mkdirSync(fakeDistDir, { recursive: true });
    fs.writeFileSync(
      path.join(fakeDistDir, "index.js"),
      [
        "export function DefaultPackageManager() {",
        "  return {",
        "    listConfiguredPackages: () => [{ source: 'npm:from-managed', scope: 'user', filtered: false }],",
        "  };",
        "}",
        "export const SettingsManager = { create: () => ({}) };",
      ].join("\n"),
    );

    restoreFns.push(withHome(tmpHome));
    expect(os.homedir()).toBe(tmpHome);
    vi.resetModules();

    const { PackageManagerWrapper } = await import("../package/package-manager-wrapper.js");
    const wrapper = new PackageManagerWrapper();
    const result = await wrapper.listInstalled("global");

    expect(result).toEqual([
      { source: "npm:from-managed", scope: "user", filtered: false },
    ]);
  });

  it.skip("falls through to global npm without crashing when managed install is absent", async () => {
    // SKIPPED: post ToolRegistry refactor, bareImportStrategy resolves pi-coding-agent
    // from the dev node_modules regardless of HOME override. Needs a more invasive
    // test-registry injection to genuinely simulate 'all paths empty'. Tracked as
    // part of the Phase 4 platform/ consolidation work.
    // tmp home with NO ~/.pi-dashboard directory -> managed resolution must
    // silently fail and continue to the global-npm path.
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dash-home-empty-"));
    cleanupPaths.push(tmpHome);

    restoreFns.push(withHome(tmpHome));
    expect(os.homedir()).toBe(tmpHome);

    // Stub execSync so `npm root -g` returns a directory where pi is also
    // absent. With direct-import + managed + global all missing, the
    // function must surface the final "pi-coding-agent is not installed"
    // error — proving the managed block didn't throw early.
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        execSync: vi.fn(() => tmpHome), // no pi inside tmpHome
      };
    });

    vi.resetModules();
    const { PackageManagerWrapper } = await import("../package/package-manager-wrapper.js");
    const wrapper = new PackageManagerWrapper();

    await expect(wrapper.listInstalled("global")).rejects.toThrow(
      /pi-coding-agent is not installed/,
    );
  });
});

// E12 / E13 — module resolution is earendil-only. The wrapper's injectable
// registry is the seam: real fs under a tmp home + npm root, bare-import
// disabled so the repo's own node_modules never leaks in.
// See change: drop-mariozechner-pi-fork (test-plan #E12, #E13).
describe("loadPiPackageManager resolves the earendil package only", () => {
  const FAKE_PM = [
    "export class DefaultPackageManager {",
    "  constructor() {}",
    "  listConfiguredPackages() { return [{ source: 'npm:from-earendil', scope: 'user', filtered: false }]; }",
    "}",
    "export const SettingsManager = { create: () => ({}) };",
  ].join("\n");

  function writePi(root: string, scope: string): void {
    const dist = path.join(root, scope, "pi-coding-agent", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.js"), FAKE_PM);
    fs.writeFileSync(path.join(dist, "cli.js"), "");
    fs.writeFileSync(
      path.join(root, scope, "pi-coding-agent", "package.json"),
      JSON.stringify({ name: `${scope}/pi-coding-agent`, version: "1.0.0", type: "module" }),
    );
  }

  function makeRegistry(home: string, npmRoot: string, probed: string[]): ToolRegistry {
    const r = new ToolRegistry({
      overrides: new OverridesStore({
        filePath: path.join(home, "tool-overrides.json"),
        warn: () => {},
      }),
      platform: "linux",
      env: { homedir: home },
    });
    registerDefaultTools(r, {
      exists: (p) => {
        probed.push(p);
        return fs.existsSync(p);
      },
      which: () => null,
      npmRootGlobal: () => npmRoot,
      resolveModule: (id) => {
        probed.push(id);
        return null;
      },
    });
    return r;
  }

  function tmp(prefix: string): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  }

  it("E12: a fork-only machine (managed + npm-global) rejects with 'pi-coding-agent is not installed'", async () => {
    const home = tmp("pi-dash-fork-only-home-");
    const npmRoot = tmp("pi-dash-fork-only-npm-");
    writePi(path.join(home, ".pi-dashboard", "node_modules"), "@mariozechner");
    writePi(npmRoot, "@mariozechner");
    const probed: string[] = [];
    const { PackageManagerWrapper } = await import("../package/package-manager-wrapper.js");
    const wrapper = new PackageManagerWrapper(makeRegistry(home, npmRoot, probed));
    await expect(wrapper.listInstalled("global")).rejects.toThrow(/pi-coding-agent is not installed/);
    await expect(wrapper.listInstalled("global")).rejects.toThrow(/@earendil-works\/pi-coding-agent/);
  });

  it("E13: with both installed in managed, earendil wins and the fork is never probed", async () => {
    const home = tmp("pi-dash-both-home-");
    const managed = path.join(home, ".pi-dashboard", "node_modules");
    writePi(managed, "@earendil-works");
    writePi(managed, "@mariozechner");
    const probed: string[] = [];
    const { PackageManagerWrapper } = await import("../package/package-manager-wrapper.js");
    const wrapper = new PackageManagerWrapper(makeRegistry(home, tmp("pi-dash-both-npm-"), probed));
    const result = await wrapper.listInstalled("global");
    expect(result).toEqual([{ source: "npm:from-earendil", scope: "user", filtered: false }]);
    expect(probed.filter((p) => p.includes("@mariozechner"))).toEqual([]);
  });
});
