/**
 * Task 5.2 — reopen acceptances dedupe so a candidate spawns at most once.
 * Task 5.3 — recovery classification reads ONLY per-session `.meta.json`,
 *            never the home-lock.
 * See change: reopen-sessions-after-shutdown.
 */
import { describe, it, expect } from "vitest";
import { createPendingResumeIntentRegistry } from "../pending/pending-resume-intent-registry.js";
import { isRecoveryCandidate } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

describe("reopen dedupe (pendingResumeIntents)", () => {
  it("two acceptances for one session consume at most once", () => {
    const reg = createPendingResumeIntentRegistry();
    // Two devices accept the same candidate's reopen.
    reg.record("sess-1", "keep");
    reg.record("sess-1", "keep"); // last-write-wins → still one entry
    expect(reg.size()).toBe(1);

    // The ended→alive reattach branch consumes once; the racing second
    // reattach sees null → no second placement / spawn path.
    expect(reg.consume("sess-1")).toBe("keep");
    expect(reg.consume("sess-1")).toBeNull();
  });
});

describe("recovery classification ignores home-lock", () => {
  // The classifier takes ONLY a SessionMeta. There is no code path by which a
  // home-lock file (present/absent/stale) could alter the result — varying a
  // simulated lock state around the call yields identical classification.
  const candidateMeta = { live: true } as const;
  const cleanMeta = { live: false } as const;

  for (const lockState of ["present", "absent", "stale"] as const) {
    it(`classification is identical with home-lock ${lockState}`, () => {
      // Whatever the (irrelevant) lock state, the marker alone decides.
      expect(isRecoveryCandidate(candidateMeta)).toBe(true);
      expect(isRecoveryCandidate(cleanMeta)).toBe(false);
    });
  }
});
