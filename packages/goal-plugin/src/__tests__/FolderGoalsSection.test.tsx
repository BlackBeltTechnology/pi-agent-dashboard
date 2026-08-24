/**
 * FolderGoalsSection — sidebar-folder-section claim.
 * Verifies the slot renders `Goals (N)` from the REST count and opens the
 * board route on click (task 3.1), and the create flow posts + navigates
 * (task 3.2) — now driven from the folder-actions-menu `CREATE` item rather
 * than a `+ Goal` pill button, which no longer exists.
 *
 * See change: add-goals-folder-page; move-slot-actions-to-menu
 * (test-plan #E3, #E20, #E21, #F2).
 */

import {
  createFolderMenuStore,
  CurrentPluginLayer,
  FolderMenuProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FolderGoalsSection } from "../client/FolderGoalsSection.js";
import { goalsBoardUrl } from "../client/goals-api.js";

const cwd = "/repo/alpha";

function mockFetch(goals: unknown[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, data: { id: "g-new", objective: "x" } }) } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: goals }) } as Response;
  });
}

beforeEach(() => { (globalThis as any).fetch = mockFetch([{ id: "g1" }, { id: "g2" }]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderSlot(hook?: any, store = createFolderMenuStore()) {
  const utils = render(
    <Router hook={hook}>
      <FolderMenuProvider store={store}>
        <CurrentPluginLayer pluginId="goal-plugin">
          <FolderGoalsSection folder={{ cwd }} />
        </CurrentPluginLayer>
      </FolderMenuProvider>
    </Router>,
  );
  return { ...utils, store };
}

describe("FolderGoalsSection", () => {
  it("renders the Goals pill with the fetched count", async () => {
    const { getByTestId } = renderSlot();
    // SlotPill: uppercase "Goals" label + bold count in `folder-goals-count`.
    await waitFor(() => expect(getByTestId("folder-goals-open-board").textContent).toContain("Goals"));
    expect(getByTestId("folder-goals-count").textContent).toBe("2");
  });

  it("opens the goals board on click", async () => {
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { getByTestId } = renderSlot(hook);
    await waitFor(() => expect(getByTestId("folder-goals-count").textContent).toBe("2"));
    fireEvent.click(getByTestId("folder-goals-open-board"));
    expect(history[history.length - 1]).toBe(goalsBoardUrl(cwd));
  });

  it("renders a STATE-ONLY pill \u2014 no refresh, no create control", async () => {
    const { getByTestId, queryByTestId } = renderSlot();
    const board = await waitFor(() => getByTestId("folder-goals-open-board"));
    expect(queryByTestId("folder-goals-refresh")).toBeNull();
    expect(queryByTestId("folder-goal-new-btn")).toBeNull();
    const section = getByTestId("folder-goals-section");
    expect(
      Array.from(section.querySelectorAll("button, a, [role='button'], [tabindex]:not([tabindex='-1'])")),
    ).toEqual([board]);
  });

  it("E3: contributes one CREATE item, stamped with the goal plugin's identity", async () => {
    const { store, getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-goals-count").textContent).toBe("2"));
    expect(store.getItems(cwd).map((i) => [i.pluginId, i.id, i.group])).toEqual([
      ["goal-plugin", "new-goal", "create"],
    ]);
  });

  it("E20/E21: registers a refresher with no item of its own", async () => {
    const { store, getByTestId } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-goals-count").textContent).toBe("2"));
    const before = ((globalThis as any).fetch as any).mock.calls.length;
    await act(async () => {
      store.runRefreshers(cwd);
    });
    await waitFor(() =>
      expect(((globalThis as any).fetch as any).mock.calls.length).toBeGreaterThan(before),
    );
    expect(store.getItems(cwd).map((i) => i.id)).toEqual(["new-goal"]);
  });

  it("F2: unmounting the section deregisters its item", async () => {
    const { store, getByTestId, unmount } = renderSlot();
    await waitFor(() => expect(getByTestId("folder-goals-count").textContent).toBe("2"));
    unmount();
    expect(store.getItems(cwd)).toHaveLength(0);
  });

  it("the CREATE item opens the shared dialog (no inline panel) and creates on Enter", async () => {
    const { hook, history } = memoryLocation({ path: "/", record: true });
    const { store, getByTestId, queryByTestId, getByPlaceholderText } = renderSlot(hook);
    await waitFor(() => expect(store.getItems(cwd)).toHaveLength(1));
    act(() => store.getItems(cwd)[0]!.onSelect());
    expect(getByTestId("goal-create-dialog")).toBeTruthy();
    expect(queryByTestId("folder-goal-create")).toBeNull();
    const input = getByPlaceholderText("Goal objective…");
    fireEvent.change(input, { target: { value: "Ship goals" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(history[history.length - 1]).toBe(goalsBoardUrl(cwd)));
  });
});
