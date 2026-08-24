/**
 * FolderAutomationSection slot render: a STATE-ONLY pill (uppercase title +
 * count + invalid marker) that navigates to the shell-overlay board
 * `/folder/:encodedCwd/automations`. Creating an automation and reloading the
 * list are folder-actions-menu contributions, not pill buttons.
 * api + CreateAutomationDialog mocked.
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing,
 * move-slot-actions-to-menu (test-plan #E3, #E20, #E21, #F2).
 */

import {
  createFolderMenuStore,
  CurrentPluginLayer,
  FolderMenuProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFolderPath } from "../client/folder-encoding.js";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

const { listAutomations } = vi.hoisted(() => ({
  listAutomations: vi.fn(async (_cwd?: string): Promise<DiscoveredAutomation[]> => []),
}));
vi.mock("../client/api.js", () => ({ listAutomations }));

const { setLocation } = vi.hoisted(() => ({ setLocation: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));

vi.mock("../client/CreateAutomationDialog.js", () => ({
  CreateAutomationDialog: () => <div data-testid="create-automation-dialog" />,
}));

import { FolderAutomationSection } from "../client/FolderAutomationSection.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Renders the section under a scoped registry so its contributions are readable. */
function renderSection(cwd: string, store = createFolderMenuStore()) {
  const utils = render(
    <FolderMenuProvider store={store}>
      <CurrentPluginLayer pluginId="automation-plugin">
        <FolderAutomationSection folder={{ cwd }} />
      </CurrentPluginLayer>
    </FolderMenuProvider>,
  );
  return { ...utils, store };
}

describe("FolderAutomationSection", () => {
  it("renders a STATE-ONLY SlotPill: label + count, and no action control", async () => {
    listAutomations.mockResolvedValueOnce([
      { name: "a", scope: "folder", dir: "/r/.pi/automation/a", valid: true },
      { name: "b", scope: "global", dir: "~/.pi/automation/b", valid: true },
    ]);
    const { getByTestId, queryByTestId } = renderSection("/r");
    const board = await waitFor(() => getByTestId("folder-automation-open-board"));
    expect(board.textContent).toContain("Automations");
    expect(getByTestId("folder-automation-count").textContent).toBe("2");
    expect(queryByTestId("folder-automation-refresh")).toBeNull();
    expect(queryByTestId("folder-automation-new-btn")).toBeNull();
    const section = getByTestId("folder-automation-section");
    expect(
      Array.from(section.querySelectorAll("button, a, [role='button'], [tabindex]:not([tabindex='-1'])")),
    ).toEqual([board]);
  });

  it("E3: contributes exactly one CREATE item for this folder scope", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { store, getByTestId } = renderSection("/r");
    await waitFor(() => getByTestId("folder-automation-open-board"));
    const items = store.getItems("/r");
    expect(items.map((i) => [i.id, i.group])).toEqual([["new-automation", "create"]]);
    expect(items[0]!.pluginId).toBe("automation-plugin");
  });

  it("E20/E21: registers a refresher that renders no item and refetches on fan-out", async () => {
    listAutomations.mockResolvedValue([]);
    const { store, getByTestId } = renderSection("/r");
    await waitFor(() => getByTestId("folder-automation-open-board"));
    const before = listAutomations.mock.calls.length;
    await act(async () => {
      store.runRefreshers("/r");
    });
    await waitFor(() => expect(listAutomations.mock.calls.length).toBe(before + 1));
    // The refresher is not itself a menu item.
    expect(store.getItems("/r").map((i) => i.id)).toEqual(["new-automation"]);
  });

  it("F2: unmounting the section leaves no item behind", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { store, getByTestId, unmount } = renderSection("/r");
    await waitFor(() => getByTestId("folder-automation-open-board"));
    expect(store.getItems("/r")).toHaveLength(1);
    unmount();
    expect(store.getItems("/r")).toHaveLength(0);
  });

  it("still renders (count 0) when the folder has no automations, as the create entry point", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/empty" }} />);
    await waitFor(() => expect(getByTestId("folder-automation-open-board").textContent).toContain("Automations"));
    expect(getByTestId("folder-automation-count").textContent).toBe("0");
  });

  it("navigates to the shell-overlay board /folder/<enc>/automations", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { getByTestId } = renderSection("/r");
    const board = await waitFor(() => getByTestId("folder-automation-open-board"));
    fireEvent.click(board);
    expect(setLocation).toHaveBeenCalledWith(`/folder/${encodeFolderPath("/r")}/automations`);
  });

  it("the CREATE item opens the create editor directly without navigating", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { store, getByTestId } = renderSection("/r");
    await waitFor(() => getByTestId("folder-automation-open-board"));
    act(() => store.getItems("/r")[0]!.onSelect());
    expect(getByTestId("create-automation-dialog")).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });
});
