/**
 * Mobile attached-proposal chip tests.
 * See change: fix-mobile-attach-proposal-display.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { archiveEntry, knownData, stubArchiveApi, withOpenSpecMap } from "../../test-support/attachmentHarness.js";
import { SessionHeader } from "../session/SessionHeader.js";

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

describe("SessionHeader mobile chip — archived attachment (resolve-archived-attached-proposal)", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("F6 chip is read-only: name, Archived badge, letters; Detach lives in the MobileAttachButton popover", async () => {
    stubArchiveApi({ "/tmp": [archiveEntry("2026-09-30-add-auth")] });
    const onDetach = vi.fn();
    render(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        {withOpenSpecMap(
          { "/tmp": knownData() },
          <SessionHeader
            session={makeSession({ attachedProposal: "add-auth" })}
            state={createInitialState()}
            mobileActions={{ onDetachProposal: onDetach, openspecChanges: [] }}
          />,
        )}
      </Router>,
    );
    const chip = screen.getByTestId("mobile-header-attached-chip");
    await screen.findByTestId("attachment-archived-badge");
    expect(chip.textContent).toContain("add-auth");
    expect(chip.textContent).toContain("Archived 2026-09-30");
    expect(chip.querySelectorAll('[data-testid="artifact-letter"]').length).toBe(3);
    expect(chip.querySelector('[data-testid="detach-btn"], [data-testid="detach-proposal-btn"]')).toBeNull();
    expect(chip.textContent).not.toMatch(/Detach/);
    // Detach is still reachable from the attach popover.
    fireEvent.click(screen.getByTestId("mobile-attach-btn"));
    expect(screen.getByText(/Detach/)).toBeTruthy();
  });
});
