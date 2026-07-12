import { describe, expect, it } from "vitest";
import {
  CONTINUATION_NUDGE,
  DEFAULT_RETRY_CAP,
  EmptyActionableGuard,
  SURFACE_MESSAGE,
} from "../empty-actionable-guard.js";

describe("EmptyActionableGuard", () => {
  it("returns none and resets for a normal turn", () => {
    const g = new EmptyActionableGuard("auto-continue", 2);
    expect(g.observe("s1", "normal")).toEqual({ action: "none" });
  });

  it("auto-continue nudges on the first empty-actionable turn", () => {
    const g = new EmptyActionableGuard("auto-continue", 2);
    const d = g.observe("s1", "empty-actionable");
    expect(d.action).toBe("continue");
    expect(d.nudge).toBe(CONTINUATION_NUDGE);
  });

  it("caps consecutive continuations then surfaces", () => {
    const g = new EmptyActionableGuard("auto-continue", 2);
    expect(g.observe("s1", "empty-actionable").action).toBe("continue"); // 1
    expect(g.observe("s1", "empty-actionable").action).toBe("continue"); // 2
    const capped = g.observe("s1", "empty-actionable"); // 3 → over cap
    expect(capped.action).toBe("surface");
    expect(capped.reason).toBe(SURFACE_MESSAGE);
  });

  it("resets the counter when a normal turn interrupts the chain", () => {
    const g = new EmptyActionableGuard("auto-continue", 2);
    g.observe("s1", "empty-actionable"); // 1
    g.observe("s1", "empty-actionable"); // 2
    expect(g.observe("s1", "normal").action).toBe("none"); // reset
    // Chain restarts — first empty-actionable nudges again.
    expect(g.observe("s1", "empty-actionable").action).toBe("continue");
  });

  it("tracks counters per session independently", () => {
    const g = new EmptyActionableGuard("auto-continue", 1);
    expect(g.observe("s1", "empty-actionable").action).toBe("continue");
    expect(g.observe("s2", "empty-actionable").action).toBe("continue");
    expect(g.observe("s1", "empty-actionable").action).toBe("surface"); // s1 over cap
    expect(g.observe("s2", "empty-actionable").action).toBe("surface"); // s2 over cap
  });

  it("surface-only mode never nudges and always surfaces", () => {
    const g = new EmptyActionableGuard("surface-only", 2);
    const d1 = g.observe("s1", "empty-actionable");
    const d2 = g.observe("s1", "empty-actionable");
    expect(d1.action).toBe("surface");
    expect(d2.action).toBe("surface");
    expect(d1.nudge).toBeUndefined();
  });

  it("truncated/error turns yield none (handled elsewhere)", () => {
    const g = new EmptyActionableGuard("auto-continue", 2);
    expect(g.observe("s1", "truncated").action).toBe("none");
    expect(g.observe("s1", "error").action).toBe("none");
  });

  it("explicit reset clears the counter", () => {
    const g = new EmptyActionableGuard("auto-continue", 1);
    g.observe("s1", "empty-actionable"); // at cap
    g.reset("s1");
    expect(g.observe("s1", "empty-actionable").action).toBe("continue");
  });

  it("exposes a small default retry cap", () => {
    expect(DEFAULT_RETRY_CAP).toBe(2);
  });
});
