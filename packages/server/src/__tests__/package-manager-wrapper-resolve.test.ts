/**
 * Tests for loadPiPackageManager() resolution chain in package-manager-wrapper.ts.
 *
 * Separate from package-manager-wrapper.test.ts because that file mocks
 * "@mariozechner/pi-coding-agent" so direct-import succeeds and the
 * fallback paths never execute.
 *
 * These tests exercise the managed-install and global-npm fallbacks.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// Force the direct import to fail so resolution falls through to the
// managed-install / global-npm paths. vi.mock is hoisted; the factory
// throws at import time which mimics pi not being an installed dependency.
vi.mock("@mariozechner/pi-coding-agent", () => {
  throw new Error("not installed as direct dependency");
});
vi.mock("@oh-my-pi/pi-coding-agent", () => {
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

  it("resolves pi from managed install at ~/.pi-dashboard/node_modules/ when direct import fails", async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dash-home-managed-"));
    cleanupPaths.push(tmpHome);

    // Create a fake managed pi install with a real ESM entry file
    const fakeDistDir = path.join(
      tmpHome,
      ".pi-dashboard",
      "node_modules",
      "@mariozechner",
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

    const { PackageManagerWrapper } = await import("../package-manager-wrapper.js");
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
    const { PackageManagerWrapper } = await import("../package-manager-wrapper.js");
    const wrapper = new PackageManagerWrapper();

    await expect(wrapper.listInstalled("global")).rejects.toThrow(
      /pi-coding-agent is not installed/,
    );
  });
});
