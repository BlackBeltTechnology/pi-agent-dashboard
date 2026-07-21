/**
 * Task 1.1 (Reproduce) for change: fix-stuck-tool-card-on-dropped-event.
 *
 * Baseline: when a tool's terminal `tool_execution_end` is WITHHELD (dropped
 * on the server→browser WS hop) but later events keep flowing, the reducer
 * alone leaves the tool card stuck in `running`. The reducer is stateless
 * about time — it cannot heal a missing terminal event. The heal lives one
 * layer up (useStaleToolReconcile), tested separately.
 *
 * Sequence: start(seq40), [end(41) withheld], event42, event43.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";

describe("stuck-tool baseline: withheld tool_execution_end leaves row running", () => {
  it("tool row stays running when its end event never arrives", () => {
    const events: DashboardEvent[] = [
      // seq 40 — tool starts (running spinner appears)
      {
        eventType: "tool_execution_start",
        timestamp: 40_000,
        data: { toolCallId: "stuck-1", toolName: "Read", args: { path: "foo.ts" } },
      },
      // seq 41 — tool_execution_end WITHHELD (dropped under WS back-pressure).
      // seq 42 — a later assistant turn proves the tool actually finished
      // server-side (the model cannot emit a new turn until prior tool
      // results return), yet the browser never saw the terminal event.
      {
        eventType: "message_start",
        timestamp: 42_000,
        data: { message: { role: "assistant", content: [] } },
      },
      // seq 43 — more streaming, unrelated to the stuck tool.
      {
        eventType: "message_update",
        timestamp: 43_000,
        data: { message: { role: "assistant", content: [{ type: "text", text: "next step" }] } },
      },
    ];

    let state = createInitialState();
    for (const e of events) state = reduceEvent(state, e);

    // toolCalls map still marks it running…
    expect(state.toolCalls.get("stuck-1")?.status).toBe("running");
    // …and the rendered tool row still shows the running spinner.
    const row = state.messages.find((m) => m.toolCallId === "stuck-1");
    expect(row?.toolStatus).toBe("running");
  });

  it("the same tool flips to complete once its end event is delivered", () => {
    // Confirms the reducer path IS idempotent + keyed by toolCallId — the
    // exact path useStaleToolReconcile drives with the server's held result.
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "tool_execution_start",
      timestamp: 40_000,
      data: { toolCallId: "stuck-1", toolName: "Read", args: { path: "foo.ts" } },
    });
    state = reduceEvent(state, {
      eventType: "tool_execution_end",
      timestamp: 41_000,
      data: { toolCallId: "stuck-1", isError: false, result: "file contents" },
    });

    expect(state.toolCalls.get("stuck-1")?.status).toBe("complete");
    const row = state.messages.find((m) => m.toolCallId === "stuck-1");
    expect(row?.toolStatus).toBe("complete");
    expect(row?.result).toBe("file contents");
  });
});
