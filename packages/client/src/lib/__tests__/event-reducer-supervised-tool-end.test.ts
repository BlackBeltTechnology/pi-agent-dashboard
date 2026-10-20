/**
 * A Supervised-mode approval prompt carries the GUARDED tool's `toolCallId` in its metadata, so
 * the reducer stamps it on the `interactiveUi` row. That row sits after the tool row with the
 * same id; `tool_execution_update` / `tool_execution_end` must still land on the `toolResult`
 * row (never the prompt row), or a bash row stays "running" forever after Allow once (until reload).
 * Found by the L3 spec `tests/e2e/supervised-approval.spec.ts` #F2.
 *
 * See change: add-supervised-tool-approval.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { addInteractiveRequest, createInitialState, reduceEvent } from "../chat/event-reducer.js";

const ID = "tool:1:abc";
const start: DashboardEvent = {
  eventType: "tool_execution_start",
  timestamp: 1,
  data: { toolCallId: ID, toolName: "bash", args: { command: "echo hi" } },
};
const update: DashboardEvent = {
  eventType: "tool_execution_update",
  timestamp: 3,
  data: { toolCallId: ID, toolName: "bash", args: { command: "echo hi" }, partialResult: "hi\n" },
};
const end: DashboardEvent = {
  eventType: "tool_execution_end",
  timestamp: 4,
  data: { toolCallId: ID, toolName: "bash", result: "hi\n", isError: false },
};

describe("tool end/update with a paired approval prompt row (same toolCallId)", () => {
  it("settles the toolResult row, not the interactiveUi row", () => {
    let s = reduceEvent(createInitialState(), start);
    s = addInteractiveRequest(s, "req-1", "select", { title: "Run this command?" }, ID);
    s = reduceEvent(s, update);
    s = reduceEvent(s, end);

    const tool = s.messages.find((m) => m.role === "toolResult" && m.toolCallId === ID);
    const ui = s.messages.find((m) => m.role === "interactiveUi");
    expect(tool?.toolStatus).toBe("complete");
    expect(tool?.result).toContain("hi");
    // The prompt row is untouched by the tool's end.
    expect(ui?.toolStatus).toBeUndefined();
    expect(ui?.result).toBeUndefined();
  });
});
