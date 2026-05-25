import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectLegacyManagedDir } from "../legacy-managed-dir.js";

describe("legacy-managed-dir", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-managed-dir-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns present:false when directory does not exist", () => {
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res).toEqual({ present: false });
  });

  it("returns present:false when path is a file, not a directory", () => {
    fs.writeFileSync(path.join(tmpHome, ".pi-dashboard"), "garbage");
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res).toEqual({ present: false });
  });

  it("returns present:true with zero pkgCount when dir exists but has no node_modules", () => {
    fs.mkdirSync(path.join(tmpHome, ".pi-dashboard"), { recursive: true });
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present) {
      expect(res.pkgCount).toBe(0);
      expect(res.path).toContain(".pi-dashboard");
      expect(res.sizeMb).toBeGreaterThanOrEqual(0);
    }
  });

  it("counts direct children under node_modules/ as pkgCount", () => {
    const nm = path.join(tmpHome, ".pi-dashboard", "node_modules");
    fs.mkdirSync(path.join(nm, "foo"), { recursive: true });
    fs.mkdirSync(path.join(nm, "bar"), { recursive: true });
    fs.mkdirSync(path.join(nm, "@scope"), { recursive: true });
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present) expect(res.pkgCount).toBe(3);
  });

  it("computes a non-zero sizeMb when content exists", () => {
    const dir = path.join(tmpHome, ".pi-dashboard");
    fs.mkdirSync(dir, { recursive: true });
    // Write 2 MB of bytes
    fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.alloc(2 * 1024 * 1024));
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present) expect(res.sizeMb).toBeGreaterThanOrEqual(2);
  });
});
