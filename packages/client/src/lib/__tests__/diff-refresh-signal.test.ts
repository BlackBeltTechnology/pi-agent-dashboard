/**
 * Tests for the diff-refresh mutation signal.
 *
 * The client schedules a session-diff refresh after every classified mutation
 * result (including failed results) via the shared classifier, and never for
 * Read/search. See change: retain-failed-tool-file-changes.
 */
import { describe, expect, it } from "vitest";
import { countMutationResults } from "../diff-refresh-signal.js";
import type { ChatMessage } from "../event-reducer.js";

function toolResult(toolName: string, isError = false): ChatMessage {
  return { role: "toolResult", toolName, isError } as unknown as ChatMessage;
}

describe("countMutationResults", () => {
  it("counts apply_patch, Shell, StrReplace, exec_command, Edit, Write, Bash results", () => {
    const msgs = [
      toolResult("apply_patch"),
      toolResult("Shell"),
      toolResult("StrReplace"),
      toolResult("exec_command"),
      toolResult("Edit"),
      toolResult("Write"),
      toolResult("Bash"),
    ];
    expect(countMutationResults(msgs)).toBe(7);
  });

  it("counts failed mutation results too", () => {
    expect(countMutationResults([toolResult("Write", true), toolResult("apply_patch", true)])).toBe(2);
  });

  it("does NOT count Read / search / other non-mutation results", () => {
    const msgs = [toolResult("Read"), toolResult("grep"), toolResult("glob"), toolResult("web_search")];
    expect(countMutationResults(msgs)).toBe(0);
  });

  it("ignores non-toolResult rows", () => {
    const msgs = [
      { role: "assistant" } as ChatMessage,
      { role: "user" } as ChatMessage,
      toolResult("Write"),
    ];
    expect(countMutationResults(msgs)).toBe(1);
  });

  it("is case-insensitive on tool name", () => {
    expect(countMutationResults([toolResult("WRITE"), toolResult("aPpLy_PaTcH")])).toBe(2);
  });
});
