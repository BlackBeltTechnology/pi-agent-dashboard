/**
 * Fix-ledger validation (test-plan #E26-#E32). Pure fn, no I/O.
 * See change: harden-review-and-fix-loop.
 */
import { describe, expect, it } from "vitest";
import { type FixLedgerEntry, validateFixLedger } from "../fix-ledger.ts";

const DIFF = new Set(["tests/b1.test.ts", "tests/b2.test.ts"]);
const inDiff = (p: string) => DIFF.has(p);

const entry = (id: string, over: Partial<FixLedgerEntry> = {}): FixLedgerEntry => ({
  id,
  test: { path: `tests/${id.toLowerCase()}.test.ts` },
  siblings: { searched: "rg -n 'mtimeMs' packages/server", sites: [] },
  fixedIn: "abc1234",
  ...over,
});

const untestable = (reason: string) => entry("B1", { test: { untestable: reason } });

describe("validateFixLedger (#E26-#E32)", () => {
  it("#E26 complete entries with tests in the diff validate", () => {
    expect(validateFixLedger(["B1", "B2"], [entry("B1"), entry("B2")], inDiff)).toEqual({
      ok: true,
      missing: [],
      incomplete: [],
    });
  });

  it("#E27 a blocking id with no entry is missing", () => {
    const r = validateFixLedger(["B1", "B2"], [entry("B1")], inDiff);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["B2"]);
  });

  it("#E28 a test file outside the change's diff does not count", () => {
    const r = validateFixLedger(["B1"], [entry("B1", { test: { path: "tests/elsewhere.test.ts" } })], inDiff);
    expect(r.ok).toBe(false);
    expect(r.incomplete.map((p) => p.id)).toEqual(["B1"]);
  });

  it("#E29 an untestable reason needs at least 20 characters", () => {
    const short = validateFixLedger(["B1"], [untestable("x".repeat(19))], inDiff);
    expect(short.incomplete.map((p) => p.id)).toEqual(["B1"]);
    expect(validateFixLedger(["B1"], [untestable("y".repeat(20))], inDiff).ok).toBe(true);
  });

  it("#E30 the sibling search must be recorded, even when it found nothing", () => {
    const empty = entry("B1", { siblings: { searched: "", sites: [] } });
    expect(validateFixLedger(["B1"], [empty], inDiff).incomplete.map((p) => p.id)).toEqual(["B1"]);
    expect(validateFixLedger(["B1"], [entry("B1")], inDiff).ok).toBe(true);
  });

  it("#E31 status assertions are rejected, ordinary words are not (C1)", () => {
    const reasonA = untestable("this is already fixed in the round-1 commit");
    const reasonB = untestable("the race occurs only when the second request passes the lock check first");
    expect(validateFixLedger(["B1"], [reasonA], inDiff).ok).toBe(false);
    expect(validateFixLedger(["B1"], [reasonB], inDiff).ok).toBe(true);

    const search = (searched: string) => entry("B1", { siblings: { searched, sites: [] } });
    expect(validateFixLedger(["B1"], [search("rg -w fixedIn")], inDiff).ok).toBe(true);
    expect(validateFixLedger(["B1"], [search("no further sites")], inDiff).ok).toBe(false);
  });

  it("#E32 fixedIn is a 7-40 hex sha or `worktree`", () => {
    const at = (fixedIn: string) => validateFixLedger(["B1"], [entry("B1", { fixedIn })], inDiff).ok;
    expect(at("abc123")).toBe(false);
    expect(at("abc1234")).toBe(true);
    expect(at("worktree")).toBe(true);
    expect(at("HEAD")).toBe(false);
  });

  it("a non-array ledger reports every id missing instead of throwing", () => {
    expect(validateFixLedger(["B1"], { B1: {} }, inDiff).missing).toEqual(["B1"]);
  });
});
