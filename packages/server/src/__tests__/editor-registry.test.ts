import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockedExecSync, mockedSpawnSync } = vi.hoisted(() => ({
  mockedExecSync: vi.fn(),
  mockedSpawnSync: vi.fn(),
}));

// platform/process.ts and platform/tools.ts now use spawnSync via whereAllLines
// and isProcessRunning; both must be mocked to exercise the detection path in
// isolation. Default return is status:1 (not found) so each test explicitly
// overrides what it needs.
vi.mock("node:child_process", () => ({
  default: { execSync: mockedExecSync, spawnSync: mockedSpawnSync },
  execSync: mockedExecSync,
  spawnSync: mockedSpawnSync,
}));

import { detectEditors, isProcessRunning, isProcessRunningWin32, EDITORS, type DetectedEditor } from "../editor-registry.js";

describe("editor-registry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: spawnSync reports not-found so any un-overridden test still
    // sees clean state rather than stale returns from previous tests.
    mockedSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });
  });

  describe("EDITORS", () => {
    it("should have entries for zed, vscode, and idea", () => {
      expect(EDITORS).toHaveLength(3);
      expect(EDITORS.map((e) => e.id)).toEqual(["zed", "vscode", "idea"]);
    });

    it("should have win32 patterns for vscode and idea", () => {
      const vscode = EDITORS.find(e => e.id === "vscode")!;
      const idea = EDITORS.find(e => e.id === "idea")!;
      expect(vscode.processPattern.win32).toBe("Code.exe");
      expect(vscode.winCli).toBe("code.cmd");
      expect(idea.processPattern.win32).toBe("idea64.exe");
      expect(idea.winCli).toBe("idea64.exe");
    });

    it("should not have win32 pattern for zed", () => {
      const zed = EDITORS.find(e => e.id === "zed")!;
      expect(zed.processPattern.win32).toBeUndefined();
    });
  });

  describe("isProcessRunningWin32", () => {
    it("returns true when tasklist finds process", () => {
      mockedExecSync.mockReturnValue("Code.exe                     12345 Console  1  150,000 K");
      expect(isProcessRunningWin32("Code.exe")).toBe(true);
    });

    it("returns false when tasklist shows no matching process", () => {
      mockedExecSync.mockReturnValue("INFO: No tasks are running which match the specified criteria.");
      expect(isProcessRunningWin32("Code.exe")).toBe(false);
    });
  });

  describe("isProcessRunning", () => {
    it("should return true when pgrep finds matching process", () => {
      mockedExecSync.mockReturnValue(Buffer.from("12345\n"));
      expect(isProcessRunning("/Applications/Zed.app")).toBe(true);
    });

    it("should return false when pgrep finds no match", () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error("exit code 1");
      });
      expect(isProcessRunning("/Applications/Zed.app")).toBe(false);
    });

    it("should return false when pgrep is not available", () => {
      mockedExecSync.mockImplementation(() => {
        const err = new Error("command not found") as any;
        err.status = 127;
        throw err;
      });
      expect(isProcessRunning("/Applications/Zed.app")).toBe(false);
    });
  });

  describe("detectEditors", () => {
    it("should return editor when process is running AND CLI is available", () => {
      // platform/process.ts isProcessRunning uses execSync (pgrep) internally.
      mockedExecSync.mockImplementation((cmd) => {
        const s = String(cmd);
        if (s.includes("pgrep")) {
          if (s.includes("Zed") || s.includes("zed")) return Buffer.from("12345\n");
          throw new Error("not found");
        }
        throw new Error("unexpected command");
      });
      // ToolResolver.which uses spawnSync for `which`/`where` lookup.
      mockedSpawnSync.mockImplementation((cmd, args) => {
        if ((cmd === "which" || cmd === "where") && args?.[0] === "zed") {
          return { status: 0, stdout: "/usr/local/bin/zed\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      });

      const result = detectEditors("/some/project");
      expect(result).toEqual([{ id: "zed", name: "Zed" }]);
    });

    it("should return empty when process not running even if CLI available", () => {
      mockedExecSync.mockImplementation((cmd) => {
        const s = String(cmd);
        if (s.includes("pgrep")) throw new Error("not found");
        throw new Error("unexpected command");
      });
      mockedSpawnSync.mockImplementation(() => ({ status: 0, stdout: "/usr/local/bin/zed\n", stderr: "" }));

      const result = detectEditors("/some/project");
      expect(result).toEqual([]);
    });

    it("should return empty when process running but CLI not available", () => {
      mockedExecSync.mockImplementation((cmd) => {
        const s = String(cmd);
        if (s.includes("pgrep")) return Buffer.from("12345\n");
        throw new Error("unexpected command");
      });
      mockedSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });

      const result = detectEditors("/some/project");
      expect(result).toEqual([]);
    });

    it("should return multiple editors when multiple are running", () => {
      mockedExecSync.mockImplementation((cmd) => {
        const s = String(cmd);
        if (s.includes("pgrep")) {
          if (s.includes("Zed") || s.includes("zed")) return Buffer.from("12345\n");
          if (s.includes("Visual Studio Code") || s.includes("code")) return Buffer.from("67890\n");
          throw new Error("not found");
        }
        throw new Error("unexpected command");
      });
      mockedSpawnSync.mockImplementation((cmd, args) => {
        if (cmd === "which" || cmd === "where") {
          if (args?.[0] === "zed") return { status: 0, stdout: "/usr/local/bin/zed\n", stderr: "" };
          if (args?.[0] === "code") return { status: 0, stdout: "/usr/local/bin/code\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      });

      const result = detectEditors("/some/project");
      expect(result).toEqual([
        { id: "zed", name: "Zed" },
        { id: "vscode", name: "VS Code" },
      ]);
    });

    it("should return empty when no editors are running", () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = detectEditors("/some/project");
      expect(result).toEqual([]);
    });
  });
});
