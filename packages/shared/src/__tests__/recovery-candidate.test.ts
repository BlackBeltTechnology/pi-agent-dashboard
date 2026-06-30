/**
 * Recovery-candidate classifier: `live===true && closedReason!=="manual"`.
 * Covers the three cold-start scenarios + the liveEpoch-absent fallback.
 * See change: reopen-sessions-after-shutdown.
 */
import { describe, it, expect } from "vitest";
import { isRecoveryCandidate, type SessionMeta } from "../session-meta.js";

describe("isRecoveryCandidate", () => {
  it("interrupted session (live:true, no closedReason) is a candidate", () => {
    expect(isRecoveryCandidate({ live: true, liveEpoch: 5 } as SessionMeta)).toBe(true);
  });

  it("cleanly closed session (live:false) is NOT a candidate", () => {
    expect(isRecoveryCandidate({ live: false } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ live: false, closedReason: "manual" } as SessionMeta)).toBe(false);
  });

  it("manual-close (live:true but closedReason:manual) is NOT a candidate", () => {
    expect(isRecoveryCandidate({ live: true, closedReason: "manual" } as SessionMeta)).toBe(false);
  });

  it("pre-feature session without marker is NOT a candidate", () => {
    expect(isRecoveryCandidate({} as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate(undefined)).toBe(false);
  });

  it("fallback: live:true with absent liveEpoch still classifies as candidate", () => {
    expect(isRecoveryCandidate({ live: true } as SessionMeta)).toBe(true);
  });
});
