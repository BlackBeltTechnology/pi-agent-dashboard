/**
 * The ended-always-has-an-evidence-based-endedAt invariant.
 *
 * Folded 1:1 from the change's test-plan manifest: E1–E12 and X1–X4.
 * See change: fix-ended-session-missing-endedat.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { deriveEndedAt, type EndedAtEvidence } from "../session/derive-ended-at.js";
import { createMemorySessionManager, type SessionManager } from "../session/memory-session-manager.js";
import { reconcileSessionOrder, type ReconcileSession } from "../session/reconcile-session-order.js";

const dir = mkdtempSync(join(tmpdir(), "endedat-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Write a transcript whose mtime is exactly `mtimeMs` — the evidence file. */
function transcript(name: string, mtimeMs: number): string {
  const p = join(dir, name);
  writeFileSync(p, "{}\n");
  utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  return p;
}

function session(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo",
    source: "tui",
    status: "active",
    startedAt: 1_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...over,
  } as DashboardSession;
}

/** Register a live session into a manager and return it. */
function live(mgr: SessionManager, over: Partial<DashboardSession> = {}): DashboardSession {
  mgr.register({ id: "s1", cwd: "/repo", source: "tui", startedAt: 1_000 });
  mgr.update("s1", over);
  return mgr.get("s1") as DashboardSession;
}

describe("R1 — a session that is ended always has an end timestamp", () => {
  it("E1: ending without a supplied timestamp stamps one", () => {
    const mgr = createMemorySessionManager();
    live(mgr, { lastActivityAt: 5_000 });
    expect(mgr.get("s1")?.endedAt).toBeUndefined();

    mgr.update("s1", { status: "ended" });

    expect(typeof mgr.get("s1")?.endedAt).toBe("number");
  });

  it("E2: an explicitly supplied timestamp is preserved", () => {
    const mgr = createMemorySessionManager();
    live(mgr, { lastActivityAt: 5_000 });

    mgr.update("s1", { status: "ended", endedAt: 1_700_000_000_000 });

    expect(mgr.get("s1")?.endedAt).toBe(1_700_000_000_000);
  });

  it("E3: re-ending does not move the timestamp", () => {
    const mgr = createMemorySessionManager();
    live(mgr, { lastActivityAt: 5_000 });
    mgr.update("s1", { status: "ended", endedAt: 4_242 });

    mgr.update("s1", { status: "ended" });

    expect(mgr.get("s1")?.endedAt).toBe(4_242);
  });

  it("E4: restore() — the bare sessions.set path — is covered by the invariant", () => {
    const mgr = createMemorySessionManager();

    mgr.restore(session({ status: "ended", lastActivityAt: 9_000 }));

    expect(typeof mgr.get("s1")?.endedAt).toBe("number");
  });

  it("E12: no filesystem work when the timestamp is already present", () => {
    const derive = vi.fn(deriveEndedAt);
    const mgr = createMemorySessionManager(derive);

    mgr.restore(session({ status: "ended", endedAt: 7_777, sessionFile: "/nope.jsonl" }));

    expect(derive).not.toHaveBeenCalled();
    expect(mgr.get("s1")?.endedAt).toBe(7_777);
  });

  it("E12b: an already-ended restore emits no onChange (D1a — no reorder storm)", () => {
    const mgr = createMemorySessionManager();
    const onChange = vi.fn();
    mgr.onChange = onChange;

    mgr.restore(session({ status: "ended" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(typeof mgr.get("s1")?.endedAt).toBe("number");
  });
});

describe("R2 — end timestamps are derived from evidence", () => {
  it("E5: recorded last activity wins over a differing transcript mtime", () => {
    const file = transcript("e5.jsonl", 50_000);
    const mgr = createMemorySessionManager();

    mgr.restore(session({ status: "ended", lastActivityAt: 20_000, sessionFile: file }));

    expect(mgr.get("s1")?.endedAt).toBe(20_000);
  });

  it("E6: transcript mtime is used when last activity is absent", () => {
    const file = transcript("e6.jsonl", 50_000);
    const mgr = createMemorySessionManager();

    mgr.restore(session({ status: "ended", sessionFile: file }));

    expect(mgr.get("s1")?.endedAt).toBe(50_000);
  });

  it("E7: startedAt is the fallback when no evidence exists", () => {
    const mgr = createMemorySessionManager();

    mgr.restore(session({ status: "ended", startedAt: 1_234, sessionFile: join(dir, "absent.jsonl") }));

    expect(mgr.get("s1")?.endedAt).toBe(1_234);
  });

  it("E8: a witnessed ending records the witnessed time, not last activity", () => {
    const mgr = createMemorySessionManager();
    const now = 10_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      live(mgr, { lastActivityAt: now - 60_000 });

      mgr.unregister("s1"); // default: the server observed this ending

      expect(mgr.get("s1")?.endedAt).toBe(now);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("X1: a timeout-inferred ending uses evidence, not detection time", () => {
    const mgr = createMemorySessionManager();
    const now = 10_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      live(mgr, { lastActivityAt: now - 300_000 });

      // Heartbeat / grace-period expiry: the end is only DETECTED now.
      mgr.unregister("s1", { witnessed: false });

      expect(mgr.get("s1")?.endedAt).toBe(now - 300_000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("X2: unreadable evidence degrades to startedAt without throwing", () => {
    const evidence: EndedAtEvidence = {
      sessionFile: join(dir, "does-not-exist.jsonl"),
      startedAt: 4_321,
    };

    expect(() => deriveEndedAt(evidence)).not.toThrow();
    expect(deriveEndedAt(evidence)).toBe(4_321);
  });

  it("X2b: one unreadable record does not stop the remaining restores", () => {
    const mgr = createMemorySessionManager();
    const good = transcript("x2b.jsonl", 60_000);

    mgr.restore(session({ id: "bad", status: "ended", startedAt: 11, sessionFile: join(dir, "gone.jsonl") }));
    mgr.restore(session({ id: "good", status: "ended", sessionFile: good }));

    expect(mgr.get("bad")?.endedAt).toBe(11);
    expect(mgr.get("good")?.endedAt).toBe(60_000);
  });

  it("X3: abandoned zombie normalisation carries evidence, not the normalisation time", () => {
    const mgr = createMemorySessionManager();
    const now = 10_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      // A zombie with NO sessionFile — the early-return path in
      // session-action-handler.ts:229-231 leaves the record `ended`.
      live(mgr, { lastActivityAt: now - 120_000, sessionFile: undefined });

      mgr.update("s1", { status: "ended" });

      expect(mgr.get("s1")?.endedAt).toBe(now - 120_000);
      expect(mgr.get("s1")?.endedAt).not.toBe(now);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("X4: history register→unregister takes its evidence value, not the add time", () => {
    const mgr = createMemorySessionManager();
    const file = transcript("x4.jsonl", 70_000);
    const now = 10_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      // The directory add/pin path: register from history, unregister at once.
      mgr.register({ id: "s1", cwd: "/repo", source: "tui", startedAt: 500, sessionFile: file });

      mgr.unregister("s1", { witnessed: false });

      expect(mgr.get("s1")?.endedAt).toBe(70_000);
      expect(mgr.get("s1")?.endedAt).not.toBe(now);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("derivation never returns the current time", () => {
    const now = 10_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect(deriveEndedAt({ startedAt: 1 })).toBe(1);
      expect(deriveEndedAt({ lastActivityAt: 2, startedAt: 1 })).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("R3 — ended-tier seeding uses the best known end time", () => {
  const key = () => "/repo";

  it("E11: seeds by end time, not start time", () => {
    // S1 started first but ended last; S2 started later but ended earlier.
    const sessions: ReconcileSession[] = [
      { id: "S1", status: "ended", startedAt: 10_00, endedAt: 12_00 },
      { id: "S2", status: "ended", startedAt: 11_00, endedAt: 11_30 },
    ];

    expect(reconcileSessionOrder({}, sessions, key)).toEqual({ "/repo": ["S1", "S2"] });
  });

  it("stored order is authoritative — supplying endedAt does not move a stored id", () => {
    const orders = { "/repo": ["S2", "S1"] };
    const sessions: ReconcileSession[] = [
      { id: "S1", status: "ended", startedAt: 10_00, endedAt: 12_00 },
      { id: "S2", status: "ended", startedAt: 11_00, endedAt: 11_30 },
    ];

    expect(reconcileSessionOrder(orders, sessions, key)).toEqual({});
  });
});

describe("R4 — liveness is status, not the end timestamp", () => {
  it("E9: a record missing its end timestamp is not live", () => {
    const mgr = createMemorySessionManager();
    // Bypass the invariant to model a legacy defective record already on disk.
    const bad = session({ status: "ended" });
    mgr.restore(bad);
    bad.endedAt = undefined;

    expect(mgr.listActive().map((s) => s.id)).not.toContain("s1");
    expect(mgr.listAll().map((s) => s.id)).toContain("s1");
  });

  it("E10: a live session legitimately has no end timestamp", () => {
    const mgr = createMemorySessionManager();
    live(mgr);

    expect(mgr.listActive().map((s) => s.id)).toContain("s1");
    expect(mgr.get("s1")?.endedAt).toBeUndefined();
  });
});
