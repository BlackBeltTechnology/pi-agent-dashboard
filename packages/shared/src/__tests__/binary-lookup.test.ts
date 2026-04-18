/**
 * Unit tests for ToolResolver.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";

const { mockExecSync, mockExistsSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execSync: mockExecSync }));
vi.mock("node:fs", () => ({ existsSync: mockExistsSync }));

import { ToolResolver } from "../platform/binary-lookup.js";

const MANAGED_BIN = path.join(os.homedir(), ".pi-dashboard", "node_modules", ".bin");

// On Windows, ToolResolver.which() appends ".cmd" to the binary name when
// probing managed bin / extra dirs (shim convention for npm-installed bins).
// Unix has no extension. Tests must mirror this so assertions line up with
// what the implementation actually queries.
const BIN_EXT = process.platform === "win32" ? ".cmd" : "";

describe("ToolResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error("not found"); });
  });

  describe("which()", () => {
    it("finds binary in managed bin first", () => {
      const managedPi = path.join(MANAGED_BIN, "pi" + BIN_EXT);
      mockExistsSync.mockImplementation((p: string) => p === managedPi);

      const resolver = new ToolResolver();
      expect(resolver.which("pi")).toBe(managedPi);
    });

    it("finds binary in extra bin dirs before system PATH", () => {
      const extraDir = "/custom/bin";
      const extraPi = path.join(extraDir, "pi" + BIN_EXT);
      mockExistsSync.mockImplementation((p: string) => p === extraPi);

      const resolver = new ToolResolver({ extraBinDirs: [extraDir] });
      expect(resolver.which("pi")).toBe(extraPi);
    });

    it("falls back to system PATH via which/where", () => {
      // Resolver uses `where` on Windows, `which` on Unix.
      const lookupCmd = process.platform === "win32" ? "where pi" : "which pi";
      const expected = process.platform === "win32" ? "C:\\Windows\\pi.exe" : "/usr/bin/pi";
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes(lookupCmd)) return expected + "\n";
        throw new Error("not found");
      });

      const resolver = new ToolResolver();
      expect(resolver.which("pi")).toBe(expected);
    });

    it("tries login shell when enabled and PATH fails", () => {
      // Regular which fails
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("-ilc")) return "/nvm/bin/pi\n";
        throw new Error("not found");
      });

      const resolver = new ToolResolver({ useLoginShell: true });
      // On win32 login shell is skipped — test on non-win32 only
      if (process.platform !== "win32") {
        expect(resolver.which("pi")).toBe("/nvm/bin/pi");
      }
    });

    it("returns null when binary not found anywhere", () => {
      const resolver = new ToolResolver();
      expect(resolver.which("nonexistent")).toBeNull();
    });
  });

  describe("resolvePi()", () => {
    it("returns [path] for Unix managed pi", () => {
      const managedPi = path.join(MANAGED_BIN, "pi");
      mockExistsSync.mockImplementation((p: string) => p === managedPi);

      const resolver = new ToolResolver();
      if (process.platform !== "win32") {
        expect(resolver.resolvePi()).toEqual([managedPi]);
      }
    });

    it("returns null when pi not found", () => {
      const resolver = new ToolResolver();
      expect(resolver.resolvePi()).toBeNull();
    });
  });

  describe("resolveTsx()", () => {
    it("returns [path] for managed tsx", () => {
      const managedTsx = path.join(MANAGED_BIN, "tsx");
      mockExistsSync.mockImplementation((p: string) => p === managedTsx);

      const resolver = new ToolResolver();
      if (process.platform !== "win32") {
        expect(resolver.resolveTsx()).toEqual([managedTsx]);
      }
    });

    it("returns null when tsx not found", () => {
      const resolver = new ToolResolver();
      expect(resolver.resolveTsx()).toBeNull();
    });
  });

  describe("resolveNode()", () => {
    it("returns processExecPath when provided", () => {
      const resolver = new ToolResolver({ processExecPath: "/usr/bin/node" });
      expect(resolver.resolveNode()).toBe("/usr/bin/node");
    });

    it("finds node in extra bin dirs", () => {
      const extraDir = "/bundled/bin";
      const nodeName = process.platform === "win32" ? "node.exe" : "node";
      const nodePath = path.join(extraDir, nodeName);
      mockExistsSync.mockImplementation((p: string) => p === nodePath);

      const resolver = new ToolResolver({ extraBinDirs: [extraDir] });
      expect(resolver.resolveNode()).toBe(nodePath);
    });

    it("falls back to which(node) when no context paths", () => {
      const managedNode = path.join(MANAGED_BIN, "node" + BIN_EXT);
      mockExistsSync.mockImplementation((p: string) => p === managedNode);

      const resolver = new ToolResolver();
      expect(resolver.resolveNode()).toBe(managedNode);
    });
  });

  describe("buildSpawnEnv()", () => {
    it("prepends managed bin to PATH", () => {
      const resolver = new ToolResolver();
      const env = resolver.buildSpawnEnv({ PATH: "/usr/bin" });
      expect(env.PATH).toContain(MANAGED_BIN);
      expect(env.PATH).toContain("/usr/bin");
      // Managed bin should come before /usr/bin
      expect(env.PATH!.indexOf(MANAGED_BIN)).toBeLessThan(env.PATH!.indexOf("/usr/bin"));
    });

    it("does not duplicate managed bin if already present", () => {
      const resolver = new ToolResolver();
      // Use the platform's PATH delimiter (`;` on Windows, `:` on Unix) so
      // MANAGED_BIN is parsed as its own PATH entry — otherwise on Windows
      // `${MANAGED_BIN}:/usr/bin` is treated as one single (broken) path.
      const existingPath = [MANAGED_BIN, "/usr/bin"].join(path.delimiter);
      const env = resolver.buildSpawnEnv({ PATH: existingPath });
      const count = env.PATH!.split(path.delimiter).filter(p => p === MANAGED_BIN).length;
      expect(count).toBe(1);
    });

    it("includes processExecPath dir", () => {
      const resolver = new ToolResolver({ processExecPath: "/custom/node/bin/node" });
      const env = resolver.buildSpawnEnv({ PATH: "/usr/bin" });
      expect(env.PATH).toContain("/custom/node/bin");
    });

    it("includes extra bin dirs", () => {
      const resolver = new ToolResolver({ extraBinDirs: ["/extra/one", "/extra/two"] });
      const env = resolver.buildSpawnEnv({ PATH: "/usr/bin" });
      expect(env.PATH).toContain("/extra/one");
      expect(env.PATH).toContain("/extra/two");
    });
  });
});
