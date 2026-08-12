/**
 * C3 — the "resident session processes vs live sessions" comparison is a
 * first-class query, not something a human eyeballs via `docker exec`.
 *
 * The pre-fix harness measured 21 resident `pi` against 0 session records and
 * nothing in the repo could assert on that divergence. `compareResidentToSessions`
 * is what makes a regression of this fix loud instead of silent.
 *
 * See change: fix-tmux-session-shutdown-leak (design D4, test-plan #C3).
 */
import { describe, expect, it } from "vitest";
import { compareResidentToSessions } from "../probe-harness-memory.mjs";

describe("orphan comparison (#C3)", () => {
  it("disjoint — every resident process is orphaned", () => {
    // The measured shape of the bug: processes resident, no session records.
    const r = compareResidentToSessions([101, 102, 103], []);
    expect(r.orphaned).toEqual([101, 102, 103]);
    expect(r.orphanedCount).toBe(3);
    expect(r.clean).toBe(false);
  });

  it("equal — nothing orphaned, nothing unaccounted", () => {
    const r = compareResidentToSessions([101, 102], [102, 101]);
    expect(r.orphaned).toEqual([]);
    expect(r.unaccounted).toEqual([]);
    expect(r.matched.sort()).toEqual([101, 102]);
    expect(r.clean).toBe(true);
  });

  it("overlapping — reports orphans and unaccounted sessions separately", () => {
    const r = compareResidentToSessions([101, 102], [102, 103]);
    expect(r.orphaned).toEqual([101]);
    expect(r.matched).toEqual([102]);
    // A session record whose process is not resident is a bookkeeping bug, not
    // a leak — it must not be counted as an orphan.
    expect(r.unaccounted).toEqual([103]);
    expect(r.clean).toBe(false);
  });

  it("deduplicates a repeated resident pid", () => {
    const r = compareResidentToSessions([101, 101], []);
    expect(r.orphanedCount).toBe(1);
  });
});
