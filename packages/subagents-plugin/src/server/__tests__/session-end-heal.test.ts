/**
 * Subagent orphan heal (moved from core `open-tool-calls.test.ts` #E6): the
 * plugin finds subagents created/started with no terminal frame and appends one
 * synthesized `subagent_failed` each, from `ctx.onSessionStatusEnded`.
 * See change: move-subagents-to-plugin (D4, tasks 5.2).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { findOpenSubagents, registerSessionEndHeal, synthesizeSessionEndedSubagentFail } from "../session-end-heal.js";

const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({
  eventType,
  timestamp: 1_000,
  data,
});
const stored = (events: DashboardEvent[]) => events.map((event, i) => ({ seq: i + 1, event }));

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

describe("registerSessionEndHeal", () => {
  /** A ctx whose store grows with every appended event, like the real one. */
  function harness(initial: DashboardEvent[]) {
    const events = [...initial];
    let handler: ((sessionId: string) => void) | undefined;
    const appendEvent = vi.fn((_sid: string, e: DashboardEvent) => {
      events.push(e);
      return { ok: true as const, seq: events.length, broadcast: true };
    });
    registerSessionEndHeal({
      onSessionStatusEnded: (h) => {
        handler = h;
        return () => {};
      },
      eventStore: { getEvents: () => stored(events), getLatestEvent: () => undefined },
      appendEvent,
      logger: { warn: vi.fn() } as never,
    });
    return { fire: (sid: string) => handler?.(sid), appendEvent };
  }

  it("appends one failed frame per open subagent, none for a completed one", () => {
    const h = harness([
      ev("subagent_created", { id: "ag-9" }),
      ev("subagent_started", { id: "ag-9" }),
      ev("subagent_started", { id: "ag-1" }),
      ev("subagent_completed", { id: "ag-1" }),
    ]);
    h.fire("S");
    expect(h.appendEvent).toHaveBeenCalledTimes(1);
    const [sid, event] = h.appendEvent.mock.calls[0];
    expect(sid).toBe("S");
    expect(event.eventType).toBe("subagent_failed");
    expect(event.data).toEqual({ id: "ag-9", error: "parent session ended", healedBy: "session_ended" });
  });

  it("is idempotent: a re-fired end finds nothing open", () => {
    const h = harness([ev("subagent_started", { id: "ag-9" })]);
    h.fire("S");
    h.fire("S");
    expect(h.appendEvent).toHaveBeenCalledTimes(1);
  });

  it("synthesizeSessionEndedSubagentFail carries the heal marker", () => {
    expect(synthesizeSessionEndedSubagentFail("x", 5)).toEqual({
      eventType: "subagent_failed",
      timestamp: 5,
      data: { id: "x", error: "parent session ended", healedBy: "session_ended" },
    });
  });
});
