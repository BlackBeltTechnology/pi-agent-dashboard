/**
 * Active-session caps (test-plan #E17, #E18, #E19, #X3): count only ephemeral,
 * reclaim oldest quiescent at the cap, global cap bounds a visitorId spoofer,
 * and a structured capacity error when every candidate is busy.
 * See change: add-embed-session-lifecycle.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { describe, expect, it, vi } from "vitest";
import { CapacityError, type CapSessionInfo, createCapsAdmission } from "../caps.js";
import type { TerminateResult } from "../../spawn-process/session-terminator.js";
import { composeIdentityKey } from "../identity-key.js";
import { createReclaimGiveUpTracker } from "../reclaim-give-up.js";

const OK: TerminateResult = { outcome: "confirmed-dead", terminated: true };

const cfg = (over = {}) => () => ({
  ...DEFAULT_EMBED_LIFECYCLE,
  enabled: true,
  maxActiveEmbedSessionsPerVisitor: 2,
  maxActiveEmbedSessionsGlobal: 3,
  ...over,
});
const keyFor = (v: string) => composeIdentityKey(v, "/w", "a");

function info(over: Partial<CapSessionInfo> & { sessionId: string }): CapSessionInfo {
  return { visitorId: "v1", quiescent: false, lastActivityAt: 0, ...over };
}

describe("caps admission", () => {
  // E17 — at the per-visitor cap with a quiescent candidate: reclaim the OLDEST
  // quiescent, then admit.
  it("reclaims the oldest quiescent session at the per-visitor cap", async () => {
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    const active: CapSessionInfo[] = [
      info({ sessionId: "old", quiescent: true, lastActivityAt: 100 }),
      info({ sessionId: "new", quiescent: true, lastActivityAt: 900 }),
    ];
    const { admit } = createCapsAdmission({
      config: cfg(),
      listEphemeralActive: () => active,
      reclaim,
    });
    await admit(keyFor("v1")); // perVisitor 2 >= cap 2 → reclaim
    expect(reclaim).toHaveBeenCalledWith("old"); // oldest quiescent
  });

  // X3 — at the cap with every candidate busy: structured error, nothing killed.
  it("throws CapacityError and terminates nothing when all candidates are busy", async () => {
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    const active = [
      info({ sessionId: "a", quiescent: false }),
      info({ sessionId: "b", quiescent: false }),
    ];
    const onCapacityReject = vi.fn();
    const { admit } = createCapsAdmission({
      config: cfg(),
      listEphemeralActive: () => active,
      reclaim,
      onCapacityReject,
    });
    await expect(admit(keyFor("v1"))).rejects.toBeInstanceOf(CapacityError);
    expect(reclaim).not.toHaveBeenCalled();
    expect(onCapacityReject).toHaveBeenCalledTimes(1);
  });

  // E18 — a durable session at the cap boundary is never counted (durable
  // sessions are simply absent from listEphemeralActive).
  it("counts only ephemeral sessions (durable are not listed)", async () => {
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    // Only ONE ephemeral active, under the per-visitor cap of 2 → admit, no reclaim.
    const active = [info({ sessionId: "e1", quiescent: true, lastActivityAt: 1 })];
    const { admit } = createCapsAdmission({
      config: cfg(),
      listEphemeralActive: () => active,
      reclaim,
    });
    await admit(keyFor("v1"));
    expect(reclaim).not.toHaveBeenCalled();
  });

  // E19 — the GLOBAL cap bounds a spoofer minting distinct visitorIds: even
  // though each visitor is under the per-visitor cap, the global cap forces a
  // reclaim (adversarial breach reclaims across ALL visitors).
  it("uses the global cap as the hard bound across spoofed visitorIds", async () => {
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    // 3 active from 3 distinct visitors = global cap (3); each visitor only 1
    // (under per-visitor 2). A 4th distinct-visitor acquire must reclaim.
    const active = [
      info({ sessionId: "s1", visitorId: "v1", quiescent: true, lastActivityAt: 300 }),
      info({ sessionId: "s2", visitorId: "v2", quiescent: true, lastActivityAt: 100 }),
      info({ sessionId: "s3", visitorId: "v3", quiescent: false }),
    ];
    const { admit } = createCapsAdmission({
      config: cfg(),
      listEphemeralActive: () => active,
      reclaim,
    });
    await admit(keyFor("v4")); // over global → reclaim oldest quiescent across all
    expect(reclaim).toHaveBeenCalledWith("s2"); // oldest quiescent globally
  });

  // X3 (global) — over the global cap with only busy candidates → CapacityError.
  it("throws when over the global cap and no candidate is quiescent", async () => {
    const active = [
      info({ sessionId: "s1", visitorId: "v1", quiescent: false }),
      info({ sessionId: "s2", visitorId: "v2", quiescent: false }),
      info({ sessionId: "s3", visitorId: "v3", quiescent: false }),
    ];
    const { admit } = createCapsAdmission({
      config: cfg(),
      listEphemeralActive: () => active,
      reclaim: vi.fn(async (): Promise<TerminateResult> => OK),
    });
    await expect(admit(keyFor("v4"))).rejects.toBeInstanceOf(CapacityError);
  });

  it("does not double-select a victim already in the shared reclaim guard", async () => {
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    const guard = new Set<string>(["old"]);
    const active = [
      info({ sessionId: "old", quiescent: true, lastActivityAt: 100 }),
      info({ sessionId: "new", quiescent: true, lastActivityAt: 900 }),
    ];
    const { admit } = createCapsAdmission({
      config: cfg({ maxActiveEmbedSessionsPerVisitor: 1 }),
      listEphemeralActive: () => active,
      reclaim,
      reclaimGuard: guard,
    });
    await admit(keyFor("v1")); // "old" is guarded → reclaim "new"
    expect(reclaim).toHaveBeenCalledWith("new");
  });

  // E19 — a given-up victim is skipped; the next quiescent one is reclaimed.
  it("never picks a given-up session as victim", async () => {
    const giveUp = createReclaimGiveUpTracker();
    giveUp.recordFailure("old", "no-identity");
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    const active = [
      info({ sessionId: "old", quiescent: true, lastActivityAt: 100 }),
      info({ sessionId: "new", quiescent: true, lastActivityAt: 900 }),
    ];
    const { admit } = createCapsAdmission({ config: cfg(), listEphemeralActive: () => active, reclaim, giveUp });
    await admit(keyFor("v1"));
    expect(reclaim).toHaveBeenCalledTimes(1);
    expect(reclaim).toHaveBeenCalledWith("new");
  });

  // E20 — all given-up: all-busy branch; they still count toward the cap.
  it("throws the all-busy CapacityError when every quiescent candidate is given up", async () => {
    const giveUp = createReclaimGiveUpTracker();
    giveUp.recordFailure("a", "no-identity");
    giveUp.recordFailure("b", "no-identity");
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    const active = [info({ sessionId: "a", quiescent: true }), info({ sessionId: "b", quiescent: true })];
    const { admit } = createCapsAdmission({ config: cfg(), listEphemeralActive: () => active, reclaim, giveUp });
    const err = await admit(keyFor("v1")).catch((e) => e);
    expect(err).toBeInstanceOf(CapacityError);
    expect((err as CapacityError).code).toBe("EMBED_CAPACITY");
    expect(reclaim).not.toHaveBeenCalled();
  });

  // X12 — unconfirmed: refuse, one victim only, guard released, failure recorded.
  it("refuses admission when the reclaim is not confirmed (exactly one victim, guard released)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const giveUp = createReclaimGiveUpTracker();
    const guard = new Set<string>();
    const onReclaimFailed = vi.fn();
    const reclaim = vi.fn(
      async (): Promise<TerminateResult> => ({ outcome: "unconfirmed", terminated: false, pid: 9 }),
    );
    const active = [
      info({ sessionId: "old", quiescent: true, lastActivityAt: 100 }),
      info({ sessionId: "new", quiescent: true, lastActivityAt: 900 }),
    ];
    const { admit } = createCapsAdmission({
      config: cfg(),
      listEphemeralActive: () => active,
      reclaim,
      reclaimGuard: guard,
      giveUp,
      onReclaimFailed,
    });
    const err = await admit(keyFor("v1")).catch((e) => e);
    expect(err).toBeInstanceOf(CapacityError);
    expect((err as CapacityError).code).toBe("EMBED_CAPACITY");
    expect((err as CapacityError).message).toContain("could not be confirmed");
    expect(reclaim).toHaveBeenCalledTimes(1);
    expect(guard.size).toBe(0);
    expect(onReclaimFailed).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  // X13 — a confirmed reclaim admits and clears give-up state.
  it("admits after a confirmed reclaim", async () => {
    const giveUp = createReclaimGiveUpTracker();
    giveUp.recordFailure("old", "unconfirmed");
    const reclaim = vi.fn(async (): Promise<TerminateResult> => OK);
    const active = [info({ sessionId: "old", quiescent: true }), info({ sessionId: "new", quiescent: false })];
    const { admit } = createCapsAdmission({ config: cfg(), listEphemeralActive: () => active, reclaim, giveUp });
    await expect(admit(keyFor("v1"))).resolves.toBeUndefined();
  });
});
