/**
 * `isMergePrimary` decision table (test-plan #E3, task 8.3).
 * See change: redesign-composer-session-strip (D6).
 */
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { isMergePrimary, isPrStatusStale, type MergePrimaryInput } from "../merge-primary.js";

const NOW = 1_000_000_000;
const MIN = 60_000;

const QUALIFYING: MergePrimaryInput = {
  hasWorktree: true,
  prState: "open",
  prDraft: false,
  prChecks: "passing",
  prCheckedAt: NOW - 1 * MIN,
  working: false,
  attached: false,
  now: NOW,
};

describe("isMergePrimary (#E3)", () => {
  it("the qualifying combination is true", () => {
    expect(isMergePrimary(QUALIFYING)).toBe(true);
  });

  it("exhaustive product: true ONLY for hasWorktree ∧ open ∧ ¬draft ∧ checks∈{passing,none} ∧ fresh ∧ ¬working ∧ (no change ∨ COMPLETE)", () => {
    const prStates = [
      { prState: "open", prDraft: false },
      { prState: "open", prDraft: true },
      { prState: "closed", prDraft: false },
      { prState: "merged", prDraft: false },
      { prState: null, prDraft: null },
    ] as const;
    const checks = ["passing", "none", "pending", "failing"] as const;
    const ages = [1 * MIN, 20 * MIN];
    const attachedCases = [
      { attached: false, attachedChangeState: undefined },
      { attached: true, attachedChangeState: ChangeState.COMPLETE },
      { attached: true, attachedChangeState: ChangeState.IMPLEMENTING },
      { attached: true, attachedChangeState: undefined },
    ];
    let trueRows = 0;
    for (const hasWorktree of [true, false])
      for (const pr of prStates)
        for (const prChecks of checks)
          for (const age of ages)
            for (const working of [true, false])
              for (const a of attachedCases) {
                const input: MergePrimaryInput = { hasWorktree, ...pr, prChecks, prCheckedAt: NOW - age, working, ...a, now: NOW };
                const expected =
                  hasWorktree &&
                  pr.prState === "open" &&
                  pr.prDraft === false &&
                  (prChecks === "passing" || prChecks === "none") &&
                  age <= 15 * MIN &&
                  !working &&
                  (!a.attached || a.attachedChangeState === ChangeState.COMPLETE);
                expect(isMergePrimary(input), JSON.stringify(input)).toBe(expected);
                if (expected) trueRows++;
              }
    // passing|none × (no change | COMPLETE)
    expect(trueRows).toBe(4);
  });

  it("named rows from task 3.3", () => {
    expect(isMergePrimary({ ...QUALIFYING, hasWorktree: false })).toBe(false);
    expect(isMergePrimary({ ...QUALIFYING, attached: true, attachedChangeState: undefined })).toBe(false);
    expect(isMergePrimary({ ...QUALIFYING, prChecks: "none" })).toBe(true);
    expect(isMergePrimary({ ...QUALIFYING, prCheckedAt: NOW - 20 * MIN })).toBe(false);
    expect(isMergePrimary({ ...QUALIFYING, working: true })).toBe(false);
    expect(isMergePrimary({ ...QUALIFYING, prCheckedAt: undefined })).toBe(false);
  });

  it("isPrStatusStale", () => {
    expect(isPrStatusStale(NOW - 20 * MIN, NOW)).toBe(true);
    expect(isPrStatusStale(NOW - 1 * MIN, NOW)).toBe(false);
    expect(isPrStatusStale(undefined, NOW)).toBe(false);
  });
});
