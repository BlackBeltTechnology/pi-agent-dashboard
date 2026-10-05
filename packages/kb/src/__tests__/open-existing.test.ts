/**
 * E18 — existing-only open is side-effect free (change:
 * improve-kb-settings-sources-and-search, D8 spike). It must work on a WAL file
 * after the writer closed (no -shm sidecar) and on a DELETE-mode file, without
 * changing journal mode, size or mtime.
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteFtsStore } from "../sqlite-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "kb-open-existing-"));
  dirs.push(d);
  return d;
};

function journalMode(path: string): string {
  const db = new DatabaseSync(path);
  try {
    return String((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode);
  } finally {
    db.close();
  }
}

describe("SqliteFtsStore.openExisting", () => {
  it("returns null for a missing file and creates nothing", () => {
    const p = join(tmp(), "nope", "index.db");
    expect(SqliteFtsStore.openExisting(p)).toBeNull();
    expect(existsSync(p)).toBe(false);
  });

  it("returns null for a 0-byte file", () => {
    const p = join(tmp(), "empty.db");
    writeFileSync(p, "");
    expect(SqliteFtsStore.openExisting(p)).toBeNull();
  });

  it("WAL file after writer close(): reads work, mode/size/mtime unchanged", () => {
    const p = join(tmp(), "wal.db");
    const w = new SqliteFtsStore(p);
    w.init();
    w.close();
    const size = statSync(p).size;
    const mtime = statSync(p).mtimeMs;
    const s = SqliteFtsStore.openExisting(p);
    expect(s).not.toBeNull();
    expect(s?.counts()).toMatchObject({ files: 0, chunks: 0 });
    expect(s?.hasCurrentSchema()).toEqual({ table: true, current: true });
    s?.close();
    expect(statSync(p).size).toBe(size);
    expect(statSync(p).mtimeMs).toBe(mtime);
    expect(journalMode(p)).toBe("wal");
  });

  it("DELETE-mode file: opened without switching to WAL", () => {
    const p = join(tmp(), "delete.db");
    const raw = new DatabaseSync(p);
    raw.exec("PRAGMA journal_mode=DELETE");
    raw.close();
    const w = new SqliteFtsStore(p, { existingOnly: true });
    w.init();
    w.close();
    const size = statSync(p).size;
    const s = SqliteFtsStore.openExisting(p);
    expect(s?.counts()).toMatchObject({ files: 0, chunks: 0 });
    s?.close();
    expect(statSync(p).size).toBe(size);
    expect(journalMode(p)).toBe("delete");
  });
});
