/**
 * Tests for OverridesStore (packages/shared/src/tool-registry/overrides.ts).
 *
 * Covered scenarios:
 *   - Absent file → empty map
 *   - Malformed file → warn + empty map
 *   - set/clear round-trip with atomic write
 *   - File schema shape (version + overrides[name].path)
 *   - invalidate() forces reload from disk
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { OverridesStore } from "../tool-registry/overrides.js";

function freshPath(): string {
  return path.join(
    os.tmpdir(),
    `tool-overrides-unit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
}

describe("OverridesStore.list", () => {
  it("returns empty map when file is absent", () => {
    const fp = freshPath();
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    expect(s.list()).toEqual({});
    expect(fs.existsSync(fp)).toBe(false);
  });

  it("returns empty map and warns when file is malformed JSON", () => {
    const fp = freshPath();
    fs.writeFileSync(fp, "{ this is not json");
    const warnings: string[] = [];
    const s = new OverridesStore({ filePath: fp, warn: (m) => warnings.push(m) });
    expect(s.list()).toEqual({});
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/failed to read/);
    fs.unlinkSync(fp);
  });

  it("returns empty map when file has valid JSON but wrong schema", () => {
    const fp = freshPath();
    fs.writeFileSync(fp, JSON.stringify({ version: 1 })); // no overrides key
    const warnings: string[] = [];
    const s = new OverridesStore({ filePath: fp, warn: (m) => warnings.push(m) });
    expect(s.list()).toEqual({});
    expect(warnings[0]).toMatch(/malformed/);
    fs.unlinkSync(fp);
  });

  it("skips individual entries with wrong shape but keeps well-formed ones", () => {
    const fp = freshPath();
    fs.writeFileSync(fp, JSON.stringify({
      version: 1,
      overrides: {
        good: { path: "/x" },
        bad1: "string not object",
        bad2: { wrong: "field" },
      },
    }));
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    expect(s.list()).toEqual({ good: "/x" });
    fs.unlinkSync(fp);
  });
});

describe("OverridesStore.set / clear", () => {
  let fp: string;
  beforeEach(() => {
    fp = freshPath();
  });

  it("set writes the file with the documented schema", () => {
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    s.set("pi", "/custom/pi");
    const raw = fs.readFileSync(fp, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      version: 1,
      overrides: { pi: { path: "/custom/pi" } },
    });
    fs.unlinkSync(fp);
  });

  it("set + list round-trips", () => {
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    s.set("pi", "/a");
    s.set("openspec", "/b");
    expect(s.list()).toEqual({ pi: "/a", openspec: "/b" });
    fs.unlinkSync(fp);
  });

  it("clear removes an entry and persists", () => {
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    s.set("pi", "/a");
    s.set("openspec", "/b");
    s.clear("pi");
    expect(s.list()).toEqual({ openspec: "/b" });
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8"));
    expect(parsed.overrides).toEqual({ openspec: { path: "/b" } });
    fs.unlinkSync(fp);
  });

  it("clear is a no-op when the name is absent", () => {
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    s.clear("pi"); // nothing to clear; must not throw
    expect(s.list()).toEqual({});
    expect(fs.existsSync(fp)).toBe(false);
  });

  it("writes are atomic (tmp file renamed, not left behind)", () => {
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    s.set("pi", "/a");
    expect(fs.existsSync(fp)).toBe(true);
    expect(fs.existsSync(fp + ".tmp")).toBe(false);
    fs.unlinkSync(fp);
  });
});

describe("OverridesStore.invalidate", () => {
  it("forces a reload from disk on next list()", () => {
    const fp = freshPath();
    fs.writeFileSync(fp, JSON.stringify({ version: 1, overrides: { pi: { path: "/a" } } }));
    const s = new OverridesStore({ filePath: fp, warn: () => {} });
    expect(s.list()).toEqual({ pi: "/a" });

    // Mutate the file underneath.
    fs.writeFileSync(fp, JSON.stringify({ version: 1, overrides: { pi: { path: "/b" } } }));
    expect(s.list()).toEqual({ pi: "/a" }); // still cached

    s.invalidate();
    expect(s.list()).toEqual({ pi: "/b" }); // reloaded
    fs.unlinkSync(fp);
  });
});
