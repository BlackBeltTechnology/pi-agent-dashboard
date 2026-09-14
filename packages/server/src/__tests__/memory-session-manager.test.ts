import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  createMemorySessionManager,
  type SnapshotOrders,
} from "../session/memory-session-manager.js";

// ── Snapshot window (D4) — see change: fix-connect-snapshot-frame-loss ──────
// E12–E18/P1, X7. The window bounds the connect `sessions_snapshot` so the
// bootstrap frame stays under budget on a large registry.

type Row = Partial<DashboardSession> & { id: string; cwd: string };

function makeRow(over: Row): DashboardSession {
  return {
    source: "tui",
    status: "active",
    startedAt: 1_000,
    hidden: false,
    ...over,
  } as DashboardSession;
}

function endedRow(id: string, cwd: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return makeRow({ id, cwd, status: "ended", endedAt: 2_000, startedAt: 1_500, ...over });
}

/** Minimal persisted-order stub (structural subset of SessionOrderManager). */
function fakeOrders(map: Record<string, string[]>): SnapshotOrders {
  return {
    getOrder: (g) => [...(map[g] ?? [])],
    getAllOrders: () => map,
  };
}

/** Seed 120+ ended sessions NEWER than `olderThan` so the global window is full past them. */
function seedGlobalWindowFiller(sm: ReturnType<typeof createMemorySessionManager>, olderThan: number, count = 130): void {
  for (let i = 0; i < count; i++) {
    sm.restore(endedRow(`gx-${i}`, `/other/g${i % 5}`, { endedAt: olderThan + 10_000 + i, startedAt: olderThan + 9_000 + i }));
  }
}

describe("memory-session-manager — snapshot window (D4)", () => {
  it("E12: live + per-group first-3 visible, mid-sequence ended absent, orders ⊆ sessions", () => {
    const sm = createMemorySessionManager(
      undefined,
      fakeOrders({ "/g": ["live1", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"] }),
    );
    sm.restore(makeRow({ id: "live1", cwd: "/g" }));
    for (let i = 1; i <= 10; i++) {
      sm.restore(endedRow(`e${i}`, "/g", { endedAt: 2_000 + i }));
    }
    // 200 newer ended elsewhere → the global-120 window is filled past every e*.
    seedGlobalWindowFiller(sm, 2_011, 200);

    const snap = sm.buildSnapshot([]);
    const ids = new Set(snap.sessions.map((s) => s.id));
    expect(ids.has("live1")).toBe(true);
    for (const id of ["e1", "e2", "e3"]) expect(ids.has(id), `${id} in first-3 window`).toBe(true);
    for (const id of ["e4", "e5", "e6", "e7", "e8", "e9", "e10"]) expect(ids.has(id), `${id} outside window`).toBe(false);
    // Every id referenced by any order exists in sessions.
    for (const ids2 of Object.values(snap.orders)) {
      for (const id of ids2) expect(ids.has(id)).toBe(true);
    }
    expect(snap.endedTotals["/g"]).toBe(10);
  });

  it("E13: exactly 120 of 121 ended kept, oldest absent, endedTotals sums to 121", () => {
    const sm = createMemorySessionManager();
    for (let i = 0; i < 121; i++) {
      sm.restore(endedRow(`e${String(i).padStart(3, "0")}`, `/old/${i % 7}`, { endedAt: 5_000 + i, startedAt: 4_000 + i }));
    }
    const snap = sm.buildSnapshot([]);
    expect(snap.sessions).toHaveLength(120);
    const ids = new Set(snap.sessions.map((s) => s.id));
    expect(ids.has("e000")).toBe(false); // oldest endedAt
    expect(ids.has("e120")).toBe(true);  // newest endedAt
    expect(Object.values(snap.endedTotals).reduce((a, b) => a + b, 0)).toBe(121);
  });

  it("E14: an ended worktree session counts toward its parent group key", () => {
    const sm = createMemorySessionManager();
    sm.restore(makeRow({ id: "p-live", cwd: "/p" }));
    sm.restore(endedRow("w1", "/p/.worktrees/x", { gitWorktree: { mainPath: "/p", name: "x" } }));

    const snap = sm.buildSnapshot([]);
    const ids = new Set(snap.sessions.map((s) => s.id));
    expect(ids.has("w1")).toBe(true);
    expect(snap.endedTotals["/p"]).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(snap.endedTotals, "/p/.worktrees/x")).toBe(false);
  });

  it("E15: a pinned group with no live session gets its first-3; unpinned it does not", () => {
    const sm = createMemorySessionManager();
    for (let i = 1; i <= 5; i++) {
      sm.restore(endedRow(`q${i}`, "/q", { endedAt: 1_000 + i, startedAt: 500 + i })); // older than the global filler
    }
    seedGlobalWindowFiller(sm, 2_000);

    const pinned = sm.buildSnapshot(["/q"]);
    const pinnedIds = new Set(pinned.sessions.map((s) => s.id).filter((id) => id.startsWith("q")));
    expect([...pinnedIds].sort()).toEqual(["q3", "q4", "q5"]); // first-3 of startedAt-desc sequence

    const unpinned = sm.buildSnapshot([]);
    expect(unpinned.sessions.map((s) => s.id).filter((id) => id.startsWith("q"))).toEqual([]);
    // endedTotals still counts the group regardless of window/pinning.
    expect(pinned.endedTotals["/q"]).toBe(5);
    expect(unpinned.endedTotals["/q"]).toBe(5);
  });

  it("E16: a group whose only non-ended session is `idle` receives its first-3", () => {
    const sm = createMemorySessionManager();
    sm.restore(makeRow({ id: "h-idle", cwd: "/h", status: "idle" }));
    for (let i = 1; i <= 3; i++) {
      sm.restore(endedRow(`h${i}`, "/h", { endedAt: 1_000 + i, startedAt: 500 + i }));
    }
    seedGlobalWindowFiller(sm, 2_000);

    const snap = sm.buildSnapshot([]);
    const ids = new Set(snap.sessions.map((s) => s.id));
    for (const id of ["h-idle", "h1", "h2", "h3"]) expect(ids.has(id), `${id}`).toBe(true);
  });

  it("E17: snapshot rows omit notifyLog; the registry object keeps it (shallow copy)", () => {
    const sm = createMemorySessionManager();
    sm.restore(makeRow({
      id: "chatty",
      cwd: "/c",
      notifyLog: Array.from({ length: 50 }, (_, i) => ({ notifyId: `n${i}`, message: `m${i}` })),
    }));
    sm.restore(endedRow("quiet", "/c", {
      notifyLog: [{ notifyId: "q1", message: "bye" }, { notifyId: "q2", message: "bye2" }, { notifyId: "q3", message: "bye3" }],
    }));

    const snap = sm.buildSnapshot([]);
    expect(snap.sessions.length).toBe(2);
    for (const row of snap.sessions) {
      expect(Object.prototype.hasOwnProperty.call(row, "notifyLog")).toBe(false);
    }
    expect(sm.get("chatty")?.notifyLog).toHaveLength(50);
    expect(sm.get("quiet")?.notifyLog).toHaveLength(3);
  });

  it("X7: registry mutation mid-build keeps the snapshot self-consistent (orders ⊆ sessions)", () => {
    const sm = createMemorySessionManager(undefined, fakeOrders({ "/r": ["flippy", "r2"] }));
    // `status` flips to "ended" after the first read — the session ends
    // between snapshotVisibleIds and row projection.
    let reads = 0;
    const flippy = {
      id: "flippy",
      cwd: "/r",
      source: "tui",
      startedAt: 1_000,
      hidden: false,
      get status() {
        reads++;
        return reads < 3 ? "active" : "ended";
      },
    } as unknown as DashboardSession;
    sm.restore(flippy);
    sm.restore(endedRow("r2", "/r"));

    const snap = sm.buildSnapshot([]);
    const ids = new Set(snap.sessions.map((s) => s.id));
    for (const orderIds of Object.values(snap.orders)) {
      for (const id of orderIds) expect(ids.has(id)).toBe(true);
    }
  });
});

describe("memory-session-manager — snapshot byte bound (E18/P1, fixture rows)", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../__fixtures__/measured-session.json", import.meta.url)), "utf8"),
  ) as { live: DashboardSession; ended: DashboardSession };

  it("fixture rows match the measured shapes (guard the guard)", () => {
    const { notifyLog: _l, ...liveStripped } = fixture.live;
    const { notifyLog: _e, ...endedStripped } = fixture.ended;
    // live ≈ 6.7 KB total / ended ≈ 1.0 KB — measured 2026-09-12 registry.
    expect(JSON.stringify(fixture.live).length).toBeGreaterThan(6_000);
    expect(JSON.stringify(fixture.ended).length).toBeGreaterThan(900);
    // Stripped rows must not be degenerate — the 400 KB bound must be met by
    // the window, not by starving row content.
    expect(JSON.stringify(liveStripped).length).toBeGreaterThan(2_000);
    expect(JSON.stringify(endedStripped).length).toBeGreaterThan(700);
  });

  it("E18/P1: 25 live + 4,000 ended / 400 groups / 20 pinned serializes ≤ 400 KB; live part ≤ 100 KB", () => {
    const groups = Array.from({ length: 400 }, (_, i) => `/srv/g${String(i).padStart(3, "0")}`);
    const liveGroups = groups.slice(0, 25);
    const pinnedGroups = groups.slice(375, 395); // 20 pinned groups, none with a live session
    const orders: Record<string, string[]> = {};

    for (const [gi, g] of liveGroups.entries()) {
      orders[g] = [`live-${gi}`];
    }
    // 4,000 ended = 10 per group, distinct descending endedAt → the global-120
    // window is the newest 120 (i ∈ [3880, 3999]).
    for (let i = 0; i < 4_000; i++) {
      (orders[groups[i % 400]] ??= []).push(`ended-${String(i).padStart(4, "0")}`);
    }
    const sm = createMemorySessionManager(undefined, fakeOrders(orders));

    for (const [gi, g] of liveGroups.entries()) {
      const id = `live-${gi}`;
      sm.restore({ ...fixture.live, id, cwd: g, sessionFile: `/home/dev/.pi/agent/sessions/${id}.jsonl`, startedAt: 9_000_000 + gi, status: "active" });
    }
    for (let i = 0; i < 4_000; i++) {
      const g = groups[i % 400];
      const id = `ended-${String(i).padStart(4, "0")}`;
      sm.restore({
        ...fixture.ended,
        id,
        cwd: g,
        sessionFile: `/home/dev/.pi/agent/sessions/${id}.jsonl`,
        startedAt: 1_000_000 + i,
        endedAt: 2_000_000 + i,
        status: "ended",
      });
    }

    const snap = sm.buildSnapshot(pinnedGroups);
    const serialized = JSON.stringify(snap);
    expect(serialized.length).toBeLessThanOrEqual(400 * 1024);
    const livePart = JSON.stringify(snap.sessions.filter((s) => s.status !== "ended"));
    expect(livePart.length).toBeLessThanOrEqual(100 * 1024);
    // The window is not degenerate: both live and ended rows are present.
    expect(snap.sessions.filter((s) => s.status !== "ended")).toHaveLength(25);
    expect(snap.sessions.filter((s) => s.status === "ended").length).toBeGreaterThan(120);
    expect(Object.keys(snap.endedTotals)).toHaveLength(400);
  });
});

describe("memory-session-manager", () => {
  it("registers a session", () => {
    const sm = createMemorySessionManager();
    const session = sm.register({
      id: "s1",
      cwd: "/tmp",
      source: "tui",
      name: "Test",
    });
    expect(session.id).toBe("s1");
    expect(session.status).toBe("active");
    expect(session.name).toBe("Test");
  });

  it("gets session by id", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    expect(sm.get("s1")).toBeDefined();
    expect(sm.get("nonexistent")).toBeUndefined();
  });

  it("unregisters session", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.unregister("s1");
    const s = sm.get("s1");
    expect(s?.status).toBe("ended");
    expect(s?.endedAt).toBeDefined();
  });

  it("updates session", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.update("s1", { tokensIn: 100, model: "test/model" });
    expect(sm.get("s1")?.tokensIn).toBe(100);
    expect(sm.get("s1")?.model).toBe("test/model");
  });

  it("updates hidden state on session object", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.update("s1", { hidden: true });
    expect(sm.get("s1")?.hidden).toBe(true);
  });

  it("listActive excludes ended sessions", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.register({ id: "s2", cwd: "/tmp", source: "tui" });
    sm.unregister("s1");
    expect(sm.listActive()).toHaveLength(1);
    expect(sm.listActive()[0].id).toBe("s2");
  });

  it("listAll includes all sessions", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.register({ id: "s2", cwd: "/tmp", source: "tui" });
    sm.unregister("s1");
    expect(sm.listAll()).toHaveLength(2);
  });

  it("starts empty after creation", () => {
    const sm = createMemorySessionManager();
    expect(sm.listAll()).toHaveLength(0);
  });

  // ── Auto-hide headless non-dashboard sessions at first register ──────────
  // See change: auto-hide-headless-worker-sessions.
  describe("auto-hide at first register", () => {
    it("hides a headless non-dashboard worker by default", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false });
      expect(s.hidden).toBe(true);
    });

    it("keeps a TUI session visible", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "t1", cwd: "/tmp", source: "tui", hasUI: true });
      expect(s.hidden).toBe(false);
    });

    // E24 — the signal, not `source`: at register time the bridge still
    // self-reports "tui"; `decideDashboardSource` has not run yet.
    // See change: fix-spawn-correlation-ttl-coupling (D3).
    it("keeps a dashboard-spawned headless session visible, on the signal not the source", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({
        id: "d1", cwd: "/tmp", source: "tui", hasUI: false, dashboardSpawned: true,
      });
      expect(s.hidden).toBe(false);
    });

    // E25 — no signal: a genuine headless worker still hides.
    it("hides a headless first register carrying no dashboard-spawn signal", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "w2", cwd: "/tmp", source: "tui", hasUI: false });
      expect(s.hidden).toBe(true);
    });

    // E26 — explicit intent still outranks the heuristic.
    it("honors visibilityIntent 'visible' over the missing signal", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({
        id: "v2", cwd: "/tmp", source: "tui", hasUI: false, visibilityIntent: "visible",
      });
      expect(s.hidden).toBe(false);
    });

    // E27 — reattach precedence untouched: the heuristic is not consulted.
    it("keeps a prior hidden=true across reattach without consulting the heuristic", () => {
      const sm = createMemorySessionManager();
      sm.register({ id: "r1", cwd: "/tmp", source: "tui", hasUI: false });
      expect(sm.get("r1")?.hidden).toBe(true);
      const re = sm.register({
        id: "r1", cwd: "/tmp", source: "tui", registerReason: "reattach", dashboardSpawned: true,
      });
      expect(re.hidden).toBe(true);
    });

    // E28 — a non-`true` signal must not un-hide.
    it("does not un-hide on a non-boolean dashboardSpawned value", () => {
      const sm = createMemorySessionManager();
      for (const [i, bogus] of ["yes", 1, {}, null].entries()) {
        const s = sm.register({
          id: `n${i}`, cwd: "/tmp", source: "tui", hasUI: false,
          dashboardSpawned: bogus as any,
        });
        expect(s.hidden).toBe(true);
      }
    });

    it("does not auto-hide when hasUI is absent (legacy bridge)", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "l1", cwd: "/tmp", source: "tui" });
      expect(s.hidden).toBe(false);
    });

    it("honors visibilityIntent 'visible' on a headless session", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "v1", cwd: "/tmp", source: "tui", hasUI: false, visibilityIntent: "visible" });
      expect(s.hidden).toBe(false);
    });

    it("honors visibilityIntent 'hidden' on a TUI session", () => {
      const sm = createMemorySessionManager();
      const s = sm.register({ id: "h1", cwd: "/tmp", source: "tui", hasUI: true, visibilityIntent: "hidden" });
      expect(s.hidden).toBe(true);
    });
  });

  describe("auto-hide is one-shot; manual state survives re-registration", () => {
    it("preserves a manual unhide across a reattach register", () => {
      const sm = createMemorySessionManager();
      // First register auto-hides the worker.
      sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false });
      expect(sm.get("w1")?.hidden).toBe(true);
      // User manually unhides.
      sm.update("w1", { hidden: false });
      // Worker reconnects (reattach) — still headless, but manual unhide sticks.
      const re = sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false, registerReason: "reattach" });
      expect(re.hidden).toBe(false);
    });

    it("preserves a manual hide across a reattach register", () => {
      const sm = createMemorySessionManager();
      sm.register({ id: "t1", cwd: "/tmp", source: "tui", hasUI: true });
      sm.update("t1", { hidden: true });
      const re = sm.register({ id: "t1", cwd: "/tmp", source: "tui", hasUI: true, registerReason: "reattach" });
      expect(re.hidden).toBe(true);
    });

    it("reattach sources hidden from a restored (persisted) record", () => {
      const sm = createMemorySessionManager();
      // Simulate server restart: registry rebuilt from persistence with a
      // manually-unhidden worker. `restore` seeds the record directly.
      sm.restore({
        id: "w1", cwd: "/tmp", source: "tui", status: "ended",
        startedAt: Date.now(), hidden: false, tokensIn: 0, tokensOut: 0, cost: 0,
      } as any);
      // Bridge reattaches after the restart — headless, would otherwise re-hide.
      const re = sm.register({ id: "w1", cwd: "/tmp", source: "tui", hasUI: false, registerReason: "reattach" });
      expect(re.hidden).toBe(false);
    });
  });

  it("onChange receives sessionId", () => {
    const sm = createMemorySessionManager();
    const ids: string[] = [];
    sm.onChange = (sessionId) => ids.push(sessionId);
    sm.register({ id: "s1", cwd: "/tmp", source: "tui" });
    sm.update("s1", { tokensIn: 50 });
    sm.unregister("s1");
    expect(ids).toEqual(["s1", "s1", "s1"]);
  });

  // D2b: gitWorktree carried over only when cwd is unchanged, so a server
  // restart / bridge reconnect during the worktree-removal window cannot
  // re-open the clear. See change: fix-worktree-grouping-lost-on-remove.
  describe("gitWorktree carry-over across reattach", () => {
    it("E7: same-cwd reattach preserves parentage", () => {
      const sm = createMemorySessionManager();
      sm.register({ id: "w1", cwd: "/repo/.worktrees/x", source: "tui" });
      sm.update("w1", { gitWorktree: { mainPath: "/repo", name: "x" } });
      sm.register({ id: "w1", cwd: "/repo/.worktrees/x", source: "tui", registerReason: "reattach" });
      expect(sm.get("w1")?.gitWorktree).toEqual({ mainPath: "/repo", name: "x" });
    });

    it("E8: different-cwd reattach resets parentage", () => {
      const sm = createMemorySessionManager();
      sm.register({ id: "w1", cwd: "/repo/.worktrees/x", source: "tui" });
      sm.update("w1", { gitWorktree: { mainPath: "/repo", name: "x" } });
      sm.register({ id: "w1", cwd: "/elsewhere", source: "tui" });
      expect(sm.get("w1")?.gitWorktree).toBeUndefined();
    });
  });
});
