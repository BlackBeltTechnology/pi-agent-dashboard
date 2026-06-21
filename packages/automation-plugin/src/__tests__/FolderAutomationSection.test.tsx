/**
 * FolderAutomationSection slot render: shows "Automations (N) →" when the
 * folder has automations, renders nothing when empty (absent when unused).
 * api mocked. See change: add-automation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { DiscoveredAutomation } from "../shared/automation-types.js";

const { listAutomations } = vi.hoisted(() => ({
  listAutomations: vi.fn(async (_cwd?: string): Promise<DiscoveredAutomation[]> => []),
}));
vi.mock("../client/api.js", () => ({ listAutomations }));

import { FolderAutomationSection } from "../client/FolderAutomationSection.js";

afterEach(cleanup);

describe("FolderAutomationSection", () => {
  it("renders the count when the folder has automations", async () => {
    listAutomations.mockResolvedValueOnce([
      { name: "a", scope: "folder", dir: "/r/.pi/automation/a", valid: true },
      { name: "b", scope: "global", dir: "~/.pi/automation/b", valid: true },
    ]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/r" }} />);
    await waitFor(() => expect(getByTestId("folder-automation-section").textContent).toContain("Automations (2)"));
  });

  it("still renders (count 0) when the folder has no automations, as the create entry point", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/empty" }} />);
    await waitFor(() => expect(getByTestId("folder-automation-section").textContent).toContain("Automations (0)"));
  });
});
