/**
 * Generic finalization of event-dispatched runs (change:
 * finalize-event-dispatched-automation-runs). Event-dispatch runs emit no
 * `agent_end`; the ACTION declares how it finishes (`emitEvent.completion`),
 * and `index.ts` `onEvent` finalizes generically on that declared event — with
 * NO action-specific event name in the automation plugin.
 *
 * This mirrors the `onEvent` finalize decision (same pattern as
 * `result-capture.test.ts` mirroring the buffer loop), so the branch logic is
 * asserted without booting the plugin/host.
 */
import { describe, it, expect } from "vitest";

type Completion = { eventType: string; summarize?: (d: Record<string, unknown> | undefined) => string };

/** Mirror of the index.ts onEvent finalize decision, kept minimal. */
function onEventFinalize(opts: {
  event: { eventType?: string; data?: Record<string, unknown> };
  buffered?: string[];
  runPromptSet: boolean; // prompt-dispatch run has a seeded prompt
  completion?: Completion; // event-dispatch run's declared completion
}): { finalized: boolean; result?: string } {
  const { event, buffered = [], completion } = opts;
  if (completion && event.eventType === completion.eventType) {
    const buf = buffered.join("\n\n").trim();
    return { finalized: true, result: buf || (completion.summarize?.(event.data) ?? "") };
  }
  if (event.eventType === "agent_end") {
    return { finalized: true, result: buffered.join("\n\n").trim() };
  }
  return { finalized: false };
}

const flowCompletion: Completion = {
  eventType: "flow_complete",
  summarize: (d) => `flow ${(d as any)?.flowName} ${(d as any)?.status}`,
};

describe("event-dispatched run finalization", () => {
  it("finalizes on the action-declared completion event, with the summarized result", () => {
    const r = onEventFinalize({
      event: { eventType: "flow_complete", data: { flowName: "invoicebot:process", status: "success" } },
      runPromptSet: false,
      completion: flowCompletion,
    });
    expect(r.finalized).toBe(true);
    expect(r.result).toBe("flow invoicebot:process success");
  });

  it("does NOT finalize on an unrelated forwarded event", () => {
    const r = onEventFinalize({
      event: { eventType: "flow_agent_complete", data: {} },
      runPromptSet: false,
      completion: flowCompletion,
    });
    expect(r.finalized).toBe(false);
  });

  it("prefers buffered assistant text over the summarizer when present", () => {
    const r = onEventFinalize({
      event: { eventType: "flow_complete", data: { flowName: "f:g", status: "success" } },
      buffered: ["hello"],
      runPromptSet: false,
      completion: flowCompletion,
    });
    expect(r.result).toBe("hello");
  });

  it("a run with no declared completion still finalizes on agent_end (prompt-dispatch default)", () => {
    const noCompletion = onEventFinalize({
      event: { eventType: "flow_complete", data: {} },
      runPromptSet: true,
    });
    expect(noCompletion.finalized).toBe(false); // flow_complete does not finalize a prompt run
    const onEnd = onEventFinalize({
      event: { eventType: "agent_end" },
      buffered: ["reply"],
      runPromptSet: true,
    });
    expect(onEnd).toEqual({ finalized: true, result: "reply" });
  });
});
