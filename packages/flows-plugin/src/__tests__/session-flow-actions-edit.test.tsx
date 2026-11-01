/**
 * Authoring actions after the move to the dock chip's pencil popover, and the
 * flowless entry point in the session actions menu. Edit… / New flow… follow
 * the session's EFFECTIVE edit mode (GET edit-mode-state). Picking a flow (Edit…)
 * or New flow… opens the intent-capture dialog; submitting it sends
 * `/skill:manage-flows ...`. Nothing ever sends an edit-mode message unless the
 * per-project item is clicked.
 * See change: rework-flows-plugin-for-new-pi-flows, add-session-actions-flyout,
 * stop-flows-edit-mode-project-writes (#E15, #F1, #F2, #X3, #X5);
 * flows-dock-chip-and-panel-actions (D6, D7).
 */
import { initPluginConfigs, publishSessionData } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowsContextGroup } from "../client/FlowsContextGroup.js";
import { SessionFlowMenuClaim } from "../client/SessionFlowMenuClaim.js";
import { editMode, entry, fetchMock, publishCatalog, type Served, sentOf, tree } from "./flows-test-harness.js";

beforeEach(() => {
  editMode.served = false;
  fetchMock.mockClear();
  initPluginConfigs({ flows: {} });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
const chip = (sid: string) => <FlowsContextGroup session={{ id: sid } as DashboardSession} />;
const menu = (sid: string) => <SessionFlowMenuClaim session={{ id: sid } as DashboardSession} />;
function renderChip(served: Served, send = vi.fn<(m: unknown) => void>()) {
  const sid = `edit-S-${++n}`;
  publishCatalog(sid, [entry("invoice-research")]);
  editMode.served = served;
  return { sid, send, ...render(tree(chip(sid), send)) };
}
/** Let the mount GET settle. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const openPencil = () => fireEvent.click(screen.getByTestId("flows-chip-edit-button"));
const prompts = (send: ReturnType<typeof vi.fn>) => sentOf(send, (m) => m.type === "send_prompt");
const editModeSends = (send: ReturnType<typeof vi.fn>) =>
  sentOf(send, (m) => m.type === "flow_management" || m.action === "flow.set-edit-mode" || m.action === "set-edit-mode");

describe("chip pencil popover authoring", () => {
  it("Edit… prompts for an instruction, then sends /skill:manage-flows <name>", async () => {
    const { sid, send } = renderChip(true);
    await settle();
    openPencil();
    fireEvent.click(await screen.findByTestId("flows-chip-edit-edit"));
    fireEvent.click(await screen.findByText(/invoice-research/));
    // Intent dialog appears; edit instruction is optional → submit empty.
    fireEvent.click(await screen.findByTestId("flow-author-submit"));
    expect(prompts(send)).toEqual([{ type: "send_prompt", sessionId: sid, text: "/skill:manage-flows invoice-research" }]);
  });

  it("New flow… requires a description before /skill:manage-flows <text> is sent", async () => {
    const { sid, send } = renderChip(true);
    await settle();
    openPencil();
    fireEvent.click(await screen.findByTestId("flows-chip-edit-new"));
    const submit = (await screen.findByTestId("flow-author-submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Research an invoice/), { target: { value: "Summarize PRs" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(prompts(send)).toEqual([{ type: "send_prompt", sessionId: sid, text: "/skill:manage-flows Summarize PRs" }]);
  });

  it("the edit-mode item requests the value its label names", async () => {
    const { sid, send } = renderChip(false);
    await settle();
    openPencil();
    const item = await screen.findByRole("menuitem", { name: "Turn on edit mode for this project" });
    expect(item.getAttribute("title")).toContain(".pi/settings.json");
    fireEvent.click(item);
    expect(editModeSends(send)).toEqual([
      { type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.set-edit-mode", payload: { enabled: true } },
    ]);
  });
});

describe("state unavailable (#X5)", () => {
  it.each(["reject", 500, 404] as const)("GET %s → loading line only, no throw", async (failure) => {
    renderChip(failure);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    openPencil();
    expect(await screen.findByTestId("flows-chip-edit-loading")).toBeTruthy();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

describe("no implicit edit-mode sends (#F1, #F2)", () => {
  it.each([{ editFlow: true }, { editFlow: false }, {}])("legacy config %j: mount + 5 re-renders send nothing", async (config) => {
    initPluginConfigs({ flows: config });
    const { sid, send, rerender } = renderChip(true);
    await settle();
    for (let i = 0; i < 5; i++) {
      publishSessionData(sid, "commandsList", [{ name: "flows" }, { name: `flows:x${i}` }]);
      rerender(tree(chip(sid), send));
    }
    await settle();
    expect(editModeSends(send)).toHaveLength(0);
  });

  it("two provider trees for one session (tabs), remount one: nothing sent", async () => {
    const [a, b] = [vi.fn(), vi.fn()];
    const sid = `edit-S-${++n}`;
    publishCatalog(sid, []);
    editMode.served = true;
    const t1 = render(tree(menu(sid), a));
    const t2 = render(tree(menu(sid), b));
    await settle();
    t2.unmount();
    render(tree(menu(sid), b));
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
    publishCatalog(sid, []);
    editMode.served = false;
    render(tree(menu(sid), () => {}, ws));
    await screen.findByRole("button", { name: "Turn on edit mode for this project" });
    const push = (frame: unknown) =>
      act(() => {
        for (const l of listeners) l({ data: JSON.stringify(frame) } as MessageEvent);
      });
    push({ type: "flows_edit_mode_state", sessionId: sid, enabled: false, error: "not-delivered" });
    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Turn on edit mode for this project" })).toBeTruthy();
    push({ type: "flows_edit_mode_state", sessionId: sid, enabled: true });
    expect(await screen.findByRole("button", { name: "New flow…" })).toBeTruthy();
    expect(screen.queryByText(/could not be reached/)).toBeNull();
  });
});
