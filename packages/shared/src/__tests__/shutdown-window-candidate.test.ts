/**
 * Shutdown-window recovery classifier: a session whose bridge explicitly
 * unregistered (pi exited gracefully on an OS signal) shortly before its
 * owning boot exited via `signal` / `user-quit`.
 * See change: fix-recovery-pi-signal-unregister (design D3).
 */
import { describe, it, expect } from "vitest";
import type { BootRecord, ExitIntent } from "../boot-state.js";
import { RECOVERY_SHUTDOWN_WINDOW_MS } from "../recovery-timing.js";
import { isShutdownWindowCandidate, type ShutdownWindowInput } from "../session-meta.js";

const B = 1_791_450_739_978;
const T = 1_791_528_209_000;

function session(over: Partial<ShutdownWindowInput> = {}): ShutdownWindowInput {
  return { live: false, liveEpoch: B, endedAt: T, closedReason: "unknown", ...over };
}
function owner(exitIntent: ExitIntent | null, at: number): BootRecord {
  return { bootId: B, exitIntent, at };
}

describe("isShutdownWindowCandidate", () => {
  it("window constant is 60 s", () => {
    expect(RECOVERY_SHUTDOWN_WINDOW_MS).toBe(60_000);
  });

  // test-plan #E1 — BVA on Δ = exitAt − endedAt.
  it.each([
    [0, true],
    [59_999, true],
    [60_000, true],
    [60_001, false],
  ])("signal exit %i ms after the unregister → %s", (delta, expected) => {
    expect(isShutdownWindowCandidate(session(), owner("signal", T + delta), RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(expected);
  });

  // test-plan #E2 — absolute difference: the unregister may land after `at`.
  it.each([
    [5_000, true],
    [60_000, true],
    [61_000, false],
  ])("user-quit recorded %i ms BEFORE the unregister → %s", (delta, expected) => {
    expect(isShutdownWindowCandidate(session(), owner("user-quit", T - delta), RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(expected);
  });

  // test-plan #E3 — intent allowlist.
  it.each([
    ["signal", true],
    ["user-quit", true],
    ["restart", false],
    ["shutdown", false],
    ["ephemeral", false],
    ["idle", false],
    [null, false],
  ] as Array<[ExitIntent | null, boolean]>)("owner intent %s → %s", (intent, expected) => {
    expect(isShutdownWindowCandidate(session(), owner(intent, T + 23_000), RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(expected);
  });

  // test-plan #E4 — reason / flag decision table (one field varied per row).
  it("base row (closedReason unknown) qualifies", () => {
    expect(isShutdownWindowCandidate(session(), owner("signal", T + 23_000), RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(true);
  });
  it.each([
    ["closedReason manual", { closedReason: "manual" }],
    ["closedReason spawn_failed", { closedReason: "spawn_failed" }],
    ["closedReason process_gone", { closedReason: "process_gone" }],
    ["closedReason absent", { closedReason: undefined }],
    ["recover:false", { recover: false }],
    ["live:true", { live: true }],
    ["no liveEpoch", { liveEpoch: undefined }],
    ["no endedAt", { endedAt: undefined }],
  ] as Array<[string, Partial<ShutdownWindowInput>]>)("%s does NOT qualify", (_label, over) => {
    expect(isShutdownWindowCandidate(session(over), owner("signal", T + 23_000), RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(false);
  });
  it("unresolvable owner boot does NOT qualify", () => {
    expect(isShutdownWindowCandidate(session(), undefined, RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(false);
  });
  it("owner record for a different boot does NOT qualify", () => {
    const other: BootRecord = { bootId: B + 1, exitIntent: "signal", at: T + 23_000 };
    expect(isShutdownWindowCandidate(session(), other, RECOVERY_SHUTDOWN_WINDOW_MS)).toBe(false);
  });
});
