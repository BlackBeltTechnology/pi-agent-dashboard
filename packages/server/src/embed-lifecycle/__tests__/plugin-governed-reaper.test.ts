/**
 * Idle reaper × plugin close policy (test-plan #E5, #E6, #E9, #E10, #E11,
 * #E14, #E17, #E18, #E20, #P1, #X1, #X2, #X3): declared sessions are governed
 * even with the feature off, undeclared behavior is unchanged, the declaring
 * plugin's closer is consulted (bounded, fail-to-keep), close requests skip
 * the closer, archive mode marks archive-on-end, and reaps of declared
 * sessions are attributed.
 * See change: add-session-close-plugin-hook.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOSER_SWEEP_BUDGET_MS,
  CLOSER_TIMEOUT_MS,
  type CloserOutcome,
  createIdleReaper,
  type ReaperDeps,
  type SessionCloser,
} from "../idle-reaper.js";
import { createSessionCloserRegistry, type SessionCloserRegistry } from "../plugin-session-close.js";
import type { ReapReason } from "../quiescence.js";

const NOW = 10_000_000;
const MIN = 60_000;

function session(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/work",
    source: "dashboard",
    status: "idle",
    startedAt: NOW - 10 * MIN,
    pid: 100,
    lastRunStartedAt: NOW - 9 * MIN,
    lastSettledAt: NOW - 8 * MIN,
    currentTool: null,
    lastActivityAt: NOW - 2 * 60 * MIN, // idle 2 h
    ...overrides,
  } as DashboardSession;
}

const declared = (over: Partial<DashboardSession> = {}, policy = {}) =>
  session({ closePolicy: { owner: "team", idleAfterMs: 30 * MIN, mode: "sleep", ...policy }, ...over });

interface Harness {
  deps: ReaperDeps;
  kills: string[];
  stops: string[];
  reaped: Array<[string, ReapReason, string | undefined]>;
  verdicts: Array<[string, string, CloserOutcome]>;
  archived: string[];
  probes: number;
  registry: SessionCloserRegistry;
}

function harness(sessions: DashboardSession[], opts: { enabled?: boolean } = {}): Harness {
  const registry = createSessionCloserRegistry();
  const h: Harness = {
    kills: [],
    stops: [],
    reaped: [],
    verdicts: [],
    archived: [],
    probes: 0,
    registry,
    deps: undefined as unknown as ReaperDeps,
  };
  h.deps = {
    config: () => ({
      ...DEFAULT_EMBED_LIFECYCLE,
      enabled: opts.enabled ?? false,
      idleTimeoutSeconds: 60,
      graceWindowSeconds: 10,
      hardCeilingSeconds: 3600,
    }),
    listSessions: () => sessions,
    probe: async () => {
      h.probes += 1;
      return { ok: true, childCount: 0, cpuPercent: 0 };
    },
    hasSubscriber: () => false,
    hasTerminalInCwd: () => false,
    hasPendingAsk: () => false,
    queueCounts: () => ({ followUp: 0, steering: 0 }),
    terminate: async (id) => {
      h.kills.push(id);
      return { outcome: "confirmed-dead" as const, terminated: true };
    },
    sendStopAfterTurn: (id) => {
      h.stops.push(id);
      return true;
    },
    onReap: (id, reason, d) => h.reaped.push([id, reason, d?.owner]),
    now: () => NOW,
    closerFor: (owner) => registry.get(owner),
    isCloseRequested: (id) => registry.isCloseRequested(id),
    clearCloseRequest: (id) => registry.clearCloseRequest(id),
    markArchiveOnEnd: (id) => h.archived.push(id),
    onCloserVerdict: (id, owner, _r, outcome) => h.verdicts.push([id, owner, outcome]),
  };
  return h;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("reaper — undeclared behavior unchanged (E5)", () => {
  it.each<[boolean, "durable" | "ephemeral", boolean, boolean]>([
    [false, "durable", false, false],
    [false, "ephemeral", false, false],
    [false, "durable", true, true],
    [false, "ephemeral", true, true],
    [true, "durable", false, false],
    [true, "ephemeral", false, true],
    [true, "durable", true, true],
    [true, "ephemeral", true, true],
  ])("E5: enabled=%s policy=%s declared=%s ⇒ reaped=%s (test-plan #E5)", async (enabled, policy, isDeclared, reaped) => {
    const s = isDeclared ? declared({ lifecyclePolicy: policy }) : session({ lifecyclePolicy: policy });
    const h = harness([s], { enabled });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual(reaped ? ["s1"] : []);
  });

  it("E5: feature off + nothing declared ⇒ no probe runs", async () => {
    const h = harness([session(), session({ id: "s2", lifecyclePolicy: "ephemeral" })]);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.probes).toBe(0);
  });
});

describe("reaper — declared threshold (E6)", () => {
  it("E6: boundary at the declared 30 min with the feature off (test-plan #E6)", async () => {
    const below = harness([declared({ lastActivityAt: NOW - (30 * MIN - 1) })]);
    await createIdleReaper(below.deps).sweepOnce();
    expect(below.kills).toEqual([]);
    const above = harness([declared({ lastActivityAt: NOW - (30 * MIN + 1) })]);
    await createIdleReaper(above.deps).sweepOnce();
    expect(above.kills).toEqual(["s1"]);
  });
});

describe("reaper — plugin closer (E9, E10, E11, E20)", () => {
  it("E9: close ⇒ kill; keep ⇒ no kill, re-asked next sweep; none ⇒ kill (test-plan #E9)", async () => {
    const close = harness([declared()]);
    close.registry.register("team", () => "close");
    await createIdleReaper(close.deps).sweepOnce();
    expect(close.kills).toEqual(["s1"]);

    const keep = harness([declared()]);
    let asked = 0;
    keep.registry.register("team", () => {
      asked += 1;
      return "keep";
    });
    const reaper = createIdleReaper(keep.deps);
    await reaper.sweepOnce();
    await reaper.sweepOnce();
    expect(keep.kills).toEqual([]);
    expect(asked).toBe(2);
    expect(keep.verdicts).toEqual([
      ["s1", "team", "keep"],
      ["s1", "team", "keep"],
    ]);

    const none = harness([declared()]);
    await createIdleReaper(none.deps).sweepOnce();
    expect(none.kills).toEqual(["s1"]);
  });

  it("E10/E20: a closer is only asked for its own declared sessions (test-plan #E10, #E20)", async () => {
    const h = harness([declared({ id: "y1" }, { owner: "y" }), session({ id: "e1", lifecyclePolicy: "ephemeral" })], {
      enabled: true,
    });
    let asked = 0;
    h.registry.register("x", () => {
      asked += 1;
      return "keep";
    });
    await createIdleReaper(h.deps).sweepOnce();
    expect(asked).toBe(0);
    expect(h.kills.sort()).toEqual(["e1", "y1"]);
  });

  it("E11: the closer receives exactly { sessionId, cwd, reason, idleMs } (test-plan #E11)", async () => {
    const h = harness([
      declared({
        pluginRefs: { team: { conv: "c" }, other: { secret: "x" } },
        principalOwner: { iss: "i", sub: "alice" },
      } as Partial<DashboardSession>),
    ]);
    const seen: unknown[] = [];
    h.registry.register("team", (req) => {
      seen.push(req);
      return "keep";
    });
    await createIdleReaper(h.deps).sweepOnce();
    expect(seen).toEqual([{ sessionId: "s1", cwd: "/work", reason: "idle", idleMs: 2 * 60 * MIN }]);
  });
});

describe("reaper — close requests, mode, attribution (E14, E17, E18)", () => {
  it("E14: idle request waits for the pending question, closer never asked (test-plan #E14)", async () => {
    let pendingAsk = true;
    const s = session({ closePolicy: { owner: "team", mode: "sleep" }, lastActivityAt: NOW - 1000 });
    const h = harness([s]);
    h.deps.hasPendingAsk = () => pendingAsk;
    let asked = 0;
    h.registry.register("team", () => {
      asked += 1;
      return "keep";
    });
    h.registry.requestIdleClose("s1");
    const reaper = createIdleReaper(h.deps);
    await reaper.sweepOnce();
    expect(h.kills).toEqual([]);
    pendingAsk = false;
    await reaper.sweepOnce();
    expect(h.kills).toEqual(["s1"]);
    expect(asked).toBe(0);
    expect(h.registry.isCloseRequested("s1")).toBe(false);
  });

  it("E17: archive mode marks archive-on-end; sleep does not (test-plan #E17)", async () => {
    const h = harness([declared({ id: "a" }, { mode: "archive" }), declared({ id: "b" })]);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills.sort()).toEqual(["a", "b"]);
    expect(h.archived).toEqual(["a"]);
  });

  it("E18: declared reaps carry the owner; ephemeral reaps do not (test-plan #E18)", async () => {
    const h = harness([declared({ id: "d" }), session({ id: "e", lifecyclePolicy: "ephemeral" })], { enabled: true });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.reaped).toEqual([
      ["d", "idle", "team"],
      ["e", "idle", undefined],
    ]);
  });
});

describe("reaper — closer failures and budget (X1–X3, P1)", () => {
  it("X1: a throwing closer keeps the session (test-plan #X1)", async () => {
    const h = harness([declared()]);
    h.registry.register("team", () => {
      throw new Error("boom");
    });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
    expect(h.verdicts).toEqual([["s1", "team", "failure"]]);
  });

  it("X2: a closer slower than 1 s is treated as keep (test-plan #X2)", async () => {
    vi.useFakeTimers();
    const h = harness([declared()]);
    h.registry.register("team", () => new Promise<"close">((r) => setTimeout(() => r("close"), 1500)));
    const sweep = createIdleReaper(h.deps).sweepOnce();
    await vi.advanceTimersByTimeAsync(CLOSER_TIMEOUT_MS + 1);
    await sweep;
    expect(h.kills).toEqual([]);
    expect(h.verdicts).toEqual([["s1", "team", "failure"]]);
  });

  it("X3: an unknown closer value is treated as keep (test-plan #X3)", async () => {
    const h = harness([declared()]);
    h.registry.register("team", (() => "maybe") as unknown as SessionCloser);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
    expect(h.verdicts).toEqual([["s1", "team", "failure"]]);
  });

  it("P1: the per-sweep closer budget defers the rest, never closes them (test-plan #P1)", async () => {
    vi.useFakeTimers();
    const sessions = Array.from({ length: 10 }, (_, i) => declared({ id: `s${i}` }));
    const h = harness(sessions);
    h.deps.elapsedClock = () => Date.now();
    h.registry.register("team", () => new Promise<"close">(() => {}));
    const start = Date.now();
    let doneAt: number | undefined;
    const sweep = createIdleReaper(h.deps)
      .sweepOnce()
      .then(() => {
        doneAt = Date.now();
      });
    for (let i = 0; i < 10 && doneAt === undefined; i += 1) await vi.advanceTimersByTimeAsync(CLOSER_TIMEOUT_MS);
    await sweep;
    expect(doneAt).toBeDefined();
    expect((doneAt ?? 0) - start).toBeLessThanOrEqual(CLOSER_SWEEP_BUDGET_MS);
    expect(h.kills).toEqual([]);
    expect(h.verdicts.length).toBe(CLOSER_SWEEP_BUDGET_MS / CLOSER_TIMEOUT_MS);
    expect(h.verdicts.every(([, , o]) => o === "failure")).toBe(true);
  });
});
