/**
 * Shared guard core: fail-closed settlement, outcome attribution, injected
 * `ApprovalSurface` contract.
 *
 * See change: add-supervised-tool-approval (test-plan #X1 #X2 #X3 #X5 #X7 #X8 #X21 #X22).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApprovalAnswer,
  type ApprovalRequest,
  type ApprovalSurface,
  type BlockedOutcome,
  createToolCallGuard,
  type DecisionRecord,
} from "../guard.js";
import type { ToolPolicy } from "../policy.js";

interface Harness {
  surface: ApprovalSurface<Record<string, never>>;
  records: DecisionRecord[];
  cancel: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}

/** A supervised-flavoured surface (distinct per-outcome reasons) with a scripted transport. */
function harness(make: () => ApprovalRequest["decision"] | never): Harness {
  const records: DecisionRecord[] = [];
  const cancel = vi.fn();
  const request = vi.fn(() => ({ decision: make(), cancel }));
  const surface: ApprovalSurface<Record<string, never>> = {
    reasonPrefix: "supervised",
    reasonFor: (outcome, detail) =>
      outcome === "denied" && detail.answer !== undefined && detail.answer !== "Deny"
        ? `denied — operator said: "${detail.answer}"`
        : outcome,
    buildPrompt: (e) => ({ title: `Allow ${e.toolName}?`, body: "b", plain: `plain ${e.toolName}`, metadata: {} }),
    request,
    onDecision: (r) => records.push(r),
  };
  return { surface, records, cancel, request };
}

const answer = (a: string | undefined, surface = "dashboard"): ApprovalAnswer => ({ answer: a, surface });
const never = () => new Promise<ApprovalAnswer>(() => {});
const policy: ToolPolicy = { approval: ["bash"], defaultAction: "allow" };

describe("createToolCallGuard (shared core)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("approves only on the exact Allow once answer", async () => {
    const h = harness(() => Promise.resolve(answer("Allow once", "tui")));
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    expect(await guard({ toolName: "bash", toolCallId: "c1" }, {})).toBeUndefined();
    expect(h.records).toEqual([
      { toolName: "bash", toolCallId: "c1", summary: "plain bash", outcome: "approved", answeredSurface: "tui" },
    ]);
  });

  it("a policy allow / deny never opens an approval", async () => {
    const h = harness(() => never());
    const guard = createToolCallGuard({ surface: h.surface, policy: { allow: ["read"] }, timeoutMs: 1000 });
    expect(await guard({ toolName: "read" }, {})).toBeUndefined();
    expect(await guard({ toolName: "bash" }, {})).toEqual({ block: true, reason: "supervised: denied_by_default" });
    expect(h.request).not.toHaveBeenCalled();
    expect(h.records).toEqual([]);
  });

  it("X1/X8: an unanswered approval times out — blocked, cancelled once, attributed to `timeout`", async () => {
    const h = harness(() => never());
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 120_000 });
    const pending = guard({ toolName: "bash" }, {});
    await vi.advanceTimersByTimeAsync(119_999);
    expect(h.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ block: true, reason: "supervised: timeout" });
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ outcome: "timeout", answeredSurface: "timeout" });
  });

  it("X2: a synchronous throw from request fails closed", async () => {
    const h = harness(() => never());
    h.request.mockImplementation(() => {
      throw new Error("boom");
    });
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    expect(await guard({ toolName: "bash" }, {})).toEqual({ block: true, reason: "supervised: error" });
    expect(h.records[0]).toMatchObject({ outcome: "error", answeredSurface: "error" });
  });

  it("X3: a rejected decision fails closed", async () => {
    const h = harness(() => Promise.reject(new Error("nope")));
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    const result = await guard({ toolName: "bash" }, {});
    expect(result?.block).toBe(true);
    expect(h.records[0]?.outcome).toBe("error");
  });

  it("a malformed answer object fails closed", async () => {
    const h = harness(() => Promise.resolve(undefined as unknown as ApprovalAnswer));
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    expect((await guard({ toolName: "bash" }, {}))?.block).toBe(true);
    expect(h.records[0]?.outcome).toBe("error");
  });

  it("X5: deny / timeout / error / dismiss / abort → five distinct outcomes and reasons", async () => {
    const seen = new Map<BlockedOutcome, string>();
    const run = async (h: Harness, ctl?: AbortController, advance?: number) => {
      const guard = createToolCallGuard({
        surface: h.surface,
        policy,
        timeoutMs: 5000,
        abortSignal: () => ctl?.signal,
      });
      const p = guard({ toolName: "bash" }, {});
      if (ctl) {
        await vi.advanceTimersByTimeAsync(10);
        ctl.abort();
      }
      if (advance) await vi.advanceTimersByTimeAsync(advance);
      const r = await p;
      expect(r?.block).toBe(true);
      const rec = h.records[0];
      seen.set(rec?.outcome as BlockedOutcome, (r as { reason: string }).reason);
    };
    await run(harness(() => Promise.resolve(answer("Deny"))));
    await run(harness(() => never()), undefined, 5000);
    await run(harness(() => Promise.reject(new Error("x"))));
    await run(harness(() => Promise.resolve(answer(undefined, "__bus__"))));
    const aborted = harness(() => never());
    await run(aborted, new AbortController());
    expect(aborted.cancel).toHaveBeenCalledOnce();

    expect([...seen.keys()].sort()).toEqual(["aborted", "denied", "dismissed", "error", "timeout"]);
    expect(new Set(seen.values()).size).toBe(5);
    expect(seen.get("denied")).toBe("supervised: denied");
  });

  it("a non-label answer is a denial carrying the operator text to the reason", async () => {
    const h = harness(() => Promise.resolve(answer("run it in /tmp")));
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    expect(await guard({ toolName: "bash" }, {})).toEqual({
      block: true,
      reason: 'supervised: denied — operator said: "run it in /tmp"',
    });
    expect(h.records[0]).toMatchObject({ outcome: "denied", answer: "run it in /tmp" });
  });

  it("an already-aborted signal blocks at once without opening an approval", async () => {
    const h = harness(() => never());
    const ctl = new AbortController();
    ctl.abort();
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000, abortSignal: () => ctl.signal });
    expect(await guard({ toolName: "bash" }, {})).toEqual({ block: true, reason: "supervised: aborted" });
    expect(h.request).not.toHaveBeenCalled();
  });

  it("X21: a dismiss the gate did not initiate → dismissed, blocked", async () => {
    // The bus resolves a cancel as {cancelled:true, source:"__bus__"}; the surface maps it to no answer.
    const h = harness(() => Promise.resolve(answer(undefined, "__bus__")));
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    expect(await guard({ toolName: "bash" }, {})).toEqual({ block: true, reason: "supervised: dismissed" });
    expect(h.records[0]).toMatchObject({ outcome: "dismissed", answeredSurface: "__bus__" });
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("X22: the bus backstop firing before a stubbed-out gate timer → dismissed, never allow", async () => {
    let busResolve: (a: ApprovalAnswer) => void = () => {};
    const h = harness(() => new Promise<ApprovalAnswer>((r) => (busResolve = r)));
    const guard = createToolCallGuard({
      surface: h.surface,
      policy,
      timeoutMs: 120_000,
      schedule: () => 1, // gate timer stubbed not to fire
      cancelTimer: () => {},
    });
    const pending = guard({ toolName: "bash" }, {});
    await vi.advanceTimersByTimeAsync(5000);
    busResolve(answer(undefined, "__bus__")); // bus timeout (5 s) backstop
    const result = await pending;
    expect(result).toEqual({ block: true, reason: "supervised: dismissed" });
    expect(h.records[0]?.outcome).toBe("dismissed");
  });

  it("X7: every requested approval is recorded (approve, then deny) with tool, summary, outcome, surface", async () => {
    const answers = ["Allow once", "Deny"];
    const h = harness(() => Promise.resolve(answer(answers.shift(), "dashboard")));
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    await guard({ toolName: "bash", toolCallId: "a" }, {});
    await guard({ toolName: "bash", toolCallId: "b" }, {});
    expect(h.records.map((r) => [r.toolName, r.toolCallId, r.summary, r.outcome, r.answeredSurface])).toEqual([
      ["bash", "a", "plain bash", "approved", "dashboard"],
      ["bash", "b", "plain bash", "denied", "dashboard"],
    ]);
  });

  it("an onDecision failure never changes the decision", async () => {
    const h = harness(() => Promise.resolve(answer("Allow once")));
    h.surface.onDecision = () => {
      throw new Error("audit down");
    };
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: 1000 });
    expect(await guard({ toolName: "bash" }, {})).toBeUndefined();
  });

  it("hands buildPrompt the timeout and the deadline (clock + timeout)", async () => {
    const h = harness(() => Promise.resolve(answer("Allow once")));
    const buildPrompt = vi.fn(h.surface.buildPrompt);
    h.surface.buildPrompt = buildPrompt;
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: () => 7000, now: () => 1_000 });
    await guard({ toolName: "bash" }, {});
    expect(buildPrompt).toHaveBeenCalledWith({ toolName: "bash" }, { timeoutMs: 7000, deadline: 8000 });
  });

  it("the timeout must be strictly positive: construction throws, a bad per-call value fails closed", async () => {
    const h = harness(() => never());
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createToolCallGuard({ surface: h.surface, policy, timeoutMs: bad })).toThrow(RangeError);
    }
    const guard = createToolCallGuard({ surface: h.surface, policy, timeoutMs: () => 0 });
    expect(await guard({ toolName: "bash" }, {})).toEqual({ block: true, reason: "supervised: error" });
    expect(h.request).not.toHaveBeenCalled();
  });
});
