import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeRealpathSync } from "../resolve-path.js";

describe("safeRealpathSync", () => {
  it("resolves a real path", () => {
    // process.cwd() is always a real path
    const result = safeRealpathSync(process.cwd());
    expect(result).toBe(fs.realpathSync(process.cwd()));
  });

  it("falls back to original when path does not exist", () => {
    const fakePath = "/nonexistent/path/that/does/not/exist";
    const result = safeRealpathSync(fakePath);
    expect(result).toBe(fakePath);
  });

  it("resolves symlinks", () => {
    const os = require("node:os");
    const path = require("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-test-"));
    const realDir = path.join(tmpDir, "real");
    const linkDir = path.join(tmpDir, "link");

    const realTmpDir = fs.realpathSync(tmpDir);
    const target = path.join(realTmpDir, "real");
    const link = path.join(realTmpDir, "link");

    fs.mkdirSync(target);
    fs.symlinkSync(target, link);

    try {
      expect(safeRealpathSync(link)).toBe(target);
    } finally {
      fs.rmSync(realTmpDir, { recursive: true });
    }
  });
});
