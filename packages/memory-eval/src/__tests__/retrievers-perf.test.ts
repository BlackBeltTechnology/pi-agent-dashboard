import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { searchSessionsReplica } from "../retrievers/hermes-session-search.js";
import { HERMES_SCHEMA_SQL } from "./helpers/hermes-db.js";

describe("retrievers perf", () => {
  it("P1: BM25 variant stays under 500 ms on 45k messages, including the widening path", () => {
    const dir = mkdtempSync(join(tmpdir(), "perf-"));
    const db = new DatabaseSync(join(dir, "sessions.db"));
    db.exec(HERMES_SCHEMA_SQL);
    db.prepare("INSERT INTO sessions (id, project, cwd, started_at) VALUES ('s1', 'synth', '/x', '2026-01-01T00:00:00.000Z')").run();
    const ins = db.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, 's1', 'user', ?, ?)");
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    db.exec("BEGIN");
    for (let i = 0; i < 45_000; i++) {
      // 8 old, long rows rank last in BM25; every later row is short and ranks first.
      const content = i < 8 ? `kaboomx ${"padding words that dilute the match ".repeat(20)} ${i}` : "kaboomx";
      ins.run(`m${i}`, content, new Date(base + i * 60_000).toISOString());
    }
    db.exec("COMMIT");

    const timed = (asOf: string) => {
      const t0 = performance.now();
      const r = searchSessionsReplica(db, "kaboomx", { project: "synth", asOf, limit: 10 }, "bm25");
      return { ms: performance.now() - t0, ...r };
    };

    const q1 = timed("3000-01-01T00:00:00.000Z");
    expect(q1.rows).toHaveLength(10);
    expect(q1.underFill).toBe(false);
    expect(q1.ms).toBeLessThan(500);

    // Only the 8 old rows are eligible; the top 5,000 FTS rows are all future, so it widens.
    const q2 = timed(new Date(base + 8 * 60_000).toISOString());
    expect(q2.rows.length).toBe(8);
    expect(q2.rows.every((r) => Number(r.id.slice(1)) < 8)).toBe(true);
    expect(q2.underFill).toBe(true);
    expect(q2.ms).toBeLessThan(500);
  });
});
