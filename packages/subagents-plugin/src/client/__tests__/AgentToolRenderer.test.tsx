/**
 * AgentToolRenderer — expand toggle + popout button tests.
 *
 * See change: add-subagent-inspector.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SubagentState } from "../types.js";
import { AgentToolRenderer, type ToolContext, withHostPrimitives } from "./agent-test-harness.js";

// The renderer and SubagentDetailView read the host primitives through
// useUiPrimitive; every render is wrapped in a provider carrying them.
function wrapInProviders(ui: React.ReactElement) {
  return withHostPrimitives(ui);
}

type SessionState = { subagents: Map<string, SubagentState> };
const createInitialState = (): SessionState => ({ subagents: new Map() });

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
    // `requestId` is the requester-scoping correlation token (a fresh uuid per
    // request). See change: reduce-subagent-details-payload (C5).
    expect(send).toHaveBeenCalledWith({
      type: "subagent_resync_request",
      sessionId: "sess_42",
      agentId: "abc123",
      requestId: expect.any(String),
      reason: "open",
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
    // Assert the OPEN-path guard this test documents, not "no resync at all":
    // the cadence hook fires its own `reason: "cadence"` resync 2 s after the
    // view opens, so a slow `findByRole` under load made a broader assertion
    // fail on a legitimate cadence tick. See change:
    // contention-harden-real-process-tests.
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "subagent_resync_request", reason: "open" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
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
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // F9 / design D5 — the `h-[70vh]` pin SURVIVES the flush-panel flex change.
  // It is a deliberate definite-height choice (a stable popout as transcript
  // entries stream in), not a workaround for the indefinite parent the panel
  // used to be, so the primitive fix must not tempt anyone to "finish the job"
  // and delete it. With the pin present, height stability is a CSS tautology;
  // the real risk is its removal, which is what this asserts.
  // See change: fix-flush-dialog-scroll-and-close-collision.
  it("F9: the popout keeps its definite-height pin under a flush dialog", async () => {
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
    // The panel itself is the flush flex column...
    expect(dialog.className).toContain("flex-col");
    expect(dialog.className).toContain("min-h-0");
    // ...and the pin is still the direct child inside it.
    expect(dialog.querySelector(".h-\\[70vh\\]")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
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
    fireEvent.keyDown(document, { key: "Escape" });
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

// See change: show-background-subagents-in-dock (tasks 2.1–2.3, test-plan #E2, #E3, #F5).
describe("AgentToolRenderer — background started card (D2)", () => {
  afterEach(() => cleanup());

  const bgArgs = { subagent_type: "docs-writer", description: "write the docs", prompt: "p" };
  const renderBg = (toolStatus: "running" | "complete", detailsStatus: string | undefined, session?: SessionState) =>
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={bgArgs}
        status={toolStatus}
        result="Started background subagent bg-7a3f (running)"
        context={makeContext(session, "s1")}
        toolDetails={{ background: true, id: "bg-7a3f", ...(detailsStatus ? { status: detailsStatus } : {}) }}
      />,
    ));

  const cells: Array<["running" | "complete", string | undefined]> = [];
  for (const ts of ["running", "complete"] as const) {
    for (const ds of ["running", "completed", "error", "aborted", "stopped", undefined]) cells.push([ts, ds]);
  }

  it.each(cells)("tool %s × details.status %s → started card only (#E2)", (ts, ds) => {
    const { container } = renderBg(ts, ds);
    expect(screen.getByText("Started in background")).toBeTruthy();
    expect(screen.getByText("bg-7a3f")).toBeTruthy();
    expect(screen.getByText(/In Processes/)).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("elapsed-badge")).toBeNull();
    expect(screen.queryByTestId("agent-run-time")).toBeNull();
    expect(screen.queryByTestId("agent-activity-row")).toBeNull();
    expect(screen.queryByTestId("agent-stop-row")).toBeNull();
    expect(screen.queryByText("Details")).toBeNull();
    expect(screen.queryByText("Popout")).toBeNull();
    // No result block either: the card only says "started".
    expect(screen.queryByText(/Started background subagent bg-7a3f/)).toBeNull();
  });

  it("a rejected background call (limit reached, no bg- id) is not shown as started", () => {
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={bgArgs}
        status="error"
        result="Background limit reached"
        context={makeContext(undefined, "s1")}
        toolDetails={{ background: true, status: "rejected", outstanding: ["bg-1"] }}
      />,
    ));
    expect(screen.queryByText("Started in background")).toBeNull();
  });

  it("a foreground running card is unchanged (#E3)", () => {
    render(wrapInProviders(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore" }}
        status="running"
        context={makeContext(undefined, "s1")}
        toolDetails={{ status: "running", agentId: "ag-1", durationMs: 1000 }}
      />,
    ));
    expect(screen.getByTestId("agent-run-time")).toBeTruthy();
    expect(screen.getByTestId("agent-activity-row")).toBeTruthy();
    expect(screen.queryByText("Started in background")).toBeNull();
  });

  it("the card markup never changes while the background run progresses or ends (#F5)", () => {
    const sub = (status: SubagentState["status"]) =>
      ({ subagents: new Map([["sub-1", { id: "sub-1", type: "docs-writer", description: "write the docs", status, background: true } as SubagentState]]) });
    const { container, rerender } = renderBg("complete", "running", sub("running"));
    const first = container.innerHTML;
    for (const status of ["completed", "failed", "stopped"] as const) {
      rerender(wrapInProviders(
        <AgentToolRenderer
          toolName="Agent"
          args={bgArgs}
          status="complete"
          result="Started background subagent bg-7a3f (running)"
          context={makeContext(sub(status), "s1")}
          toolDetails={{ background: true, id: "bg-7a3f", status: "running" }}
        />,
      ));
      expect(container.innerHTML).toBe(first);
    }
  });
});
