/**
 * FlowDashboardClaim with an attached (not-started) flow.
 *
 * Render harness: primitive registry (FlowSummary.test.tsx), session events via
 * publishSessionEvent(s) (FlowsSessionStateContext.test.tsx), flowsList via
 * publishSessionData, mocked fetch (flow-agent-card-code-source.test.tsx).
 * Instance continuity is asserted via DOM identity of the `flow-dashboard` root:
 * React reuses the root DOM node only when the FlowDashboard instance is kept,
 * so `===` on it is the mount counter.
 * See change: attach-flow-before-run.
 */
import {
  createUiPrimitiveRegistry,
  type InteractiveUiRequestSnapshot,
  PluginContextProvider,
  publishSessionData,
  publishSessionEvent,
  publishSessionEvents,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent, DashboardSession, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@blackbelt-technology/pi-dashboard-client-utils/useMobile", () => ({
  useMobile: () => mobile.value,
}));

import { FlowDashboardClaim } from "../client/FlowDashboard.js";
import {
  __resetFlowAttachStoreForTests,
  flowAttachKey,
  getAttachment,
  setAttachment,
} from "../client/flow-attach-store.js";
import type { FlowAttachment } from "../client/flow-idle-state.js";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

// ── Primitive registry ─────────────────────────────────────────────
const registry = createUiPrimitiveRegistry();
const Dialog = (({ open, title, children, testId }: { open: boolean; title?: string; children?: React.ReactNode; testId?: string }) =>
  open ? <div data-testid={testId ?? "dialog"}>{title}{children}</div> : null) as unknown as {
  Footer: React.FC<{ children?: React.ReactNode }>;
  Cancel: React.FC<{ onClick: () => void }>;
};
Dialog.Footer = ({ children }) => <div>{children}</div>;
Dialog.Cancel = ({ onClick }) => <button type="button" onClick={onClick}>Cancel</button>;
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, Dialog as never);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.agentCard,
  (({ children, selected, onClick }: { children?: React.ReactNode; selected?: boolean; onClick?: () => void }) => (
    <div data-testid="agent-card" data-selected={selected ? "true" : "false"} onClick={onClick}>{children}</div>
  )) as never,
);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.markdownContent, (({ content }: { content: string }) => <pre>{content}</pre>) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, ((ms: number) => `${ms}ms`) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, ((n: number) => `${n}`) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.zoomControls, (() => null) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.popover, (({ children }: { children?: React.ReactNode }) => <>{children}</>) as never);

// ── Fixtures ───────────────────────────────────────────────────────
const yamlFor = (name: string) => `
name: ${name}
description: two agents
steps:
  - id: alpha
    type: agent
    agent: e2e-alpha
  - id: beta
    type: agent
    agent: e2e-beta
    blockedBy: [alpha]
`;

let seq = 0;
let sidCounter = 0;
const nextSid = () => `attach-S-${++sidCounter}`;

function ev(eventType: string, timestamp: number, data: Record<string, unknown>): DashboardEvent {
  return { seq: ++seq, timestamp, eventType, data } as unknown as DashboardEvent;
}
const started = (flowName: string, ts: number, extra: Record<string, unknown> = {}) =>
  ev("flow_started", ts, {
    flowName,
    task: "",
    autonomousMode: true,
    source: `/p/${flowName}/flow.yaml`,
    steps: [
      { id: "alpha", stepType: "agent", agent: "e2e-alpha", blockedBy: [] },
      { id: "beta", stepType: "agent", agent: "e2e-beta", blockedBy: ["alpha"] },
    ],
    ...extra,
  });
const completed = (flowName: string, ts: number, status = "success") =>
  ev("flow_complete", ts, { flowName, status });

function flows(...names: string[]): FlowInfo[] {
  return names.map((name) => ({ name, description: `${name} desc`, taskRequired: false, source: `/p/${name}/flow.yaml` }));
}

function okFetch() {
  return vi.fn(async (url: string) => {
    const path = decodeURIComponent(String(url).split("path=")[1] ?? "");
    const name = path.split("/")[2] ?? "x";
    return { status: 200, json: async () => ({ success: true, data: { content: yamlFor(name) } }) };
  });
}

function attach(sid: string, name: string, over: Partial<FlowAttachment> = {}): FlowAttachment {
  const a: FlowAttachment = { id: `att-${name}-${++seq}`, name, source: `/p/${name}/flow.yaml`, baselineStartedAt: 0, ...over };
  act(() => setAttachment(sid, a));
  return a;
}

function renderClaim(sid: string, opts: { requests?: readonly InteractiveUiRequestSnapshot[] } = {}) {
  const send = vi.fn();
  const requests = opts.requests;
  const session = { id: sid } as DashboardSession;
  const utils = render(
    <PluginContextProvider send={send} useSessionInteractiveRequests={requests ? () => requests : undefined}>
      <UiPrimitiveProvider value={registry}>
        <FlowDashboardClaim session={session} />
      </UiPrimitiveProvider>
    </PluginContextProvider>,
  );
  return { ...utils, send };
}

const root = () => screen.queryByTestId("flow-dashboard");
const cards = () => screen.getAllByTestId("agent-card");
const selectBeta = () => fireEvent.click(cards()[1]);
const betaSelected = () => cards()[1].getAttribute("data-selected") === "true";
const openGraph = () => fireEvent.click(screen.getByTitle("Expand graph"));
const graphDialogOpen = () => screen.queryByText(/^Flow graph ·/) !== null;

beforeEach(() => {
  localStorage.clear();
  __resetFlowAttachStoreForTests();
  mobile.value = false;
  vi.stubGlobal("fetch", okFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ── 5.1 harness smoke ──────────────────────────────────────────────
describe("claim harness", () => {
  it("renders an existing live flow panel", () => {
    const sid = nextSid();
    publishSessionEvent(sid, started("L", 10));
    renderClaim(sid);
    expect(root()?.getAttribute("data-flow-mode")).toBe("live");
    expect(cards()).toHaveLength(2);
  });
});

// ── 5.2 E8 attach while history loading ────────────────────────────
describe("attach while history is still loading (E8)", () => {
  it("resolves the baseline from the first batch, then a newer start consumes", async () => {
    const sid = nextSid();
    const a = attach(sid, "A", { baselineStartedAt: null });
    renderClaim(sid);
    act(() => publishSessionEvents(sid, [started("B", 500), completed("B", 510)]));
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("idle"));
    expect(getAttachment(sid)?.baselineStartedAt).toBe(500);
    expect(getAttachment(sid)?.id).toBe(a.id);
    act(() => publishSessionEvent(sid, started("C", 600)));
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("live"));
    expect(getAttachment(sid)).toBeNull();
  });
});

// ── 5.3 F1 same flow starts: in place ──────────────────────────────
describe("starting the attached flow updates the panel in place (F1)", () => {
  it("keeps the instance, selection and dialog; shows Abort", async () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", flows("e2e:synthetic"));
    attach(sid, "e2e:synthetic");
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    const before = root();
    selectBeta();
    openGraph();
    expect(betaSelected()).toBe(true);
    expect(graphDialogOpen()).toBe(true);
    expect(screen.getAllByText(/not started/).length).toBeGreaterThan(0);

    act(() => publishSessionEvent(sid, started("e2e:synthetic", 100)));
    expect(root()).toBe(before);
    expect(root()?.getAttribute("data-flow-mode")).toBe("live");
    expect(betaSelected()).toBe(true);
    expect(graphDialogOpen()).toBe(true);
    expect(screen.getByTitle("Abort flow")).toBeTruthy();
    expect(screen.queryByText(/not started/)).toBeNull();
  });
});

// ── 5.4 F2 other flow starts: replaced ─────────────────────────────
describe("a different flow starting replaces the attached flow (F2)", () => {
  it("remounts, clears selection and removes the attachment", async () => {
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    const before = root();
    selectBeta();
    act(() => publishSessionEvent(sid, started("B", 100)));
    expect(root()).not.toBe(before);
    expect(betaSelected()).toBe(false);
    expect(localStorage.getItem(flowAttachKey(sid))).toBeNull();
    expect(root()?.textContent).toContain("B");
  });
});

// ── 5.5 F3 selection across run progress ───────────────────────────
describe("live panel keeps the selected node across run progress (F3)", () => {
  it("survives tool calls, clears on tab switch", () => {
    const sid = nextSid();
    publishSessionEvents(sid, [started("OTHER", 5), completed("OTHER", 6), started("RUN", 10)]);
    renderClaim(sid);
    selectBeta();
    for (let i = 0; i < 3; i++) {
      act(() => publishSessionEvent(sid, ev("flow_tool_call", 20 + i, { agentName: "e2e-alpha", stepId: "alpha", toolName: "read", input: {} })));
      expect(betaSelected()).toBe(true);
    }
    // Tab bar: switch to the other flow.
    fireEvent.click(screen.getByRole("button", { name: "OTHER" }));
    // Back on the selected tab, the selection is gone.
    fireEvent.click(screen.getByRole("button", { name: "RUN" }));
    expect(betaSelected()).toBe(false);
  });
});

// ── 5.6 F4 re-attach starts fresh ──────────────────────────────────
describe("re-attaching starts fresh (F4)", () => {
  it("summary selection/dialog do not carry into the idle panel", async () => {
    const sid = nextSid();
    publishSessionEvents(sid, [started("A", 10), completed("A", 20)]);
    renderClaim(sid);
    expect(screen.getByTestId("flow-summary-scrollbox")).toBeTruthy();
    selectBeta();
    openGraph();
    expect(graphDialogOpen()).toBe(true);
    attach(sid, "A", { baselineStartedAt: 10 });
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("idle"));
    expect(betaSelected()).toBe(false);
    expect(graphDialogOpen()).toBe(false);
  });
});

// ── 5.7 F5 header controls ─────────────────────────────────────────
describe("not-started header controls (F5)", () => {
  it("Run/Close/AUTO, no Abort, no summary, no tabs", async () => {
    const sid = nextSid();
    publishSessionEvents(sid, [started("B", 10), completed("B", 20)]);
    attach(sid, "A", { baselineStartedAt: 10 });
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    expect(screen.getByTestId("flow-idle-run")).toBeTruthy();
    expect(screen.getByTestId("flow-idle-close")).toBeTruthy();
    expect(screen.getByText("AUTO")).toBeTruthy();
    expect(screen.queryByTitle("Abort flow")).toBeNull();
    expect(screen.getAllByText(/not started/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("flow-summary-scrollbox")).toBeNull();
    expect(screen.queryByText("FOLLOW")).toBeNull();
    expect(screen.queryByText("B")).toBeNull();
  });
});

// ── 5.8 F6 mobile ──────────────────────────────────────────────────
describe("not-started mobile collapsed bar (F6)", () => {
  it("reads not started; Run + Close after expanding", async () => {
    mobile.value = true;
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    const bar = await screen.findByText(/A · not started/);
    expect(screen.queryByTestId("flow-idle-run")).toBeNull();
    fireEvent.click(bar);
    expect(screen.getByTestId("flow-idle-run")).toBeTruthy();
    expect(screen.getByTestId("flow-idle-close")).toBeTruthy();
  });
});

// ── 5.9 F7 AUTO ────────────────────────────────────────────────────
describe("autonomous toggle before the run (F7)", () => {
  const autoOn = () => screen.getByText("AUTO").className.includes("green");

  it("last known off → toggle sends flow_control and follows the event", async () => {
    const sid = nextSid();
    publishSessionEvent(sid, ev("flow_autonomous_changed", 5, { enabled: false }));
    attach(sid, "A");
    const { send } = renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    expect(autoOn()).toBe(false);
    fireEvent.click(screen.getByText("AUTO"));
    expect(send).toHaveBeenCalledWith({ type: "flow_control", sessionId: sid, action: "toggle_autonomous" });
    act(() => publishSessionEvent(sid, ev("flow_autonomous_changed", 6, { enabled: true })));
    expect(autoOn()).toBe(true);
  });

  it("never observed → engine default on", async () => {
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    expect(autoOn()).toBe(true);
  });
});

// ── 5.10 F8 questions ──────────────────────────────────────────────
describe("idle panel questions (F8)", () => {
  it("hides earlier-run answered/cancelled, keeps a pending one answerable", async () => {
    const sid = nextSid();
    const q = (requestId: string, status: InteractiveUiRequestSnapshot["status"]): InteractiveUiRequestSnapshot => ({
      requestId,
      method: "custom",
      status,
      result: status === "resolved" ? "yes" : undefined,
      params: { _promptBusComponent: { type: "flow-question", props: { flowId: "A", stepId: "alpha", question: `q-${requestId}`, type: "confirm" } } },
    });
    attach(sid, "A");
    const { send } = renderClaim(sid, { requests: [q("r1", "resolved"), q("r2", "cancelled"), q("r3", "pending")] });
    await screen.findByTestId("flow-dashboard");
    expect(screen.queryAllByTestId("flow-question-transcript-pill")).toHaveLength(0);
    expect(screen.getAllByTestId("flow-question-card")).toHaveLength(1);
    fireEvent.click(screen.getByText("Yes"));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "prompt_response", promptId: "r3", answer: "yes" }));
  });
});

// ── 5.11 F9 run / rejected / dialog closes ─────────────────────────
describe("run from the not-started panel (F9)", () => {
  async function submitRun(sid: string) {
    const utils = renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    fireEvent.click(screen.getByTestId("flow-idle-run"));
    const input = screen.getByPlaceholderText(/Describe the task/);
    fireEvent.change(input, { target: { value: "t" } });
    fireEvent.click(screen.getByTestId("flow-launch-run"));
    return utils;
  }

  it("(a) rejected → Run re-enabled with reason, still idle", async () => {
    const sid = nextSid();
    attach(sid, "A");
    const { send } = await submitRun(sid);
    const runs = send.mock.calls.filter(([m]) => (m as { type: string }).type === "flow_management");
    expect(runs).toEqual([[{ type: "flow_management", sessionId: sid, action: "run", flowName: "A", task: "t" }]]);
    expect((screen.getByTestId("flow-idle-run") as HTMLButtonElement).disabled).toBe(true);
    act(() => publishSessionEvent(sid, ev("flow_complete", 50, { status: "rejected", flowName: "A", reason: "A flow is already running" })));
    expect((screen.getByTestId("flow-idle-run") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("flow-run-rejected").textContent).toContain("A flow is already running");
    expect(root()?.getAttribute("data-flow-mode")).toBe("idle");
  });

  it("(b) another flow starts → dialog gone, live B", async () => {
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    fireEvent.click(screen.getByTestId("flow-idle-run"));
    expect(screen.getByTestId("flow-launch-dialog")).toBeTruthy();
    act(() => publishSessionEvent(sid, started("B", 60)));
    expect(screen.queryByTestId("flow-launch-dialog")).toBeNull();
    expect(root()?.getAttribute("data-flow-mode")).toBe("live");
    expect(root()?.textContent).toContain("B");
  });
});

// ── 5.12 F10 cross-tab ─────────────────────────────────────────────
describe("tabs of the same browser stay in sync (F10)", () => {
  it("storage events attach and detach", async () => {
    const sid = nextSid();
    renderClaim(sid);
    expect(root()).toBeNull();
    const a: FlowAttachment = { id: "x1", name: "A", source: "/p/A/flow.yaml", baselineStartedAt: 0 };
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: flowAttachKey(sid), newValue: JSON.stringify(a) }));
    });
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("idle"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: flowAttachKey(sid), newValue: null }));
    });
    expect(root()).toBeNull();
  });
});

// ── 5.13 F11 detach ────────────────────────────────────────────────
describe("detach (F11)", () => {
  it("(a) restores an undismissed summary", async () => {
    const sid = nextSid();
    publishSessionEvents(sid, [started("B", 10), completed("B", 20)]);
    attach(sid, "A", { baselineStartedAt: 10 });
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    fireEvent.click(screen.getByTestId("flow-idle-close"));
    expect(screen.getByTestId("flow-summary-scrollbox")).toBeTruthy();
    expect(localStorage.getItem(flowAttachKey(sid))).toBeNull();
  });

  it("(b) renders nothing when nothing else exists", async () => {
    const sid = nextSid();
    attach(sid, "A");
    const { container } = renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    fireEvent.click(screen.getByTestId("flow-idle-close"));
    expect(container.innerHTML).toBe("");
    expect(localStorage.getItem(flowAttachKey(sid))).toBeNull();
  });
});

// ── 5.14 F12 reload ────────────────────────────────────────────────
describe("attachment survives reload (F12)", () => {
  it("pre-seeded storage renders the idle panel", async () => {
    const sid = nextSid();
    localStorage.setItem(flowAttachKey(sid), JSON.stringify({ id: "r1", name: "A", source: "/p/A/flow.yaml", baselineStartedAt: 0 }));
    __resetFlowAttachStoreForTests();
    renderClaim(sid);
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("idle"));
  });
});

// ── 5.15 F13 replay reveals running ────────────────────────────────
describe("replay reveals a flow that is still running (F13)", () => {
  it("live B, attachment removed", async () => {
    const sid = nextSid();
    attach(sid, "A", { baselineStartedAt: null });
    renderClaim(sid);
    act(() => publishSessionEvents(sid, [started("B", 300)]));
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("live"));
    expect(root()?.textContent).toContain("B");
    expect(getAttachment(sid)).toBeNull();
  });
});

// ── 5.16 F14 finished while closed ─────────────────────────────────
describe("other flow finished while the page was closed (F14)", () => {
  it("B summary, key removed", async () => {
    const sid = nextSid();
    localStorage.setItem(flowAttachKey(sid), JSON.stringify({ id: "c1", name: "A", source: "/p/A/flow.yaml", baselineStartedAt: 1000 }));
    __resetFlowAttachStoreForTests();
    publishSessionEvents(sid, [started("B", 2000), completed("B", 2100)]);
    renderClaim(sid);
    expect(screen.getByTestId("flow-summary-scrollbox")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem(flowAttachKey(sid))).toBeNull());
  });
});

// ── 5.17–5.20 X1–X4 load failures ──────────────────────────────────
describe("definition cannot be loaded (X1–X4)", () => {
  const expectErrorHeader = (text: RegExp) => {
    const msg = screen.getByTestId("flow-slot-message");
    expect(msg.getAttribute("data-tone")).toBe("error");
    expect(msg.textContent).toMatch(/A/);
    expect(msg.textContent).toMatch(text);
    expect(screen.getByTestId("flow-idle-close")).toBeTruthy();
    expect(screen.queryAllByTestId("agent-card")).toHaveLength(0);
    expect(root()).toBeNull();
  };

  it("X1: 403 refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 403, json: async () => ({ success: false, error: "path not in allowed resource location" }) })));
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByText(/path not in allowed resource location/);
    expectErrorHeader(/path not in allowed/);
  });

  it("X1: 404 without JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404, json: async () => { throw new Error("no json"); } })));
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByText(/HTTP 404/);
    expectErrorHeader(/404/);
  });

  it("X2: loading then idle", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolve = r; })));
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    const msg = screen.getByTestId("flow-slot-message");
    expect(msg.textContent).toMatch(/A/);
    expect(msg.textContent).toMatch(/loading…/);
    expect(screen.getByTestId("flow-idle-close")).toBeTruthy();
    await act(async () => {
      resolve({ status: 200, json: async () => ({ success: true, data: { content: yamlFor("A") } }) });
    });
    await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("idle"));
  });

  it("X3: network TypeError", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const sid = nextSid();
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByText(/Failed to fetch/);
    expectErrorHeader(/Failed to fetch/);
  });

  it("X4: no source → error, fetch not called", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const source of ["", undefined]) {
      const sid = nextSid();
      attach(sid, "A", { source });
      renderClaim(sid);
      expectErrorHeader(/unavailable/);
      cleanup();
    }
    expect(f).not.toHaveBeenCalled();
  });
});

// ── 5.21 X5 storage throws ─────────────────────────────────────────
describe("storage unavailable (X5)", () => {
  it("attach/render/Close work in memory", async () => {
    const boom = () => { throw new Error("denied"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    try {
      const sid = nextSid();
      attach(sid, "A");
      renderClaim(sid);
      await waitFor(() => expect(root()?.getAttribute("data-flow-mode")).toBe("idle"));
      fireEvent.click(screen.getByTestId("flow-idle-close"));
      expect(root()).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// ── 5.22 X6 no longer available ────────────────────────────────────
describe("attached flow no longer available (X6)", () => {
  it("error header + Close", async () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", flows("A"));
    attach(sid, "A");
    renderClaim(sid);
    await screen.findByTestId("flow-dashboard");
    act(() => publishSessionData(sid, "flowsList", flows("B")));
    expect(screen.getByTestId("flow-slot-message").textContent).toMatch(/no longer available/);
    expect(screen.getByTestId("flow-idle-close")).toBeTruthy();
  });
});

// ── 5.23 X7 unmount safety ─────────────────────────────────────────
describe("loader unmount safety (X7)", () => {
  it("no state update or attachment change after unmount", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolve = r; })));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const sid = nextSid();
    const a = attach(sid, "A");
    const { unmount } = renderClaim(sid);
    unmount();
    await act(async () => {
      resolve({ status: 200, json: async () => ({ success: true, data: { content: yamlFor("A") } }) });
    });
    expect(errors).not.toHaveBeenCalled();
    expect(getAttachment(sid)).toEqual(a);
  });
});
