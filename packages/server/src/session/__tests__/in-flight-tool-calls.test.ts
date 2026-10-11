/**
 * Live-only in-flight tool-call hint. Folded from test-plan E5.
 * See change: distinguish-tool-result-pending-vs-gone (D2).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInFlightToolCalls } from "../in-flight-tool-calls.js";

const ev = (eventType: string, data: Record<string, unknown> = {}): DashboardEvent => ({
  eventType,
  timestamp: 1,
  data,
});
const start = (id: string, extra: Record<string, unknown> = {}) =>
  ev("tool_execution_start", { toolCallId: id, toolName: "bash", ...extra });
const end = (id: string) => ev("tool_execution_end", { toolCallId: id });

describe("in-flight tool-call hint (E5)", () => {
  it("tracks a top-level call from start to end", () => {
    const h = createInFlightToolCalls();
    h.observeLive("s", start("a"));
    expect(h.isInFlight("s", "a")).toBe(true);
    h.observeLive("s", end("a"));
    expect(h.isInFlight("s", "a")).toBe(false);
  });

  it("never tracks a nested call", () => {
    const h = createInFlightToolCalls();
    h.observeLive("s", start("n", { parentToolCallId: "root" }));
    expect(h.isInFlight("s", "n")).toBe(false);
  });

  it("agent_settled empties the session and removes its entry", () => {
    const h = createInFlightToolCalls();
    h.observeLive("s", start("a"));
    expect(h.sessionCount()).toBe(1);
    h.observeLive("s", ev("agent_settled"));
    expect(h.isInFlight("s", "a")).toBe(false);
    expect(h.sessionCount()).toBe(0);
  });

  it("an end that empties a session removes its entry", () => {
    const h = createInFlightToolCalls();
    h.observeLive("s", start("a"));
    h.observeLive("s", end("a"));
    expect(h.sessionCount()).toBe(0);
  });

  it("clear(s) leaves other sessions", () => {
    const h = createInFlightToolCalls();
    h.observeLive("s", start("a"));
    h.observeLive("t", start("b"));
    h.clear("s");
    expect(h.isInFlight("s", "a")).toBe(false);
    expect(h.isInFlight("t", "b")).toBe(true);
  });

  it("holds at most 256 ids per session (oldest dropped)", () => {
    const h = createInFlightToolCalls();
    for (let i = 0; i < 257; i++) h.observeLive("s", start(`id${i}`));
    expect(h.idCount("s")).toBe(256);
    expect(h.isInFlight("s", "id0")).toBe(false);
    expect(h.isInFlight("s", "id256")).toBe(true);
  });

  it("ignores events without a string toolCallId", () => {
    const h = createInFlightToolCalls();
    h.observeLive("s", ev("tool_execution_start", { toolName: "bash" }));
    expect(h.sessionCount()).toBe(0);
  });
});
