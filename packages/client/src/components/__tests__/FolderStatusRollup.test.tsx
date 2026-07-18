import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FolderStatusRollup } from "../folder/FolderStatusRollup.js";

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

afterEach(() => {
  cleanup();
});

describe("FolderStatusRollup", () => {
  it("renders nothing when there are no working or idle sessions", () => {
    render(<FolderStatusRollup sessions={[makeSession({ status: "ended" })]} />);
    expect(screen.queryByTestId("folder-status-rollup")).toBeNull();
  });

  it("shows working and idle counts, excludes ended and needs-you", () => {
    render(
      <FolderStatusRollup
        sessions={[
          makeSession({ id: "a", status: "streaming" }),
          makeSession({ id: "b", status: "idle" }),
          makeSession({ id: "c", status: "active" }),
          makeSession({ id: "d", status: "idle", currentTool: "ask_user" }),
          makeSession({ id: "e", status: "ended" }),
        ]}
      />,
    );
    expect(screen.getByTestId("folder-status-working").textContent).toContain("1");
    expect(screen.getByTestId("folder-status-idle").textContent).toContain("2");
  });

  it("omits the working chip when no working sessions", () => {
    render(<FolderStatusRollup sessions={[makeSession({ status: "idle" })]} />);
    expect(screen.queryByTestId("folder-status-working")).toBeNull();
    expect(screen.getByTestId("folder-status-idle").textContent).toContain("1");
  });
});
