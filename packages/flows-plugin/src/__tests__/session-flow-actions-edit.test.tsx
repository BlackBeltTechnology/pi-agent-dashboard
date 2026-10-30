/**
 * SessionFlowMenuClaim edit-mode gating + New/Edit launcher + per-project item.
 * New/Edit shows only when the session's EFFECTIVE edit mode (GET
 * edit-mode-state) is on. Selecting a flow (or "+ New flow") opens an
 * intent-capture dialog; submitting it sends `/skill:manage-flows ...`. The claim
 * never sends an edit-mode message unless the per-project item is clicked.
 * See change: rework-flows-plugin-for-new-pi-flows, add-session-actions-flyout,
 * stop-flows-edit-mode-project-writes (test-plan #E15, #F1, #F2, #X3, #X5).
 */

import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer, initPluginConfigs, PluginContextProvider, publishSessionData, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardEvent, DashboardSession, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionFlowMenuClaim } from "../client/SessionFlowMenuClaim.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.confirmDialog, (() => null) as never);
// Stub Dialog primitive used by FlowAuthorPromptDialog: render children + Footer/Cancel.
const Dialog = (({ children }: { children: React.ReactNode }) => <div>{children}</div>) as never;
(Dialog as unknown as { Footer: React.FC<{ children: React.ReactNode }>; Cancel: React.FC<{ onClick: () => void }> }).Footer =
  ({ children }) => <div>{children}</div>;
(Dialog as unknown as { Footer: React.FC; Cancel: React.FC<{ onClick: () => void }> }).Cancel =
  ({ onClick }) => <button onClick={onClick}>Cancel</button>;
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, Dialog);
// Stub SearchableSelectDialog: render each option as a button that selects it.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.searchableSelectDialog,
  (({ options, onSelect }: { options: Array<{ value: string; label: string }>; onSelect: (v: string) => void }) => (
    <div data-testid="picker">
      {options.map((o) => (
        <button key={o.value} onClick={() => onSelect(o.value)}>{o.label}</button>
      ))}
    </div>
  )) as never,
);

const flows: FlowInfo[] = [{ name: "invoice-research" } as FlowInfo];

/** What `GET /api/plugins/flows/edit-mode-state` answers. */
type Served = boolean | "reject" | 500 | 404;
let served: Served = false;
const fetchMock = vi.fn(async () => {
  if (served === "reject") throw new TypeError("network");
  if (typeof served === "number") return new Response("{}", { status: served });
  return new Response(JSON.stringify({ enabled: served }), { status: 200 });
});
beforeEach(() => {
  served = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
function tree(sid: string, send: (m: unknown) => void) {
  return (
    <PluginContextProvider send={send}>
      <UiPrimitiveProvider value={registry}>
        <CurrentPluginLayer pluginId="flows">
          <SessionFlowMenuClaim session={{ id: sid } as DashboardSession} />
        </CurrentPluginLayer>
      </UiPrimitiveProvider>
    </PluginContextProvider>
  );
}
function renderActions({ editMode, send = () => {}, available = true }: { editMode: Served; send?: (m: unknown) => void; available?: boolean }) {
  const sid = `edit-S-${++n}`;
  if (available) publishSessionData(sid, "commandsList", [{ name: "flows" }]);
  publishSessionData(sid, "flowsList", flows);
  served = editMode;
  return { sid, ...render(tree(sid, send)) };
}
/** Let the mount GET settle. */
const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
const editButton = () => screen.queryByRole("button", { name: /New \/ Edit/ });
const projectItem = () => screen.queryByRole("button", { name: /edit mode for this project/ });
const promptsSent = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([m]) => m as { type: string; text?: string }).filter((m) => m.type === "send_prompt");
const editModeSends = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter(([m]) => {
    const x = m as { type?: string; action?: string };
    return x.type === "flow_management" || x.action === "flow.set-edit-mode" || x.action === "set-edit-mode";
  });

describe("SessionFlowMenuClaim edit mode", () => {
  it("hides New / Edit when edit mode is off", async () => {
    renderActions({ editMode: false });
    await settle();
    expect(editButton()).toBeNull();
  });

  it("shows New / Edit when edit mode is on", async () => {
    renderActions({ editMode: true });
    expect(await screen.findByRole("button", { name: /New \/ Edit/ })).toBeTruthy();
  });

  it("editing a flow prompts for an instruction, then sends /skill:manage-flows <name>", async () => {
    const send = vi.fn();
    const { sid, getByTestId, getByText } = renderActions({ editMode: true, send });
    fireEvent.click(await screen.findByRole("button", { name: /New \/ Edit/ }));
    fireEvent.click(getByText("invoice-research"));
    // Intent dialog appears; edit instruction is optional → submit empty.
    const submit = getByTestId("flow-author-submit");
    expect(submit).toBeTruthy();
    fireEvent.click(submit);
    expect(promptsSent(send)).toEqual([{ type: "send_prompt", sessionId: sid, text: "/skill:manage-flows invoice-research" }]);
  });

  it("new flow requires a description before /skill:manage-flows <text> is sent", async () => {
    const send = vi.fn();
    const { sid, getByTestId, getByText, getByPlaceholderText } = renderActions({ editMode: true, send });
    fireEvent.click(await screen.findByRole("button", { name: /New \/ Edit/ }));
    fireEvent.click(getByText("+ New flow"));
    const submit = getByTestId("flow-author-submit") as HTMLButtonElement;
    // Required: disabled until text entered.
    expect(submit.disabled).toBe(true);
    fireEvent.change(getByPlaceholderText(/Research an invoice/), {
      target: { value: "Summarize PRs" },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(promptsSent(send)).toEqual([{ type: "send_prompt", sessionId: sid, text: "/skill:manage-flows Summarize PRs" }]);
  });
});

describe("effective edit mode × availability (#E15)", () => {
  it.each([
    [true, true, true, "Turn off edit mode for this project"],
    [true, false, false, "Turn on edit mode for this project"],
    [false, true, false, null],
    [false, false, false, null],
  ] as const)("available=%s effective=%s → New/Edit=%s, item=%s", async (available, effective, newEdit, label) => {
    renderActions({ editMode: effective, available });
    await settle();
    expect(!!editButton()).toBe(newEdit);
    if (label) {
      const item = screen.getByRole("button", { name: label });
      expect(item.getAttribute("title")).toContain(".pi/settings.json");
    } else {
      expect(projectItem()).toBeNull();
    }
    if (!available) expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown (GET pending) → neither New/Edit nor the per-project item", () => {
    renderActions({ editMode: true });
    expect(editButton()).toBeNull();
    expect(projectItem()).toBeNull();
  });

  it("clicking the item requests the value its label names", async () => {
    const send = vi.fn();
    const { sid } = renderActions({ editMode: false, send });
    fireEvent.click(await screen.findByRole("button", { name: "Turn on edit mode for this project" }));
    expect(editModeSends(send)).toEqual([
      [{ type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.set-edit-mode", payload: { enabled: true } }],
    ]);
  });
});

describe("state unavailable (#X5)", () => {
  it.each(["reject", 500, 404] as const)("GET %s → no edit-mode UI, no throw", async (failure) => {
    renderActions({ editMode: failure });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(editButton()).toBeNull();
    expect(projectItem()).toBeNull();
  });
});

describe("no implicit edit-mode sends (#F1, #F2)", () => {
  it.each([{ editFlow: true }, { editFlow: false }, {}])("legacy config %j: mount + 5 re-renders send nothing", async (config) => {
    initPluginConfigs({ flows: config });
    const send = vi.fn();
    const { sid, rerender } = renderActions({ editMode: true, send });
    await settle();
    for (let i = 0; i < 5; i++) {
      publishSessionData(sid, "commandsList", [{ name: "flows" }, { name: `flows:x${i}` }]);
      rerender(tree(sid, send));
    }
    await settle();
    expect(editModeSends(send)).toHaveLength(0);
  });

  it("two provider trees for one session (tabs), remount one: nothing sent", async () => {
    const [a, b] = [vi.fn(), vi.fn()];
    const sid = `edit-S-${++n}`;
    publishSessionData(sid, "commandsList", [{ name: "flows" }]);
    served = true;
    const t1 = render(tree(sid, a));
    const t2 = render(tree(sid, b));
    await settle();
    t2.unmount();
    render(tree(sid, b));
    await settle();
    t1.unmount();
    expect(editModeSends(a)).toHaveLength(0);
    expect(editModeSends(b)).toHaveLength(0);
  });
});

describe("pushed state + errors (#X3 client)", () => {
  it("a not-delivered frame shows an error dialog and keeps the label", async () => {
    const listeners = new Set<(e: MessageEvent) => void>();
    const ws = {
      addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.add(l),
      removeEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.delete(l),
    } as unknown as WebSocket;
    const sid = `edit-S-${++n}`;
    publishSessionData(sid, "commandsList", [{ name: "flows" }]);
    served = false;
    render(
      <PluginContextProvider send={() => {}} ws={ws}>
        <UiPrimitiveProvider value={registry}>
          <CurrentPluginLayer pluginId="flows">
            <SessionFlowMenuClaim session={{ id: sid } as DashboardSession} />
          </CurrentPluginLayer>
        </UiPrimitiveProvider>
      </PluginContextProvider>,
    );
    await screen.findByRole("button", { name: "Turn on edit mode for this project" });
    const push = (frame: unknown) =>
      act(() => {
        for (const l of listeners) l({ data: JSON.stringify(frame) } as MessageEvent);
      });
    push({ type: "flows_edit_mode_state", sessionId: sid, enabled: false, error: "not-delivered" });
    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Turn on edit mode for this project" })).toBeTruthy();
    push({ type: "flows_edit_mode_state", sessionId: sid, enabled: true });
    expect(await screen.findByRole("button", { name: "Turn off edit mode for this project" })).toBeTruthy();
  });
});

describe("availability via a flow event", () => {
  it("fetches effective state when a flow event opens the gate", async () => {
    const sid = `edit-S-${++n}`;
    publishSessionEvents(sid, [{ seq: 1, timestamp: 1, eventType: "flow_started", data: { flowName: "A", task: "", steps: [] } } as unknown as DashboardEvent]);
    served = true;
    render(tree(sid, () => {}));
    expect(await screen.findByRole("button", { name: /New \/ Edit/ })).toBeTruthy();
  });
});

