/**
 * Unit tests for ensureWindowsSystemPath.
 *
 * See change: fix-windows-path-system32-missing.
 */
import { describe, it, expect } from "vitest";
import { ensureWindowsSystemPath } from "../platform/ensure-windows-path.js";

const WIN_ENV_BASE = {
  SYSTEMROOT: "C:\\Windows",
  LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
};

const EXPECTED_CANDIDATES = [
  "C:\\Windows\\System32",
  "C:\\Windows",
  "C:\\Windows\\System32\\Wbem",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
  "C:\\Windows\\System32\\OpenSSH",
  "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps",
];

const allExist = () => true;
const noneExist = () => false;

describe("ensureWindowsSystemPath", () => {
  describe("non-Windows hosts", () => {
    it("returns env unchanged on darwin", () => {
      const env = { PATH: "/usr/bin:/bin" };
      const out = ensureWindowsSystemPath(env, { platform: "darwin", exists: allExist });
      expect(out).toBe(env);
    });

    it("returns env unchanged on linux", () => {
      const env = { PATH: "/usr/bin:/bin" };
      const out = ensureWindowsSystemPath(env, { platform: "linux", exists: allExist });
      expect(out).toBe(env);
    });
  });

  describe("Windows host", () => {
    it("prepends all 6 candidates when PATH empty and all exist", () => {
      const env = { ...WIN_ENV_BASE, PATH: "" };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists: allExist });
      const parts = (out.PATH ?? "").split(";").filter(Boolean);
      expect(parts).toEqual(EXPECTED_CANDIDATES);
    });

    it("does not duplicate System32 when already in PATH", () => {
      const env = {
        ...WIN_ENV_BASE,
        PATH: "C:\\foo;C:\\Windows\\System32;C:\\bar",
      };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists: allExist });
      const occurrences = (out.PATH ?? "")
        .toLowerCase()
        .split(";")
        .filter((p) => p === "c:\\windows\\system32").length;
      expect(occurrences).toBe(1);
      // Original PATH ordering preserved at the tail.
      expect(out.PATH).toContain("C:\\foo;C:\\Windows\\System32;C:\\bar");
      // Other 5 prepended.
      expect(out.PATH).toContain("C:\\Windows\\System32\\Wbem");
    });

    it("skips Wbem when it does not exist on disk", () => {
      const exists = (p: string) => !p.endsWith("Wbem");
      const env = { ...WIN_ENV_BASE, PATH: "" };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists });
      expect(out.PATH).not.toContain("Wbem");
      expect(out.PATH).toContain("C:\\Windows\\System32");
      expect(out.PATH).toContain("WindowsPowerShell");
    });

    it("returns env unchanged when no candidates exist on disk", () => {
      const env = { ...WIN_ENV_BASE, PATH: "C:\\already\\here" };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists: noneExist });
      expect(out).toBe(env);
    });

    it("is idempotent: second call adds nothing", () => {
      const env = { ...WIN_ENV_BASE, PATH: "" };
      const once = ensureWindowsSystemPath(env, { platform: "win32", exists: allExist });
      const twice = ensureWindowsSystemPath(once, { platform: "win32", exists: allExist });
      expect(twice.PATH).toBe(once.PATH);
    });

    it("treats lowercase System32 in PATH as already-present", () => {
      const env = {
        ...WIN_ENV_BASE,
        PATH: "c:\\windows\\system32;c:\\elsewhere",
      };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists: allExist });
      const lower = (out.PATH ?? "").toLowerCase();
      const occurrences = lower.split(";").filter((p) => p === "c:\\windows\\system32").length;
      expect(occurrences).toBe(1);
    });

    it("defaults SYSTEMROOT to C:\\Windows when env lacks it", () => {
      const env = { PATH: "", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists: allExist });
      expect(out.PATH).toContain("C:\\Windows\\System32");
    });

    it("skips WindowsApps when LOCALAPPDATA missing", () => {
      const env = { SYSTEMROOT: "C:\\Windows", PATH: "" };
      const out = ensureWindowsSystemPath(env, { platform: "win32", exists: allExist });
      expect(out.PATH).not.toContain("WindowsApps");
      expect(out.PATH).toContain("C:\\Windows\\System32");
    });
  });
});
