import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control widget-bar placement per session id. Returns true for ids in the set.
const widgetBarIds = new Set<string>();
vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({
  useHasWidgetBarPrompt: (sessionId: string) => widgetBarIds.has(sessionId),
}));

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FolderNeedsYouPill } from "../folder/FolderNeedsYouPill.js";

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/tmp",
    source: "dashboard",
    status: "idle",
    startedAt: 0,
    ...overrides,
  } as DashboardSession;
}

beforeEach(() => {
  widgetBarIds.clear();
});

afterEach(() => {
  cleanup();
});

describe("FolderNeedsYouPill", () => {
  it("hidden when no ask_user sessions", () => {
    render(<FolderNeedsYouPill sessions={[makeSession({ status: "idle" })]} onActivate={() => {}} />);
    expect(screen.queryByTestId("folder-needs-you-pill")).toBeNull();
  });

  it("renders count of chat-routed ask_user sessions", () => {
    const sessions = [
      makeSession({ id: "a", currentTool: "ask_user" }),
      makeSession({ id: "b", status: "streaming" }),
      makeSession({ id: "c", currentTool: "ask_user" }),
    ];
    render(<FolderNeedsYouPill sessions={sessions} onActivate={() => {}} />);
    const pill = screen.getByTestId("folder-needs-you-pill");
    expect(pill.getAttribute("data-needs-you-count")).toBe("2");
  });

  it("excludes widget-bar-placed ask_user from the count", () => {
    widgetBarIds.add("c");
    const sessions = [
      makeSession({ id: "a", currentTool: "ask_user" }),
      makeSession({ id: "c", currentTool: "ask_user" }),
    ];
    render(<FolderNeedsYouPill sessions={sessions} onActivate={() => {}} />);
    const pill = screen.getByTestId("folder-needs-you-pill");
    expect(pill.getAttribute("data-needs-you-count")).toBe("1");
  });

  it("hidden when the only ask_user session is widget-bar-placed", () => {
    widgetBarIds.add("a");
    render(<FolderNeedsYouPill sessions={[makeSession({ id: "a", currentTool: "ask_user" })]} onActivate={() => {}} />);
    expect(screen.queryByTestId("folder-needs-you-pill")).toBeNull();
  });

  it("activates on click with the first chat-routed blocked id", () => {
    const onActivate = vi.fn();
    render(
      <FolderNeedsYouPill
        sessions={[
          makeSession({ id: "a", currentTool: "ask_user" }),
          makeSession({ id: "c", currentTool: "ask_user" }),
        ]}
        onActivate={onActivate}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-needs-you-pill"));
    expect(onActivate).toHaveBeenCalledWith("a");
  });

  it("activation target skips widget-bar sessions", () => {
    widgetBarIds.add("a");
    const onActivate = vi.fn();
    render(
      <FolderNeedsYouPill
        sessions={[
          makeSession({ id: "a", currentTool: "ask_user" }),
          makeSession({ id: "c", currentTool: "ask_user" }),
        ]}
        onActivate={onActivate}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-needs-you-pill"));
    expect(onActivate).toHaveBeenCalledWith("c");
  });

  it("label collapses on mobile (hidden sm:inline), icon+count stay", () => {
    render(<FolderNeedsYouPill sessions={[makeSession({ id: "a", currentTool: "ask_user" })]} onActivate={() => {}} />);
    const label = screen.getByText("need you");
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("sm:inline");
    // Count is always visible (not inside the collapsing label span).
    expect(screen.getByText("1")).toBeTruthy();
  });
});
