import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { SessionOpenSpecActions } from "../openspec/SessionOpenSpecActions.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Tests for the replace-proposal dialog (race-handling).
 * See change: replace-proposal-dialog-with-race-handling.
 *
 * The core invariant: the primary button reflects the *committed* target,
 * never the latest server suggestion. The committed target only advances on
 * an explicit `[Use latest]` click.
 */

afterEach(cleanup);

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/project/foo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    ...overrides,
  } as DashboardSession;
}

function renderActions(session: DashboardSession, onReplaceProposal = vi.fn()) {
  const utils = render(
    <SessionOpenSpecActions
      session={session}
      changes={[]}
      onAttach={() => {}}
      onDetach={() => {}}
      onReplaceProposal={onReplaceProposal}
      onSendPrompt={() => {}}
    />,
  );
  return { ...utils, onReplaceProposal };
}

describe("ReplaceProposalDialog", () => {
  it("6.1 renders when both attached and pending are set", () => {
    renderActions(makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "bravo" }));
    expect(screen.getByTestId("replace-proposal-dialog")).toBeTruthy();
  });

  it("6.1b does not render when pendingReplaceProposal is absent", () => {
    renderActions(makeSession({ attachedProposal: "alpha" }));
    expect(screen.queryByTestId("replace-proposal-dialog")).toBeNull();
  });

  it("6.1c does not render when attachedProposal is absent even if pending exists", () => {
    renderActions(makeSession({ attachedProposal: null, pendingReplaceProposal: "bravo" }));
    expect(screen.queryByTestId("replace-proposal-dialog")).toBeNull();
  });

  it("6.2 button text shows the committed target, not the latest suggestion", () => {
    const { rerender } = renderActions(
      makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "bravo" }),
    );
    expect(screen.getByTestId("replace-proposal-dialog-action").textContent).toContain("bravo");
    // Server coalesces to a newer suggestion while the dialog stays open.
    rerender(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "charlie" })}
        changes={[]}
        onAttach={() => {}}
        onDetach={() => {}}
        onReplaceProposal={() => {}}
        onSendPrompt={() => {}}
      />,
    );
    // Button still commits to "bravo" — the core invariant.
    expect(screen.getByTestId("replace-proposal-dialog-action").textContent).toContain("bravo");
    expect(screen.getByTestId("replace-proposal-dialog-action").textContent).not.toContain("charlie");
  });

  it("6.3 divergence shows banner; [Use latest] advances the committed target", () => {
    const session1 = makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "bravo" });
    const { rerender } = renderActions(session1);
    expect(screen.queryByTestId("replace-divergence-banner")).toBeNull();
    rerender(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "charlie" })}
        changes={[]}
        onAttach={() => {}}
        onDetach={() => {}}
        onReplaceProposal={() => {}}
        onSendPrompt={() => {}}
      />,
    );
    const banner = screen.getByTestId("replace-divergence-banner");
    expect(banner.textContent).toContain("charlie");
    fireEvent.click(screen.getByTestId("use-latest-btn"));
    // Committed target advanced; banner hides; button now reads "charlie".
    expect(screen.queryByTestId("replace-divergence-banner")).toBeNull();
    expect(screen.getByTestId("replace-proposal-dialog-action").textContent).toContain("charlie");
  });

  it("6.4 Replace click sends accept_replace_proposal with the committed target", () => {
    const { onReplaceProposal } = renderActions(
      makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "bravo" }),
    );
    fireEvent.click(screen.getByTestId("replace-proposal-dialog-action"));
    expect(onReplaceProposal).toHaveBeenCalledWith(true, "bravo");
  });

  it("6.5 Cancel sends dismiss_replace_proposal with the committed target", () => {
    const { onReplaceProposal } = renderActions(
      makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "bravo" }),
    );
    fireEvent.click(screen.getByTestId("replace-proposal-dialog-cancel"));
    expect(onReplaceProposal).toHaveBeenCalledWith(false, "bravo");
  });

  it("6.6 dialog unmounts when pendingReplaceProposal becomes null", () => {
    const { rerender } = renderActions(
      makeSession({ attachedProposal: "alpha", pendingReplaceProposal: "bravo" }),
    );
    expect(screen.getByTestId("replace-proposal-dialog")).toBeTruthy();
    rerender(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "alpha", pendingReplaceProposal: null })}
        changes={[]}
        onAttach={() => {}}
        onDetach={() => {}}
        onReplaceProposal={() => {}}
        onSendPrompt={() => {}}
      />,
    );
    expect(screen.queryByTestId("replace-proposal-dialog")).toBeNull();
  });

  it("6.7 switching sessions mounts fresh dialog state (lazy init keyed by session id)", () => {
    const { rerender } = renderActions(
      makeSession({ id: "s1", attachedProposal: "alpha", pendingReplaceProposal: "bravo" }),
    );
    expect(screen.getByTestId("replace-proposal-dialog-action").textContent).toContain("bravo");
    // Different session id → ReplaceProposalDialog remounts, committing to the
    // new session's pending value.
    rerender(
      <SessionOpenSpecActions
        session={makeSession({ id: "s2", attachedProposal: "delta", pendingReplaceProposal: "charlie" })}
        changes={[]}
        onAttach={() => {}}
        onDetach={() => {}}
        onReplaceProposal={() => {}}
        onSendPrompt={() => {}}
      />,
    );
    expect(screen.getByTestId("replace-proposal-dialog-action").textContent).toContain("charlie");
  });
});
