/**
 * Visibility matrix for JjWorkspaceBadge under each jjState shape.
 *
 * Per spec scenario "Badge displays workspace name when inside a jj workspace".
 *
 * See change: add-jj-workspace-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { JjWorkspaceBadge } from "../client/JjWorkspaceBadge.js";

const baseSession: DashboardSession = {
  id: "s1",
  cwd: "/repo",
  source: "dashboard",
  status: "active",
  startedAt: 0,
};

describe("JjWorkspaceBadge", () => {
  it("renders nothing when jjState is absent", () => {
    const { queryByTestId } = render(<JjWorkspaceBadge session={baseSession} />);
    expect(queryByTestId("jj-workspace-badge")).toBeNull();
  });

  it("renders nothing when jjState is present but workspaceName is undefined", () => {
    const { queryByTestId } = render(
      <JjWorkspaceBadge
        session={{
          ...baseSession,
          jjState: { isJjRepo: true, isColocated: true },
        }}
      />,
    );
    expect(queryByTestId("jj-workspace-badge")).toBeNull();
  });

  it("renders `jj:<name>` when workspace name is present", () => {
    const { getByTestId } = render(
      <JjWorkspaceBadge
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
    const badge = getByTestId("jj-workspace-badge");
    expect(badge.textContent).toBe("jj:agent-1");
  });

  it("annotates tooltip with `(colocated with git)` when isColocated", () => {
    const { getByTestId } = render(
      <JjWorkspaceBadge
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
    expect(getByTestId("jj-workspace-badge").getAttribute("title")).toContain(
      "(colocated with git)",
    );
  });
});
