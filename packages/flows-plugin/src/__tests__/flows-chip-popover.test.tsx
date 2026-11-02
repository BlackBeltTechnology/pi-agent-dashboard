/**
 * The chip's pencil popover: loading line while edit mode is unknown; only the
 * per-project item when off; Edit… / New flow… / Delete… (with `flows:delete`)
 * plus the item when on; keyboard focus moves in and arrows move. A failed
 * per-project change shows the error notice and keeps the label.
 * See change: flows-dock-chip-and-panel-actions (test-plan E22, X6).
 */
import { initPluginConfigs, publishSessionData } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowsContextGroup } from "../client/FlowsContextGroup.js";
import { editMode, entry, fetchMock, publishCatalog, type Served, tree } from "./flows-test-harness.js";

beforeEach(() => {
  initPluginConfigs({ flows: {} });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
async function openPopover(served: Served, withDelete: boolean, ws?: WebSocket) {
  const sid = `pop-S-${++n}`;
  publishCatalog(sid, [entry("x")]);
  if (withDelete) publishSessionData(sid, "commandsList", [{ name: "flows" }, { name: "flows:delete" }]);
  editMode.served = served;
  const send = vi.fn();
  render(tree(<FlowsContextGroup session={{ id: sid } as DashboardSession} />, send, ws));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.click(screen.getByTestId("flows-chip-edit-button"));
  // The popover body is a lazy chunk.
  await screen.findByTestId("flows-chip-edit-popover");
  return { sid, send };
}
const items = () => screen.queryAllByRole("menuitem").map((i) => i.textContent);

describe("pencil popover (E22)", () => {
  for (const del of [false, true]) {
    it(`edit mode unknown, flows:delete ${del} → loading line only`, async () => {
      await openPopover("pending", del);
      expect(screen.getByTestId("flows-chip-edit-loading")).toBeTruthy();
      expect(items()).toEqual([]);
    });
    it(`edit mode off, flows:delete ${del} → only "Turn on edit mode for this project"`, async () => {
      await openPopover(false, del);
      expect(items()).toEqual(["Turn on edit mode for this project"]);
    });
    it(`edit mode on, flows:delete ${del} → authoring items`, async () => {
      await openPopover(true, del);
      expect(items()).toEqual(
        del
          ? ["Edit…", "New flow…", "Delete…", "Turn off edit mode for this project"]
          : ["Edit…", "New flow…", "Turn off edit mode for this project"],
      );
    });
  }

  it("opening re-reads edit mode (out-of-band change seen on open)", async () => {
    await openPopover(false, false);
    expect(items()).toEqual(["Turn on edit mode for this project"]);
    // Close, flip the served value, reopen.
    fireEvent.click(screen.getByTestId("flows-chip-edit-button"));
    editMode.served = true;
    fireEvent.click(screen.getByTestId("flows-chip-edit-button"));
    await screen.findByTestId("flows-chip-edit-popover");
    await waitFor(() => expect(items()).toContain("New flow…"));
  });

  it("keyboard: focus moves into the popover and arrows move between items", async () => {
    await openPopover(true, true);
    const menuItems = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(menuItems[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(menuItems[1]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(menuItems[menuItems.length - 1]);
  });
});

describe("session unreachable (X6)", () => {
  it("a not-delivered set-edit-mode shows the error notice; the item keeps its label", async () => {
    const listeners = new Set<(e: MessageEvent) => void>();
    const ws = {
      addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.add(l),
      removeEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.delete(l),
    } as unknown as WebSocket;
    const { sid, send } = await openPopover(false, false, ws);
    fireEvent.click(screen.getByRole("menuitem", { name: "Turn on edit mode for this project" }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "plugin_action", action: "flow.set-edit-mode", payload: { enabled: true } }),
    );
    act(() => {
      for (const l of listeners) l({ data: JSON.stringify({ type: "flows_edit_mode_state", sessionId: sid, enabled: false, error: "not-delivered" }) } as MessageEvent);
    });
    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy());
    fireEvent.click(screen.getByTestId("flows-chip-edit-button"));
    await screen.findByTestId("flows-chip-edit-popover");
    expect(items()).toEqual(["Turn on edit mode for this project"]);
  });
});
