/**
 * FLOWS subcard "Open flow…" action: hidden with no flows, enabled when idle,
 * disabled while any flow runs; the picker lists every flow and selecting one
 * writes the per-session attachment with the resolved baseline.
 * See change: attach-flow-before-run (D7).
 */
import {
  createUiPrimitiveRegistry,
  CurrentPluginLayer,
  PluginContextProvider,
  publishSessionData,
  publishSessionEvents,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent, DashboardSession, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionFlowActionsClaim } from "../client/SessionFlowActions.js";
import { __resetFlowAttachStoreForTests, getAttachment } from "../client/flow-attach-store.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.confirmDialog, (() => null) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, (({ children }: { children?: React.ReactNode }) => <div>{children}</div>) as never);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.searchableSelectDialog,
  (({ title, options, onSelect }: { title: string; options: Array<{ value: string; label: string; description?: string }>; onSelect: (v: string) => void }) => (
    <div data-testid="picker" data-title={title}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onSelect(o.value)}>
          {o.label}|{o.description}
        </button>
      ))}
    </div>
  )) as never,
);

let n = 0;
const nextSid = () => `open-S-${++n}`;
let seq = 0;
function ev(eventType: string, timestamp: number, data: Record<string, unknown>): DashboardEvent {
  return { seq: ++seq, timestamp, eventType, data } as unknown as DashboardEvent;
}
const started = (flowName: string, ts: number) =>
  ev("flow_started", ts, { flowName, task: "", steps: [{ id: "s", stepType: "agent", agent: "a", blockedBy: [] }] });

const TWO: FlowInfo[] = [
  { name: "test:capabilities", description: "project flow", taskRequired: false, source: "/proj/.pi/flows/flows/test/capabilities/flow.yaml" },
  { name: "pkg:review", description: "package flow", taskRequired: false, source: "/home/.pi/agent/npm/node_modules/pkg/flows/review/flow.yaml" },
];

function renderClaim(sid: string) {
  return render(
    <PluginContextProvider>
      <UiPrimitiveProvider value={registry}>
        <CurrentPluginLayer pluginId="flows">
          <SessionFlowActionsClaim session={{ id: sid } as DashboardSession} />
        </CurrentPluginLayer>
      </UiPrimitiveProvider>
    </PluginContextProvider>,
  );
}
const openBtn = () => screen.queryByTestId("flows-open-button") as HTMLButtonElement | null;

beforeEach(() => {
  localStorage.clear();
  __resetFlowAttachStoreForTests();
});
afterEach(() => cleanup());

describe("Open flow… visibility (E9)", () => {
  it("(a) hidden with no flows", () => {
    const sid = nextSid();
    publishSessionEvents(sid, [started("A", 1)]);
    renderClaim(sid);
    expect(openBtn()).toBeNull();
  });

  it("(b) enabled with flows and nothing running", () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", TWO);
    renderClaim(sid);
    expect(openBtn()?.disabled).toBe(false);
  });

  it("(c) disabled while any flowStates entry runs, even if the latest is completed", () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", TWO);
    // B starts, then A starts and completes: latest flowState = completed A,
    // flowStates still holds running B.
    publishSessionEvents(sid, [started("B", 1), started("A", 2), ev("flow_complete", 3, { flowName: "A", status: "success" })]);
    renderClaim(sid);
    expect(openBtn()?.disabled).toBe(true);
    expect(openBtn()?.title).toMatch(/running/i);
  });
});

describe("Open flow… picker (E10)", () => {
  it("lists every flow with its description and attaches with the resolved baseline", () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", TWO);
    publishSessionEvents(sid, [started("X", 700), ev("flow_complete", 800, { flowName: "X", status: "success" })]);
    renderClaim(sid);
    fireEvent.click(openBtn()!);
    const picker = screen.getByTestId("picker");
    expect(picker.textContent).toContain("test:capabilities|project flow");
    expect(picker.textContent).toContain("pkg:review|package flow");
    fireEvent.click(screen.getByText(/pkg:review/));
    const a = getAttachment(sid);
    expect(a).toMatchObject({ name: "pkg:review", source: TWO[1].source, baselineStartedAt: 700 });
    expect(typeof a?.id).toBe("string");
  });

  it("empty stream → null baseline", () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", TWO);
    renderClaim(sid);
    fireEvent.click(openBtn()!);
    fireEvent.click(screen.getByText(/test:capabilities/));
    expect(getAttachment(sid)?.baselineStartedAt).toBeNull();
  });
});
