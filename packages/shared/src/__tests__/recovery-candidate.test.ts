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

  it("E1: decision table over recover × liveness reads ONLY recover", () => {
    // recover false/absent/true × live/ended/manual → false,true,true,false,false,false
    // (test-plan E1). The flag is the sole opt-out; kind/goalId/pluginRef are
    // never consulted. See change: detach-automation-goal-from-core.
    expect(isRecoveryCandidate({ live: true, status: "streaming", recover: false } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ live: true, status: "streaming" } as SessionMeta)).toBe(true); // recover absent ⇒ default true
    expect(isRecoveryCandidate({ live: true, status: "streaming", recover: true } as SessionMeta)).toBe(true);
    expect(isRecoveryCandidate({ live: false, status: "streaming", recover: true } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ live: true, status: "ended", recover: true } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ live: true, status: "streaming", closedReason: "manual", recover: true } as SessionMeta)).toBe(false);
  });

  it("recover:false exempts a live session; the classifier reads recover, never kind", () => {
    // The opt-out is the core-owned `recover` flag, set from the spawn-time
    // lifecycle declaration — NOT a plugin name. See change:
    // detach-automation-goal-from-core.
    expect(isRecoveryCandidate({ live: true, status: "streaming", recover: false } as SessionMeta)).toBe(false);
    expect(isRecoveryCandidate({ live: true, status: "idle", recover: false, liveEpoch: 5 } as SessionMeta)).toBe(false);
    // `kind:"automation"` alone no longer exempts — core stopped keying on it.
    // Only the generic `recover` flag governs. An automation session becomes
    // non-recoverable because the automation plugin DECLARES `recover:false`,
    // which is persisted as the flag below — not because core reads `kind`.
    expect(isRecoveryCandidate({ live: true, status: "streaming", kind: "automation" } as SessionMeta)).toBe(true);
  });
});
