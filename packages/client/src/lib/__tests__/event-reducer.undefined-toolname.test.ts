/**
 * Regression suite for change: fix-reducer-crash-undefined-toolname
 *
 * A live `tool_execution_start` event can arrive with `data.toolName`
 * absent (pi core emits it that way for some tools; the bridge forwards
 * it verbatim). The reducer's start handler previously cast `toolName as
 * string` and called `.toLowerCase()` unguarded, throwing
 * `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`.
 * Because the reducer also runs at App level (rehydrate re-reduce) above
 * every error boundary, that throw black-screened the whole app.
 *
 * The reducer MUST tolerate an absent/non-string toolName: coalesce to a
 * stable fallback (`"unknown"`), never throw, and render the tool card.
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";

function startEvt(data: Record<string, unknown>, ts = 1000): DashboardEvent {
  return { eventType: "tool_execution_start", timestamp: ts, data } as DashboardEvent;
}

describe("reduceEvent — tool_execution_start with a malformed toolName", () => {
  it("does not throw and yields a running card with the fallback name when toolName is undefined", () => {
    const s0 = createInitialState();
    let s = s0;
    expect(() => {
      s = reduceEvent(s0, startEvt({ toolCallId: "t1", toolName: undefined, args: {} }));
    }).not.toThrow();

    const tc = s.toolCalls.get("t1");
    expect(tc).toBeDefined();
    expect(tc?.status).toBe("running");
    expect(tc?.toolName).toBe("unknown");

    const row = s.messages.find((m) => m.toolCallId === "t1");
    expect(row?.toolStatus).toBe("running");
    expect(row?.toolName).toBe("unknown");

    // Unknown name is neither write nor edit → no file-change flag.
    expect(s.hasFileChanges).toBe(false);
  });

  it("does not throw when toolName is a non-string value", () => {
    const s0 = createInitialState();
    let s = s0;
    expect(() => {
      s = reduceEvent(s0, startEvt({ toolCallId: "t2", toolName: 42, args: {} }));
    }).not.toThrow();
    expect(s.toolCalls.get("t2")?.toolName).toBe("unknown");
  });

  it("leaves a valid toolName unaffected (Write still flags hasFileChanges)", () => {
    let s = createInitialState();
    s = reduceEvent(s, startEvt({ toolCallId: "t3", toolName: "Write", args: {} }));
    expect(s.toolCalls.get("t3")?.toolName).toBe("Write");
    expect(s.hasFileChanges).toBe(true);
    expect(s.messages.find((m) => m.toolCallId === "t3")?.toolName).toBe("Write");
  });
});
