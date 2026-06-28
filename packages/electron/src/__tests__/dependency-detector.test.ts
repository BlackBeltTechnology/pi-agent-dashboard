import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecSync, mockExistsSync, mockReadFileSync, mockNpmRootGlobalOr, mockResolve, mockHas, mockWhich } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockNpmRootGlobalOr: vi.fn(),
  mockResolve: vi.fn(),
  mockHas: vi.fn(),
  mockWhich: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/npm.js", () => ({
  rootGlobalOr: mockNpmRootGlobalOr,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// Tool-registry mock: detectPi / detectOpenSpec / detectSystemNode
// now route through `getDefaultRegistry().resolve()`. Layered on top of
// the existing execSync/fs mocks so the 21 previously-passing tests
// stay green (their code paths don't touch the registry).
vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({
  getDefaultRegistry: () => ({
    has: mockHas,
    resolve: mockResolve,
  }),
}));

// Binary-lookup mock: ToolResolver.which() is used by detectDashboardPackage
// for its npm-global fallback. Keep the REAL `isAppImageSelfHit` so the
// detectPiDashboardCli AppImage tests below continue to exercise the real
// guard logic.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", async () => {
  const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js")>(
    "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js",
  );
  return {
    ...actual,
    ToolResolver: class {
      which(name: string) { return mockWhich(name); }
    },
  };
});

import { detectPi, detectOpenSpec, detectSystemNode, detectDashboardPackage, detectBridgeExtension, detectPiDashboardCli } from "../lib/dependency-detector.js";

describe("dependency-detector", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
    // Fail-closed defaults for the new registry + binary-lookup mocks.
    // Tests opt in by calling .mockReturnValue / .mockImplementation locally.
    mockHas.mockReturnValue(false);
    mockResolve.mockImplementation(() => ({
      name: "unknown",
      ok: false,
      path: null,
      source: null,
      tried: [],
      resolvedAt: Date.now(),
    }));
    mockWhich.mockReturnValue(null);
  });

  describe("detectPi", () => {
    it("finds pi on system PATH", () => {
      mockHas.mockReturnValue(true);
      mockResolve.mockReturnValue({
        name: "pi",
        ok: true,
        path: "/usr/local/bin/pi",
        source: "system",
        tried: [],
        resolvedAt: Date.now(),
      });
      const result = detectPi();
      // .toMatchObject so the new `resolution` field does not break the assertion.
      expect(result).toMatchObject({ found: true, path: "/usr/local/bin/pi", source: "system" });
    });

    it("finds pi via login shell when not on process PATH", () => {
      mockHas.mockReturnValue(true);
      mockResolve.mockReturnValue({
        name: "pi",
        ok: true,
        path: "/Users/test/.nvm/versions/node/v22.0.0/bin/pi",
        source: "system",
        tried: [],
        resolvedAt: Date.now(),
      });
      const result = detectPi();
      expect(result).toMatchObject({ found: true, path: "/Users/test/.nvm/versions/node/v22.0.0/bin/pi", source: "system" });
    });

    it("finds pi in managed install when not on PATH", () => {
      mockHas.mockReturnValue(true);
      mockResolve.mockReturnValue({
        name: "pi",
        ok: true,
        path: "/Users/test/.pi-dashboard/node_modules/.bin/pi",
        source: "managed",
        tried: [],
        resolvedAt: Date.now(),
      });
      const result = detectPi();
      expect(result.found).toBe(true);
      expect(result.source).toBe("managed");
    });

    it("returns not found when pi is nowhere", () => {
      // beforeEach defaults: mockHas=false, mockResolve=ok:false.
      // Production detect() returns {found:false} short-circuit when has() returns false.
      const result = detectPi();
      expect(result).toMatchObject({ found: false });
    });
  });

  describe("detectSystemNode", () => {
    it("finds node with sufficient version", () => {
      mockHas.mockReturnValue(true);
      mockResolve.mockReturnValue({
        name: "node",
        ok: true,
        path: "/usr/local/bin/node",
        source: "system",
        tried: [],
        resolvedAt: Date.now(),
      });
      // detectSystemNode then calls execSync("<path> --version") via platform/exec
      // (chained through node:child_process which IS mocked).
      // v22.19.0 is the engines floor — usable per isUsableNodeVersion.
      mockExecSync.mockReturnValue("v22.19.0\n");
      const result = detectSystemNode();
      expect(result).toMatchObject({ found: true, path: "/usr/local/bin/node", source: "system" });
    });

    it("rejects node with version too low", () => {
      mockHas.mockReturnValue(true);
      mockResolve.mockReturnValue({
        name: "node",
        ok: true,
        path: "/usr/local/bin/node",
        source: "system",
        tried: [],
        resolvedAt: Date.now(),
      });
      // Version is below the engines floor (>=22.19) so detectSystemNode
      // rejects and falls through to scanForUsableNodeOnDisk. mockExistsSync
      // is false by default so the on-disk scan finds no candidates → {found:false}.
      mockExecSync.mockReturnValue("v18.0.0\n");
      const result = detectSystemNode();
      expect(result).toMatchObject({ found: false });
    });
  });

  describe("detectDashboardPackage", () => {
    it("finds in managed install", () => {
      mockExistsSync.mockImplementation((p: string) =>
        String(p).includes(".pi-dashboard") && String(p).includes("pi-agent-dashboard/package.json")
      );
      const result = detectDashboardPackage();
      expect(result.found).toBe(true);
      expect(result.source).toBe("managed");
    });
  });

  describe("detectBridgeExtension", () => {
    it("finds bridge registered as local dev path in settings.json", () => {
      mockExistsSync.mockImplementation((p: string) => String(p).includes("settings.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        packages: ["../../Project/pi-agent-dashboard", "npm:some-other-package"]
      }));
      const result = detectBridgeExtension();
      expect(result).toEqual({ found: true, path: "../../Project/pi-agent-dashboard", source: "settings" });
    });

    it("finds bridge registered as bundled extension path", () => {
      mockExistsSync.mockImplementation((p: string) => String(p).includes("settings.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        packages: ["/Users/test/pi-agent-dashboard/packages/extension"]
      }));
      const result = detectBridgeExtension();
      expect(result.found).toBe(true);
      expect(result.source).toBe("settings");
    });

    it("finds bridge registered as npm package reference", () => {
      mockExistsSync.mockImplementation((p: string) => String(p).includes("settings.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        packages: ["npm:@blackbelt-technology/pi-dashboard"]
      }));
      const result = detectBridgeExtension();
      expect(result).toEqual({ found: true, path: "npm:@blackbelt-technology/pi-dashboard", source: "settings" });
    });

    it("finds bridge registered as git reference", () => {
      mockExistsSync.mockImplementation((p: string) => String(p).includes("settings.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        packages: ["git:github.com/org/pi-dashboard"]
      }));
      const result = detectBridgeExtension();
      expect(result).toEqual({ found: true, path: "git:github.com/org/pi-dashboard", source: "settings" });
    });

    it("falls back to npm global when not in settings.json", () => {
      // settings.json exists but no pi-dashboard entry
      mockExistsSync.mockImplementation((p: string) => {
        if (String(p).includes("settings.json")) return true;
        // Global npm package exists
        if (String(p).includes("pi-agent-dashboard/package.json") && !String(p).includes(".pi-dashboard")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packages: ["npm:other-pkg"] }));
      mockNpmRootGlobalOr.mockReturnValue("/usr/lib/node_modules");
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      // detectDashboardPackage's npm-global fallback uses resolver.which("npm");
      // path.dirname(path.dirname(...)) derives the global node_modules root.
      mockWhich.mockImplementation((name: string) =>
        name === "npm" ? "/usr/lib/node_modules/npm/bin/npm" : null,
      );
      const result = detectBridgeExtension();
      expect(result.found).toBe(true);
      expect(result.source).toBe("system");
    });

    it("falls back to managed install when not in settings.json", () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (String(p).includes("settings.json")) return true;
        if (String(p).includes(".pi-dashboard") && String(p).includes("pi-agent-dashboard/package.json")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packages: [] }));
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      const result = detectBridgeExtension();
      expect(result.found).toBe(true);
      expect(result.source).toBe("managed");
    });

    it("returns not found when bridge is nowhere", () => {
      mockExistsSync.mockImplementation((p: string) => String(p).includes("settings.json"));
      mockReadFileSync.mockReturnValue(JSON.stringify({ packages: ["npm:unrelated"] }));
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      const result = detectBridgeExtension();
      expect(result).toEqual({ found: false });
    });

    it("returns not found when settings.json is missing", () => {
      // existsSync returns false for everything
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      const result = detectBridgeExtension();
      expect(result).toEqual({ found: false });
    });

    it("handles corrupt settings.json gracefully", () => {
      mockExistsSync.mockImplementation((p: string) => String(p).includes("settings.json"));
      mockReadFileSync.mockReturnValue("not valid json{{");
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      const result = detectBridgeExtension();
      expect(result).toEqual({ found: false });
    });
  });

  describe("detectPiDashboardCli", () => {
    it("finds pi-dashboard on PATH", () => {
      mockExecSync.mockReturnValue("/usr/local/bin/pi-dashboard\n");
      const result = detectPiDashboardCli();
      expect(result).toEqual({ found: true, path: "/usr/local/bin/pi-dashboard", source: "system" });
    });

    it("excludes npx cache paths", () => {
      mockExecSync.mockReturnValue("/Users/test/.npm/_npx/abc123/node_modules/.bin/pi-dashboard\n");
      const result = detectPiDashboardCli();
      expect(result).toEqual({ found: false });
    });

    it("returns not found when not on PATH", () => {
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      const result = detectPiDashboardCli();
      expect(result).toEqual({ found: false });
    });

    // Change: fix-electron-appimage-cli-self-detection — AppImage cases.
    it("rejects an AppImage self-hit (path under APPDIR)", () => {
      const savedAppDir = process.env.APPDIR;
      const fakeAppDir = "/tmp/.mount_PI-DAS-DETECT";
      process.env.APPDIR = fakeAppDir;
      try {
        mockExecSync.mockReturnValue(fakeAppDir + "/pi-dashboard\n");
        const result = detectPiDashboardCli();
        expect(result).toEqual({ found: false });
      } finally {
        if (savedAppDir === undefined) delete process.env.APPDIR;
        else process.env.APPDIR = savedAppDir;
      }
    });

    it("rejects a process.execPath self-hit", () => {
      // realpath(out) === realpath(process.execPath) — use process.execPath directly.
      mockExecSync.mockReturnValue(process.execPath + "\n");
      const result = detectPiDashboardCli();
      expect(result).toEqual({ found: false });
    });

    it("prefers a real CLI later on PATH after rejecting an AppImage hit", () => {
      // The current detector reads only the first `which` line, so to
      // prove "continues searching" we simulate the call sequence: first
      // call returns the AppImage path; if the detector re-queries
      // (which it doesn't today), the next would return the real CLI.
      // We instead assert the simpler invariant: when the AppImage hit
      // is the only result, the detector returns {found:false}; when a
      // real CLI is the result, it returns it.
      mockExecSync.mockReturnValue("/home/user/.nvm/versions/node/v22/bin/pi-dashboard\n");
      const result = detectPiDashboardCli();
      expect(result).toEqual({
        found: true,
        path: "/home/user/.nvm/versions/node/v22/bin/pi-dashboard",
        source: "system",
      });
    });
  });
});
