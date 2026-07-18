import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { truncateToolResultForReplay } from "../session/replay-truncate.js";

const MARKER = "«";

function toolEnd(result: unknown): DashboardEvent {
  return { eventType: "tool_execution_end", timestamp: 1, data: { toolName: "bash", toolCallId: "tc1", result } };
}

describe("truncateToolResultForReplay (Strategy B, reconciled onto develop)", () => {
  it("pre-truncates a > 200-line STRING result to the display form", () => {
    const text = Array.from({ length: 500 }, (_, i) => `line-${i + 1}`).join("\n");
    const out = truncateToolResultForReplay(toolEnd(text));
    const r = out.data.result as string;
    expect(r.startsWith(`${MARKER}300 earlier lines hidden»`)).toBe(true);
    expect(r.split("\n").length).toBe(201); // marker line + last 200
    expect(r).toContain("line-500"); // tail kept
    expect(r).not.toContain("line-1\n"); // head dropped
  });

  it("pre-truncates a > 200-line STRUCTURED result ({content:[{type:text}]})", () => {
    const text = Array.from({ length: 300 }, (_, i) => `row-${i + 1}`).join("\n");
    const out = truncateToolResultForReplay(toolEnd({ content: [{ type: "text", text }] }));
    const r = out.data.result as string;
    expect(typeof r).toBe("string");
    expect(r.startsWith(`${MARKER}100 earlier lines hidden»`)).toBe(true);
    expect(r).toContain("row-300");
  });

  it("truncates a > 200-line result that merely STARTS with « (not the full header)", () => {
    const text = `« not a real marker\n${Array.from({ length: 400 }, (_, i) => `q${i}`).join("\n")}`;
    const out = truncateToolResultForReplay(toolEnd(text));
    const r = out.data.result as string;
    expect(r.startsWith(`${MARKER}201 earlier lines hidden»`)).toBe(true);
  });

  it("leaves a <= 200-line result unchanged (inline)", () => {
    const text = Array.from({ length: 50 }, (_, i) => `x${i}`).join("\n");
    const ev = toolEnd(text);
    expect(truncateToolResultForReplay(ev)).toBe(ev);
  });

  it("is idempotent: an already-truncated result passes through unchanged", () => {
    const already = `${MARKER}10 earlier lines hidden»\nlast\nlines`;
    const ev = toolEnd(already);
    expect(truncateToolResultForReplay(ev)).toBe(ev);
  });

  it("never mutates the caller's live event object", () => {
    const text = Array.from({ length: 400 }, (_, i) => `n${i}`).join("\n");
    const ev = toolEnd(text);
    truncateToolResultForReplay(ev);
    expect(ev.data.result).toBe(text); // original untouched
  });

  it("ignores non-tool events", () => {
    const ev: DashboardEvent = { eventType: "message_end", timestamp: 1, data: { foo: "bar" } };
    expect(truncateToolResultForReplay(ev)).toBe(ev);
  });
});
