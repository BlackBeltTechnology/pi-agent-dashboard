/**
 * Give-up tracker (test-plan #E12–#E14).
 * See change: fix-session-reclaim-tmux (design D4).
 */
import { describe, expect, it } from "vitest";
import { createReclaimGiveUpTracker } from "../reclaim-give-up.js";

describe("reclaim give-up tracker", () => {
  // E12 — N = 3, crossing reported exactly once.
  it("gives up at the 3rd consecutive unconfirmed failure and reports the crossing once", () => {
    const t = createReclaimGiveUpTracker();
    expect(t.recordFailure("s1", "unconfirmed")).toBe(false);
    expect(t.recordFailure("s1", "unconfirmed")).toBe(false);
    expect(t.isGivenUp("s1")).toBe(false);
    expect(t.recordFailure("s1", "unconfirmed")).toBe(true);
    expect(t.isGivenUp("s1")).toBe(true);
    expect(t.recordFailure("s1", "unconfirmed")).toBe(false);
  });

  // E13 — clear restarts the count.
  it("restarts the count after clear (confirmed termination)", () => {
    const t = createReclaimGiveUpTracker();
    t.recordFailure("s1", "unconfirmed");
    t.recordFailure("s1", "unconfirmed");
    t.clear("s1");
    t.recordFailure("s1", "unconfirmed");
    expect(t.recordFailure("s1", "unconfirmed")).toBe(false);
    expect(t.isGivenUp("s1")).toBe(false);
  });

  // E14 — outcomes that cannot change without new information give up at once.
  it.each(["no-identity", "refused-identity"] as const)("gives up immediately on %s", (outcome) => {
    const t = createReclaimGiveUpTracker();
    expect(t.recordFailure("s1", outcome)).toBe(true);
    expect(t.isGivenUp("s1")).toBe(true);
  });

  // E16 — prune forgets sessions that left the list.
  it("prune drops sessions that are no longer listed", () => {
    const t = createReclaimGiveUpTracker();
    t.recordFailure("s1", "no-identity");
    t.recordFailure("s2", "unconfirmed");
    t.prune(new Set(["s2"]));
    expect(t.isGivenUp("s1")).toBe(false);
    // s2 kept its count: two more failures cross the bound.
    expect(t.recordFailure("s2", "unconfirmed")).toBe(false);
    expect(t.recordFailure("s2", "unconfirmed")).toBe(true);
  });

  it("tracks sessions independently", () => {
    const t = createReclaimGiveUpTracker();
    t.recordFailure("s1", "no-identity");
    expect(t.isGivenUp("s2")).toBe(false);
  });
});
