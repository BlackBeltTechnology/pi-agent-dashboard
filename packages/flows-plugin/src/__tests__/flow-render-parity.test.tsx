/**
 * Render parity: one flow YAML drawn by every surface — idle panel (a), running
 * panel (b), completed panel (c) and the `flow_write` transcript card (d) —
 * yields the same graph node + edge set; running vs completed yield the same
 * Agent cards structure. Fails on any future divergence of the render paths.
 * See change: unify-flow-rendering (D6; test-plan E10, E11).
 */

import { registerUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { initPluginConfigs } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@blackbelt-technology/pi-dashboard-client-utils/useMobile", () => ({ useMobile: () => false }));

import { FlowDashboard } from "../client/FlowDashboard.js";
import { FlowWriteToolRenderer } from "../client/FlowWriteToolRenderer.js";
import { FLOW_SHOW_ERROR_ROUTES_KEY, flowCollapseKey } from "../client/flow-collapse-storage.js";
import { buildIdleFlowState } from "../client/flow-idle-state.js";
import { reduceFlowEvent } from "../reducer.js";
import type { FlowState } from "../types.js";
import { registry, tree, useIsolatedLocalStorage } from "./flows-test-harness.js";

useIsolatedLocalStorage();

/** Agent segment, a `code` separator followed by a step, a string-branch
 *  decision, an `on_error` route and a fan-out step (`review`). */
const PARITY_YAML = `
name: parity
description: render parity fixture
steps:
  - id: plan
    type: agent
    agent: planner
  - id: build
    type: agent
    agent: builder
    on_error: fixup
  - id: lint
    type: code
  - id: gate
    type: agent-decision
    agent: judge
    task: decide
    branches: { fix: review, ship: ship }
  - id: review
    type: agent
    agent: reviewer
  - id: ship
    type: code
  - id: fixup
    type: agent
    agent: fixer
`;

const SID = "parity-s";
let seq = 0;
const ev = (eventType: string, data: Record<string, unknown>) =>
  ({ seq: ++seq, timestamp: 1000 + seq, eventType, data }) as unknown as DashboardEvent;

function idleState(): FlowState {
  const r = buildIdleFlowState(PARITY_YAML, { name: "parity", source: "/p/parity/flow.yaml" });
  if (r.kind !== "ready") throw new Error(r.message);
  return r.flowState;
}

/** (a)'s `flow_started` (the idle state IS the reducer state after it) plus
 *  agent, decision and fan-out item events. */
function runningState(): FlowState {
  seq = 0;
  const events = [
    ev("flow_agent_started", { agentName: "planner", stepId: "plan" }),
    ev("flow_agent_complete", { agentName: "planner", stepId: "plan", result: { success: true } }),
    ev("flow_agent_started", { agentName: "builder", stepId: "build" }),
    ev("flow_agent_complete", { agentName: "builder", stepId: "build", result: { success: true } }),
    ev("flow_agent_started", { agentName: "judge", stepId: "gate" }),
    ev("flow_agent_complete", { agentName: "judge", stepId: "gate", result: { success: true } }),
    ev("flow_decision", { stepId: "gate", labels: ["fix"], routes: [{ branch: "fix", itemCount: 3 }] }),
    ...[0, 1, 2].map((i) => ev("flow_agent_started", { agentName: "reviewer", stepId: "review", itemIndex: i, itemCount: 3 })),
    ...[0, 1, 2].map((i) => ev("flow_agent_complete", { agentName: "reviewer", stepId: "review", itemIndex: i, result: { success: true } })),
  ];
  return events.reduce<FlowState>((s, e) => reduceFlowEvent(s, e) as FlowState, idleState());
}

function completedState(): FlowState {
  return reduceFlowEvent(runningState(), ev("flow_complete", { flowName: "parity", status: "success" })) as FlowState;
}

function renderPanel(state: FlowState, idle = false) {
  return render(
    tree(
      <FlowDashboard
        flowState={state}
        onAbort={() => {}}
        onToggleAutonomous={() => {}}
        onDismiss={() => {}}
        sessionId={SID}
        idle={idle ? { onRun: () => {}, onClose: () => {} } : undefined}
      />,
    ),
  );
}

function renderCard() {
  return render(
    tree(
      <FlowWriteToolRenderer
        toolName="flow_write"
        sessionId={SID}
        toolInput={{ content: PARITY_YAML }}
        status="complete"
        result={JSON.stringify({ written: true, command: "custom:parity", path: "/p/parity/flow.yaml", diagnostics: [] })}
      />,
    ),
  );
}

/** Node ids + edge `from>to` pairs of the inline graph (the harness Dialog
 *  renders its children even when closed, so dialog content is excluded). */
function graphOf(): { nodes: string[]; edges: string[]; kinds: string[] } {
  const attr = (sel: string, a: string) =>
    Array.from(document.querySelectorAll(sel))
      .filter((n) => !n.closest('[data-testid="dialog"]'))
      .map((n) => n.getAttribute(a) ?? "");
  return {
    nodes: attr("[data-node]", "data-node").sort(),
    edges: attr("[data-edge]", "data-edge").sort(),
    kinds: attr("[data-edge-kind]", "data-edge-kind"),
  };
}

/** Structural signature of the Agent cards section (statuses excluded):
 *  one `step|card` / `step|group:<items>` entry per card, then the decision
 *  route chips. */
function cardsOf(): string[] {
  const section = screen.getByTestId("flow-agent-cards-section");
  const cards = Array.from(section.querySelectorAll("[data-step]")).map((el) => {
    const group = el.getAttribute("data-testid") === "flow-group-card" ? `group:${el.querySelectorAll("[data-item]").length}` : "card";
    return `${el.getAttribute("data-step")}|${group}`;
  });
  const routes = Array.from(section.querySelectorAll('[data-testid="flow-decision-routes"]')).map((r) => `routes|${r.textContent}`);
  return [...cards, ...routes];
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  for (const k of [UI_PRIMITIVE_KEYS.markdownContent, UI_PRIMITIVE_KEYS.zoomControls] as const) {
    registerUiPrimitive(registry, k, (() => null) as never);
  }
  registerUiPrimitive(
    registry,
    UI_PRIMITIVE_KEYS.agentCard,
    (({ name, children }: { name: string; children?: React.ReactNode }) => <div data-testid="agent-card" data-name={name}>{children}</div>) as never,
  );
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, ((ms: number) => `${ms}ms`) as never);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, ((x: number) => `${x}`) as never);
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(FLOW_SHOW_ERROR_ROUTES_KEY, "true");
  for (const kind of ["dashboard", "summary", "cards"] as const) localStorage.setItem(flowCollapseKey(kind, SID), "false");
  initPluginConfigs({ flows: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status: 200, json: async () => ({ success: true, data: { reported: true, agents: {}, handlers: {} } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("render parity across idle / running / completed / flow_write card (E10)", () => {
  it("same node ids and edge pairs on all four surfaces, incl. implicit and on_error edges", () => {
    const graphs: Record<string, ReturnType<typeof graphOf>> = {};
    renderPanel(idleState(), true);
    graphs.idle = graphOf();
    cleanup();
    renderPanel(runningState());
    expect(screen.getByTestId("flow-dashboard").getAttribute("data-flow-mode")).toBe("live");
    graphs.running = graphOf();
    cleanup();
    renderPanel(completedState());
    expect(screen.getByTestId("flow-dashboard").getAttribute("data-flow-mode")).toBe("summary");
    graphs.completed = graphOf();
    cleanup();
    renderCard();
    graphs.card = graphOf();

    expect(graphs.idle.nodes).toEqual(["build", "fixup", "gate", "lint", "plan", "review", "ship"]);
    for (const surface of ["running", "completed", "card"]) {
      expect(graphs[surface].nodes, surface).toEqual(graphs.idle.nodes);
      expect(graphs[surface].edges, surface).toEqual(graphs.idle.edges);
    }
    expect(graphs.idle.kinds).toContain("implicit");
    expect(graphs.idle.kinds).toContain("on_error");
  });
});

describe("Agent cards: same structure before and after completion (E11)", () => {
  it("a fan-out group card with 3 items and the decision chips, running vs completed", () => {
    renderPanel(runningState());
    const running = cardsOf();
    cleanup();
    renderPanel(completedState());
    const completed = cardsOf();

    expect(completed).toEqual(running);
    expect(completed).toContain("review|group:3");
    const routes = completed.filter((c) => c.startsWith("routes|"));
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain("fix x3");
    expect(routes[0]).toContain("ship: not taken");
  });
});
