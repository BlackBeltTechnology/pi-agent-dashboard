import { describe, it, expect } from "vitest";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { maybeStubToolResult, STUB_BYTE_THRESHOLD, STUB_PREVIEW_CHARS } from "../tool-result-stub.js";

function toolEnd(data: Record<string, unknown>): DashboardEvent {
  return { eventType: "tool_execution_end", timestamp: 1, data };
}

describe("maybeStubToolResult", () => {
  it("stubs a heavy finalized tool result, dropping the full body", () => {
    const big = "x".repeat(STUB_BYTE_THRESHOLD + 500);
    const out = maybeStubToolResult(
      toolEnd({ toolName: "Bash", result: big, byteSize: big.length, entryId: "e1", isError: false }),
    );
    expect(out.data.stub).toBe(true);
    expect(out.data.byteSize).toBe(big.length);
    expect(out.data.entryId).toBe("e1");
    expect(out.data.preview).toBe(big.slice(0, STUB_PREVIEW_CHARS));
    // Full body must NOT be present.
    expect(out.data.result).toBeUndefined();
    // Unrelated fields preserved.
    expect(out.data.toolName).toBe("Bash");
  });

  it("leaves a small tool result inline unchanged", () => {
    const small = "short output";
    const ev = toolEnd({ toolName: "Read", result: small, entryId: "e2" });
    const out = maybeStubToolResult(ev);
    expect(out).toBe(ev); // same ref, no transform
    expect(out.data.result).toBe(small);
    expect(out.data.stub).toBeUndefined();
  });

  it("does not stub when entryId is missing (cannot fetch full body)", () => {
    const big = "y".repeat(STUB_BYTE_THRESHOLD + 10);
    const ev = toolEnd({ toolName: "Bash", result: big, byteSize: big.length });
    const out = maybeStubToolResult(ev);
    expect(out).toBe(ev);
    expect(out.data.result).toBe(big);
  });

  it("ignores non-tool events", () => {
    const ev: DashboardEvent = { eventType: "message_end", timestamp: 1, data: { byteSize: 99999, entryId: "x" } };
    expect(maybeStubToolResult(ev)).toBe(ev);
  });
});
