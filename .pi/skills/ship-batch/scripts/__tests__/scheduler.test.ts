import { describe, expect, it } from "vitest";
import { isDone, nextActions } from "../scheduler.ts";
import type { Action } from "../types.ts";
import { item, mkObs, mkState, T0 } from "./helpers.ts";

const starts = (a: Action[]) => a.filter((x) => x.kind === "start").map((x) => x.change);
const running = (id: string) => ({ state: "running" as const, sessionId: id, lastPromptAt: T0, idleSince: null });

describe("#E5 parallelism cap", () => {
  it("tick 1 starts N; freeing one slot starts exactly one more", () => {
    const s = mkState({ a: "queued", b: "queued", c: "queued", d: "queued" });
    expect(starts(nextActions(s, mkObs(), T0))).toEqual(["a", "b"]);
    item(s, "a").state = "shipped";
    expect(starts(nextActions(s, mkObs({ sessions: { a: {}, b: {} } }), T0 + 10_000))).toEqual(["c"]);
  });
});

describe("#E6 question frees a slot", () => {
  it("a questioned session is not torn down/nudged and a slot opens", () => {
    const s = mkState({ A: running("A"), B: running("B"), C: "queued" });
    const actions = nextActions(s, mkObs({ sessions: { A: {}, B: {} }, questions: new Set(["A"]) }), T0);
    expect(starts(actions)).toEqual(["C"]);
    expect(actions.some((a) => (a.kind === "teardown" || a.kind === "nudge") && a.change === "A")).toBe(false);
    expect(item(s, "A").state).toBe("question");
  });
});

describe("#E7 live ceiling", () => {
  const mk = (maxLive: number) => mkState({ A: running("A"), B: { state: "question", sessionId: "B" }, C: { state: "question", sessionId: "C" }, D: "queued" }, { maxLive });
  const obs = () => mkObs({ sessions: { A: {}, B: {}, C: {} }, questions: new Set(["B", "C"]) });
  it("max-live 3 blocks the start; 4 allows it", () => {
    expect(starts(nextActions(mk(3), obs(), T0))).toEqual([]);
    expect(starts(nextActions(mk(4), obs(), T0))).toEqual(["D"]);
  });
});

describe("#E8 answered never pre-empts", () => {
  it("temporary over-cap: no stops, no starts until active < N", () => {
    const s = mkState({ A: running("A"), B: running("B"), C: { state: "question", sessionId: "C" }, D: "queued" });
    const obs = mkObs({ sessions: { A: {}, B: {}, C: {} } });
    const actions = nextActions(s, obs, T0);
    expect(item(s, "C").state).toBe("running");
    expect(actions).toEqual([]);
    item(s, "A").state = "shipped";
    expect(starts(nextActions(s, obs, T0 + 10_000))).toEqual([]);
    item(s, "B").state = "shipped";
    expect(starts(nextActions(s, obs, T0 + 20_000))).toEqual(["D"]);
  });
});

describe("#E9 runner exit condition", () => {
  it("(a) all terminal -> done", () => expect(isDone(mkState({ a: "shipped", b: "kept", c: "skipped" }))).toBe(true));
  it("(b) one question -> not done", () => expect(isDone(mkState({ a: "shipped", b: "question" }))).toBe(false));
  it("(c) a queued item waiting on a running blocker -> not done", () => {
    expect(isDone(mkState({ a: "running", b: "waiting_dep" }))).toBe(false);
  });
});

describe("#E10 in-batch dependency gating", () => {
  it("dependent waits, the free item starts, then the dependent starts", () => {
    const s = mkState({ a: "queued", b: { state: "queued", blockedBy: ["a"] }, c: "queued" });
    expect(starts(nextActions(s, mkObs(), T0))).toEqual(["a", "c"]);
    expect(item(s, "b").state).toBe("waiting_dep");
    item(s, "a").state = "shipped";
    item(s, "c").state = "shipped";
    expect(starts(nextActions(s, mkObs(), T0 + 10_000))).toEqual(["b"]);
  });
});

describe("#E11 failed blocker skips the dependent", () => {
  it.each(["kept", "incomplete", "failed", "skipped"] as const)("blocker %s", (st) => {
    const s = mkState({ a: st, b: { state: "waiting_dep", blockedBy: ["a"] } });
    nextActions(s, mkObs(), T0);
    expect(item(s, "b").state).toBe("skipped");
    expect(item(s, "b").reason).toContain("a");
  });
  it("skips cascade through dependents in one tick", () => {
    const s = mkState({ a: "failed", b: { state: "queued", blockedBy: ["a"] }, c: { state: "queued", blockedBy: ["b"] } });
    nextActions(s, mkObs(), T0);
    expect([item(s, "b").state, item(s, "c").state]).toEqual(["skipped", "skipped"]);
  });
});

describe("#E16 bounded nudge", () => {
  const settledItem = (nudgesUsed: number) =>
    mkState({ a: { state: "settled", sessionId: "a", outcome: "incomplete", nudgesUsed } });
  it("alive idle + 0 nudges used -> one prompt, back to running", () => {
    const s = settledItem(0);
    const actions = nextActions(s, mkObs({ sessions: { a: { status: "idle" } } }), T0);
    expect(actions).toEqual([{ kind: "nudge", change: "a", sessionId: "a", text: "Continue /skill:ship-it for a from where you stopped." }]);
    expect(item(s, "a")).toMatchObject({ state: "running", nudgesUsed: 1, streamedSincePrompt: false, idleSince: null });
    expect(item(s, "a").outcome).toBeUndefined();
  });
  it("alive idle + budget used -> teardown", () => {
    const s = settledItem(1);
    expect(nextActions(s, mkObs({ sessions: { a: { status: "idle" } } }), T0).map((a) => a.kind)).toEqual(["teardown"]);
    expect(item(s, "a").state).toBe("teardown");
  });
  it("ended + 0 nudges used -> teardown, no prompt", () => {
    const s = settledItem(0);
    const kinds = nextActions(s, mkObs({ sessions: { a: { status: "ended" } } }), T0).map((a) => a.kind);
    expect(kinds).toEqual(["teardown"]);
  });
  it("a non-incomplete outcome is never nudged", () => {
    const s = mkState({ a: { state: "settled", sessionId: "a", outcome: "blocked" } });
    expect(nextActions(s, mkObs({ sessions: { a: { status: "idle" } } }), T0).map((a) => a.kind)).toEqual(["teardown"]);
  });
  it("a session that woke up again goes back to running instead of teardown", () => {
    const s = settledItem(1);
    const actions = nextActions(s, mkObs({ sessions: { a: { status: "streaming" } } }), T0);
    expect(actions).toEqual([]);
    expect(item(s, "a").state).toBe("running");
  });
});

describe("#X12 no decision without a live view (pure half)", () => {
  it("bus down -> no actions at all", () => {
    const s = mkState({ a: running("a"), b: "queued" });
    expect(nextActions(s, mkObs({ connected: false, connectedSince: null }), T0)).toEqual([]);
    expect(item(s, "b").state).toBe("queued");
  });
  it("connected for less than a settle window -> starts yes, settle no", () => {
    const s = mkState({ a: { ...running("a"), streamedSincePrompt: true, idleSince: T0 - 60_000 }, b: "queued" });
    const actions = nextActions(s, mkObs({ connectedSince: T0 - 5_000, sessions: { a: { status: "idle" } } }), T0);
    expect(actions.map((a) => a.kind)).toEqual(["start"]);
    expect(item(s, "a").state).toBe("running");
  });
  it("a recorded session missing from the snapshot and not archived is never settled", () => {
    const s = mkState({ a: running("a") });
    expect(nextActions(s, mkObs(), T0 + 600_000)).toEqual([]);
    expect(item(s, "a").state).toBe("running");
    const settled = nextActions(s, mkObs({ archived: new Set(["a"]) }), T0 + 600_000);
    expect(settled).toEqual([{ kind: "classify", change: "a" }]);
  });
  it("a settled session going idle for the window triggers classify", () => {
    const s = mkState({ a: { ...running("a"), streamedSincePrompt: true } });
    const obs = mkObs({ sessions: { a: { status: "idle" } } });
    expect(nextActions(s, obs, T0)).toEqual([]); // idleSince starts now
    expect(nextActions(s, obs, T0 + 30_000)).toEqual([{ kind: "classify", change: "a" }]);
    expect(item(s, "a").state).toBe("settled");
  });
});

describe("start halting", () => {
  it("halted scheduling starts nothing", () => {
    const s = mkState({ a: "queued" });
    s.halted = "init hook untrusted";
    expect(nextActions(s, mkObs(), T0)).toEqual([]);
  });
});
