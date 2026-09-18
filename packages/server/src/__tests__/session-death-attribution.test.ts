import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecoveryCandidate } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { sessionFromMeta } from "../session/session-scanner.js";

function row(over: Partial<DashboardSession> & { id: string; cwd: string }): DashboardSession {
  return { source: "tui", status: "active", startedAt: 1_000, hidden: false, ...over } as DashboardSession;
}

/**
 * Central `→ ended` stamp (design D1 option B).
 * See change: stop-discarding-known-session-state (test-plan E9/E10/E13).
 */
describe("session death attribution — central stamp", () => {
  it("E9: unregister stamps `unknown` when the path has no better information", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a" }));

    sm.unregister("s1");

    expect(sm.get("s1")!.status).toBe("ended");
    expect(sm.get("s1")!.closedReason).toBe("unknown");
  });

  it("E9: an update() transition to ended stamps `unknown`", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a" }));

    sm.update("s1", { status: "ended", endedAt: 5 });

    expect(sm.get("s1")!.closedReason).toBe("unknown");
  });

  it("E9: an explicit reason is preserved over the default", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a" }));

    sm.unregister("s1", { closedReason: "spawn_failed" });

    expect(sm.get("s1")!.closedReason).toBe("spawn_failed");
  });

  it("E10: a no-op re-entry on an already-ended session never overwrites a good reason", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a" }));
    sm.unregister("s1", { closedReason: "process_gone" });

    // A further `update()` that sets status ended again, and a duplicate
    // unregister, must both leave the original reason alone.
    sm.update("s1", { status: "ended" });
    sm.unregister("s1");

    expect(sm.get("s1")!.closedReason).toBe("process_gone");
  });

  it("E13: a manual close stays exactly `manual`", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a" }));

    sm.unregister("s1", { closedReason: "manual" });

    expect(sm.get("s1")!.closedReason).toBe("manual");
  });

  it("E13: a manual force-kill update stays exactly `manual`", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a" }));

    sm.update("s1", { status: "ended", endedAt: 9, closedReason: "manual" });

    expect(sm.get("s1")!.closedReason).toBe("manual");
  });
});

describe("classifyCarrierLoss", () => {
  it("E14: no recorded pid yields `unknown` (never claims the process is gone)", async () => {
    const { classifyCarrierLoss } = await import("../session/death-reason.js");
    expect(classifyCarrierLoss({ pid: undefined })).toBe("unknown");
    expect(classifyCarrierLoss({})).toBe("unknown");
  });

  it("E14: a REMOTE-origin pid is never probed locally — `unknown`, not `process_gone`", async () => {
    const { classifyCarrierLoss } = await import("../session/death-reason.js");
    const kill = () => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    };
    // The pid belongs to ANOTHER host's PID namespace; a local ESRCH says
    // nothing about a remote process (a running remote pi behind a dropped
    // tunnel is the common case), so the probe must not run at all.
    expect(classifyCarrierLoss({ pid: 4242, originDeviceId: "remote-host" }, { kill })).toBe("unknown");
  });

  it("E14: an ESRCH probe yields `process_gone`", async () => {
    const { classifyCarrierLoss } = await import("../session/death-reason.js");
    const kill = () => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    };
    expect(classifyCarrierLoss({ pid: 4242 }, { kill })).toBe("process_gone");
  });

  it("E14: a live (possibly recycled) pid downgrades to `unknown`", async () => {
    const { classifyCarrierLoss } = await import("../session/death-reason.js");
    expect(classifyCarrierLoss({ pid: 4242 }, { kill: () => {} })).toBe("unknown");
  });

  it("E14: an unprobeable pid (EPERM) is `unknown`", async () => {
    const { classifyCarrierLoss } = await import("../session/death-reason.js");
    const kill = () => {
      const err = new Error("not permitted") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    };
    expect(classifyCarrierLoss({ pid: 4242 }, { kill })).toBe("unknown");
  });
});

/**
 * E16 — the recovery predicate is NOT modified: only `manual` excludes, so
 * every new involuntary value passes through unchanged.
 * See change: stop-discarding-known-session-state.
 */
describe("isRecoveryCandidate — vocabulary pass-through", () => {
  it("E16: process_gone / spawn_failed / unknown all remain candidates; manual does not", () => {
    for (const reason of ["process_gone", "spawn_failed", "unknown"] as const) {
      expect(isRecoveryCandidate({ live: true, status: "idle", closedReason: reason } as any)).toBe(true);
    }
    expect(isRecoveryCandidate({ live: true, status: "idle", closedReason: "manual" } as any)).toBe(false);
  });
});

/**
 * E17 — cold-start reconstruction does not synthesize reasons. A pre-change
 * sidecar without `closedReason` stays absent; history is not retro-labelled
 * `unknown`.
 * See change: stop-discarding-known-session-state.
 */
describe("sessionFromMeta — cold start does not retro-label", () => {
  it("E17: a sidecar without a closedReason reconstructs with none", () => {
    const dir = mkdtempSync(join(tmpdir(), "scanner-reason-"));
    const file = join(dir, "legacy.jsonl");
    writeFileSync(file, "");

    const session = sessionFromMeta("legacy", file, dir, { status: "ended" }, 1_000);

    expect(session.closedReason).toBeUndefined();
  });
});

/**
 * E12 — no IMPLICIT write path revives an ended record. The registry reconcile
 * rule "a record that is no longer ended means the id was re-registered"
 * depends on this: `unregister`, `remove`, and `restore` all leave an ended
 * record ended. See change: close-registry-frame-shed-gaps (test-plan #E12).
 *
 * Scope, deliberately: a partial `update` carrying an explicit non-ended
 * `status` is OUTSIDE the invariant — the event path really does write status
 * deltas through `update` (`event-wiring.ts`), so guarding it here would change
 * event-application semantics well beyond this change. The reconcile rule is
 * unharmed either way, because it reads the record's status AT FLUSH TIME and
 * so delivers whatever the record actually holds.
 */
describe("no write path revives an ended record implicitly (E12)", () => {
  it("enumerates every write path: none of the implicit paths yields a non-ended status", () => {
    // register → active
    const a = createMemorySessionManager();
    expect(a.register({ id: "r", cwd: "/a", source: "tui" }).status).not.toBe("ended");

    // unregister → ended
    const b = createMemorySessionManager();
    b.register({ id: "r", cwd: "/a", source: "tui" });
    b.unregister("r");
    expect(b.get("r")!.status).toBe("ended");

    // update to ended → ended
    const c = createMemorySessionManager();
    c.register({ id: "r", cwd: "/a", source: "tui" });
    c.update("r", { status: "ended", endedAt: 1 });
    expect(c.get("r")!.status).toBe("ended");

    // restore of an ended record → STAYS ended (never revived without register)
    const d = createMemorySessionManager();
    d.restore(row({ id: "e", cwd: "/a", status: "ended" }));
    expect(d.get("e")!.status).toBe("ended");

    // remove → gone entirely, so trivially not a non-ended record
    const e = createMemorySessionManager();
    e.register({ id: "r", cwd: "/a", source: "tui" });
    e.remove("r");
    expect(e.get("r")).toBeUndefined();

    // The documented EXCEPTION: an explicit non-ended `status` through the
    // generic partial `update`. Pinned so the boundary is deliberate: if a
    // future change starts enforcing the invariant inside `update`, this
    // assertion is the one that fails and forces the decision to be made
    // consciously (the event path depends on the current behaviour).
    const f = createMemorySessionManager();
    f.register({ id: "r", cwd: "/a", source: "tui" });
    f.unregister("r");
    f.update("r", { status: "streaming" });
    expect(f.get("r")!.status).toBe("streaming");
  });

  it("a restored ended record is not silently revived by a later unrelated write", () => {
    const sm = createMemorySessionManager();
    sm.restore(row({ id: "s1", cwd: "/a", status: "ended" }));
    sm.update("s1", { name: "renamed" });
    sm.listAll();
    sm.snapshotVisibleIds();
    expect(sm.get("s1")!.status).toBe("ended");
  });
});
