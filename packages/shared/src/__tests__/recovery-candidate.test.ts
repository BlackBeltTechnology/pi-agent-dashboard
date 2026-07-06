/**
 * Recovery-candidate classifier: `live===true && status!=="ended"` (and not
 * `closedReason==="manual"`). Covers the four close-path scenarios + the
 * liveEpoch-absent fallback. See change: reopen-sessions-after-shutdown.
 */
import { describe, it, expect } from "vitest";
import { isRecoveryCandidate, type SessionMeta } from "../session-meta.js";

describe("isRecoveryCandidate", () => {
  // Crash mid-run: no unregister ran, so the sidecar keeps its last running
  // status and `live` was never cleared.
  it("crash (live:true, status non-ended) IS a candidate", () => {
    expect(isRecoveryCandidate({ live: true, status: "idle", liveEpoch: 5 } as SessionMeta)).toBe(true);
    expect(isRecoveryCandidate({ live: true, status: "streaming" } as SessionMeta)).toBe(true);
  });

  // pi TUI quit / dashboard ✕: unregister() persisted status:"ended".
  it("clean unregister (status:ended) is NOT a candidate, even if live:true", () => {
    // TUI quit leaves live:true but status:ended → excluded by the status half.
    expect(isRecoveryCandidate({ live: true, status: "ended" } as SessionMeta)).toBe(false);
    // dashboard ✕ additionally stamps closedReason:manual.
    expect(isRecoveryCandidate({ live: false, status: "ended", closedReason: "manual" } as SessionMeta)).toBe(false);
  });

  // Idle / app-quit clean stop(): clears live:false without unregistering,
  // so status stays non-ended — excluded by the live half.
  it("clean stop() (live:false, status non-ended) is NOT a candidate", () => {
    expect(isRecoveryCandidate({ live: false, status: "idle" } as SessionMeta)).toBe(false);
  });

  it("manual-close reason is also excluded regardless of status", () => {
    expect(isRecoveryCandidate({ live: true, status: "idle", closedReason: "manual" } as SessionMeta)).toBe(false);
  });

  it("pre-feature session without marker is NOT a candidate", () => {
    expect(isRecoveryCandidate({} as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ status: "idle" } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate(undefined)).toBe(false);
  });

  it("fallback: live:true + non-ended status with absent liveEpoch still classifies", () => {
    expect(isRecoveryCandidate({ live: true, status: "idle" } as SessionMeta)).toBe(true);
  });

  it("automation run sessions are NEVER candidates (fully exempt)", () => {
    // A crash mid-automation-run must not respawn the headless rpc session
    // detached from its automation (no per-fire context, no run finalization).
    expect(isRecoveryCandidate({ live: true, status: "streaming", kind: "automation" } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ live: true, status: "idle", kind: "automation", liveEpoch: 5 } as SessionMeta)).toBe(false);
  });
});
