import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createMemoryEventStore } from "../memory-event-store.js";
import { maybeStubToolResult, STUB_BYTE_THRESHOLD } from "../tool-result-stub.js";

const neverPinned = () => false;

describe("memory-event-store byteSize + stub (Strategy B)", () => {
  it("records pre-truncation byteSize for a heavy tool result and stubs it on replay", () => {
    const store = createMemoryEventStore(neverPinned);
    const big = "z".repeat(STUB_BYTE_THRESHOLD + 5000);
    const ev: DashboardEvent = {
      eventType: "tool_execution_end",
      timestamp: 1,
      data: { toolName: "Bash", result: big, entryId: "entry-1", isError: false },
    };
    store.insertEvent("s1", ev);

    const stored = store.getEvents("s1", 1)[0].event;
    // Body truncated in the store…
    expect((stored.data.result as string).length).toBeLessThan(big.length);
    // …but the true size is recorded.
    expect(stored.data.byteSize).toBe(big.length);

    // Replay transform produces a stub without the full body.
    const replayed = maybeStubToolResult(stored);
    expect(replayed.data.stub).toBe(true);
    expect(replayed.data.byteSize).toBe(big.length);
    expect(replayed.data.entryId).toBe("entry-1");
    expect(replayed.data.result).toBeUndefined();
  });

  it("records byteSize + stubs a STRUCTURED result (live `{content:[{type:text}]}` shape)", () => {
    const store = createMemoryEventStore(neverPinned);
    const text = `HEADMARKER${"X".repeat(STUB_BYTE_THRESHOLD + 2000)}TAILMARKER`;
    const ev: DashboardEvent = {
      eventType: "tool_execution_end",
      timestamp: 1,
      // The live bridge forwards the result as a content-block object, NOT a string.
      data: { toolName: "bash", result: { content: [{ type: "text", text }] }, entryId: "e-bash" },
    };
    store.insertEvent("s1", ev);
    const stored = store.getEvents("s1", 1)[0].event;
    expect(stored.data.byteSize).toBe(Buffer.byteLength(text, "utf8"));

    const replayed = maybeStubToolResult(stored);
    expect(replayed.data.stub).toBe(true);
    expect(replayed.data.byteSize).toBeGreaterThan(STUB_BYTE_THRESHOLD);
    expect(replayed.data.entryId).toBe("e-bash");
    expect(replayed.data.result).toBeUndefined();
    // Preview is the first 200 chars of the inner text — no TAILMARKER.
    expect(String(replayed.data.preview).startsWith("HEADMARKER")).toBe(true);
    expect(String(replayed.data.preview)).not.toContain("TAILMARKER");
  });

  it("records byteSize + stubs a heavy result even when truncation is DISABLED (prod default maxStringFieldSize=0)", () => {
    // Production config defaults maxStringFieldSize to 0 → no truncation. byteSize
    // recording must NOT depend on a truncated copy existing.
    const store = createMemoryEventStore(neverPinned, undefined, undefined, 0);
    const text = `HEADMARKER${"X".repeat(STUB_BYTE_THRESHOLD + 2000)}TAILMARKER`;
    const ev: DashboardEvent = {
      eventType: "tool_execution_end",
      timestamp: 1,
      data: { toolName: "bash", result: { content: [{ type: "text", text }] }, entryId: "e-bash" },
    };
    store.insertEvent("s1", ev);
    const stored = store.getEvents("s1", 1)[0].event;
    // Body NOT truncated (truncation disabled) but byteSize still recorded…
    expect((stored.data.result as { content: { text: string }[] }).content[0].text.length).toBe(text.length);
    expect(stored.data.byteSize).toBe(Buffer.byteLength(text, "utf8"));
    // …and the live caller object is never mutated.
    expect(ev.data.byteSize).toBeUndefined();
    // …and it stubs on replay.
    expect(maybeStubToolResult(stored).data.stub).toBe(true);
  });

  it("does not record byteSize or stub a small tool result", () => {
    const store = createMemoryEventStore(neverPinned);
    const ev: DashboardEvent = {
      eventType: "tool_execution_end",
      timestamp: 1,
      data: { toolName: "Read", result: "small", entryId: "entry-2" },
    };
    store.insertEvent("s1", ev);
    const stored = store.getEvents("s1", 1)[0].event;
    expect(stored.data.byteSize).toBeUndefined();
    expect(maybeStubToolResult(stored)).toBe(stored);
  });

  it("does not mutate the caller's live event object", () => {
    const store = createMemoryEventStore(neverPinned);
    const big = "q".repeat(STUB_BYTE_THRESHOLD + 100);
    const ev: DashboardEvent = {
      eventType: "tool_execution_end",
      timestamp: 1,
      data: { toolName: "Bash", result: big, entryId: "e3" },
    };
    store.insertEvent("s1", ev);
    // Original object the broadcast path holds is untouched.
    expect(ev.data.byteSize).toBeUndefined();
    expect((ev.data.result as string).length).toBe(big.length);
  });
});
