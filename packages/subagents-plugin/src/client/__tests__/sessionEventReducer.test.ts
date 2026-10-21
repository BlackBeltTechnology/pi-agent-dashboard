/**
 * The subagents plugin's session event reducer slice: pure, ownership of
 * exactly the four stream events, same-ref when a frame changes nothing.
 * Behavioural replay coverage lives in the shell's reducer suites (they
 * register this slice through the vitest setup file).
 *
 * See change: decouple-plugins-from-core (task 4.2).
 */
import { matchesEventTypePattern } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { type SubagentSessionSlice, sessionEventReducer } from "../sessionEventReducer.js";

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({ eventType, timestamp: 1000, data });
const empty = (): SubagentSessionSlice => ({ subagents: new Map() });

describe("subagents sessionEventReducer", () => {
  it("owns the four stream events plus completed/failed (written by the finalizer, 4.6)", () => {
    const claims = (t: string) => sessionEventReducer.eventTypes.some((p) => matchesEventTypePattern(p, t));
    for (const t of ["subagent_created", "subagent_started", "subagent_entry", "subagent_delta", "subagent_completed", "subagent_failed"]) {
      expect(claims(t)).toBe(true);
    }
    for (const t of ["tool_execution_end", "tool_execution_update", "agent_settled"]) expect(claims(t)).toBe(false);
  });

  it("subagent_completed|failed are left to the Agent finalizer: the slice returns the same state", () => {
    const before = empty();
    expect(sessionEventReducer.reduce(before, ev("subagent_completed", { id: "a", result: "r" }))).toBe(before);
    expect(sessionEventReducer.reduce(before, ev("subagent_failed", { id: "a", error: "e" }))).toBe(before);
  });

  it("subagent_started writes a running state into a NEW map; the input state is never mutated", () => {
    const before = empty();
    const after = sessionEventReducer.reduce(before, ev("subagent_started", { id: "a", type: "Explore", description: "d" }));
    expect(after).not.toBe(before);
    expect(after.subagents).not.toBe(before.subagents);
    expect(before.subagents.size).toBe(0);
    expect(after.subagents.get("a")).toMatchObject({ status: "running", type: "Explore", startedAt: 1000 });
  });

  it.each([
    ["entry without an agent id", ev("subagent_entry", { index: 0, entry: { kind: "text", text: "x", ts: 1 } })],
    ["entry with a negative index", ev("subagent_entry", { agentId: "a", index: -1, entry: { kind: "text", text: "x", ts: 1 } })],
    ["delta with a bad kind", ev("subagent_delta", { agentId: "a", blockId: 0, offset: 0, kind: "x", text: "t" })],
    ["delta without an agent id", ev("subagent_delta", { blockId: 0, offset: 0, kind: "text", text: "t" })],
    ["an unrelated event", ev("agent_start", {})],
  ])("%s → same state reference", (_label, event) => {
    const before = empty();
    expect(sessionEventReducer.reduce(before, event)).toBe(before);
  });

  it("a duplicate entry index returns the same state", () => {
    const entry = { kind: "text", text: "x", ts: 1 };
    const s1 = sessionEventReducer.reduce(empty(), ev("subagent_entry", { agentId: "a", index: 0, entry }));
    expect(sessionEventReducer.reduce(s1, ev("subagent_entry", { agentId: "a", index: 0, entry }))).toBe(s1);
  });
});
