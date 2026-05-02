/**
 * Regression suite for change: fix-replay-duplicates-tool-and-flushed-rows
 *
 * `tool_execution_start` MUST be idempotent on `toolCallId`: replaying
 * the same start event MUST NOT push a duplicate `toolResult` row.
 * For in-flight (`running`) rows it updates in place; for terminal rows
 * (`complete`/`error`) it falls through to push so a hypothetical id
 * reuse doesn't silently overwrite a finalised tool card.
 */

import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function startEvt(toolCallId: string, command: string, ts = 1000): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: ts,
    data: { toolCallId, toolName: "bash", args: { command } },
  };
}

function endEvt(toolCallId: string, ts = 2000): DashboardEvent {
  return {
    eventType: "tool_execution_end",
    timestamp: ts,
    data: { toolCallId, isError: false, result: "ok" },
  };
}

describe("tool_execution_start idempotency", () => {
  it("two starts with identical toolCallId update in place; latest args win, original startedAt preserved", () => {
    let s = createInitialState();
    s = reduceEvent(s, startEvt("t1", "first", 1000));
    s = reduceEvent(s, startEvt("t1", "second", 1100));

    const t1Rows = s.messages.filter((m) => m.toolCallId === "t1");
    expect(t1Rows).toHaveLength(1);
    expect((t1Rows[0].args as { command: string }).command).toBe("second");
    expect(t1Rows[0].toolStatus).toBe("running");
    // startedAt preserved from the original push so duration derivation at
    // tool_execution_end stays correct.
    expect(t1Rows[0].startedAt).toBe(1000);
  });

  it("start replayed after the tool is already complete preserves terminal state", () => {
    let s = createInitialState();
    s = reduceEvent(s, startEvt("t1", "first", 1000));
    s = reduceEvent(s, endEvt("t1", 1500));
    // Capture terminal-state shape
    const before = s.messages.find((m) => m.toolCallId === "t1");
    expect(before?.toolStatus).toBe("complete");
    expect(before?.result).toBe("ok");

    // Replay the start event — the duplicate-key push must NOT happen.
    s = reduceEvent(s, startEvt("t1", "second", 2000));

    const t1Rows = s.messages.filter((m) => m.toolCallId === "t1");
    expect(t1Rows).toHaveLength(1);
    // toolStatus and result preserved — in-place update only refreshes
    // args/toolName, never clobbers terminal data.
    expect(t1Rows[0].toolStatus).toBe("complete");
    expect(t1Rows[0].result).toBe("ok");
    // args reflect the replayed event
    expect((t1Rows[0].args as { command: string }).command).toBe("second");
  });

  it("N-fold replay of the same tool sequence produces N rows, not 2N", () => {
    const events: DashboardEvent[] = [
      startEvt("t1", "ls", 1000),
      endEvt("t1", 1100),
      startEvt("t2", "pwd", 1200),
      endEvt("t2", 1300),
      startEvt("t3", "whoami", 1400),
      endEvt("t3", 1500),
    ];

    // First pass
    let s = createInitialState();
    for (const e of events) s = reduceEvent(s, e);
    const firstPassToolCount = s.messages.filter((m) => m.role === "toolResult").length;
    expect(firstPassToolCount).toBe(3);

    // Replay same sequence on top of existing state — must NOT double
    for (const e of events) s = reduceEvent(s, e);
    const secondPassToolCount = s.messages.filter((m) => m.role === "toolResult").length;
    expect(secondPassToolCount).toBe(3);
  });
});
