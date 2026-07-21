import { describe, expect, it } from "vitest";
import { isAbsolutePath, normalizeUnderCwd, toPosix } from "../session-rel-path.js";

describe("isAbsolutePath", () => {
  it("detects posix absolute", () => {
    expect(isAbsolutePath("/repo/src/a.ts")).toBe(true);
  });
  it("detects windows drive absolute", () => {
    expect(isAbsolutePath("C:\\repo\\src\\a.ts")).toBe(true);
    expect(isAbsolutePath("C:/repo/src/a.ts")).toBe(true);
  });
  it("detects relative", () => {
    expect(isAbsolutePath("src/a.ts")).toBe(false);
    expect(isAbsolutePath("./src/a.ts")).toBe(false);
  });
});

describe("toPosix", () => {
  it("converts backslashes and strips trailing slash", () => {
    expect(toPosix("C:\\repo\\src\\")).toBe("C:/repo/src");
  });
});

describe("normalizeUnderCwd", () => {
  it("rewrites absolute under cwd to relative-posix", () => {
    expect(normalizeUnderCwd("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("leaves already-relative unchanged (strips ./)", () => {
    expect(normalizeUnderCwd("src/a.ts", "/repo")).toBe("src/a.ts");
    expect(normalizeUnderCwd("./src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("leaves absolute outside cwd unchanged", () => {
    expect(normalizeUnderCwd("/other/x.ts", "/repo")).toBe("/other/x.ts");
  });

  it("handles Windows seps under cwd (case-insensitive drive)", () => {
    expect(normalizeUnderCwd("C:\\Repo\\src\\a.ts", "c:/Repo")).toBe("src/a.ts");
  });

  it("no cwd → posix only", () => {
    expect(normalizeUnderCwd("C:\\Repo\\src\\a.ts")).toBe("C:/Repo/src/a.ts");
  });

  it("exact cwd match → .", () => {
    expect(normalizeUnderCwd("/repo", "/repo")).toBe(".");
  });
});
