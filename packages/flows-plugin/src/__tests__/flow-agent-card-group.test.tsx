/**
 * Group (fan-out), decision-route and skipped cards (pi-flows 0.10).
 * See change: update-flows-plugin (task 4.5; test-plan E56).
 */
import { createUiPrimitiveRegistry, registerUiPrimitive, UiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowStepCards } from "../client/FlowStepCards.js";
import type { FlowAgentState, FlowState } from "../types.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.agentCard,
  (({ name, children }: { name: string; children?: React.ReactNode }) => (
    <div data-testid="agent-card" data-name={name}>
      {children}
    </div>
  )) as never,
);
for (const k of [UI_PRIMITIVE_KEYS.dialog] as const) registerUiPrimitive(registry, k, (() => null) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, ((ms: number) => `${ms}ms`) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, ((x: number) => `${x}`) as never);

afterEach(() => cleanup());

const card = (stepId: string, status: FlowAgentState["status"], extra: Partial<FlowAgentState> = {}): FlowAgentState => ({
  agentName: stepId,
  stepId,
  status,
  blockedBy: [],
  recentTools: [],
  detailHistory: [],
  ...extra,
});

describe("group / decision / skipped cards (E56)", () => {
  it("renders the fan-out group with item cards and ok / failed pills, decision routes and a skipped card", () => {
    const items = [0, 1, 2].map((i) =>
      card("review", i === 1 ? "error" : "complete", { itemIndex: i, itemKey: `review[${i}]` }),
    );
    const agents = [card("triage", "complete"), card("review", "error", { itemCount: 3 }), card("fix", "pending"), card("doc", "skipped")];
    const state: FlowState = {
      flowName: "f",
      task: "",
      status: "running",
      autonomousMode: false,
      agents: new Map(agents.map((a) => [a.stepId, a])),
      dagSteps: [{ id: "triage", stepType: "agent-decision", blockedBy: [], branches: { bug: "fix", docs: "doc" } }],
      groups: { review: items },
      decisions: { triage: { labels: ["bug"], routes: [{ branch: "bug" }], chosenTargets: ["fix"], notTaken: ["doc"] } },
    };
    render(
      <UiPrimitiveProvider value={registry}>
        <FlowStepCards state={state} agents={agents} selectedStepId={null} onSelect={() => {}} />
      </UiPrimitiveProvider>,
    );
    const group = screen.getByTestId("flow-group-card");
    expect(within(group).getAllByTestId("agent-card")).toHaveLength(3);
    expect(group.textContent).toContain("2 ok");
    expect(group.textContent).toContain("1 failed");
    expect(group.textContent).toContain("fan-out x3");
    const routes = screen.getByTestId("flow-decision-routes");
    expect(routes.textContent).toContain("bug");
    expect(routes.textContent).toContain("docs: not taken");
    expect(screen.getByTestId("flow-skipped-card").textContent).toContain("skipped");
  });

  it("a decision route error shows the error and no not-taken chips", () => {
    const agents = [card("triage", "complete")];
    const state: FlowState = {
      flowName: "f",
      task: "",
      status: "running",
      autonomousMode: false,
      agents: new Map(agents.map((a) => [a.stepId, a])),
      dagSteps: [{ id: "triage", stepType: "agent-decision", blockedBy: [], branches: { bug: "fix" } }],
      decisions: { triage: { routeError: "for_each must resolve to an array", chosenTargets: [], notTaken: [] } },
    };
    render(
      <UiPrimitiveProvider value={registry}>
        <FlowStepCards state={state} agents={agents} selectedStepId={null} onSelect={() => {}} />
      </UiPrimitiveProvider>,
    );
    expect(screen.getByTestId("flow-decision-error").textContent).toContain("for_each must resolve");
    expect(screen.queryByTestId("flow-decision-routes")).toBeNull();
  });
});
