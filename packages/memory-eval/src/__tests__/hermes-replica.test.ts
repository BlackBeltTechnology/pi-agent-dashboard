import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type GoldenQuery, loadInstalledSearch } from "../../scripts/regen-hermes-golden.js";
import { searchSessionsReplica } from "../retrievers/hermes-session-search.js";

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
});
