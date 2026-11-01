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
import { findBackfillOpenToolCalls, findOpenSubagents, findOpenToolCalls } from "../open-tool-calls.js";

/** Wrap bare events into the store's `{seq, event}` shape, seq ascending. */
function stored(events: DashboardEvent[]): StoredEvent[] {
  return events.map((event, i) => ({ seq: i + 1, event, bytes: 0 }));
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
) as { seq: number; event: DashboardEvent; bytes: number };

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
    findOpenToolCalls(events); // warm-up: the first call pays JIT cost
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      findOpenToolCalls(events);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // 10 ms is the design bound (test-plan #P1). Shared CI runners measured a
    // median of 11.4 ms (nightly 2026-10-22); allow headroom there, still an
    // order of magnitude below anything that would need a scan limit.
    expect(times[2]).toBeLessThan(process.env.CI ? 30 : 10);
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

// See change: render-nested-tool-calls — test-plan E16.
describe("findOpenToolCalls — nested calls are never healed (E16)", () => {
  const nestedStart = (id: string, parent: string) =>
    ev("tool_execution_start", { toolCallId: id, toolName: "bash", parentToolCallId: parent });

  it("(a) root ended + nested still open → empty", () => {
    const events = stored([
      ev("agent_start", {}),
      start("call_1", "codemode"),
      nestedStart("call_1/1", "call_1"),
      end("call_1"),
    ]);
    expect(findOpenToolCalls(events)).toEqual([]);
  });

  it("(b) root and nested both open → only the root", () => {
    const events = stored([
      ev("agent_start", {}),
      start("call_1", "codemode"),
      nestedStart("call_1/1", "call_1"),
    ]);
    expect(findOpenToolCalls(events)).toEqual([{ toolCallId: "call_1", toolName: "codemode" }]);
  });
});

// A live bridge replay leaves its in-flight tail open and re-announces the
// running turn with a SYNTHETIC agent_start after the replay. That marked start
// must not bound the scan, or a real death never heals the tail.
// See change: fix-replay-fabricates-orphan-end-for-live-calls (D4).
describe("findOpenToolCalls — synthetic reconnect agent_start", () => {
  it("walks past a synthetic agent_start (test-plan #E7)", () => {
    const events = stored([
      ev("agent_start", {}),
      start("A", "Agent"),
      recordedUpdate("A", "ag-1"),
      ev("agent_start", { synthetic: true }),
    ]);
    expect(findOpenToolCalls(events)).toEqual([{ toolCallId: "A", toolName: "Agent", agentId: "ag-1" }]);
  });

  it("an unmarked agent_start still bounds the scan (test-plan #E8)", () => {
    const events = stored([start("C", "bash"), ev("agent_start", {})]);
    expect(findOpenToolCalls(events)).toEqual([]);
  });

  it("dedupes a repeated open start by toolCallId (test-plan #E9)", () => {
    const events = stored([ev("agent_start", {}), start("A", "bash"), start("A", "bash")]);
    expect(findOpenToolCalls(events)).toEqual([{ toolCallId: "A", toolName: "bash" }]);
  });
});

// Serve-time open set for a `history_backfill_result`: narrower than
// `findOpenToolCalls` — an ended turn or a later assistant inference also closes.
// See change: fix-backfill-elides-live-tools (D1).
describe("findBackfillOpenToolCalls", () => {
  const upd = (toolCallId: string) => ev("tool_execution_update", { toolCallId });
  const msgStart = (role: string) => ev("message_start", { message: { role } });

  it("reports a start with only updates after it (test-plan #E1)", () => {
    const suffix = stored([start("c1", "Agent"), upd("c1"), upd("c1")]);
    expect(findBackfillOpenToolCalls(["c1"], suffix)).toEqual(["c1"]);
  });

  it("a real or healed end closes it (test-plan #E2)", () => {
    expect(findBackfillOpenToolCalls(["c1"], stored([start("c1", "bash"), end("c1")]))).toEqual([]);
    const healed = stored([
      start("c1", "bash"),
      end("c1", { isError: true, healedBy: "session_ended" }),
    ]);
    expect(findBackfillOpenToolCalls(["c1"], healed)).toEqual([]);
  });

  it("a later non-synthetic agent_start closes it (test-plan #E3)", () => {
    expect(findBackfillOpenToolCalls(["c1"], stored([start("c1", "bash"), ev("agent_start", {})]))).toEqual([]);
  });

  it("a later SYNTHETIC agent_start does not close it (test-plan #E4)", () => {
    const suffix = stored([start("c1", "bash"), ev("agent_start", { synthetic: true })]);
    expect(findBackfillOpenToolCalls(["c1"], suffix)).toEqual(["c1"]);
  });

  it("a later agent_end closes it (test-plan #E5)", () => {
    expect(findBackfillOpenToolCalls(["c1"], stored([start("c1", "bash"), ev("agent_end", {})]))).toEqual([]);
  });

  it("only a later ASSISTANT message_start closes it (test-plan #E6)", () => {
    const run = (role: string) =>
      findBackfillOpenToolCalls(["c1"], stored([start("c1", "bash"), msgStart(role)]));
    expect(run("assistant")).toEqual([]);
    expect(run("toolResult")).toEqual(["c1"]);
    expect(run("user")).toEqual(["c1"]);
  });

  it("never reports a nested start (test-plan #E7)", () => {
    const suffix = stored([ev("tool_execution_start", { toolCallId: "c1", toolName: "bash", parentToolCallId: "p" })]);
    expect(findBackfillOpenToolCalls(["c1"], suffix)).toEqual([]);
  });

  it("reports only open candidates actually present (test-plan #E8)", () => {
    const suffix = stored([start("c1", "bash"), start("c2", "bash"), end("c1")]);
    expect(findBackfillOpenToolCalls(["c1", "c2", "c3"], suffix)).toEqual(["c2"]);
  });

  it("scans a 50,000-event suffix in under 25 ms (test-plan #P1)", () => {
    const suffix = stored([
      ...Array.from({ length: 20 }, (_, i) => start(`c-${i}`, "bash")),
      ...Array.from({ length: 49_980 }, (_, i) => upd(`c-${i % 20}`)),
    ]);
    const candidates = Array.from({ length: 20 }, (_, i) => `c-${i}`);
    expect(findBackfillOpenToolCalls(candidates, suffix)).toHaveLength(20); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      findBackfillOpenToolCalls(candidates, suffix);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(25);
  });
});
