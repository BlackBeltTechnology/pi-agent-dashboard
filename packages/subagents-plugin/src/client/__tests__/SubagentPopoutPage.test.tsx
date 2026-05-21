/**
 * SubagentPopoutPage — loading / not-found / found tests.
 *
 * See change: add-subagent-inspector.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { SubagentPopoutPage } from "../SubagentPopoutPage.js";
import type { SessionStateLike } from "../SubagentDetailView.js";
import type { SubagentState } from "../types.js";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";

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
