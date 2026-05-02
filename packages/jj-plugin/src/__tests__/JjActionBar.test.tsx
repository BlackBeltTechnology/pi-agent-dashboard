/**
 * Visibility matrix for JjActionBar buttons under each jjState shape.
 *
 * Per spec scenarios:
 *   - "+ Workspace" appears whenever isInJjRepo
 *   - "Fold back" / "Forget" appear only inside non-default workspaces
 *   - All buttons hidden when not in jj repo
 *
 * See change: add-jj-workspace-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { JjActionBar } from "../client/JjActionBar.js";

const baseSession: DashboardSession = {
  id: "s1",
  cwd: "/repo",
  source: "dashboard",
  status: "active",
  startedAt: 0,
};

describe("JjActionBar", () => {
  it("renders nothing when not in a jj repo", () => {
    const { queryByTestId } = render(<JjActionBar session={baseSession} />);
    expect(queryByTestId("jj-action-bar")).toBeNull();
  });

  it("shows only `+ Workspace` for the default workspace", () => {
    const { getByTestId, queryByTestId } = render(
      <JjActionBar
        session={{
          ...baseSession,
          jjState: {
            isJjRepo: true,
            isColocated: true,
            workspaceName: "default",
          },
        }}
      />,
    );
    expect(getByTestId("jj-action-bar")).toBeDefined();
    expect(getByTestId("jj-add-workspace")).toBeDefined();
    expect(queryByTestId("jj-fold-back")).toBeNull();
    expect(queryByTestId("jj-forget-workspace")).toBeNull();
  });

  it("shows fold-back + forget for non-default workspaces", () => {
    const { getByTestId } = render(
      <JjActionBar
        session={{
          ...baseSession,
          jjState: {
            isJjRepo: true,
            isColocated: true,
            workspaceName: "agent-1",
          },
        }}
      />,
    );
    expect(getByTestId("jj-add-workspace")).toBeDefined();
    expect(getByTestId("jj-fold-back")).toBeDefined();
    expect(getByTestId("jj-forget-workspace")).toBeDefined();
  });

  it("shows only `+ Workspace` when jjState.isJjRepo but no workspace name", () => {
    const { getByTestId, queryByTestId } = render(
      <JjActionBar
        session={{
          ...baseSession,
          jjState: { isJjRepo: true, isColocated: true },
        }}
      />,
    );
    expect(getByTestId("jj-add-workspace")).toBeDefined();
    expect(queryByTestId("jj-fold-back")).toBeNull();
    expect(queryByTestId("jj-forget-workspace")).toBeNull();
  });
});
