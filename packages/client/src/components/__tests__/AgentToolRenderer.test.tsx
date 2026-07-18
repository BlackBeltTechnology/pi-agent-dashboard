/**
 * AgentToolRenderer — expand toggle + popout button tests.
 *
 * See change: add-subagent-inspector.
 */

import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState, type SubagentState } from "../../lib/chat/event-reducer.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { AgentToolRenderer } from "../tool-renderers/AgentToolRenderer.js";
import type { ToolContext } from "../tool-renderers/types.js";

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

function makeContext(
  session?: SessionState,
  sessionId?: string,
  send?: ToolContext["send"],
): ToolContext {
  return { sessionId, session, send };
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

  it("inline expand requests a resync for a running subagent with an empty timeline", () => {
    const send = vi.fn();
    // agentId present on the card, but NOT in the subagents map — mirrors a
    // running subagent viewed after refresh/late-subscribe (map un-hydrated).
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", prompt: "do work" }}
        status="running"
        context={makeContext(createInitialState(), "sess_42", send)}
        toolDetails={{ displayName: "explorer", status: "running", agentId: "abc123" }}
      />
    ));
    fireEvent.click(screen.getByTitle(/Expand to inspect/i));
    expect(send).toHaveBeenCalledWith({
      type: "subagent_resync_request",
      sessionId: "sess_42",
      agentId: "abc123",
    });
  });

  it("inline expand does NOT resync when the timeline already has entries", () => {
    const send = vi.fn();
    const session = sessionWithAgent("abc123", {
      status: "running",
      entries: [{ kind: "text", text: "hi", ts: 0 }],
    });
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", prompt: "do work" }}
        status="running"
        context={makeContext(session, "sess_42", send)}
        toolDetails={{ displayName: "explorer", status: "running", agentId: "abc123" }}
      />
    ));
    fireEvent.click(screen.getByTitle(/Expand to inspect/i));
    expect(send).not.toHaveBeenCalled();
  });

  // X4 (change: resolve-subagent-inspector-by-session-id): the variant-A
  // populated-timeline guard is preserved on the popout path too — opening the
  // detail dialog for a subagent with non-empty entries[] sends no resync.
  it("X4: popout does NOT resync when the timeline already has entries", async () => {
    const send = vi.fn();
    const session = sessionWithAgent("abc123", {
      status: "running",
      entries: [{ kind: "text", text: "hi", ts: 0 }],
    });
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", prompt: "do work" }}
        status="running"
        context={makeContext(session, "sess_42", send)}
        toolDetails={{ displayName: "explorer", status: "running", agentId: "abc123" }}
      />
    ));
    fireEvent.click(screen.getByTitle(/Open subagent detail/i));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "subagent_resync_request" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // These three tests OPEN the ui:dialog, whose body mounts the full
  // SubagentDetailView subtree via a portal. They are `async` and use
  // `findByRole`/`waitFor` (both act-wrapped) so React's concurrent scheduler
  // flushes and the portal unmounts WITHIN the test — otherwise a deferred
  // scheduler task can fire after the vitest worker tears jsdom down and leak
  // a "window is not defined" unhandled error under full-suite concurrency.
  // See change: fix-subagent-live-detail-reliability (D4).
  it("popout opens a ui:dialog (not a new browser tab) when agentId is present", async () => {
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
    // No dialog before activation.
    expect(screen.queryByRole("dialog")).toBeNull();
    // Title changed to "Open subagent detail" — the popout now opens the
    // shell ui:dialog primitive.
    fireEvent.click(screen.getByTitle(/Open subagent detail/i));
    // A dialog opens…
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // …and NO new browser tab/window is opened.
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    // Tear the portal down within the test (flush the scheduler).
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("detail dialog dismisses on Esc", async () => {
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore" }}
        status="running"
        context={makeContext(sessionWithAgent("abc123"), "sess_42")}
        toolDetails={{ displayName: "explorer", status: "running", agentId: "abc123" }}
      />
    ));
    fireEvent.click(screen.getByTitle(/Open subagent detail/i));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("detail dialog dismisses on overlay click", async () => {
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore" }}
        status="running"
        context={makeContext(sessionWithAgent("abc123"), "sess_42")}
        toolDetails={{ displayName: "explorer", status: "running", agentId: "abc123" }}
      />
    ));
    fireEvent.click(screen.getByTitle(/Open subagent detail/i));
    const dialog = await screen.findByRole("dialog");
    // The overlay is the sibling before the dialog panel; click it to dismiss.
    const overlay = dialog.parentElement!.querySelector(".absolute.inset-0") as HTMLElement;
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("popout button is disabled when agentId is missing (no dialog opens)", () => {
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
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
