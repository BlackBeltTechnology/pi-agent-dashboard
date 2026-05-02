/**
 * Pin Defect 3's "filter `where` output for executable extensions on Windows" rule.
 * Tests the pure `pickSpawnableShim()` helper extracted from
 * `detectPiDashboardCli()`. See change:
 * fix-electron-windows-installer-and-server-bootstrap (Defect 3 / D5).
 */
import { describe, it, expect } from "vitest";
import { pickSpawnableShim } from "../lib/dependency-detector.js";

describe("pickSpawnableShim", () => {
  it("returns null for empty output", () => {
    expect(pickSpawnableShim("", "win32")).toBeNull();
    expect(pickSpawnableShim("   \n  ", "win32")).toBeNull();
    expect(pickSpawnableShim("", "linux")).toBeNull();
  });

  describe("Windows", () => {
    it("picks the .cmd shim when extensionless precedes it (the Defect 3 scenario)", () => {
      const out = [
        "B:\\Dev\\Nodejs\\global\\pi-dashboard",
        "B:\\Dev\\Nodejs\\global\\pi-dashboard.cmd",
      ].join("\r\n");
      expect(pickSpawnableShim(out, "win32")).toBe(
        "B:\\Dev\\Nodejs\\global\\pi-dashboard.cmd",
      );
    });

    it("picks an executable-extension match even if the extensionless one has the same dir", () => {
      const out = [
        "C:\\Users\\me\\pi-dashboard",
        "C:\\Users\\me\\pi-dashboard.cmd",
        "C:\\Users\\me\\pi-dashboard.ps1",
      ].join("\r\n");
      // First match wins among executable extensions; the .cmd line comes first.
      expect(pickSpawnableShim(out, "win32")).toBe("C:\\Users\\me\\pi-dashboard.cmd");
    });

    it("supports .exe and .bat as well", () => {
      expect(
        pickSpawnableShim(
          ["C:\\foo\\bar", "C:\\foo\\bar.exe"].join("\n"),
          "win32",
        ),
      ).toBe("C:\\foo\\bar.exe");
      expect(
        pickSpawnableShim(
          ["C:\\foo\\bar", "C:\\foo\\bar.bat"].join("\n"),
          "win32",
        ),
      ).toBe("C:\\foo\\bar.bat");
    });

    it("falls back to lines[0] when no candidate has a recognised executable extension", () => {
      const out = [
        "C:\\foo\\pi-dashboard",
        "C:\\foo\\pi-dashboard.weird",
      ].join("\n");
      expect(pickSpawnableShim(out, "win32")).toBe("C:\\foo\\pi-dashboard");
    });

    it("returns the single line when only one is present", () => {
      expect(pickSpawnableShim("C:\\foo\\pi-dashboard.cmd", "win32")).toBe(
        "C:\\foo\\pi-dashboard.cmd",
      );
      expect(pickSpawnableShim("C:\\foo\\pi-dashboard", "win32")).toBe(
        "C:\\foo\\pi-dashboard",
      );
    });

    it("matches case-insensitively (.CMD, .EXE)", () => {
      const out = ["C:\\foo\\bar", "C:\\foo\\bar.CMD"].join("\n");
      expect(pickSpawnableShim(out, "win32")).toBe("C:\\foo\\bar.CMD");
    });
  });

  describe("POSIX", () => {
    it("returns the first line regardless of extensions (linux)", () => {
      // POSIX `which` returns at most one line; ensuring no Windows-style filter is applied.
      const out = "/usr/local/bin/pi-dashboard";
      expect(pickSpawnableShim(out, "linux")).toBe("/usr/local/bin/pi-dashboard");
    });

    it("returns the first line regardless of extensions (darwin)", () => {
      const out = "/Users/me/.local/bin/pi-dashboard";
      expect(pickSpawnableShim(out, "darwin")).toBe(
        "/Users/me/.local/bin/pi-dashboard",
      );
    });

    it("does NOT prefer .cmd on POSIX (no extension-aware filter)", () => {
      // Hypothetical multi-line output on POSIX. lines[0] wins regardless of
      // what extensions are present.
      const out = ["/foo/pi-dashboard", "/foo/pi-dashboard.cmd"].join("\n");
      expect(pickSpawnableShim(out, "linux")).toBe("/foo/pi-dashboard");
    });
  });
});
