/**
 * AgentToolRenderer — expand toggle + popout button tests.
 *
 * See change: add-subagent-inspector.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { AgentToolRenderer } from "../tool-renderers/AgentToolRenderer.js";
import { ThemeProvider } from "../ThemeProvider.js";
import { createInitialState, type SessionState, type SubagentState } from "../../lib/event-reducer.js";
import type { ToolContext } from "../tool-renderers/types.js";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";

// SubagentDetailView (in the subagents plugin) uses useUiPrimitive for the
// markdown renderer; tests rendering its expanded body must wrap in a
// UiPrimitiveProvider.
const MockMarkdown: React.FC<{ content: string }> = ({ content }) => <div>{content}</div>;

function wrapInProviders(ui: React.ReactElement) {
  return withUiPrimitiveProvider(
    { "ui:markdown-content": MockMarkdown },
    <ThemeProvider>{ui}</ThemeProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: q === "(prefers-color-scheme: dark)",
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function makeContext(session?: SessionState, sessionId?: string): ToolContext {
  return { editors: [], sessionId, session };
}

function sessionWithAgent(agentId: string, sub: Partial<SubagentState> = {}): SessionState {
  const s = createInitialState();
  s.subagents = new Map([[agentId, {
    id: agentId,
    type: "Explore",
    description: "",
    status: "running",
    ...sub,
  } as SubagentState]]);
  return s;
}

describe("AgentToolRenderer — expand + popout", () => {
  afterEach(() => cleanup());

  it("renders collapsed by default and shows expand toggle", () => {
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", prompt: "do work" }}
        status="running"
        context={makeContext()}
        toolDetails={{
          displayName: "explorer",
          status: "running",
          activity: "reading",
          agentId: "abc123",
        }}
      />
    ));
    // Expand button is present
    expect(screen.getByTitle(/Expand to inspect/i)).toBeTruthy();
    // Detail view body NOT rendered until expanded.
    expect(screen.queryByText(/No detail available yet/i)).toBeNull();
  });

  it("clicking expand shows the SubagentDetailView body", () => {
    const session = sessionWithAgent("abc123", {
      displayName: "explorer",
      status: "running",
      activity: "reading src/foo.ts",
      toolUses: 3,
    });
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", prompt: "do work" }}
        status="running"
        context={makeContext(session, "sess_42")}
        toolDetails={{
          displayName: "explorer",
          status: "running",
          activity: "reading src/foo.ts",
          agentId: "abc123",
        }}
      />
    ));
    fireEvent.click(screen.getByTitle(/Expand to inspect/i));
    // After expanding without entries[], Tier-4 placeholder shows
    // (Tier-2 footnote was removed in add-subagent-inspector §14).
    expect(screen.getByText(/No detail available yet/i)).toBeTruthy();
  });

  it("popout button opens new tab with the correct URL when agentId is present", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore" }}
        status="running"
        context={makeContext(sessionWithAgent("abc123"), "sess_42")}
        toolDetails={{ displayName: "explorer", status: "running", agentId: "abc123" }}
      />
    ));
    // Title is "Open subagent in new tab" — see fix-flows-plugin-polish
    // (pill-style popout button with subagent-specific label).
    fireEvent.click(screen.getByTitle(/Open subagent in new tab/i));
    // Third arg `"noopener"` is a security best practice preventing the
    // popup from accessing window.opener. Added in fix-flows-plugin-polish.
    expect(open).toHaveBeenCalledWith("/session/sess_42/subagent/abc123", "_blank", "noopener");
    open.mockRestore();
  });

  it("popout button is disabled when agentId is missing", () => {
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore" }}
        status="running"
        context={makeContext()}
        toolDetails={{ displayName: "explorer", status: "running" }}
      />
    ));
    const btn = screen.getByTitle(/Subagent id not yet available/i);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
