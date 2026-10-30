/**
 * Session actions menu "Open flow…" action (flows `session-card-action-bar`
 * claim, `SessionFlowMenuClaim`): hidden with no flows, enabled when idle,
 * disabled while any flow runs; the picker lists every flow and selecting one
 * writes the per-session attachment with the resolved baseline. Also covers the
 * removed edit-mode reconcile (no message is ever sent on mount) and the
 * effective-state refetch on menu open.
 * See change: attach-flow-before-run (D7), add-session-actions-flyout (E26, F20),
 * stop-flows-edit-mode-project-writes (D1, D4; test-plan #F6).
 */
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer, initPluginConfigs, PluginContextProvider, publishSessionData, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { ActionListMenuContext } from "@blackbelt-technology/pi-dashboard-client-utils/ActionListMenuContext";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent, DashboardSession, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetFlowAttachStoreForTests, getAttachment } from "../client/flow-attach-store.js";
import { SessionFlowMenuClaim } from "../client/SessionFlowMenuClaim.js";

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

/** Flows available for `sid` (a `flows` command published), unless `commands` overrides. */
function openGate(sid: string, commands: Array<{ name: string }> = [{ name: "flows" }]) {
  publishSessionData(sid, "commandsList", commands);
}

function claimTree(sid: string, send?: (m: unknown) => void, menu?: { open: boolean }) {
  const claim = (
    <PluginContextProvider send={send}>
      <UiPrimitiveProvider value={registry}>
        <CurrentPluginLayer pluginId="flows">
          <SessionFlowMenuClaim session={{ id: sid } as DashboardSession} />
        </CurrentPluginLayer>
      </UiPrimitiveProvider>
    </PluginContextProvider>
  );
  return menu ? <ActionListMenuContext.Provider value={menu}>{claim}</ActionListMenuContext.Provider> : claim;
}
function renderClaim(sid: string, send?: (m: unknown) => void) {
  return render(claimTree(sid, send));
}

/** Effective edit mode served by `GET /api/plugins/flows/edit-mode-state`. */
let effective: boolean[] = [];
const fetchMock = vi.fn(async () => {
  const enabled = effective.length > 1 ? effective.shift() : effective[0];
  return new Response(JSON.stringify({ enabled: enabled ?? false }), { status: 200 });
});
const openBtn = () => screen.queryByRole("button", { name: /Open flow/ }) as HTMLButtonElement | null;

beforeEach(() => {
  localStorage.clear();
  __resetFlowAttachStoreForTests();
  initPluginConfigs({ flows: {} });
  effective = [false];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Open flow… visibility (E9)", () => {
  it("(a) hidden with no flows", () => {
    const sid = nextSid();
    openGate(sid);
    publishSessionData(sid, "flowsList", []);
    publishSessionEvents(sid, [started("A", 1)]);
    renderClaim(sid);
    expect(openBtn()).toBeNull();
  });

  it("(b) enabled with flows and nothing running", () => {
    const sid = nextSid();
    openGate(sid);
    publishSessionData(sid, "flowsList", TWO);
    renderClaim(sid);
    expect(openBtn()?.disabled).toBe(false);
  });

  it("(c) disabled while any flowStates entry runs, even if the latest is completed", () => {
    const sid = nextSid();
    openGate(sid);
    publishSessionData(sid, "flowsList", TWO);
    // B starts, then A starts and completes: latest flowState = completed A,
    // flowStates still holds running B.
    publishSessionEvents(sid, [started("B", 1), started("A", 2), ev("flow_complete", 3, { flowName: "A", status: "success" })]);
    renderClaim(sid);
    expect(openBtn()?.disabled).toBe(true);
    expect(openBtn()?.title).toBe("A flow is running");
  });
});

describe("Open flow… picker (E10)", () => {
  it("lists every flow with its description and attaches with the resolved baseline", () => {
    const sid = nextSid();
    openGate(sid);
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
    openGate(sid);
    publishSessionData(sid, "flowsList", TWO);
    renderClaim(sid);
    fireEvent.click(openBtn()!);
    fireEvent.click(screen.getByText(/test:capabilities/));
    expect(getAttachment(sid)?.baselineStartedAt).toBeNull();
  });
});

describe("flows menu claim gate + actions", () => {
  it("renders nothing before the first commandsList publish", () => {
    const sid = nextSid();
    publishSessionData(sid, "flowsList", TWO);
    const { container } = renderClaim(sid);
    expect(container.textContent).toBe("");
  });

  it("flows:new alone does not open the claim", () => {
    const sid = nextSid();
    openGate(sid, [{ name: "flows:new" }]);
    publishSessionData(sid, "flowsList", TWO);
    const { container } = renderClaim(sid);
    expect(container.textContent).toBe("");
  });

  it("active-but-empty cwd offers New / Edit… in edit mode (no flowsList, no events)", async () => {
    const sid = nextSid();
    openGate(sid);
    publishSessionData(sid, "flowsList", []);
    effective = [true];
    renderClaim(sid);
    expect(await screen.findByRole("button", { name: /New \/ Edit/ })).toBeTruthy();
    expect(openBtn()).toBeNull();
    expect(screen.queryByRole("button", { name: /Run Flow/ })).toBeNull();
  });

  it("Run Flow… / Delete… follow flowsList and flows:delete", () => {
    const sid = nextSid();
    openGate(sid, [{ name: "flows" }, { name: "flows:delete" }]);
    publishSessionData(sid, "flowsList", TWO);
    renderClaim(sid);
    expect(screen.getByRole("button", { name: /Run Flow/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeTruthy();
  });

  it("Delete… absent without the flows:delete command", () => {
    const sid = nextSid();
    openGate(sid);
    publishSessionData(sid, "flowsList", TWO);
    renderClaim(sid);
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });
});

describe("edit mode from the menu claim (reconcile removed; F6)", () => {
  const editMsgs = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.filter(([m]) => {
      const x = m as { action?: string };
      return x.action === "set-edit-mode" || x.action === "flow.set-edit-mode";
    });

  it("sends no edit-mode message when flows is available and nothing was opened", async () => {
    const sid = nextSid();
    openGate(sid);
    effective = [true];
    const send = vi.fn();
    const { rerender } = renderClaim(sid, send);
    await screen.findByRole("button", { name: /New \/ Edit/ });
    rerender(claimTree(sid, send));
    expect(editMsgs(send)).toHaveLength(0);
  });

  it("does not fetch before the first commandsList publish", () => {
    const sid = nextSid();
    renderClaim(sid, vi.fn());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fetches on menu open and shows an out-of-band change (#F6)", async () => {
    const sid = nextSid();
    openGate(sid);
    effective = [false, true];
    const { rerender } = render(claimTree(sid, vi.fn(), { open: false }));
    expect(await screen.findByRole("menuitem", { name: "Turn on edit mode for this project" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender(claimTree(sid, vi.fn(), { open: true }));
    expect(await screen.findByRole("menuitem", { name: "Turn off edit mode for this project" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toBe(`/api/plugins/flows/edit-mode-state?sessionId=${sid}`);
  });
});
