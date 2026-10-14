import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_KEEP, planPrune, prune } from "../prune-memory-backups.mjs";

describe("planPrune", () => {
  it("marks every sessions.db.corrupt-* file (incl. -shm/-wal) for deletion", () => {
    const plan = planPrune(
      [
        "sessions.db.corrupt-2026-07-14T19-00-39-738Z-97154-bc11b2",
        "sessions.db.corrupt-2026-07-14T19-00-39-738Z-97154-bc11b2-shm",
        "sessions.db.corrupt-2026-07-14T19-00-39-738Z-97154-bc11b2-wal",
      ],
      DEFAULT_KEEP,
    );
    expect(plan.corrupt).toHaveLength(3);
    expect(plan.backups).toEqual([]);
  });

  it("keeps the N newest .bak.auto-* by timestamp and deletes older ones", () => {
    const plan = planPrune(
      [
        "sessions.db.bak.auto-20260831-090023",
        "sessions.db.bak.auto-20260907-090030",
        "sessions.db.bak.auto-20260907-090047",
        "sessions.db.bak.auto-20260914-090023",
        "sessions.db.bak.auto-20260914-090532",
      ],
      2,
    );
    expect(plan.kept).toEqual([
      "sessions.db.bak.auto-20260914-090532",
      "sessions.db.bak.auto-20260914-090023",
    ]);
    expect(plan.backups).toEqual([
      "sessions.db.bak.auto-20260907-090047",
      "sessions.db.bak.auto-20260907-090030",
      "sessions.db.bak.auto-20260831-090023",
    ]);
  });

  it("never touches the live DB, its sidecars, or non-auto backups", () => {
    const protectedNames = [
      "sessions.db",
      "sessions.db-wal",
      "sessions.db-shm",
      "sessions.db.bak.cleanup-20260623-160233",
      "sessions.db.bak.trim-20260623-161344",
      "MEMORY.md",
      "failures.md",
    ];
    const plan = planPrune(protectedNames, 0);
    expect(plan.corrupt).toEqual([]);
    expect(plan.backups).toEqual([]);
  });

  it("is a no-op when backups are within the keep budget", () => {
    const plan = planPrune(["sessions.db.bak.auto-20260914-090532"], DEFAULT_KEEP);
    expect(plan.backups).toEqual([]);
  });

  it("defaults to keeping 2 backups", () => {
    expect(DEFAULT_KEEP).toBe(2);
  });
});

describe("prune", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "prune-mem-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const seed = () => {
    const names = [
      "sessions.db",
      "sessions.db-wal",
      "sessions.db.corrupt-2026-07-14T19-00-39-738Z-97154-bc11b2",
      "sessions.db.corrupt-2026-07-14T19-00-39-738Z-97154-bc11b2-wal",
      "sessions.db.bak.auto-20260831-090023",
      "sessions.db.bak.auto-20260907-090030",
      "sessions.db.bak.auto-20260914-090532",
      "MEMORY.md",
    ];
    for (const n of names) writeFileSync(join(tmp, n), "x");
  };

  it("dry-run deletes nothing", () => {
    seed();
    const res = prune({ dir: tmp, keep: 1, write: false });
    expect(res.deleted).toEqual([]);
    expect(readdirSync(tmp)).toHaveLength(8);
    expect(res.plan.corrupt).toHaveLength(2);
  });

  it("--write removes corrupt + surplus backups only", () => {
    seed();
    const res = prune({ dir: tmp, keep: 1, write: true });
    expect(res.deleted).toHaveLength(4);
    expect(readdirSync(tmp).sort()).toEqual([
      "MEMORY.md",
      "sessions.db",
      "sessions.db-wal",
      "sessions.db.bak.auto-20260914-090532",
    ]);
  });

  it("is idempotent — a second --write run is a no-op", () => {
    seed();
    prune({ dir: tmp, keep: 1, write: true });
    const second = prune({ dir: tmp, keep: 1, write: true });
    expect(second.deleted).toEqual([]);
    expect(readdirSync(tmp)).toHaveLength(4);
  });

  it("tolerates a missing directory", () => {
    const res = prune({ dir: join(tmp, "nope"), keep: 2, write: true });
    expect(res.deleted).toEqual([]);
    expect(res.missing).toBe(true);
  });
});
