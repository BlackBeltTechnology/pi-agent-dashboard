/**
 * The session header no longer surfaces the attached OpenSpec change.
 * See change: reorganize-session-header (supersedes add-attached-proposal-header-summary
 * for the header; Attach / detach stay on the session card and in the composer).
 *
 * Covers test-plan E8.
 */
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return { id: "s1", status: "idle", cwd: "/tmp", startedAt: Date.now() - 60_000, ...overrides } as DashboardSession;
}

const CHANGE = {
  name: "add-auth",
  status: "in-progress",
  completedTasks: 3,
  totalTasks: 12,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "ready" },
  ],
} as OpenSpecChange;

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("../../hooks/useMobile.js");
});

async function load(mobile: boolean) {
  vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => mobile }));
  return (await import("../session/SessionHeader.js")).SessionHeader;
}

describe("SessionHeader carries no attach surface (E8)", () => {
  it("desktop: no Attach button, attached chip, artifact letters, task counter, pencil or standalone refresh", async () => {
    const SessionHeader = await load(false);
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "add-auth" })}
        state={createInitialState()}
        onRename={() => {}}
        onRefresh={() => {}}
        mobileActions={{ openspecChanges: [CHANGE] }}
      />,
    );
    expect(screen.queryByText("Attach")).toBeNull();
    expect(screen.queryByText("add-auth")).toBeNull();
    expect(screen.queryByTestId("attached-proposal-task-counter")).toBeNull();
    expect(screen.queryByTitle("Detach change")).toBeNull();
    expect(screen.queryByTitle("Rename session")).toBeNull();
    expect(screen.queryByTestId("refresh-chat")).toBeNull();
    expect(screen.queryByTestId("mobile-attach-btn")).toBeNull();
  });

  it("mobile: no paperclip button and no attached-chip row", async () => {
    const SessionHeader = await load(true);
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "add-auth" })}
        state={createInitialState()}
        mobileActions={{ openspecChanges: [CHANGE] }}
      />,
    );
    expect(screen.queryByTestId("mobile-attach-btn")).toBeNull();
    expect(screen.queryByTestId("mobile-header-attached-chip")).toBeNull();
  });
});
