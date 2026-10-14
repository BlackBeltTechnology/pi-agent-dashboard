/**
 * abortSpawnedRun factory (test-plan #X14–#X16, #X23): both branches resolve
 * through the shared terminator; a non-confirmed outcome is reported (false +
 * one warn + failedReclaims) and never feeds the reaper's give-up tracker.
 * See change: fix-session-reclaim-tmux (design D6, R1).
 */
import { describe, expect, it, vi } from "vitest";
import { createAbortSpawnedRun } from "../abort-spawned-run.js";
import type { TerminateResult } from "../session-terminator.js";

function make(result: TerminateResult) {
  const calls: string[] = [];
  const terminate = vi.fn(async (_id: string, _o?: unknown) => {
    calls.push("terminate");
    return result;
  });
  const sendShutdownHint = vi.fn(() => {
    calls.push("hint");
    return false; // bridge WS closed
  });
  const recordReclaimFailure = vi.fn();
  const warn = vi.fn();
  const abort = createAbortSpawnedRun({ terminate, sendShutdownHint, recordReclaimFailure, warn });
  return { abort, terminate, sendShutdownHint, recordReclaimFailure, warn, calls };
}

const DEAD: TerminateResult = { outcome: "confirmed-dead", terminated: true, pid: 5 };

describe("abortSpawnedRun", () => {
  // X14 — graceful: hint first, then the terminator escalates even though the hint was dropped.
  it("sends the hint, then terminates with the unattended options, and returns true", async () => {
    const h = make(DEAD);
    await expect(h.abort({ sessionId: "s1", spawnToken: "tok", graceful: true })).resolves.toBe(true);
    expect(h.calls).toEqual(["hint", "terminate"]);
    expect(h.terminate).toHaveBeenCalledWith("s1", { spawnToken: "tok", verifyIdentity: true, stampManualClose: true });
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.recordReclaimFailure).not.toHaveBeenCalled();
  });

  it("does not send the hint on the hard branch", async () => {
    const h = make(DEAD);
    await h.abort({ sessionId: "s1" });
    expect(h.sendShutdownHint).not.toHaveBeenCalled();
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  // X15 — pre-register window: no session id, token only.
  it("reclaims a never-registered run by spawn token", async () => {
    const h = make(DEAD);
    await expect(h.abort({ spawnToken: "tok-12345678" })).resolves.toBe(true);
    expect(h.terminate).toHaveBeenCalledWith("", { spawnToken: "tok-12345678", verifyIdentity: true, stampManualClose: true });
  });

  it("reports an unresolvable token: false, one warn naming the token + no-identity, failedReclaims +1", async () => {
    const h = make({ outcome: "no-identity", terminated: false });
    await expect(h.abort({ spawnToken: "tok-12345678" })).resolves.toBe(false);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(String(h.warn.mock.calls[0]?.[0])).toContain("tok-12345678");
    expect(String(h.warn.mock.calls[0]?.[0])).toContain("no-identity");
    expect(h.recordReclaimFailure).toHaveBeenCalledTimes(1);
  });

  // X16 — win32 non-headless.
  it("reports refused-identity naming the session", async () => {
    const h = make({ outcome: "refused-identity", terminated: false, pid: 77 });
    await expect(h.abort({ sessionId: "s9" })).resolves.toBe(false);
    expect(h.warn).toHaveBeenCalledTimes(1);
    const line = String(h.warn.mock.calls[0]?.[0]);
    expect(line).toContain("s9");
    expect(line).toContain("refused-identity");
    expect(line).toContain("77");
    expect(h.recordReclaimFailure).toHaveBeenCalledTimes(1);
  });

  // X23 — unconfirmed.
  it("reports an unconfirmed kill with the surviving pid", async () => {
    const h = make({ outcome: "unconfirmed", terminated: false, pid: 123 });
    await expect(h.abort({ sessionId: "s1", graceful: false })).resolves.toBe(false);
    const line = String(h.warn.mock.calls[0]?.[0]);
    expect(line).toContain("s1");
    expect(line).toContain("unconfirmed");
    expect(line).toContain("123");
    expect(h.recordReclaimFailure).toHaveBeenCalledTimes(1);
  });

  it("returns false without calling the terminator when it has neither id nor token", async () => {
    const h = make(DEAD);
    await expect(h.abort({})).resolves.toBe(false);
    expect(h.terminate).not.toHaveBeenCalled();
  });
});
