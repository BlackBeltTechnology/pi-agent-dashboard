/**
 * Unit tests for normalizeEnvPathKey — collapse every case-variant of the
 * PATH key into a single `PATH` on win32 (Node's win32 spawn keeps only the
 * first of case-duplicate keys, and `"PATH" < "Path"`).
 *
 * See change: fix-windows-path-env-key-casing (#720).
 */
import { describe, expect, it } from "vitest";
import { normalizeEnvPathKey } from "../platform/env-path-key.js";

const pathKeys = (env: NodeJS.ProcessEnv) => Object.keys(env).filter((k) => k.toUpperCase() === "PATH");

describe("normalizeEnvPathKey", () => {
  it("E1: renames a lone Path to PATH on win32", () => {
    const input = { Path: "C:\\a", FOO: "1" };
    const out = normalizeEnvPathKey(input, "win32");
    expect(out).not.toBe(input);
    expect(out).toEqual({ PATH: "C:\\a", FOO: "1" });
    expect("Path" in out).toBe(false);
  });

  it("E2: merges PATH + Path variants, PATH first, de-duped", () => {
    const out = normalizeEnvPathKey(
      { PATH: "C:\\managed", Path: "C:\\managed;C:\\Program Files\\Git\\cmd" },
      "win32",
    );
    expect(out.PATH).toBe("C:\\managed;C:\\Program Files\\Git\\cmd");
    expect(pathKeys(out)).toEqual(["PATH"]);
  });

  it("E3: de-dups entries case-insensitively (first seen wins)", () => {
    const out = normalizeEnvPathKey({ Path: "C:\\Windows\\System32;c:\\windows\\system32" }, "win32");
    expect(out.PATH).toBe("C:\\Windows\\System32");
  });

  it("E4: ignores an undefined variant", () => {
    const input = { Path: undefined, PATH: "C:\\a" };
    const out = normalizeEnvPathKey(input, "win32");
    expect(out.PATH).toBe("C:\\a");
    expect("Path" in out).toBe(false);
  });

  it("E5: an undefined-only variant leaves no PATH-like key", () => {
    const out = normalizeEnvPathKey({ Path: undefined, FOO: "1" }, "win32");
    expect(pathKeys(out)).toEqual([]);
    expect(out.FOO).toBe("1");
  });

  it("E6: an empty-string-only variant becomes PATH = \"\"", () => {
    expect(normalizeEnvPathKey({ Path: "" }, "win32")).toEqual({ PATH: "" });
  });

  it("E7: no variant returns the same object", () => {
    const input = { FOO: "1" };
    expect(normalizeEnvPathKey(input, "win32")).toBe(input);
  });

  it("E8: already-normalized input returns the same object (idempotent)", () => {
    const input = { PATH: "C:\\a" };
    expect(normalizeEnvPathKey(input, "win32")).toBe(input);
    const merged = normalizeEnvPathKey(
      { PATH: "C:\\managed", Path: "C:\\managed;C:\\Program Files\\Git\\cmd" },
      "win32",
    );
    expect(normalizeEnvPathKey(merged, "win32")).toBe(merged);
  });

  it("E9: POSIX platforms are untouched", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const input = { PATH: "/usr/bin", Path: "/opt/x" };
      const out = normalizeEnvPathKey(input, platform);
      expect(out).toBe(input);
      expect(out).toEqual({ PATH: "/usr/bin", Path: "/opt/x" });
    }
  });

  it("E10: orders variants PATH first, then the rest sorted", () => {
    const out = normalizeEnvPathKey({ path: "C:\\c", Path: "C:\\b", PATH: "C:\\a" }, "win32");
    expect(out.PATH).toBe("C:\\a;C:\\b;C:\\c");
    expect(pathKeys(out)).toEqual(["PATH"]);
  });

  it("E11: drops empty entries", () => {
    expect(normalizeEnvPathKey({ Path: ";;C:\\a;" }, "win32").PATH).toBe("C:\\a");
  });

  it("E12: never mutates the input", () => {
    const input = Object.freeze({ Path: "C:\\a", PATH: "C:\\b" });
    const out = normalizeEnvPathKey(input, "win32");
    expect(out).not.toBe(input);
    expect(input.Path).toBe("C:\\a");
    expect(input.PATH).toBe("C:\\b");
    expect(out.PATH).toBe("C:\\b;C:\\a");
  });
});
