/**
 * L1 unit coverage for `tests/e2e/reap-core.ts` — the pure decision logic behind
 * the browser-E2E session-reap fixture (D1/D3/D4/D5).
 *
 * The fixture itself cannot be unit-tested (it needs Playwright + a live bus),
 * so every branch worth pinning lives in `reap-core.ts` as a pure function with
 * injected clock/sleep. This file is the level-1 half of the change.
 *
 * Location rationale: repo-root logic outside `packages/*` is conventionally
 * covered from `scripts/__tests__/*.test.mjs` (see `test-up-port-derivation.test.mjs`,
 * which tests `docker/` logic from here). Vitest transforms the `.ts` import.
 *
 * See change: fix-e2e-harness-memory-exhaustion
 * (test-plan #E1, #E4, #E5, #X2, #X3, #X4, #X5, #X6, #P2).
 */

import { describe, expect, it } from "vitest";
import {
  HARNESS_DOWN_MESSAGE,
  LATCH_FAILURE_THRESHOLD,
  RESIDUAL_SESSION_BUDGET,
  checkBudget,
  computeDelta,
  createLatch,
  decideGate,
  isLiveSession,
  settleSessionIds,
} from "../../tests/e2e/reap-core.ts";

/** Deterministic fake clock + sleep, so settle tests never wall-clock wait. */
function fakeTime() {
  let now = 0;
  const sleep = async (ms) => {
    now += ms;
  };
  return { now: () => now, sleep, advance: (ms) => (now += ms) };
}

describe("computeDelta — reap the delta, never 'kill everything' (E1)", () => {
  // Decision table: an id present pre-only / post-only / both / neither.
  it.each([
    ["post-only  → reaped", ["a"], ["a", "b"], ["b"]],
    ["pre-only   → not reaped (it died on its own)", ["a", "b"], ["a"], []],
    ["both       → not reaped (pre-existing)", ["a", "b"], ["a", "b"], []],
    ["neither    → nothing to reap", [], [], []],
  ])("%s", (_label, pre, post, expected) => {
    expect(computeDelta(pre, post)).toEqual(expected);
  });

  it("never returns a pre-existing id even when the post list reorders", () => {
    // Ordering must not be mistaken for membership.
    expect(computeDelta(["a", "b", "c"], ["c", "b", "a"])).toEqual([]);
  });

  it("returns every newly-appeared id, not just the first", () => {
    expect(computeDelta(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
  });

  it("tolerates duplicate ids in either snapshot without duplicating the reap", () => {
    expect(computeDelta(["a", "a"], ["a", "b", "b"])).toEqual(["b"]);
  });
});

describe("settleSessionIds — adaptive settle before the delta (E4)", () => {
  it("classifies an id that registers 800ms after the body as spawned-during-test", async () => {
    const t = fakeTime();
    // The late session appears at t=800; the settle must still be watching.
    const read = () => (t.now() >= 800 ? ["a", "late"] : ["a"]);

    const settled = await settleSessionIds(read, {
      stableMs: 1_000,
      capMs: 5_000,
      pollMs: 100,
      now: t.now,
      sleep: t.sleep,
    });

    expect(settled).toContain("late");
    expect(computeDelta(["a"], settled)).toEqual(["late"]);
  });

  it("returns as soon as the list has been stable for stableMs (does not burn the cap)", async () => {
    const t = fakeTime();
    const read = () => ["a"];

    await settleSessionIds(read, {
      stableMs: 1_000,
      capMs: 5_000,
      pollMs: 100,
      now: t.now,
      sleep: t.sleep,
    });

    // Stable from t=0, so it may not wait anywhere near the 5s cap.
    expect(t.now()).toBeLessThan(2_000);
  });

  it("gives up at the cap when the list never stabilises", async () => {
    const t = fakeTime();
    // A list that changes on every poll never becomes stable.
    let n = 0;
    const read = () => Array.from({ length: ++n }, (_, i) => `s${i}`);

    const settled = await settleSessionIds(read, {
      stableMs: 1_000,
      capMs: 5_000,
      pollMs: 100,
      now: t.now,
      sleep: t.sleep,
    });

    expect(t.now()).toBeLessThanOrEqual(5_000 + 100);
    expect(settled.length).toBeGreaterThan(0);
  });
});

describe("createLatch — harness-down latch (X3, X4, X5, X6)", () => {
  it("declares the threshold as N>=2 consecutive failures", () => {
    expect(LATCH_FAILURE_THRESHOLD).toBeGreaterThanOrEqual(2);
  });

  it("X3 — a slow harness (2 failures then a success) is NOT declared dead", () => {
    const latch = createLatch();
    expect(latch.record(false).armed).toBe(false);
    expect(latch.record(false).armed).toBe(false);
    const verdict = latch.record(true);
    expect(verdict.armed).toBe(false);
    expect(latch.armed).toBe(false);
  });

  it("X3 — a success resets the consecutive-failure run", () => {
    const latch = createLatch();
    latch.record(false);
    latch.record(false);
    latch.record(true); // reset
    latch.record(false);
    latch.record(false);
    // Only 2 consecutive since the reset — still not armed at threshold 3.
    expect(latch.armed).toBe(false);
  });

  it("X4 — 3 consecutive failures arm the latch with a message naming the harness", () => {
    const latch = createLatch();
    latch.record(false);
    latch.record(false);
    const verdict = latch.record(false);

    expect(verdict.armed).toBe(true);
    expect(latch.armed).toBe(true);
    expect(verdict.message).toContain(HARNESS_DOWN_MESSAGE);
    // Must name the harness, not just "a request failed".
    expect(verdict.message.toLowerCase()).toContain("harness");
  });

  it("X5 — once armed, the latch stays armed so the remainder is skipped", () => {
    const latch = createLatch();
    latch.record(false);
    latch.record(false);
    latch.record(false);
    expect(latch.armed).toBe(true);
    // A later stray success must not disarm it: a dead container never
    // recovers within a run, and un-arming would resurrect the cascade.
    latch.record(true);
    expect(latch.armed).toBe(true);
  });

  it("X6 — the probe result is recorded before the latch is consulted, so a retry re-probes", () => {
    // Modelled as: shouldSkip() is only true when armed AND the fresh probe
    // also failed. A retry whose probe succeeds must run, not skip.
    const latch = createLatch();
    latch.record(false);
    latch.record(false);
    latch.record(false);
    expect(latch.armed).toBe(true);
    expect(latch.shouldSkip({ probeOk: false })).toBe(true);
    expect(latch.shouldSkip({ probeOk: true })).toBe(false);
  });
});

describe("isLiveSession — only process-backed sessions count", () => {
  // Regression: read.sessions() keeps a record until `session_removed`, so a
  // shut-down session lingers with live:false / status:"ended". Counting those
  // produced 96 false budget breaches in an acceptance run while only 2 pi
  // processes were resident.
  it.each([
    ["no liveness fields (fresh snapshot entry)", { id: "a" }, true],
    ["live:true", { id: "a", live: true }, true],
    ["status:idle", { id: "a", status: "idle" }, true],
    ["status:streaming", { id: "a", status: "streaming" }, true],
    ["live:false", { id: "a", live: false }, false],
    ["status:ended", { id: "a", status: "ended" }, false],
    ["live:false AND status:ended", { id: "a", live: false, status: "ended" }, false],
  ])("%s → %s", (_label, session, expected) => {
    expect(isLiveSession(session)).toBe(expected);
  });
});

describe("decideGate — how the fixture must wire the latch (X4, X5, X6)", () => {
  const armedLatch = () => {
    const l = createLatch();
    l.record(false);
    l.record(false);
    return l; // one more failure arms it
  };

  it("X4 — the probe that ARMS the latch fails loudly, it does not skip", () => {
    // Regression: the fixture consulted shouldSkip() first, so the declaring
    // test was skipped and the harness death was never announced.
    const gate = decideGate(armedLatch(), false);
    expect(gate.action).toBe("fail");
    expect(gate.message).toContain("HARNESS DOWN");
  });

  it("X5 — a later probe that also fails is skipped, not re-announced", () => {
    const latch = armedLatch();
    decideGate(latch, false); // arms + announces
    const gate = decideGate(latch, false);
    expect(gate.action).toBe("skip");
  });

  it("X6 — an armed latch whose fresh probe SUCCEEDS runs the test", () => {
    // The pinned intent of X6: a retry that re-probes healthy must RUN.
    // Regression: the fixture threw HARNESS DOWN here instead.
    const latch = armedLatch();
    decideGate(latch, false); // arm
    const gate = decideGate(latch, true);
    expect(gate.action).toBe("run");
  });

  it("a healthy harness always runs", () => {
    const latch = createLatch();
    expect(decideGate(latch, true).action).toBe("run");
    expect(decideGate(latch, true).action).toBe("run");
  });

  it("failures below the threshold still run — a slow harness is not condemned", () => {
    const latch = createLatch();
    expect(decideGate(latch, false).action).toBe("run");
    expect(decideGate(latch, false).action).toBe("run");
  });
});

describe("computeDelta — a lost pre-snapshot must never mean 'reap everything'", () => {
  it("an empty pre-snapshot would classify EVERY session as spawned-during-test", () => {
    // This is why the fixture must not reap when its pre-snapshot failed: the
    // delta cannot distinguish the harness's own session from the spec's.
    const post = ["harness-owned", "spec-spawned"];
    expect(computeDelta([], post)).toEqual(["harness-owned", "spec-spawned"]);
  });
});

describe("checkBudget — residual-session budget (E5)", () => {
  const sessionsOf = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, cwd: `/w/${i}` }));

  it("declares the starting budget as 8", () => {
    expect(RESIDUAL_SESSION_BUDGET).toBe(8);
  });

  it.each([
    [7, true],
    [8, true],
    [9, false],
  ])("BVA: %i live sessions against budget 8 → ok=%s", (count, ok) => {
    expect(checkBudget(sessionsOf(count), 8).ok).toBe(ok);
  });

  it("on breach, names the offending session ids and cwds", () => {
    const result = checkBudget(sessionsOf(9), 8);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("s0");
    expect(result.message).toContain("/w/0");
    expect(result.message).toContain("9");
    expect(result.message).toContain("8");
  });

  it("passes cleanly at zero live sessions", () => {
    expect(checkBudget([], 8).ok).toBe(true);
  });

  it("does not count ended/closed records once they are filtered out", () => {
    // The fixture filters with isLiveSession before calling checkBudget; this
    // pins the combination the acceptance run got wrong.
    const mixed = [
      ...sessionsOf(2),
      { id: "dead1", cwd: "/w/d1", live: false },
      { id: "dead2", cwd: "/w/d2", status: "ended" },
    ];
    expect(checkBudget(mixed, 3).ok).toBe(false); // unfiltered → 4 > 3
    expect(checkBudget(mixed.filter(isLiveSession), 3).ok).toBe(true); // filtered → 2
  });
});
