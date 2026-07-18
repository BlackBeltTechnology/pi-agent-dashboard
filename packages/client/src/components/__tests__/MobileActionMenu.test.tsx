import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { MobileActionMenu } from "../shell/MobileActionMenu.js";
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/project/foo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    ...overrides,
  };
}

const sampleChange: OpenSpecChange = {
  name: "add-auth",
  status: "in-progress",
  completedTasks: 0,
  totalTasks: 5,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "ready" },
  ],
};

function openMenu() {
  fireEvent.click(screen.getByTestId("mobile-kebab-btn"));
}

describe("MobileActionMenu unattached OpenSpec section", () => {
  it("shows Explore and + New Change when alive with no attached proposal", () => {
    const onSendPrompt = vi.fn();
    render(
      <MobileActionMenu
        session={makeSession({ status: "idle" })}
        openspecChanges={[sampleChange]}
        onSendPrompt={onSendPrompt}
      />
    );
    openMenu();
    const menu = screen.getByTestId("mobile-action-menu");
    expect(menu.textContent).toContain("Explore");
    expect(menu.textContent).toContain("New Change");
  });

  it("hides unattached OpenSpec section when session is ended", () => {
    const onSendPrompt = vi.fn();
    render(
      <MobileActionMenu
        session={makeSession({ status: "ended" })}
        openspecChanges={[sampleChange]}
        onSendPrompt={onSendPrompt}
      />
    );
    openMenu();
    const menu = screen.getByTestId("mobile-action-menu");
    // Should not show the unattached section header
    // The menu should not contain OpenSpec entries for unattached state
    const buttons = menu.querySelectorAll("button");
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).not.toContain("Explore");
    expect(labels).not.toContain("+ New Change");
  });

  it("hides unattached OpenSpec section when a proposal is attached", () => {
    const onSendPrompt = vi.fn();
    render(
      <MobileActionMenu
        session={makeSession({ status: "idle", attachedProposal: "add-auth" })}
        openspecChanges={[sampleChange]}
        onSendPrompt={onSendPrompt}
      />
    );
    openMenu();
    const menu = screen.getByTestId("mobile-action-menu");
    // Should show the attached section instead, not "+ New Change"
    const buttons = menu.querySelectorAll("button");
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).not.toContain("+ New Change");
    // "Explore" exists but in the attached section (different command), which is fine
  });

  it("Explore opens dialog and sends prompt with correct format", () => {
    const onSendPrompt = vi.fn();
    render(
      <MobileActionMenu
        session={makeSession({ status: "idle" })}
        openspecChanges={[sampleChange]}
        onSendPrompt={onSendPrompt}
      />
    );
    openMenu();
    // Click Explore in the unattached section
    const menu = screen.getByTestId("mobile-action-menu");
    const exploreBtn = Array.from(menu.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Explore")!;
    fireEvent.click(exploreBtn);
    // Menu should close, dialog should open
    expect(screen.queryByTestId("mobile-action-menu")).toBeNull();
    expect(screen.getByTestId("explore-dialog")).toBeTruthy();
    // Type and send
    fireEvent.change(screen.getByTestId("explore-textarea"), { target: { value: "investigate auth" } });
    fireEvent.click(screen.getByTestId("explore-send"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-explore\ninvestigate auth", undefined);
    // Dialog should close
    expect(screen.queryByTestId("explore-dialog")).toBeNull();
  });

  it("+ New Change opens dialog and sends prompt", () => {
    const onSendPrompt = vi.fn();
    render(
      <MobileActionMenu
        session={makeSession({ status: "idle" })}
        openspecChanges={[sampleChange]}
        onSendPrompt={onSendPrompt}
      />
    );
    openMenu();
    const menu = screen.getByTestId("mobile-action-menu");
    const newBtn = Array.from(menu.querySelectorAll("button")).find((b) => b.textContent?.trim() === "+ New Change")!;
    fireEvent.click(newBtn);
    // Menu should close, dialog should open
    expect(screen.queryByTestId("mobile-action-menu")).toBeNull();
    expect(screen.getByTestId("new-change-dialog")).toBeTruthy();
    // Fill and send
    fireEvent.change(screen.getByTestId("new-change-name"), { target: { value: "add-auth" } });
    fireEvent.change(screen.getByTestId("new-change-description"), { target: { value: "Add OAuth" } });
    fireEvent.click(screen.getByTestId("new-change-send"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-new-change add-auth\nAdd OAuth");
    // Dialog should close
    expect(screen.queryByTestId("new-change-dialog")).toBeNull();
  });
});
