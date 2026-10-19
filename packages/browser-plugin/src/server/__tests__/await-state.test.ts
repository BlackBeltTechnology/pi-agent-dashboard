/**
 * `browser/await-state` tracker (change: add-dedicated-agent-browser, D8 — the
 * server signal that lets the idle sweep hold an instance during
 * `browser_await_human`; test-plan #R16a input).
 */
import { describe, expect, it } from "vitest";
import { AWAIT_MAX_HOLD_MS, AwaitTracker } from "../await-state.js";

describe("AwaitTracker", () => {
  it("pending(true) holds the instance until pending(false) from the same session", () => {
    const t = new AwaitTracker();
    t.handle({ instanceId: "inst-1", pending: true }, { sessionId: "S" });
    expect(t.pending("inst-1")).toBe(true);
    expect(t.pending("inst-2")).toBe(false);
    t.handle({ instanceId: "inst-1", pending: false }, { sessionId: "S" });
    expect(t.pending("inst-1")).toBe(false);
    expect(t.size).toBe(0);
  });

  it("the session comes from the lane meta: another session cannot clear it, a payload sessionId is ignored", () => {
    const t = new AwaitTracker();
    t.handle({ instanceId: "inst-1", pending: true, sessionId: "spoofed" }, { sessionId: "S" });
    t.handle({ instanceId: "inst-1", pending: false, sessionId: "S" }, { sessionId: "OTHER" });
    expect(t.pending("inst-1")).toBe(true);
    t.handle({ instanceId: "inst-1", pending: false }, { sessionId: "S" });
    expect(t.pending("inst-1")).toBe(false);
  });

  it("two sessions awaiting the same instance: held until BOTH finish", () => {
    const t = new AwaitTracker();
    t.handle({ instanceId: "i", pending: true }, { sessionId: "A" });
    t.handle({ instanceId: "i", pending: true }, { sessionId: "B" });
    t.handle({ instanceId: "i", pending: false }, { sessionId: "A" });
    expect(t.pending("i")).toBe(true);
    t.handle({ instanceId: "i", pending: false }, { sessionId: "B" });
    expect(t.pending("i")).toBe(false);
  });

  it("a hold older than the cap stops counting (bridge crashed before sending false)", () => {
    let now = 1_000;
    const t = new AwaitTracker({ now: () => now });
    t.handle({ instanceId: "i", pending: true }, { sessionId: "S" });
    now += AWAIT_MAX_HOLD_MS;
    expect(t.pending("i")).toBe(true);
    now += 1;
    expect(t.pending("i")).toBe(false);
    expect(t.size).toBe(0);
  });

  it("forget drops the entries of a closed instance only", () => {
    const t = new AwaitTracker();
    t.handle({ instanceId: "a", pending: true }, { sessionId: "S" });
    t.handle({ instanceId: "b", pending: true }, { sessionId: "S" });
    t.forget("a");
    expect(t.pending("a")).toBe(false);
    expect(t.pending("b")).toBe(true);
  });

  it.each([
    [{}, "invalid-instance"],
    [{ instanceId: "", pending: true }, "invalid-instance"],
    [{ instanceId: "x".repeat(129), pending: true }, "invalid-instance"],
    [{ instanceId: "i", pending: "yes" }, "invalid-pending"],
    [null, "invalid-instance"],
  ])("rejects a malformed payload %j", (payload, message) => {
    expect(() => new AwaitTracker().handle(payload, { sessionId: "S" })).toThrow(message);
  });

  it("the table is capped", () => {
    const t = new AwaitTracker();
    for (let i = 0; i < 256; i++) t.handle({ instanceId: `i${i}`, pending: true }, { sessionId: "S" });
    expect(() => t.handle({ instanceId: "overflow", pending: true }, { sessionId: "S" })).toThrow("too-many-pending");
    // re-announcing an existing entry is not growth
    expect(() => t.handle({ instanceId: "i0", pending: true }, { sessionId: "S" })).not.toThrow();
  });
});
