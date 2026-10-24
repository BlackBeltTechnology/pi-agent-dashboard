/**
 * Read-only archived view header: the synthesized ended row renders the header
 * with the layout switch and NONE of the mutating controls (test-plan #E6).
 * See change: fix-archived-session-view-header-and-stale-artifact-tab (D1).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

const archivedRow = {
  id: "arch-1",
  status: "ended",
  cwd: "/repo",
  name: "E2E archived",
  sessionFile: "/s/arch-1.jsonl",
  startedAt: 1,
  endedAt: 2,
} as unknown as DashboardSession;

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("../../hooks/useMobile.js");
});

describe("SessionHeader — archived read-only view", () => {
  it("E6: shows the name + layout switch, no seek/resume/fork/tags/rename/reveal", async () => {
    vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));
    const { SessionHeader } = await import("../session/SessionHeader.js");
    localStorage.clear();
    render(
      <SplitWorkspaceProvider sessionId="arch-1" cwd="/repo" orientation="h">
        <SessionHeader
          session={archivedRow}
          state={createInitialState()}
          allTags={["a"]}
          onRefresh={() => {}}
          onRename={undefined}
          onSetTags={undefined}
          onSeekToCard={undefined}
          onResume={undefined}
        />
      </SplitWorkspaceProvider>,
    );
    expect(screen.getByTestId("session-title-text").textContent).toBe("E2E archived");
    expect(screen.getByTestId("layout-mode-switch")).toBeTruthy();
    expect(screen.queryByTestId("session-header-seek-card")).toBeNull();
    expect(screen.queryByTestId("header-resume-button")).toBeNull();
    expect(screen.queryByTestId("header-fork-button")).toBeNull();
    expect(screen.queryByText("No session selected")).toBeNull();

    fireEvent.click(screen.getByTestId("session-title-menu"));
    const menu = screen.getByTestId("session-title-menu-list");
    expect(menu.textContent).not.toMatch(/Rename|Reveal in sidebar|Edit tags/);
    expect(menu.textContent).toMatch(/Reload transcript/);
  });
});
