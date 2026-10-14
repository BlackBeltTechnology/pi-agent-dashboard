/**
 * Brief generation: success/limited label, timeout, cap + FIFO, unavailable
 * without a call, on-demand failure semantics (test-plan #E19, #X1; tasks 4.2).
 * See change: add-pending-question-stack (D4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBriefGenerator, type BriefRequest } from "../brief-generator.js";

const snap = (text?: string): BriefRequest["snapshot"] =>
  text === undefined
    ? { toolCalls: [], redactionVersion: 1, assistantAbsentReason: "none" }
    : { toolCalls: [], redactionVersion: 1, assistantText: text };
const req = (over: Partial<BriefRequest> = {}): BriefRequest => ({ question: "Resume?", type: "select", options: ["a", "b"], snapshot: snap("working"), ...over });
const okModel = async () => ({ ok: true as const, model: { id: "m" } });

describe("createBriefGenerator", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("one model call → generated brief, label generated", async () => {
    const complete = vi.fn(async () => "  The agent was fixing the build.  ");
    const gen = createBriefGenerator({ resolveModel: okModel, complete });
    const out = await gen.generate(req());
    expect(out).toMatchObject({ ok: true, text: "The agent was fixing the build.", label: "generated" });
    expect(complete).toHaveBeenCalledTimes(1);
    const prompt = (complete.mock.calls[0] as unknown[])[1] as { system: string; user: string };
    expect(prompt.user).toContain("Resume?");
  });

  it("no assistant text → label generated-limited", async () => {
    const gen = createBriefGenerator({ resolveModel: okModel, complete: async () => "text" });
    expect(await gen.generate(req({ snapshot: snap() }))).toMatchObject({ ok: true, label: "generated-limited" });
  });

  it("input/editor prompt has no per-option instruction", async () => {
    const complete = vi.fn(async () => "text");
    const gen = createBriefGenerator({ resolveModel: okModel, complete });
    await gen.generate(req({ type: "input", options: undefined }));
    const prompt = (complete.mock.calls[0] as unknown[])[1] as { system: string };
    expect(prompt.system).not.toMatch(/each option/i);
  });

  it("unresolved model → unavailable, no model call (test-plan #E18)", async () => {
    const complete = vi.fn(async () => "x");
    const gen = createBriefGenerator({ resolveModel: async () => ({ ok: false, reason: "no role" }), complete });
    expect(await gen.generate(req())).toMatchObject({ ok: false, kind: "unavailable" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("a throwing call → failed (never throws)", async () => {
    const gen = createBriefGenerator({ resolveModel: okModel, complete: async () => { throw new Error("provider 500"); } });
    expect(await gen.generate(req())).toMatchObject({ ok: false, kind: "failed" });
  });

  it("an empty completion → failed", async () => {
    const gen = createBriefGenerator({ resolveModel: okModel, complete: async () => "   " });
    expect(await gen.generate(req())).toMatchObject({ ok: false, kind: "failed" });
  });

  it("a call that never resolves fails at 20 s and aborts the signal (test-plan #X1)", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const complete = vi.fn((_m: unknown, _p: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise<string>(() => {});
    });
    const gen = createBriefGenerator({ resolveModel: okModel, complete });
    const p = gen.generate(req());
    await vi.advanceTimersByTimeAsync(19_999);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toMatchObject({ ok: false, kind: "failed", reason: expect.stringMatching(/timed out/i) });
    expect(signal?.aborted).toBe(true);
  });

  it("caps concurrency at 2 and starts the rest FIFO (test-plan #E19)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const complete = vi.fn(async (_m: unknown, prompt: { user: string }) => {
      started.push(/Question \(select\): (q\d)/.exec(prompt.user)![1]);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => releases.push(r));
      inFlight--;
      return "brief";
    });
    const gen = createBriefGenerator({ resolveModel: okModel, complete });
    const all = [1, 2, 3, 4, 5].map((n) => gen.generate(req({ question: `q${n}` })));
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(started).toEqual(["q1", "q2"]);
    // Release one at a time; the queue drains in arrival order.
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(i));
      releases[i]();
    }
    await Promise.all(all);
    expect(started).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(maxInFlight).toBe(2);
  });

  it("a timed-out call frees its slot for the queue", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const complete = vi.fn((_m: unknown, p: { user: string }) => {
      seen.push(/Question \(select\): (q\d)/.exec(p.user)![1]);
      return seen.length <= 2 ? new Promise<string>(() => {}) : Promise.resolve("ok");
    });
    const gen = createBriefGenerator({ resolveModel: okModel, complete });
    const ps = [1, 2, 3].map((n) => gen.generate(req({ question: `q${n}` })));
    await vi.advanceTimersByTimeAsync(20_001);
    const outs = await Promise.all(ps);
    expect(outs.map((o) => o.ok)).toEqual([false, false, true]);
  });

  it("counts outcomes and fallbacks (task 4.6) and logs outcome + latency", async () => {
    const log = vi.spyOn(console, "log");
    const gen = createBriefGenerator({ resolveModel: okModel, complete: async () => "ok" });
    await gen.generate(req());
    const failing = createBriefGenerator({ resolveModel: okModel, complete: async () => { throw new Error("x"); } });
    await failing.generate(req());
    expect(gen.stats()).toMatchObject({ ready: 1, failed: 0, unavailable: 0, fallbacks: 0 });
    expect(failing.stats()).toMatchObject({ ready: 0, failed: 1, fallbacks: 1 });
    expect(log.mock.calls.some((c) => /\[questions\] brief .*outcome=ready.*latencyMs=\d+/.test(String(c[0])))).toBe(true);
  });

  it("never logs prompt or brief content", async () => {
    const log = vi.spyOn(console, "log");
    const gen = createBriefGenerator({ resolveModel: okModel, complete: async () => "SECRET-BRIEF-TEXT" });
    await gen.generate(req({ question: "SECRET-QUESTION" }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET/);
  });
});
