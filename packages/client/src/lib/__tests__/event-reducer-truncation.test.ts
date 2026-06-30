/**
 * Tool-result truncation for display (pi 0.73 bash streaming UX).
 *
 * truncateOutputForDisplay keeps the LAST N lines (default 200) and prepends
 * a `«N earlier lines hidden»` marker; short output is untouched. Verified
 * both directly and through the reducer's tool_execution_update /
 * tool_execution_end arms.
 *
 * See change: adopt-pi-071-072-073-features (C.1).
 */
import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduceEvent,
  truncateOutputForDisplay,
  type SessionState,
} from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function lines(n: number, prefix = "L"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join("\n");
}
function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce(reduceEvent, createInitialState());
}

describe("truncateOutputForDisplay (pure helper)", () => {
  it("keeps the last 200 lines + marker for a 500-line input", () => {
    const out = truncateOutputForDisplay(lines(500));
    const outLines = out.split("\n");
    expect(outLines[0]).toBe("«300 earlier lines hidden»");
    expect(outLines).toHaveLength(201); // marker + 200 lines
    expect(outLines[1]).toBe("L301");
    expect(outLines[outLines.length - 1]).toBe("L500");
  });

  it("returns short input unchanged (no marker)", () => {
    const out = truncateOutputForDisplay(lines(10));
    expect(out).toBe(lines(10));
    expect(out.startsWith("«")).toBe(false);
  });

  it("honors a custom maxLines option", () => {
    const out = truncateOutputForDisplay(lines(50), { maxLines: 10 });
    expect(out.split("\n")[0]).toBe("«40 earlier lines hidden»");
  });
});

describe("reducer wires truncateOutputForDisplay", () => {
  it("tool_execution_update.partialResult keeps last 200 of 500", () => {
    const state = applyEvents([
      { eventType: "tool_execution_start", timestamp: 1, data: { toolCallId: "t1", toolName: "bash", args: {} } },
      { eventType: "tool_execution_update", timestamp: 2, data: { toolCallId: "t1", partialResult: lines(500) } },
    ]);
    const row = state.messages.find((m) => m.toolCallId === "t1")!;
    expect(row.result!.startsWith("«300 earlier lines hidden»")).toBe(true);
    expect(row.result!.split("\n")).toHaveLength(201);
  });

  it("structured tool_execution_update.partialResult.content keeps last 200 of 500", () => {
    const state = applyEvents([
      { eventType: "tool_execution_start", timestamp: 1, data: { toolCallId: "t3", toolName: "Agent", args: {} } },
      { eventType: "tool_execution_update", timestamp: 2, data: { toolCallId: "t3", partialResult: { content: [{ text: lines(500) }], details: { status: "running" } } } },
    ]);
    const row = state.messages.find((m) => m.toolCallId === "t3")!;
    expect(row.result!.startsWith("«300 earlier lines hidden»")).toBe(true);
    expect(row.result!.split("\n")).toHaveLength(201);
  });

  it("tool_execution_end.result keeps last 200 of 1000", () => {
    const state = applyEvents([
      { eventType: "tool_execution_start", timestamp: 1, data: { toolCallId: "t2", toolName: "bash", args: {} } },
      { eventType: "tool_execution_end", timestamp: 2, data: { toolCallId: "t2", result: lines(1000), status: "success" } },
    ]);
    const row = state.messages.find((m) => m.toolCallId === "t2")!;
    expect(row.result!.startsWith("«800 earlier lines hidden»")).toBe(true);
    expect(row.result!.split("\n")).toHaveLength(201);
  });
});
