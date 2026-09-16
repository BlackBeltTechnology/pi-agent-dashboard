/**
 * Pure open-tool-call / open-subagent derivation over a stored event stream.
 *
 * Folded 1:1 from the change's test-plan manifest: E1–E7 and P1.
 * See change: heal-orphaned-tool-cards-on-session-end.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../persistence/memory-event-store.js";
import { findOpenSubagents, findOpenToolCalls } from "../open-tool-calls.js";

/** Wrap bare events into the store's `{seq, event}` shape, seq ascending. */
function stored(events: DashboardEvent[]): StoredEvent[] {
  return events.map((event, i) => ({ seq: i + 1, event }));
}

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({
  eventType,
  timestamp: 1_000,
  data,
});

const start = (toolCallId: string, toolName: string) =>
  ev("tool_execution_start", { toolCallId, toolName });
const end = (toolCallId: string, extra: Record<string, unknown> = {}) =>
  ev("tool_execution_end", { toolCallId, ...extra });

/**
 * A `tool_execution_update` copied VERBATIM from a recorded dashboard stream
 * (captured off the live browser gateway). The `agentId` sits at
 * `data.partialResult.details.agentId`; a hand-shaped fixture could encode the
 * wrong path and go green while production stays broken (design D2).
 */
const RECORDED_UPDATE = JSON.parse(
  readFileSync(join(__dirname, "../../__fixtures__/recorded-agent-tool-update.json"), "utf8"),
) as { seq: number; event: DashboardEvent };

/** The recorded update re-pointed at a test tool-call id / agent id. */
function recordedUpdate(toolCallId: string, agentId: string): DashboardEvent {
  const src = RECORDED_UPDATE.event;
  const data = src.data as Record<string, unknown>;
  const partial = data.partialResult as Record<string, unknown>;
  const details = partial.details as Record<string, unknown>;
  return {
    ...src,
    data: {
      ...data,
      toolCallId,
      partialResult: { ...partial, details: { ...details, agentId } },
    },
  };
}

describe("findOpenToolCalls", () => {
  it("returns every unclosed start of the last turn, with the Agent's agentId (#E1)", () => {
    const events = stored([
      ev("agent_start", {}),
      start("A", "Agent"),
      recordedUpdate("A", "ag-1"),
      start("B", "bash"),
    ]);
    expect(findOpenToolCalls(events)).toEqual([
      { toolCallId: "A", toolName: "Agent", agentId: "ag-1" },
      { toolCallId: "B", toolName: "bash" },
    ]);
  });

  it("reads agentId from the nested recorded path, not a flat data.details (#E2)", () => {
    const nested = stored([ev("agent_start", {}), start("A", "Agent"), recordedUpdate("A", "ag-1")]);
    expect(findOpenToolCalls(nested)[0].agentId).toBe("ag-1");

    const flat = stored([
      ev("agent_start", {}),
      start("A", "Agent"),
      ev("tool_execution_update", { toolCallId: "A", details: { agentId: "ag-1" } }),
    ]);
    expect(findOpenToolCalls(flat)[0].agentId).toBeUndefined();
  });

  it("is scoped to the last agent_start — earlier turns are not reopened (#E3)", () => {
    const events = stored([
      ev("agent_start", {}),
      start("C", "bash"),
      ev("agent_start", {}),
      start("D", "bash"),
    ]);
    expect(findOpenToolCalls(events)).toEqual([{ toolCallId: "D", toolName: "bash" }]);
  });

  it("returns nothing when every start has its end (#E4)", () => {
    const events = stored([
      ev("agent_start", {}),
      start("A", "Agent"),
      start("B", "bash"),
      end("B"),
      end("A"),
    ]);
    expect(findOpenToolCalls(events)).toEqual([]);
  });

  it("handles an empty stream, and treats a stream with no agent_start as one turn (#E5)", () => {
    expect(findOpenToolCalls([])).toEqual([]);
    const noTurn = stored([start("A", "bash"), start("B", "bash"), end("B")]);
    expect(findOpenToolCalls(noTurn)).toEqual([{ toolCallId: "A", toolName: "bash" }]);
  });

  it("is idempotent — a stream already carrying a synthesized end has nothing open (#E7)", () => {
    const events = stored([
      ev("agent_start", {}),
      start("A", "Agent"),
      end("A", { isError: true, result: "parent session ended", healedBy: "session_ended" }),
    ]);
    expect(findOpenToolCalls(events)).toEqual([]);
  });

  it("scans a full store-cap stream in under 10 ms (#P1)", () => {
    const events = stored(
      Array.from({ length: 20_000 }, (_, i) => start(`t-${i}`, "bash")),
    );
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      findOpenToolCalls(events);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(10);
  });
});

describe("findOpenSubagents", () => {
  it("returns non-terminal subagents in first-seen order (#E6)", () => {
    const events = stored([
      ev("subagent_created", { id: "ag-9" }),
      ev("subagent_started", { id: "ag-9" }),
      ev("subagent_started", { id: "ag-1" }),
      ev("subagent_completed", { id: "ag-1" }),
      ev("subagent_created", { id: "ag-7" }),
    ]);
    expect(findOpenSubagents(events)).toEqual(["ag-9", "ag-7"]);
  });

  it("treats subagent_failed as terminal, so a healed stream rescans empty (#E6)", () => {
    const events = stored([
      ev("subagent_created", { id: "ag-9" }),
      ev("subagent_started", { id: "ag-9" }),
      ev("subagent_failed", { id: "ag-9", error: "parent session ended", healedBy: "session_ended" }),
    ]);
    expect(findOpenSubagents(events)).toEqual([]);
  });
});
