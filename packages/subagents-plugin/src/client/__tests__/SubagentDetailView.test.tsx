/**
 * SubagentDetailView — three-tier rendering test (Tier 2 removed §14).
 *
 * Tier 1: entries present → renders entry rows.
 * Tier 3: completed/failed, no entries → result/error block.
 * Tier 4: no useful data → "No detail available yet."
 * Row mode: single-line summary, no body.
 *
 * See change: add-subagent-inspector.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { __resetHeldTailsForTest, SubagentDetailView, type SessionStateLike } from "../SubagentDetailView.js";
import type { SubagentState } from "../types.js";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";

// Mock markdown renderer — just pass-through the content so we can assert on it.
const MockMarkdown: React.FC<{ content: string }> = ({ content }) => <div data-testid="md">{content}</div>;

function makeSession(sub: SubagentState): SessionStateLike {
  return { subagents: new Map([[sub.id, sub]]) };
}

function emptySession(): SessionStateLike {
  return { subagents: new Map() };
}

function renderWithPrimitives(ui: React.ReactElement) {
  return render(withUiPrimitiveProvider({ "ui:markdown-content": MockMarkdown }, ui));
}

describe("SubagentDetailView", () => {
  afterEach(() => {
    cleanup();
    __resetHeldTailsForTest();
  });

  it("renders 'not found' when agentId is missing from session", () => {
    renderWithPrimitives(<SubagentDetailView session={emptySession()} agentId="missing" />);
    expect(screen.getByText(/not found/i)).toBeTruthy();
  });

  it("Tier 1 — renders entries when present", () => {
    const session = makeSession({
      id: "a1",
      type: "Explore",
      description: "search",
      status: "running",
      displayName: "explorer",
      entries: [
        { kind: "tool", toolName: "Read", input: { file_path: "/foo.ts" }, output: "abc", ts: 1 },
        { kind: "text", text: "Hello world", ts: 2 },
        { kind: "thinking", text: "I should look here", ts: 3 },
      ],
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText("/foo.ts")).toBeTruthy();
    expect(screen.getByText(/Hello world/)).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
  });

  it("running, no entries: collapses to Tier-4 placeholder (no upgrade footnote)", () => {
    // Tier 2 was removed in §14 — pi-dashboard-subagents reliably streams
    // entries from its first tool_execution_end, so the intermediate
    // "running, no entries" branch is no longer needed.
    const session = makeSession({
      id: "a1",
      type: "Explore",
      description: "search",
      status: "running",
      activity: "Reading src/foo.ts",
      toolUses: 5,
      tokens: { input: 100, output: 50, total: 150 },
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText(/No detail available yet/i)).toBeTruthy();
    // No leftover @tintinweb upgrade footnote
    expect(screen.queryByText(/Live timeline requires/i)).toBeNull();
  });

  it("Tier 3 — completed, no entries: shows result block, no footnote", () => {
    const session = makeSession({
      id: "a1",
      type: "Explore",
      description: "search",
      status: "completed",
      result: "Found 3 issues.",
      durationMs: 1234,
      tokens: { input: 100, output: 50, total: 150 },
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText(/Found 3 issues/)).toBeTruthy();
  });

  it("Tier 4 — nothing useful yet: placeholder", () => {
    const session = makeSession({
      id: "a1",
      type: "Explore",
      description: "",
      status: "created",
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText(/No detail available yet/i)).toBeTruthy();
  });

  it("renders agentMdPath as monospace path under displayName when present", () => {
    const session = makeSession({
      id: "a1",
      type: "general-purpose",
      description: "search",
      status: "completed",
      displayName: "explorer",
      agentMdPath: "/home/u/.pi/agent/agents/Explore.md",
      result: "done",
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText("explorer")).toBeTruthy();
    expect(screen.getByText("/home/u/.pi/agent/agents/Explore.md")).toBeTruthy();
  });

  it("omits the path line when agentMdPath is undefined", () => {
    const session = makeSession({
      id: "a1",
      type: "general-purpose",
      description: "search",
      status: "completed",
      displayName: "explorer",
      result: "done",
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText("explorer")).toBeTruthy();
    expect(screen.queryByText(/\.md$/)).toBeNull();
  });

  it("E16 — text sentinel renders as text on the client path (no error)", () => {
    // The server's head+tail reducer elides the middle of an oversized subagent
    // timeline into a { kind: "text", "⋯ N steps hidden ⋯" } sentinel. It must
    // render as plain text on any client version — never an (unknown entry)
    // error. See change: head-tail-truncate-subagent-event-timeline (D5).
    const session = makeSession({
      id: "a1",
      type: "Explore",
      description: "search",
      status: "running",
      displayName: "explorer",
      entries: [
        { kind: "tool", toolName: "Read", input: { file_path: "/a.ts" }, output: "x", ts: 1 },
        { kind: "text", text: "⋯ 21 steps hidden ⋯", ts: 2 },
        { kind: "tool", toolName: "Read", input: { file_path: "/z.ts" }, output: "y", ts: 3 },
      ],
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" />);
    expect(screen.getByText(/21 steps hidden/)).toBeTruthy();
    expect(screen.queryByText(/unknown entry/i)).toBeNull();
    // Non-empty guard still adopts entries: both tool rows render.
    expect(screen.getByText("/a.ts")).toBeTruthy();
    expect(screen.getByText("/z.ts")).toBeTruthy();
  });

  it("row mode — single-line summary, no body", () => {
    const session = makeSession({
      id: "a1",
      type: "Explore",
      description: "search",
      status: "running",
      displayName: "deep-research",
      activity: "Reading docs",
      entries: [{ kind: "text", text: "should not render in row mode", ts: 1 }],
    });
    renderWithPrimitives(<SubagentDetailView session={session} agentId="a1" mode="row" />);
    expect(screen.getByText("deep-research")).toBeTruthy();
    expect(screen.getByText(/Reading docs/)).toBeTruthy();
    // Body content from entries must NOT render in row mode
    expect(screen.queryByText(/should not render in row mode/)).toBeNull();
  });
});

// See change: stream-subagent-reasoning-and-stable-card (#E7, #X2).
describe("SubagentDetailView liveTail", () => {
  afterEach(() => {
    cleanup();
    __resetHeldTailsForTest();
  });
  const base: SubagentState = { id: "a1", type: "Explore", description: "d", status: "running" };
  const three = [
    { kind: "text" as const, text: "one", ts: 1 },
    { kind: "text" as const, text: "two", ts: 2 },
    { kind: "text" as const, text: "three", ts: 3 },
  ];
  const tails = [
    { kind: "none" as const, text: "" },
    { kind: "thinking" as const, text: "live-think" },
    { kind: "text" as const, text: "live-text" },
  ];
  for (const entries of [[], three]) {
    for (const liveTail of tails) {
      it(`entries=${entries.length} tail=${liveTail.kind}`, () => {
        const { container } = renderWithPrimitives(
          <SubagentDetailView session={makeSession({ ...base, entries, liveTail })} agentId="a1" />,
        );
        const live = container.querySelector('[data-testid="minimal-live-entry"]');
        if (liveTail.kind === "none") expect(live).toBeNull();
        else {
          expect(live).not.toBeNull();
          expect(live!.textContent).toContain(liveTail.text);
        }
        const emptyShown = screen.queryByText(/No detail available yet/) !== null;
        expect(emptyShown).toBe(entries.length === 0 && liveTail.kind === "none");
      });
    }
  }

  it("#X2 0.2.6-shaped state (no liveTail) renders as before", () => {
    const { container } = renderWithPrimitives(
      <SubagentDetailView session={makeSession({ ...base, entries: three })} agentId="a1" />,
    );
    expect(container.querySelector('[data-testid="minimal-live-entry"]')).toBeNull();
    expect(screen.getByText(/three/)).toBeTruthy();
  });
});

// See change: stream-subagent-reasoning-and-stable-card (task 5.3).
describe("SubagentDetailView thinking level", () => {
  afterEach(() => {
    cleanup();
    __resetHeldTailsForTest();
  });
  it("shows the level next to the model in the header", () => {
    renderWithPrimitives(
      <SubagentDetailView
        session={makeSession({ id: "a1", type: "Explore", description: "d", status: "running", modelName: "glm", thinkingLevel: "high" })}
        agentId="a1"
      />,
    );
    expect(screen.getByText("glm · thinking high")).toBeTruthy();
  });
});

// Block end → finished entry arrives later (next resync). The tail must stay
// up meanwhile, then hand off to the finished entry without a gap.
describe("SubagentDetailView tail hand-off", () => {
  afterEach(() => {
    cleanup();
    __resetHeldTailsForTest();
  });
  const base: SubagentState = { id: "a1", type: "Explore", description: "d", status: "running" };
  const one = [{ kind: "text" as const, text: "one", ts: 1 }];
  const view = (sub: SubagentState) => <SubagentDetailView session={makeSession(sub)} agentId="a1" />;

  it("keeps the last tail while cleared and no new entry has arrived, drops it once entries grow", () => {
    const { container, rerender } = renderWithPrimitives(view({ ...base, entries: one, liveTail: { kind: "thinking", text: "deep thought" } }));
    const live = () => container.querySelector('[data-testid="minimal-live-entry"]');
    expect(live()?.textContent).toContain("deep thought");
    rerender(withUiPrimitiveProvider({ "ui:markdown-content": MockMarkdown }, view({ ...base, entries: one, liveTail: { kind: "none", text: "" } })));
    expect(live()?.textContent).toContain("deep thought");
    rerender(
      withUiPrimitiveProvider(
        { "ui:markdown-content": MockMarkdown },
        view({ ...base, entries: [...one, { kind: "thinking", text: "deep thought full", ts: 2 }], liveTail: { kind: "none", text: "" } }),
      ),
    );
    expect(live()).toBeNull();
  });

  it("opens the newest reasoning entry while running", () => {
    const Thinking = (p: { content: string; defaultExpanded?: boolean }) => (
      <div data-testid="tb" data-expanded={String(Boolean(p.defaultExpanded))}>{p.content}</div>
    );
    const { getAllByTestId } = render(
      withUiPrimitiveProvider(
        { "ui:markdown-content": MockMarkdown, "ui:thinking-block": Thinking },
        view({ ...base, entries: [{ kind: "thinking", text: "old", ts: 1 }, { kind: "text", text: "x", ts: 2 }, { kind: "thinking", text: "new", ts: 3 }] }),
      ),
    );
    expect(getAllByTestId("tb").map((e) => e.getAttribute("data-expanded"))).toEqual(["false", "true"]);
  });
});
