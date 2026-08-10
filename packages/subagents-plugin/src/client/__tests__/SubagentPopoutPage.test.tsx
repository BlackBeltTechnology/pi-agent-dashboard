/**
 * SubagentPopoutPage — loading / not-found / found tests.
 *
 * See change: add-subagent-inspector.
 */

import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionStateLike } from "../SubagentDetailView.js";
import { SubagentPopoutPage } from "../SubagentPopoutPage.js";
import type { SubagentState } from "../types.js";

const MockMarkdown: React.FC<{ content: string }> = ({ content }) => <div data-testid="md">{content}</div>;

function sessionWithAgent(agentId: string, sub: Partial<SubagentState> = {}): SessionStateLike {
  return {
    subagents: new Map([[agentId, {
      id: agentId,
      type: "Explore",
      description: "",
      status: "running",
      ...sub,
    } as SubagentState]]),
  };
}

function emptySession(): SessionStateLike {
  return { subagents: new Map() };
}

/**
 * A session whose `subagents` map dual-indexes ONE run under both the v4
 * `agentId` and the v7 `agentSessionId`, pointing at the SAME state ref —
 * mirrors what the reducer produces (change:
 * resolve-subagent-inspector-by-session-id). A deep-link route carrying the v7
 * id in its `:agentId` slot must resolve this run.
 */
function dualIndexedSession(
  agentId: string,
  agentSessionId: string,
  sub: Partial<SubagentState> = {},
): SessionStateLike {
  const state = {
    id: agentId,
    agentSessionId,
    type: "Explore",
    description: "",
    status: "running",
    ...sub,
  } as SubagentState;
  return { subagents: new Map([[agentId, state], [agentSessionId, state]]) };
}

function renderWithPrimitives(ui: React.ReactElement) {
  return render(withUiPrimitiveProvider({ "ui:markdown-content": MockMarkdown }, ui));
}

describe("SubagentPopoutPage", () => {
  afterEach(() => cleanup());

  it("shows loading state before subscription resolves", () => {
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="abc123"
        session={undefined}
        subscriptionResolved={false}
      />,
    );
    expect(screen.getByText(/Loading parent session/i)).toBeTruthy();
  });

  it("shows 'parent session not found' when subscription resolves with no session", () => {
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="abc123"
        session={undefined}
        subscriptionResolved={true}
      />,
    );
    expect(screen.getByText(/Parent session not found/i)).toBeTruthy();
  });

  it("shows 'subagent not found' when parent session exists but agent does not", () => {
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="missing"
        session={emptySession()}
        subscriptionResolved={true}
      />,
    );
    expect(screen.getByText(/Subagent not found/i)).toBeTruthy();
  });

  it("renders the detail view when subagent is found", () => {
    const session = sessionWithAgent("abc123", {
      displayName: "explorer",
      status: "running",
      activity: "reading",
      toolUses: 2,
      entries: [{ kind: "text", text: "Looking up files", ts: 1 }],
    });
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="abc123"
        session={session}
        subscriptionResolved={true}
        parentLabel="/home/me/project"
      />,
    );
    expect(screen.getByText(/\/home\/me\/project/)).toBeTruthy();
    // Tier 1 entries render via the detail view body
    expect(screen.getByText(/Looking up files/)).toBeTruthy();
  });

  // Change: resolve-subagent-inspector-by-session-id — the deep-link ROUTE
  // (`/session/:sessionId/subagent/:agentId`) resolves a v7 runner session id
  // once the reducer dual-indexes the run. These prove that resolution at the
  // exact route surface (SubagentPopoutPage), deterministically.

  // F1: running run dual-indexed under A and S; open the route by S → live
  // timeline renders, not-found placeholder NOT shown.
  it("F1: resolves a RUNNING run by its runner session id (v7 in the :agentId slot)", () => {
    const session = dualIndexedSession("agent-A", "runner-S", {
      displayName: "explorer",
      status: "running",
      activity: "reading",
      toolUses: 2,
      entries: [{ kind: "text", text: "Looking up files", ts: 1 }],
    });
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="runner-S"
        session={session}
        subscriptionResolved={true}
        parentLabel="/home/me/project"
      />,
    );
    expect(screen.getByText(/Looking up files/)).toBeTruthy();
    expect(screen.queryByText(/Subagent not found/i)).toBeNull();
  });

  // F2 (PRIMARY): completed/backfilled run dual-indexed under A and S; open the
  // route by S → rehydrated body renders, not the placeholder.
  it("F2: resolves a COMPLETED (backfilled) run by its runner session id", () => {
    const session = dualIndexedSession("agent-A", "runner-S", {
      displayName: "explorer",
      status: "completed",
      result: "Found 5 files",
      entries: [{ kind: "text", text: "Rehydrated timeline entry", ts: 1 }],
    });
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="runner-S"
        session={session}
        subscriptionResolved={true}
        parentLabel="/home/me/project"
      />,
    );
    expect(screen.getByText(/Rehydrated timeline entry/)).toBeTruthy();
    expect(screen.queryByText(/Subagent not found/i)).toBeNull();
  });

  // F3: an id in neither the A nor S slot → the ACTUAL route placeholder string
  // (SubagentPopoutPage's "cleared" variant, NOT the inline view's string).
  it("F3: an unknown id (neither agentId nor agentSessionId) shows the route placeholder", () => {
    const session = dualIndexedSession("agent-A", "runner-S", { status: "running" });
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="totally-unknown-id"
        session={session}
        subscriptionResolved={true}
        parentLabel="/home/me/project"
      />,
    );
    expect(
      screen.getByText(/Subagent not found — it may have been cleared from the parent session's history\./i),
    ).toBeTruthy();
  });

  it("renders agentMdPath in the chrome header when present", () => {
    const session = sessionWithAgent("abc123", {
      displayName: "code-reviewer",
      status: "completed",
      agentMdPath: "/home/u/.pi/agent/agents/CodeReviewer.md",
      result: "LGTM",
    });
    renderWithPrimitives(
      <SubagentPopoutPage
        sessionId="sess_42"
        agentId="abc123"
        session={session}
        subscriptionResolved={true}
        parentLabel="/home/me/project"
      />,
    );
    // The path renders as monospace text under the displayName.
    // It appears in both the chrome header and the SubagentDetailView header,
    // so we just check at least one occurrence.
    const matches = screen.getAllByText("/home/u/.pi/agent/agents/CodeReviewer.md");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
