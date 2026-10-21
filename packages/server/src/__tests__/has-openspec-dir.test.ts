/**
 * Unit tests for `hasOpenSpecDir` — synchronous spawn-free probe used by
 * the WS on-connect snapshot to disambiguate "no openspec here" from
 * "openspec here, polling pending".
 *
 * See change: fix-cold-boot-openspec-protocol.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasOpenSpecDir } from "../directory-service.js";

describe("hasOpenSpecDir", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "has-openspec-dir-"));
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns true when <cwd>/openspec/changes exists as a directory", () => {
    fs.mkdirSync(path.join(tmp, "openspec", "changes"), { recursive: true });
    expect(hasOpenSpecDir(tmp)).toBe(true);
  });

  it("returns false when openspec dir is absent (ENOENT)", () => {
    expect(hasOpenSpecDir(tmp)).toBe(false);
  });

  it("returns false when openspec exists but openspec/changes does not", () => {
    fs.mkdirSync(path.join(tmp, "openspec"));
    expect(hasOpenSpecDir(tmp)).toBe(false);
  });

  it("returns false when openspec/changes is a regular file, not a directory", () => {
    fs.mkdirSync(path.join(tmp, "openspec"));
    fs.writeFileSync(path.join(tmp, "openspec", "changes"), "not a dir");
    expect(hasOpenSpecDir(tmp)).toBe(false);
  });

  it("returns false when openspec/changes is a symlink to a non-directory", () => {
    fs.mkdirSync(path.join(tmp, "openspec"));
    const target = path.join(tmp, "target.txt");
    fs.writeFileSync(target, "x");
    fs.symlinkSync(target, path.join(tmp, "openspec", "changes"));
    expect(hasOpenSpecDir(tmp)).toBe(false);
  });

  it("returns true when openspec/changes is a symlink to a directory", () => {
    fs.mkdirSync(path.join(tmp, "openspec"));
    const target = path.join(tmp, "target-dir");
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(tmp, "openspec", "changes"));
    expect(hasOpenSpecDir(tmp)).toBe(true);
  });

  it("returns false for a non-existent cwd", () => {
    expect(hasOpenSpecDir("/this/path/does/not/exist/__nope__")).toBe(false);
  });
});
