import { describe, it, expect } from "vitest";
import { selectInflightBashTools } from "../useInflightBashTools.js";
import { createInitialState, type SessionState, type ToolCallState } from "../../lib/event-reducer.js";

function withToolCalls(...entries: ToolCallState[]): SessionState {
  const s = createInitialState();
  for (const e of entries) s.toolCalls.set(e.toolCallId, e);
  return s;
}

describe("selectInflightBashTools (redesign-process-list-activity-bar)", () => {
  it("returns [] for undefined state", () => {
    expect(selectInflightBashTools(undefined)).toEqual([]);
  });

  it("returns [] when no toolCalls exist", () => {
    expect(selectInflightBashTools(createInitialState())).toEqual([]);
  });

  it("returns one entry for one running bash toolCall", () => {
    const state = withToolCalls({
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "npm test" },
      status: "running",
      startedAt: 1000,
    });
    expect(selectInflightBashTools(state)).toEqual([
      { toolCallId: "tc-1", command: "npm test", startedAt: 1000 },
    ]);
  });

  it("returns multiple entries, newest first", () => {
    const state = withToolCalls(
      { toolCallId: "tc-old", toolName: "bash", args: { command: "sleep 10" }, status: "running", startedAt: 500 },
      { toolCallId: "tc-new", toolName: "bash", args: { command: "ls" }, status: "running", startedAt: 2000 },
      { toolCallId: "tc-mid", toolName: "bash", args: { command: "pwd" }, status: "running", startedAt: 1000 },
    );
    const result = selectInflightBashTools(state);
    expect(result.map((r) => r.toolCallId)).toEqual(["tc-new", "tc-mid", "tc-old"]);
  });

  it("excludes resolved bash toolCalls (complete + error)", () => {
    const state = withToolCalls(
      { toolCallId: "running", toolName: "bash", args: { command: "a" }, status: "running", startedAt: 1 },
      { toolCallId: "done", toolName: "bash", args: { command: "b" }, status: "complete", startedAt: 2 },
      { toolCallId: "errored", toolName: "bash", args: { command: "c" }, status: "error", startedAt: 3 },
    );
    const result = selectInflightBashTools(state);
    expect(result.map((r) => r.toolCallId)).toEqual(["running"]);
  });

  it("excludes non-bash tools", () => {
    const state = withToolCalls(
      { toolCallId: "read", toolName: "Read", args: { path: "foo" }, status: "running", startedAt: 1 },
      { toolCallId: "write", toolName: "Write", args: { path: "bar" }, status: "running", startedAt: 2 },
      { toolCallId: "ui", toolName: "interactiveUi", status: "running", startedAt: 3 },
      { toolCallId: "bash", toolName: "bash", args: { command: "ls" }, status: "running", startedAt: 4 },
    );
    expect(selectInflightBashTools(state).map((r) => r.toolCallId)).toEqual(["bash"]);
  });

  it("matches toolName case-insensitively", () => {
    const state = withToolCalls({
      toolCallId: "tc-1",
      toolName: "Bash",
      args: { command: "ls" },
      status: "running",
      startedAt: 1,
    });
    expect(selectInflightBashTools(state)).toHaveLength(1);
  });

  it("falls back to empty command when args.command missing", () => {
    const state = withToolCalls({
      toolCallId: "tc-1",
      toolName: "bash",
      args: {},
      status: "running",
      startedAt: 1,
    });
    expect(selectInflightBashTools(state)[0].command).toBe("");
  });
});
