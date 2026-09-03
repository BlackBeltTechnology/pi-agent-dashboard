import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectLegacyManagedDir } from "../legacy-managed-dir.js";

/**
 * Orphan-test contract (change: unify-pi-runtime-identity, task 6.2):
 * present:true + orphaned:true ONLY for a genuinely orphaned directory —
 * no `node/` runtime, no wizard state files, no non-empty `node_modules/`,
 * no `doctor.log`/`server.log`. Any live content → orphaned:false with the
 * consumers named. Absent (or a file) → present:false.
 */
describe("legacy-managed-dir", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-managed-dir-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function legacyDir(): string {
    return path.join(tmpHome, ".pi-dashboard");
  }

  it("returns present:false when directory does not exist", () => {
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res).toEqual({ present: false });
  });

  it("returns present:false when path is a file, not a directory", () => {
    fs.writeFileSync(legacyDir(), "garbage");
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res).toEqual({ present: false });
  });

  it("orphaned when the directory exists with no live consumers", () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res).toEqual({
      present: true,
      orphaned: true,
      path: legacyDir(),
      sizeMb: 0,
    });
  });

  it("stray non-consumer files do not make the directory live", () => {
    // A random leftover blob is not a live consumer — still orphaned.
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "blob.bin"), Buffer.alloc(2 * 1024 * 1024));
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present && res.orphaned === false) {
      expect(res.orphaned).toBe(true);
      expect(res.sizeMb).toBeGreaterThanOrEqual(2);
    }
  });

  it("node/ managed runtime is live content", () => {
    fs.mkdirSync(path.join(legacyDir(), "node", "bin"), { recursive: true });
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present && res.orphaned === false) {
      expect(res.orphaned).toBe(false);
      expect(res.consumers.join(" ")).toContain("managed Node runtime");
    }
  });

  it("Electron wizard state files are live content", () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "dashboard-settings.json"), "{}");
    fs.writeFileSync(path.join(legacyDir(), "recommended.json"), "{}");
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present && res.orphaned === false) {
      expect(res.orphaned).toBe(false);
      expect(res.consumers.join(" ")).toContain("wizard state");
      expect(res.consumers.join(" ")).toContain("dashboard-settings.json");
    }
  });

  it("non-empty node_modules is live content", () => {
    const nm = path.join(legacyDir(), "node_modules");
    fs.mkdirSync(path.join(nm, "foo"), { recursive: true });
    fs.mkdirSync(path.join(nm, "bar"), { recursive: true });
    fs.mkdirSync(path.join(nm, "@scope"), { recursive: true });
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present && res.orphaned === false) {
      expect(res.orphaned).toBe(false);
      expect(res.consumers.join(" ")).toContain("node_modules");
      expect(res.consumers.join(" ")).toContain("3 entries");
    }
  });

  it("empty node_modules does NOT make the directory live", () => {
    fs.mkdirSync(path.join(legacyDir(), "node_modules"), { recursive: true });
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present) expect(res.orphaned).toBe(true);
  });

  it("doctor.log and server.log are live content", () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "doctor.log"), "{}\n");
    fs.writeFileSync(path.join(legacyDir(), "server.log"), "line\n");
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present && res.orphaned === false) {
      expect(res.orphaned).toBe(false);
      expect(res.consumers.join(" ")).toContain("doctor.log");
      expect(res.consumers.join(" ")).toContain("server.log");
    }
  });

  it("names every consumer kind at once", () => {
    fs.mkdirSync(path.join(legacyDir(), "node", "bin"), { recursive: true });
    fs.mkdirSync(path.join(legacyDir(), "node_modules", "pi"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "recommended.json"), "{}");
    fs.writeFileSync(path.join(legacyDir(), "doctor.log"), "{}\n");
    const res = detectLegacyManagedDir({ homedir: tmpHome });
    expect(res.present).toBe(true);
    if (res.present && res.orphaned === false) {
      expect(res.orphaned).toBe(false);
      expect(res.consumers).toHaveLength(4);
    }
  });
});
