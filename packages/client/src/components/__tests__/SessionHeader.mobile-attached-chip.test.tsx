/**
 * Mobile attached-proposal chip tests.
 * See change: fix-mobile-attach-proposal-display.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { SessionHeader } from "../session/SessionHeader.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Force mobile layout for these tests.
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    ...overrides,
  } as DashboardSession;
}

describe("SessionHeader mobile attached-proposal chip", () => {
  afterEach(cleanup);

  it("renders the chip when attachedProposal is set", () => {
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "add-auth" })}
        state={createInitialState()}
        mobileActions={{}}
      />,
    );
    const chip = screen.getByTestId("mobile-header-attached-chip");
    expect(chip.textContent).toContain("add-auth");
    expect(chip.getAttribute("title")).toBe("Attached: add-auth");
  });

  it("does NOT render the chip when attachedProposal is null/undefined", () => {
    const { unmount } = render(
      <SessionHeader
        session={makeSession({ attachedProposal: null })}
        state={createInitialState()}
        mobileActions={{}}
      />,
    );
    expect(screen.queryByTestId("mobile-header-attached-chip")).toBeNull();
    unmount();

    render(
      <SessionHeader
        session={makeSession({ attachedProposal: undefined })}
        state={createInitialState()}
        mobileActions={{}}
      />,
    );
    expect(screen.queryByTestId("mobile-header-attached-chip")).toBeNull();
  });

  it("renders chip even when no mobileActions are provided (read-only nature)", () => {
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "feature-x" })}
        state={createInitialState()}
        mobileActions={{}}
      />,
    );
    expect(screen.getByTestId("mobile-header-attached-chip").textContent).toContain("feature-x");
  });
});
