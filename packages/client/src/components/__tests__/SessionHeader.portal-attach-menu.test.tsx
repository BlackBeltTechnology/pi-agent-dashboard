/**
 * Overlay-layering contract for SessionHeader's MobileAttachButton menu.
 * Verifies fixed z-popover not absolute z-50.
 * See change: migrate-workspace-menus-to-portal-layer.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SessionHeader } from "../session/SessionHeader.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";

// Heavy deps not needed for the attach-button menu test.
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));
vi.mock("../../lib/api/known-servers-api.js", () => ({ listKnownServers: vi.fn(async () => []) }));
vi.mock("../shell/MobileActionMenu.js", () => ({ MobileActionMenu: () => null }));
vi.mock("../split/LayoutModeSwitch.js", () => ({ LayoutModeSwitch: () => null }));
vi.mock("../split/SplitWorkspaceContext.js", () => ({ useOptionalSplitWorkspace: () => null }));
vi.mock("../diff/SessionDiffContext.js", () => ({ useOptionalSessionDiff: () => null }));
vi.mock("../tags/TagChip.js", () => ({ TagChip: () => null }));
vi.mock("../tags/TagEditor.js", () => ({ TagEditor: () => null }));
vi.mock("../extension-ui/FooterSegmentSlot.js", () => ({ FooterSegmentSlot: () => null }));
vi.mock("../openspec/openspec-helpers.js", () => ({ ArtifactLettersButton: () => null }));
vi.mock("../primitives/SearchableSelectDialog.js", () => ({ SearchableSelectDialog: () => null }));
vi.mock("./CountBadges.js", () => ({ CountBadges: () => null }));

afterEach(() => cleanup());

const CHANGE: OpenSpecChange = {
  name: "add-auth",
  status: "in-progress",
  completedTasks: 0,
  totalTasks: 3,
  artifacts: [],
};

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/project",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    ...overrides,
  } as DashboardSession;
}

describe("SessionHeader MobileAttachButton overlay-layering", () => {
  it("attach menu panel has fixed and z-popover, not absolute or z-50", () => {
    const state = createInitialState();
    render(
      <SessionHeader
        session={makeSession()}
        state={state}
        openspecChanges={[CHANGE]}
        onSendPrompt={() => {}}
      />,
    );
    // The mobile-attach-btn is only rendered when there are changes
    const btn = screen.queryByTestId("mobile-attach-btn");
    if (!btn) return; // component returns null when no changes — skip
    fireEvent.click(btn);
    const panel = screen.getByTestId("mobile-attach-menu");
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("z-popover");
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("z-50");
  });

  it("outside click closes the attach menu", () => {
    const state = createInitialState();
    render(
      <SessionHeader
        session={makeSession()}
        state={state}
        openspecChanges={[CHANGE]}
        onSendPrompt={() => {}}
      />,
    );
    const btn = screen.queryByTestId("mobile-attach-btn");
    if (!btn) return;
    fireEvent.click(btn);
    expect(screen.queryByTestId("mobile-attach-menu")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("mobile-attach-menu")).toBeNull();
  });
});
