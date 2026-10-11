import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type GoldenQuery, loadInstalledSearch } from "../../scripts/regen-hermes-golden.js";
import { searchSessionsReplica } from "../retrievers/hermes-session-search.js";
import { createHermesDb } from "./helpers/hermes-db.js";

const FIXTURE = resolve(__dirname, "../../fixtures/hermes-golden");
const queries: GoldenQuery[] = JSON.parse(readFileSync(join(FIXTURE, "queries.json"), "utf8"));
const golden: { hermesVersion: string; expected: Record<string, string[]> } = JSON.parse(readFileSync(join(FIXTURE, "expected.json"), "utf8"));

function openCopy(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "golden-"));
  copyFileSync(join(FIXTURE, "sessions.db"), join(dir, "sessions.db"));
  return new DatabaseSync(join(dir, "sessions.db"));
}

const HERMES_DIR = join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-hermes-memory");
const hermesInstalled = existsSync(join(HERMES_DIR, "src", "store", "session-search.ts"));

describe("hermes replica", () => {
  it("E23: newest-first replica matches the committed golden ids", () => {
    const db = openCopy();
    expect(queries.length).toBeGreaterThan(5);
    for (const q of queries) {
      const ids = searchSessionsReplica(db, q.query, { project: q.project, limit: 10 }, "recent").rows.map((r) => r.session_id);
      expect(ids, q.query).toEqual(golden.expected[q.query]);
    }
  });

  it.skipIf(!hermesInstalled)("E24: installed hermes returns the same ids (drift check)", async () => {
    const db = openCopy();
    const search = await loadInstalledSearch(HERMES_DIR);
    for (const q of queries) {
      expect(search(db, q.query, { project: q.project, limit: 10 }).map((r) => r.sessionId), q.query).toEqual(golden.expected[q.query]);
    }
  });

  it("B2 (round 3): newest-first orders by instant, not by the raw timestamp string", () => {
    const dir = mkdtempSync(join(tmpdir(), "order-"));
    const path = join(dir, "sessions.db");
    createHermesDb(path, {
      sessions: [{ id: "s1", project: "synth" }],
      messages: [
        { session: "s1", id: "a", content: "kaboom failure alpha", ts: "2026-02-01T14:00:00+05:00" }, // 09:00Z
        { session: "s1", id: "b", content: "kaboom failure bravo", ts: "2026-02-01T08:59:00-03:00" }, // 11:59Z — newest
        { session: "s1", id: "c", content: "kaboom failure charlie", ts: "2026-02-01T12:30:00Z" }, // after the bound
      ],
    }).close();
    const db = new DatabaseSync(path, { readOnly: true });
    for (const query of ["kaboom failure", "ab"]) {
      const r = searchSessionsReplica(db, query, { project: "synth", asOf: "2026-02-01T12:00:00.000Z", limit: 1 }, "recent");
      expect(r.rows.map((x) => x.id), query).toEqual(["b"]);
    }
  });
});
