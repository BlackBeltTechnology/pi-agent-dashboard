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
  buildRestorePayload,
  checkBudget,
  compareTrust,
  computeDelta,
  createLatch,
  decideGate,
  decidePreRead,
  decidePreSnapshotError,
  decideReassert,
  decideRefusal,
  decideWorkerStart,
  droppedTrustKeys,
  HARNESS_DOWN_MESSAGE,
  HARNESS_POLICY_REFUSAL_ERRORS,
  HARNESS_UNUSABLE_MESSAGE,
  isLiveSession,
  LATCH_FAILURE_THRESHOLD,
  narrowedKeys,
  pickTrust,
  RESIDUAL_SESSION_BUDGET,
  recordBaseline,
  recordCredentialFreeAdmission,
  settleSessionIds,
  TRUST_KEYS,
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

/**
 * Refusal-aware latch + trust isolation (change: triage-browser-e2e-offbox-poison).
 * test-plan #E8-#E18, #X5-#X7, #X9, #X11-#X13, #X16.
 */
const ARMED = { credentialFreeAdmitted: true, narrowingActive: false };
const FULL_TRUST = () => ({
  trustedNetworks: ["0.0.0.0/0"],
  auth: { bypassHosts: [], bypassUrls: ["/"] },
  allowedHosts: [],
  hostGate: { mode: "enforce" },
  requireLocalProof: false,
  resolvedTrustedNetworks: ["0.0.0.0/0"],
});

describe("decideRefusal — harness-policy refusal verdict (E8-E13)", () => {
  it("E8: network_not_allowed 403 latches and names harness, status, literal, reason", () => {
    const d = decideRefusal({
      status: 403,
      error: "network_not_allowed",
      message: "ticket mint denied: 403 network_not_allowed — Source IP not loopback",
      ...ARMED,
    });
    expect(d.action).toBe("latch");
    expect(d.message).toContain("HARNESS");
    expect(d.message).toContain("403");
    expect(d.message).toContain("network_not_allowed");
    expect(d.message).toContain("Source IP not loopback");
  });

  it("E9: host_not_allowed 403 latches", () => {
    expect(decideRefusal({ status: 403, error: "host_not_allowed", ...ARMED }).action).toBe("latch");
  });

  it.each([
    ["unknown 403 literal", { status: 403, error: "forbidden" }, "forbidden"],
    ["403 without literal", { status: 403 }, "403"],
    ["401", { status: 401 }, "401"],
  ])("E10: %s fails the test without latching", (_l, input, needle) => {
    const d = decideRefusal({ ...input, ...ARMED });
    expect(d.action).toBe("fail-no-latch");
    expect(d.message).toContain(String(input.status));
    expect(d.message).toContain(needle);
  });

  it("E11: a transport error (no status) is warn-continue — the liveness counter governs", () => {
    expect(decideRefusal({ status: undefined, ...ARMED }).action).toBe("warn-continue");
  });

  it.each([
    ["boot baseline refuses credential-free", { credentialFreeAdmitted: false, narrowingActive: false }],
    ["declared narrowing active", { credentialFreeAdmitted: true, narrowingActive: true }],
    ["both", { credentialFreeAdmitted: false, narrowingActive: true }],
  ])("E12: disarmed (%s) → warn-continue even for a policy 403", (_l, flags) => {
    expect(decideRefusal({ status: 403, error: "network_not_allowed", ...flags }).action).toBe("warn-continue");
  });

  it("E13: classification ignores message text; the literal list is one exact constant", () => {
    const d = decideRefusal({
      status: 403,
      error: "forbidden",
      message: "contains network_not_allowed in prose",
      ...ARMED,
    });
    expect(d.action).toBe("fail-no-latch");
    expect(HARNESS_POLICY_REFUSAL_ERRORS).toEqual(["network_not_allowed", "host_not_allowed"]);
  });
});

describe("compareTrust — tripwire comparison (E14-E16, X16)", () => {
  it("E14: identical over all 7 keys is ok", () => {
    expect(TRUST_KEYS).toHaveLength(7);
    expect(compareTrust(FULL_TRUST(), FULL_TRUST())).toMatchObject({ ok: true, breaches: [] });
  });

  it("E15: names each differing key with before/after", () => {
    const after = FULL_TRUST();
    after.trustedNetworks = [];
    after.hostGate.mode = "off";
    const r = compareTrust(FULL_TRUST(), after);
    expect(r.ok).toBe(false);
    expect(r.breaches.map((b) => b.key)).toEqual(["trustedNetworks", "hostGate.mode"]);
    expect(r.breaches[0]).toMatchObject({ before: ["0.0.0.0/0"], after: [] });

    const onlyDerived = FULL_TRUST();
    onlyDerived.resolvedTrustedNetworks = [];
    expect(compareTrust(FULL_TRUST(), onlyDerived).breaches.map((b) => b.key)).toEqual(["resolvedTrustedNetworks"]);
  });

  it("E16: absent list ≡ [] (defaults filled); a reordered list is a breach", () => {
    const withEmpty = { ...FULL_TRUST(), auth: { bypassHosts: [], bypassUrls: [] } };
    const absent = { ...FULL_TRUST(), auth: { bypassHosts: [] } };
    expect(compareTrust(withEmpty, absent).ok).toBe(true);

    const ab = { ...FULL_TRUST(), trustedNetworks: ["a", "b"] };
    const ba = { ...FULL_TRUST(), trustedNetworks: ["b", "a"] };
    const r = compareTrust(ab, ba);
    expect(r.ok).toBe(false);
    expect(r.breaches.map((b) => b.key)).toEqual(["trustedNetworks"]);
  });

  it("X16: a response missing requireLocalProof is dropped with a note, not a false breach", () => {
    const missing = FULL_TRUST();
    delete missing.requireLocalProof;
    expect(droppedTrustKeys(missing)).toEqual(["requireLocalProof"]);
    expect(compareTrust(FULL_TRUST(), missing).ok).toBe(true);
    expect(pickTrust(missing)).not.toHaveProperty("requireLocalProof");
  });
});

describe("worker-start re-assert + pre-read (E17, E18, X11)", () => {
  const WIDE = FULL_TRUST();
  const NARROW = { ...FULL_TRUST(), trustedNetworks: [] };

  it("E17: baseline wide / live narrow → write the baseline back", () => {
    expect(decideReassert(WIDE, NARROW)).toEqual({ action: "write", baseline: WIDE });
  });

  it("E17: baseline narrow / live narrow → no-op (never the seed values)", () => {
    const narrowBoot = { ...FULL_TRUST(), trustedNetworks: ["127.0.0.1/32"] };
    expect(decideReassert(narrowBoot, { ...narrowBoot })).toEqual({ action: "noop" });
  });

  it("E17: baseline null → no-op", () => {
    expect(decideReassert(null, NARROW)).toEqual({ action: "noop" });
  });

  it("E18: registry empty + live ≠ baseline → re-assert and fail naming the last owner", () => {
    const d = decidePreRead({
      registryActive: false,
      baseline: WIDE,
      live: NARROW,
      lastReleasedOwner: "lan-knock.spec.ts",
    });
    expect(d.action).toBe("reassert-and-fail");
    expect(d.message).toContain("lan-knock.spec.ts");
    expect(d.message).toContain("trustedNetworks");
  });

  it("E18: an active narrowing, equal reads, or a null baseline → no check", () => {
    expect(decidePreRead({ registryActive: true, baseline: WIDE, live: NARROW }).action).toBe("none");
    expect(decidePreRead({ registryActive: false, baseline: WIDE, live: FULL_TRUST() }).action).toBe("none");
    expect(decidePreRead({ registryActive: false, baseline: null, live: NARROW }).action).toBe("none");
  });

  it("X11: a rejected operator credential latches with the status and error", () => {
    const file = { baseline: WIDE, credential: true, credentialFreeAdmitted: true };
    const d = decideWorkerStart(file, { status: 401, error: "unauthorized" });
    expect(d).toEqual({ action: "latch", message: "operator credential rejected: 401 unauthorized" });
  });

  it("worker start re-asserts a narrowed harness and no-ops a healthy or unreadable one", () => {
    const file = { baseline: WIDE, credential: true, credentialFreeAdmitted: true };
    expect(decideWorkerStart(file, { status: 200, data: NARROW })).toEqual({ action: "reassert", baseline: WIDE });
    expect(decideWorkerStart(file, { status: 200, data: FULL_TRUST() })).toEqual({ action: "noop" });
    expect(decideWorkerStart({ ...file, baseline: null }, { status: 403 })).toEqual({ action: "noop" });
  });
});

describe("refusal latch is sticky and coexists with liveness (X5-X7, X9)", () => {
  it("X5: probe fails twice then succeeds → not latched (regression)", () => {
    const latch = createLatch();
    decideGate(latch, false);
    decideGate(latch, false);
    expect(decideGate(latch, true).action).toBe("run");
    expect(latch.armed).toBe(false);
  });

  it("X6: three consecutive probe failures latch once, the rest skip (regression)", () => {
    const latch = createLatch();
    expect(decideGate(latch, false).action).toBe("run");
    expect(decideGate(latch, false).action).toBe("run");
    expect(decideGate(latch, false).action).toBe("fail");
    expect(decideGate(latch, false).action).toBe("skip");
  });

  it("X7: a 401 at pre-snapshot fails naming 401 and touches neither latch nor liveness counter", () => {
    const latch = createLatch();
    decideGate(latch, false);
    const before = latch.consecutiveFailures;
    const d = decidePreSnapshotError({ name: "OffBoxError", status: 401, message: "ticket mint denied: 401" }, ARMED);
    expect(d.action).toBe("fail-no-latch");
    expect(d.message).toContain("401");
    expect(latch.refused).toBe(false);
    expect(latch.consecutiveFailures).toBe(before);
  });

  it("X7: an error without status keeps today's warn-and-continue", () => {
    expect(decidePreSnapshotError(new Error("boom"), ARMED).action).toBe("warn-continue");
    expect(decidePreSnapshotError("string", ARMED).action).toBe("warn-continue");
  });

  it("X9: after a refusal latch the retry (probe ok) is skipped and the latch stays armed", () => {
    const latch = createLatch();
    const d = decidePreSnapshotError({ status: 403, error: "network_not_allowed", message: "m" }, ARMED);
    expect(d.action).toBe("latch");
    latch.refuse(d.message);
    const retry = decideGate(latch, true);
    expect(retry).toEqual({ action: "skip", message: HARNESS_UNUSABLE_MESSAGE });
    expect(latch.refused).toBe(true);
    expect(decideGate(latch, true).action).toBe("skip");
  });
});

describe("globalSetup baseline recording (X12, X13)", () => {
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => void (t += ms) };
  };

  it("X12: transport failures are retried and a later 200 records admitted=true", async () => {
    let calls = 0;
    const clock = fakeClock();
    const admitted = await recordCredentialFreeAdmission({
      mint: async () => {
        calls += 1;
        if (calls <= 2) throw new Error("connect ECONNREFUSED");
        return { status: 200 };
      },
      budgetMs: 10_000,
      ...clock,
    });
    expect(admitted).toBe(true);
    expect(calls).toBe(3);
  });

  it("X12: a refusal is a real answer → false; transport that never answers throws, never false", async () => {
    const clock = fakeClock();
    expect(await recordCredentialFreeAdmission({ mint: async () => ({ status: 403 }), budgetMs: 1000, ...clock })).toBe(false);
    await expect(
      recordCredentialFreeAdmission({
        mint: async () => {
          throw new Error("ETIMEDOUT");
        },
        budgetMs: 2000,
        ...clock,
      }),
    ).rejects.toThrow(/ETIMEDOUT/);
  });

  it("X13: no credential and a refused credential-free read → baseline null, nothing armed", () => {
    const file = recordBaseline({ credential: false, credentialFreeAdmitted: false, config: null });
    expect(file).toEqual({ baseline: null, credential: false, credentialFreeAdmitted: false });
    expect(decideWorkerStart(file, { status: 403 })).toEqual({ action: "noop" });
    expect(decidePreRead({ registryActive: false, baseline: file.baseline, live: {} }).action).toBe("none");
    expect(decideRefusal({ status: 403, error: "network_not_allowed", ...ARMED, credentialFreeAdmitted: file.credentialFreeAdmitted }).action).toBe("warn-continue");
  });

  it("records the trust subset when a read path exists", () => {
    const file = recordBaseline({ credential: true, credentialFreeAdmitted: true, config: { ...FULL_TRUST(), preferences: { x: 1 } } });
    expect(file.baseline).toEqual(FULL_TRUST());
  });
});

describe("narrowTrust restore payload (D3 L1)", () => {
  it("narrowedKeys covers patch keys and declared touches, never the derived key", () => {
    expect(
      narrowedKeys({ trustedNetworks: [], auth: { bypassUrls: ["/v1/"] }, resolvedTrustedNetworks: [] }, ["allowedHosts"]),
    ).toEqual(["trustedNetworks", "auth.bypassUrls", "allowedHosts"]);
    expect(narrowedKeys({}, ["hostGate.mode", "resolvedTrustedNetworks"])).toEqual(["hostGate.mode"]);
  });

  it("buildRestorePayload writes only the narrowed keys, merging bypass keys onto the live auth", () => {
    const payload = buildRestorePayload(
      ["trustedNetworks", "auth.bypassUrls"],
      FULL_TRUST(),
      { secret: "***", providers: { github: {} }, bypassUrls: ["/v1/"], bypassHosts: ["x"] },
    );
    expect(payload).toEqual({
      trustedNetworks: ["0.0.0.0/0"],
      auth: { secret: "***", providers: { github: {} }, bypassUrls: ["/"], bypassHosts: ["x"] },
    });
  });

  it("an absent list in the snapshot restores to [] and host-gate mode restores as {mode}", () => {
    expect(buildRestorePayload(["allowedHosts", "hostGate.mode"], { hostGate: { mode: "report" } })).toEqual({
      allowedHosts: [],
      hostGate: { mode: "report" },
    });
  });
});
