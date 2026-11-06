/**
 * Graph-first live flow panel: header + graph, every step card in an
 * "Agent cards" disclosure collapsed by default; a graph node click opens it,
 * selects the step and scrolls its card (or fan-out group) into view.
 * See change: update-flows-plugin (D7; test-plan E53–E55).
 */
import { initPluginConfigs, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { registerUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@blackbelt-technology/pi-dashboard-client-utils/useMobile", () => ({ useMobile: () => false }));

import { FlowDashboardClaim } from "../client/FlowDashboard.js";
import { __resetFlowAttachStoreForTests } from "../client/flow-attach-store.js";
import { flowCollapseKey } from "../client/flow-collapse-storage.js";
import { ev, registry, tree, useIsolatedLocalStorage } from "./flows-test-harness.js";

useIsolatedLocalStorage();

const scrollSpy = vi.fn();
let reducedMotion = false;

beforeAll(() => {
  Element.prototype.scrollIntoView = function (this: Element, opts?: ScrollIntoViewOptions | boolean) {
    scrollSpy(this, opts);
  };
  for (const k of [UI_PRIMITIVE_KEYS.markdownContent, UI_PRIMITIVE_KEYS.zoomControls] as const) {
    registerUiPrimitive(registry, k, (() => null) as never);
  }
  registerUiPrimitive(
    registry,
    UI_PRIMITIVE_KEYS.agentCard,
    (({ name, children, onClick, selected }: { name: string; children?: React.ReactNode; onClick?: () => void; selected?: boolean }) => (
      <div data-testid="agent-card" data-name={name} data-selected={selected ? "true" : "false"} onClick={onClick}>
        {children}
      </div>
    )) as never,
  );
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, ((ms: number) => `${ms}ms`) as never);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, ((x: number) => `${x}`) as never);
});
beforeEach(() => {
  localStorage.clear();
  __resetFlowAttachStoreForTests();
  initPluginConfigs({ flows: {} });
  scrollSpy.mockClear();
  reducedMotion = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") ? reducedMotion : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status: 200, json: async () => ({ success: true, data: { reported: true, agents: {}, handlers: {} } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
/** 5 steps: build done, review fan-out (3 items, 1 failed → failed), test running, doc skipped, ship pending. */
function seedRun(sid: string) {
  const steps = [
    { id: "build", stepType: "agent", agent: "builder", blockedBy: [] },
    { id: "triage", stepType: "agent-decision", agent: "triager", blockedBy: [], branches: { many: "review", docs: "doc" } },
    { id: "review", stepType: "agent", agent: "reviewer", blockedBy: [] },
    { id: "test", stepType: "agent", agent: "tester", blockedBy: [] },
    { id: "doc", stepType: "agent", agent: "writer", blockedBy: [] },
  ];
  let ts = 10;
  const e = (t: string, d: Record<string, unknown>) => ev(t, ++ts, d);
  publishSessionEvents(sid, [
    e("flow_started", { flowName: "pipe", task: "", steps }),
    e("flow_agent_started", { agentName: "builder", stepId: "build" }),
    e("flow_agent_complete", { agentName: "builder", stepId: "build", result: { success: true } }),
    e("flow_agent_started", { agentName: "triager", stepId: "triage" }),
    e("flow_agent_complete", { agentName: "triager", stepId: "triage", result: { success: true } }),
    e("flow_decision", { stepId: "triage", labels: ["many"], routes: [{ branch: "many", itemCount: 3 }] }),
    ...[0, 1, 2].map((i) => e("flow_agent_started", { agentName: "reviewer", stepId: "review", itemIndex: i, itemCount: 3 })),
    e("flow_agent_complete", { agentName: "reviewer", stepId: "review", itemIndex: 0, result: { success: true } }),
    e("flow_agent_complete", { agentName: "reviewer", stepId: "review", itemIndex: 1, result: { success: false, outcome: "soft" } }),
    e("flow_agent_complete", { agentName: "reviewer", stepId: "review", itemIndex: 2, result: { success: true } }),
    e("flow_agent_started", { agentName: "tester", stepId: "test" }),
  ]);
}
function mount(sid: string) {
  localStorage.setItem(flowCollapseKey("dashboard", sid), "false");
  return render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
}
const toggle = () => screen.getByTestId("flow-agent-cards-toggle");

describe("Agent cards header summary (E53)", () => {
  it("shows the step count and non-zero state pills while collapsed", () => {
    const sid = `cards-${++n}`;
    seedRun(sid);
    mount(sid);
    expect(screen.getByTestId("flow-agent-cards-count").textContent).toBe("5");
    const text = toggle().textContent ?? "";
    expect(text).toContain("2 done");
    expect(text).toContain("1 running");
    expect(text).toContain("1 failed");
    expect(text).toContain("1 skipped");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    const controls = toggle().getAttribute("aria-controls")!;
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls)).not.toBeNull();
    expect(screen.queryAllByTestId("agent-card")).toHaveLength(0);
  });

  it("toggling opens the grid: a fan-out group card, a skipped card, decision routes", () => {
    const sid = `cards-${++n}`;
    seedRun(sid);
    mount(sid);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("flow-group-card").querySelectorAll("[data-item]")).toHaveLength(3);
    expect(screen.getByTestId("flow-skipped-card").textContent).toContain("skipped");
    expect(screen.getByTestId("flow-decision-routes").textContent).toContain("many x3");
    expect(screen.getByTestId("flow-decision-routes").textContent).toContain("docs: not taken");
  });
});

const node = (id: string) => document.querySelector(`[data-node="${id}"]`) as Element;

describe("node click (E54)", () => {
  it("opens the section, selects and scrolls; second click clears and keeps it open", () => {
    const sid = `cards-${++n}`;
    seedRun(sid);
    mount(sid);
    act(() => void fireEvent.click(node("build")));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const card = document.querySelector('[data-step="build"]')!;
    expect(card.querySelector('[data-selected="true"]')).not.toBeNull();
    const call = scrollSpy.mock.calls.find(([el]) => el === card);
    expect(call?.[1]).toMatchObject({ block: "nearest" });
    act(() => void fireEvent.click(node("build")));
    expect(document.querySelector('[data-step="build"] [data-selected="true"]')).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("reduced motion: scrolls the fan-out group element without smooth behaviour", () => {
    reducedMotion = true;
    const sid = `cards-${++n}`;
    seedRun(sid);
    mount(sid);
    act(() => void fireEvent.click(node("review")));
    const group = screen.getByTestId("flow-group-card");
    expect(group.getAttribute("data-step")).toBe("review");
    const call = scrollSpy.mock.calls.find(([el]) => el === group);
    expect(call).toBeDefined();
    expect(call![1].behavior).not.toBe("smooth");
  });
});

describe("graph-first panel (E55)", () => {
  it("collapsed header after start; expanded shows graph + collapsed section; dismiss removes it", () => {
    const sid = `cards-${++n}`;
    publishSessionEvents(sid, [
      ev("flow_started", 1, { flowName: "f", task: "", steps: [{ id: "a", stepType: "agent", agent: "x", blockedBy: [] }] }),
    ]);
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    const root = screen.getByTestId("flow-dashboard");
    expect(root.querySelector(".group-collapse.collapsed")).not.toBeNull();
    cleanup();
    mount(sid);
    expect(document.querySelector('[data-node="a"]')).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByTestId("agent-card")).toHaveLength(0);
    act(() => {
      publishSessionEvents(sid, [
        ev("flow_complete", 2, { flowName: "f", status: "success" }),
        ev("flow_summary_dismissed", 3, {}),
      ]);
    });
    expect(screen.queryByTestId("flow-dashboard")).toBeNull();
  });
});
