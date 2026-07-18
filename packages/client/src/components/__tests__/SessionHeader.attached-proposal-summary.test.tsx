/**
 * Attached-proposal artifact summary tests.
 * See change: add-attached-proposal-header-summary.
 *
 * Verifies that the content-window header (SessionHeader.tsx, both desktop
 * branch and MobileHeader) surfaces the artifact-letters pill and task counter
 * for the attached OpenSpec change. Mobile cases mock useMobile -> true; the
 * desktop spec is split into a sibling describe block with useMobile -> false.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import React from "react";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(overrides?: Partial<DashboardSession>): DashboardSession {
  return {
    id: "s1",
    status: "idle",
    cwd: "/tmp",
    startedAt: Date.now() - 60_000,
    ...overrides,
  } as DashboardSession;
}

function makeChange(overrides?: Partial<OpenSpecChange>): OpenSpecChange {
  return {
    name: "foo",
    status: "in-progress",
    completedTasks: 3,
    totalTasks: 12,
    artifacts: [
      { id: "proposal", status: "done" },
      { id: "design", status: "ready" },
      { id: "tasks", status: "blocked" },
      { id: "specs", status: "blocked" },
    ],
    ...overrides,
  } as OpenSpecChange;
}

describe("SessionHeader attached-proposal summary — desktop", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("../../hooks/useMobile.js");
  });

  async function loadDesktop() {
    vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));
    const mod = await import("../session/SessionHeader.js");
    return mod.SessionHeader;
  }

  it("renders pill and counter when attached change has artifacts and tasks", async () => {
    const SessionHeader = await loadDesktop();
    const onReadArtifact = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "foo" })}
        state={createInitialState()}
        openspecChanges={[makeChange()]}
        onAttachProposal={() => {}}
        onDetachProposal={() => {}}
        onReadArtifact={onReadArtifact}
      />,
    );
    const pill = screen.getByTestId("artifact-letters-btn");
    expect(pill).toBeTruthy();
    expect(screen.getByTestId("attached-proposal-task-counter").textContent).toContain("3/12");
  });

  it("invokes onReadArtifact with proposal when the pill is clicked", async () => {
    const SessionHeader = await loadDesktop();
    const onReadArtifact = vi.fn();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "foo" })}
        state={createInitialState()}
        openspecChanges={[makeChange()]}
        onAttachProposal={() => {}}
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("artifact-letters-btn"));
    expect(onReadArtifact).toHaveBeenCalledWith("foo", "proposal");
  });

  it("renders no pill or counter when attachedProposal is set but no matching change in list", async () => {
    const SessionHeader = await loadDesktop();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "foo" })}
        state={createInitialState()}
        openspecChanges={[]}
        onAttachProposal={() => {}}
      />,
    );
    expect(screen.queryByTestId("artifact-letters-btn")).toBeNull();
    expect(screen.queryByTestId("attached-proposal-task-counter")).toBeNull();
  });

  it("renders pill but hides counter when totalTasks is 0", async () => {
    const SessionHeader = await loadDesktop();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "foo" })}
        state={createInitialState()}
        openspecChanges={[makeChange({ completedTasks: 0, totalTasks: 0 })]}
        onAttachProposal={() => {}}
        onReadArtifact={() => {}}
      />,
    );
    expect(screen.getByTestId("artifact-letters-btn")).toBeTruthy();
    expect(screen.queryByTestId("attached-proposal-task-counter")).toBeNull();
  });

  it("does NOT render pill for auto-detected openspecChange when attachedProposal is null", async () => {
    const SessionHeader = await loadDesktop();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: null, openspecChange: "foo" })}
        state={createInitialState()}
        openspecChanges={[makeChange()]}
        onAttachProposal={() => {}}
        onReadArtifact={() => {}}
      />,
    );
    expect(screen.queryByTestId("artifact-letters-btn")).toBeNull();
    expect(screen.queryByTestId("attached-proposal-task-counter")).toBeNull();
  });
});

describe("SessionHeader attached-proposal summary — mobile", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("../../hooks/useMobile.js");
  });

  async function loadMobile() {
    vi.doMock("../../hooks/useMobile.js", () => ({ useMobile: () => true }));
    const mod = await import("../session/SessionHeader.js");
    return mod.SessionHeader;
  }

  it("renders pill and counter inside the mobile-header-attached-chip span", async () => {
    const SessionHeader = await loadMobile();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "foo" })}
        state={createInitialState()}
        mobileActions={{
          openspecChanges: [makeChange()],
          onAttachProposal: () => {},
          onDetachProposal: () => {},
          onReadArtifact: () => {},
        }}
      />,
    );
    const chip = screen.getByTestId("mobile-header-attached-chip");
    expect(within(chip).getByTestId("artifact-letters-btn")).toBeTruthy();
    expect(within(chip).getByTestId("attached-proposal-task-counter").textContent).toContain("3/12");
  });

  it("renders chip but no pill when no matching change in list", async () => {
    const SessionHeader = await loadMobile();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "foo" })}
        state={createInitialState()}
        mobileActions={{
          openspecChanges: [],
          onAttachProposal: () => {},
        }}
      />,
    );
    expect(screen.getByTestId("mobile-header-attached-chip")).toBeTruthy();
    expect(screen.queryByTestId("artifact-letters-btn")).toBeNull();
  });

  // Two-row layout assertions — see change: fix-mobile-header-and-orientation.
  it("places chip on its own row, NOT a sibling of the title span, when attached", async () => {
    const SessionHeader = await loadMobile();
    render(
      <SessionHeader
        session={makeSession({ attachedProposal: "add-extension-ui-decorations", name: "my-session" })}
        state={createInitialState()}
        mobileActions={{
          openspecChanges: [makeChange({ name: "add-extension-ui-decorations" })],
          onAttachProposal: () => {},
          onDetachProposal: () => {},
          onReadArtifact: () => {},
        }}
      />,
    );
    const chip = screen.getByTestId("mobile-header-attached-chip");
    const title = screen.getByText("my-session");
    // Chip's nearest row container must NOT contain the title — they're on
    // separate rows.
    const chipRow = chip.closest("div");
    expect(chipRow).toBeTruthy();
    expect(chipRow!.contains(title)).toBe(false);
  });

  it("renders header as a single-row container when attachedProposal is null", async () => {
    const SessionHeader = await loadMobile();
    const { container } = render(
      <SessionHeader
        session={makeSession({ attachedProposal: null })}
        state={createInitialState()}
        mobileActions={{
          openspecChanges: [],
          onAttachProposal: () => {},
        }}
      />,
    );
    // No chip in the DOM.
    expect(screen.queryByTestId("mobile-header-attached-chip")).toBeNull();
    // The flex-col outer wrapper has exactly one child (row 1).
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("flex-col");
    expect(outer.children.length).toBe(1);
  });
});
