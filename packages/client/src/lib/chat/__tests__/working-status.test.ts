import { describe, expect, it } from "vitest";
import { workingStatusLabel } from "../working-status.js";

describe("workingStatusLabel", () => {
  it("is null unless streaming", () => {
    expect(workingStatusLabel("idle", "bash", "x")).toBeNull();
    expect(workingStatusLabel("ended")).toBeNull();
  });

  it("names the running tool", () => {
    expect(workingStatusLabel("streaming", "bash")).toEqual({ kind: "tool", label: "Running bash..." });
  });

  it("reports generating when text is streaming and no tool runs", () => {
    expect(workingStatusLabel("streaming", undefined, "partial")).toEqual({ kind: "generating", label: "Generating..." });
  });

  it("falls back to thinking", () => {
    expect(workingStatusLabel("streaming")).toEqual({ kind: "thinking", label: "Thinking..." });
  });

  it("a tool wins over streaming text", () => {
    expect(workingStatusLabel("streaming", "read", "text")?.kind).toBe("tool");
  });
});
