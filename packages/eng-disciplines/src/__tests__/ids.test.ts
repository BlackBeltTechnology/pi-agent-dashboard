/**
 * guard.mjs id high-water marks (review r4 B2): `seed-ids` raises each mark to the max
 * id found in previous catalogs; `next-id` allocates above the mark and persists it, so
 * an id retired by a previous run or by a revision of this run is never reused.
 * See change: add-reverse-spec-for-rebuild.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guard } from "./files";

let dir: string;
const ids = () => join(dir, "_ids.json");
const marks = () => JSON.parse(readFileSync(ids(), "utf8"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rsfr-ids-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("next-id", () => {
  it("starts at 001 without a file and persists the mark", () => {
    expect(guard(dir, "next-id", ids(), "BR").stdout.trim()).toBe("BR-001");
    expect(guard(dir, "next-id", ids(), "BR").stdout.trim()).toBe("BR-002");
    expect(guard(dir, "next-id", ids(), "GAP").stdout.trim()).toBe("GAP-001");
    expect(marks()).toEqual({ BR: 2, QUIRK: 0, GAP: 1 });
  });

  it("never reuses an id allocated earlier, even if that item was dropped", () => {
    writeFileSync(ids(), JSON.stringify({ BR: 10, QUIRK: 0, GAP: 0 }));
    expect(guard(dir, "next-id", ids(), "BR").stdout.trim()).toBe("BR-011");
  });

  it("rejects an unknown kind and missing arguments", () => {
    expect(guard(dir, "next-id", ids(), "XX").code).toBe(2);
    expect(guard(dir, "next-id", ids()).code).toBe(2);
    expect(guard(dir, "next-id").code).toBe(2);
  });

  it("rejects a corrupt ids file instead of restarting at 001", () => {
    writeFileSync(ids(), "{not json");
    const r = guard(dir, "next-id", ids(), "BR");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
  });
});

describe("seed-ids", () => {
  it("raises marks to the max id in previous catalogs (retired highest id stays retired)", () => {
    const prev = join(dir, "prev");
    mkdirSync(prev);
    // previous catalog ends at BR-009, but its own _ids.json remembers BR-010 was used
    writeFileSync(join(prev, "rules.md"), "## BR-001 a\n## BR-009 b\nsee QUIRK-003\n");
    writeFileSync(join(prev, "quirks.md"), "## QUIRK-002 q\n");
    writeFileSync(join(prev, "_ids.json"), JSON.stringify({ BR: 10, QUIRK: 2, GAP: 4 }));
    expect(guard(dir, "seed-ids", ids(), prev).code).toBe(0);
    expect(marks()).toEqual({ BR: 10, QUIRK: 3, GAP: 4 });
    expect(guard(dir, "next-id", ids(), "BR").stdout.trim()).toBe("BR-011");
  });

  it("legacy package without _ids.json seeds from catalog text alone", () => {
    const prev = join(dir, "prev");
    mkdirSync(prev);
    writeFileSync(join(prev, "gaps.md"), "## GAP-007 g\n");
    expect(guard(dir, "seed-ids", ids(), prev).code).toBe(0);
    expect(marks()).toEqual({ BR: 0, QUIRK: 0, GAP: 7 });
  });

  it("never lowers an existing mark", () => {
    writeFileSync(ids(), JSON.stringify({ BR: 20, QUIRK: 0, GAP: 0 }));
    const prev = join(dir, "prev");
    mkdirSync(prev);
    writeFileSync(join(prev, "rules.md"), "## BR-005 x\n");
    guard(dir, "seed-ids", ids(), prev);
    expect(marks().BR).toBe(20);
  });

  it("requires an ids file and at least one dir", () => {
    expect(guard(dir, "seed-ids", ids()).code).toBe(2);
    expect(guard(dir, "seed-ids").code).toBe(2);
  });
});
