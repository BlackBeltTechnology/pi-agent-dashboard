/**
 * Flows → automation action contribution (publish/collect): availability
 * gating + enum options from the injected live flows resolver, flow:run event
 * build, and pure-publisher wiring (provide, no consume).
 * See change: decouple-automation-action-registry, fix-automation-flow-detection.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ACTION_CONTRIBUTION_KEY,
  type FlowsForCwd,
  flowsActionContributions,
  provideFlowsActions,
  summarizeFlowResult,
} from "../server/automation-actions.js";

/** Stub resolver: returns the flows configured for a given cwd. */
function stubFlows(map: Record<string, string[]>): FlowsForCwd {
  return (cwd: string) => map[cwd] ?? [];
}

const noFlows: FlowsForCwd = () => [];

describe("flowsActionContributions", () => {
  it("contributes flows.run only (no resume/cancel); gated on the live flows resolver; enum options resolve", () => {
    const flowsForCwd = stubFlows({ "/w/invoice-bot": ["invoicebot:pull"] });
    const contribs = flowsActionContributions(flowsForCwd);
    expect(contribs.map((c) => c.id)).toEqual(["flows.run"]);

    const run = contribs[0]!;
    expect(run.source).toBe("flows");
    // Package/event-registered flow, not on disk under .pi/flows/flows.
    expect(run.available!("/w/invoice-bot")).toBe(true);
    // No running session for this cwd → empty → unavailable.
    expect(run.available!("/w/other")).toBe(false);

    const flowField = run.payloadSchema!.find((f) => f.key === "flow")!;
    expect(flowField.type).toBe("enum");
    expect(flowField.options!("/w/invoice-bot")).toEqual(["invoicebot:pull"]);
    expect(flowField.options!("/w/other")).toEqual([]);
  });

  it("flows.run emits a flow:run event (flowName+task) and declares its completion", () => {
    const run = flowsActionContributions(noFlows)[0]!;
    const ev = run.buildEvent!({ payload: { flow: "test:capabilities", task: "do it" }, automation: {} });
    expect(ev).toMatchObject({ eventType: "flow:run", data: { flowName: "test:capabilities", task: "do it" } });
    // Event-dispatched flow runs emit no agent_end — the action declares how it
    // finishes so the automation engine can finalize generically.
    expect(ev!.completion!.eventType).toBe("flow_complete");
    expect(typeof ev!.completion!.summarize).toBe("function");
    // task optional
    expect(run.buildEvent!({ payload: { flow: "test:capabilities" }, automation: {} }))
      .toMatchObject({ eventType: "flow:run", data: { flowName: "test:capabilities" } });
  });

  it("flows.run emits data.inputs (per-fire resolved, types preserved), task optional", () => {
    const run = flowsActionContributions(noFlows)[0]!;
    // Every flows.run also declares its completion (merged from
    // finalize-event-dispatched-automation-runs).
    const completion = { eventType: "flow_complete", summarize: expect.any(Function) };
    // payload arrives already interpolated by the engine: ${{trigger}} resolved.
    expect(
      run.buildEvent!({
        payload: { flow: "invoicebot:process", inputs: { invoice: "/spool/inv-042.pdf", priority: 5, dry: true } },
        automation: {},
      }),
    ).toEqual({
      eventType: "flow:run",
      data: { flowName: "invoicebot:process", inputs: { invoice: "/spool/inv-042.pdf", priority: 5, dry: true } },
      completion,
    });
    // task + inputs coexist
    expect(
      run.buildEvent!({ payload: { flow: "a:b", task: "label", inputs: { x: 1 } }, automation: {} }),
    ).toEqual({ eventType: "flow:run", data: { flowName: "a:b", task: "label", inputs: { x: 1 } }, completion });
    // empty / non-object inputs omitted
    expect(run.buildEvent!({ payload: { flow: "a:b", inputs: {} }, automation: {} }))
      .toEqual({ eventType: "flow:run", data: { flowName: "a:b" }, completion });
    expect(run.buildEvent!({ payload: { flow: "a:b", inputs: "nope" }, automation: {} }))
      .toEqual({ eventType: "flow:run", data: { flowName: "a:b" }, completion });
  });

  it("flows.run rejects a malformed flow id (emits nothing)", () => {
    const run = flowsActionContributions(noFlows)[0]!;
    expect(run.buildEvent!({ payload: { flow: "test:cap x", task: "t" }, automation: {} })).toBeNull();
    expect(run.buildEvent!({ payload: { flow: "nocolon", task: "t" }, automation: {} })).toBeNull();
    expect(run.buildEvent!({ payload: { flow: "" }, automation: {} })).toBeNull();
  });
});

describe("summarizeFlowResult (flows owns the FlowResult shape)", () => {
  it("builds a line from status + flowName + summary", () => {
    expect(
      summarizeFlowResult({
        status: "success",
        flowName: "invoicebot:process",
        lastResult: { result: { summary: "done: exported" } },
      }),
    ).toBe("flow invoicebot:process success: done: exported");
  });
  it("tolerates a missing summary and missing fields", () => {
    expect(summarizeFlowResult({ status: "error", flowName: "x:y" })).toBe("flow x:y error");
    expect(summarizeFlowResult(undefined)).toBe("flow finished");
  });
});

describe("provideFlowsActions (pure publisher)", () => {
  it("publishes the contribution under automation.action.flows and consumes nothing", () => {
    const provide = vi.fn();
    provideFlowsActions(provide, () => {}, noFlows);
    expect(provide).toHaveBeenCalledTimes(1);
    const [key, value] = provide.mock.calls[0]!;
    expect(key).toBe(ACTION_CONTRIBUTION_KEY);
    expect(key).toBe("automation.action.flows");
    expect((value as Array<{ id: string }>).map((c) => c.id)).toEqual(["flows.run"]);
  });
});
