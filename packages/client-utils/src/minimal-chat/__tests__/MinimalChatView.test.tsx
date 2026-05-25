/**
 * MinimalChatView unit tests.
 *
 * Tests use `withUiPrimitiveProvider` to mock `MarkdownContent`,
 * `formatTokens`, `formatDuration`. Rendering without the provider must
 * throw a hook-resolution error (covered by the negative case below).
 *
 * See change: extract-minimal-chat-view.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { MinimalChatView } from "../MinimalChatView.js";
import type { MinimalChatEntry, MinimalChatStatus } from "../types.js";

const MockMarkdown: React.FC<{ content: string }> = ({ content }) => (
  <div data-testid="md">{content}</div>
);

const mockFormatTokens = (n: number) => {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
};
const mockFormatDuration = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function renderView(ui: React.ReactElement) {
  return render(
    withUiPrimitiveProvider(
      {
        "ui:markdown-content": MockMarkdown,
        "ui:format-tokens": mockFormatTokens,
        "ui:format-duration": mockFormatDuration,
      },
      ui,
    ),
  );
}

describe("MinimalChatView", () => {
  afterEach(() => cleanup());

  it("renders each of the four entry kinds in order", () => {
    const entries: MinimalChatEntry[] = [
      { kind: "tool", toolName: "Read", input: { file_path: "/foo.ts" } },
      { kind: "text", text: "Hello world" },
      { kind: "thinking", text: "I should look here" },
      { kind: "error", text: "Boom" },
    ];
    renderView(
      <MinimalChatView title="alpha" status="running" entries={entries} />,
    );
    expect(screen.getByText("Read")).toBeTruthy();
    expect(screen.getByText("/foo.ts")).toBeTruthy();
    expect(screen.getByText(/Hello world/)).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Boom")).toBeTruthy();
  });

  it("status enum maps to expected icon + color (5 values)", () => {
    const cases: Array<{ status: MinimalChatStatus; color: string }> = [
      { status: "complete", color: "text-green-400" },
      { status: "error", color: "text-red-400" },
      { status: "running", color: "text-yellow-400" },
      { status: "blocked", color: "text-orange-400" },
      { status: "pending", color: "text-[var(--text-tertiary)]" },
    ];
    for (const { status, color } of cases) {
      cleanup();
      const { container } = renderView(
        <MinimalChatView title="t" status={status} entries={[]} />,
      );
      // Walk all spans, find one whose classList contains both the color
      // and `inline-flex`. Avoids CSS.escape (not available in jsdom env).
      const spans = Array.from(container.querySelectorAll<HTMLElement>("span"));
      const span = spans.find(
        (s) => s.classList.contains(color) && s.classList.contains("inline-flex"),
      );
      expect(span, `expected color span for status=${status}`).toBeTruthy();
    }
  });

  it("three modes apply expected root container classes", () => {
    {
      const { container } = renderView(
        <MinimalChatView title="a" status="running" entries={[]} mode="popout" />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain("h-full");
      expect(root.className).toContain("overflow-hidden");
    }
    cleanup();
    {
      const { container } = renderView(
        <MinimalChatView title="a" status="running" entries={[]} mode="inline" />,
      );
      const root = container.firstElementChild as HTMLElement;
      // Inline mode now uses a STABLE `h-[60vh]` (not `max-h-[60vh]`) so the
      // container doesn't bounce as content streams in. The body's
      // `flex-1 min-h-0 overflow-y-auto` provides the scroll surface.
      // See change: fix-flows-plugin-polish (stable inline height).
      expect(root.className).toContain("h-[60vh]");
      expect(root.className).not.toContain("max-h-[60vh]");
    }
    cleanup();
    {
      const { container } = renderView(
        <MinimalChatView title="a" status="running" entries={[{ kind: "text", text: "body" }]} mode="row" activity="reading" />,
      );
      // Row mode: no body, only single line
      expect(screen.queryByTestId("md")).toBeNull();
      expect(screen.getByText("a")).toBeTruthy();
      expect(screen.getByText("reading")).toBeTruthy();
      // Root has no flex-col h-full
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toContain("h-full");
      expect(root.className).not.toContain("h-[60vh]");
    }
  });

  it("hides meta when prop is omitted", () => {
    renderView(<MinimalChatView title="hdr" status="complete" entries={[]} />);
    expect(screen.queryByText(/↑/)).toBeNull();
    expect(screen.queryByText(/↓/)).toBeNull();
  });

  it("renders ↑/↓ tokens and formatted duration when meta supplied", () => {
    renderView(
      <MinimalChatView
        title="hdr"
        status="complete"
        entries={[]}
        meta={{ tokens: { input: 1234, output: 567 }, durationMs: 4500 }}
      />,
    );
    expect(screen.getByText(/↑1\.2k/)).toBeTruthy();
    expect(screen.getByText(/↓567/)).toBeTruthy();
    expect(screen.getByText(/4\.5s/)).toBeTruthy();
  });

  it("renders subtitle path under the title in monospace", () => {
    renderView(
      <MinimalChatView
        title="explorer"
        subtitle="~/.pi/agent/agents/Explore.md"
        status="complete"
        entries={[]}
      />,
    );
    const sub = screen.getByText("~/.pi/agent/agents/Explore.md");
    expect(sub).toBeTruthy();
    expect(sub.className).toContain("font-mono");
    expect(sub.getAttribute("title")).toBe("~/.pi/agent/agents/Explore.md");
  });

  it("tool entry without output shows no expand toggle", () => {
    renderView(
      <MinimalChatView
        title="t"
        status="running"
        entries={[{ kind: "tool", toolName: "Read", input: { file_path: "foo.ts" } }]}
      />,
    );
    expect(screen.queryByText("▸")).toBeNull();
    expect(screen.queryByText("▾")).toBeNull();
  });

  it("tool entry with output toggles open on click", () => {
    renderView(
      <MinimalChatView
        title="t"
        status="running"
        entries={[{ kind: "tool", toolName: "Bash", input: { command: "ls" }, output: "abc-output" }]}
      />,
    );
    const toggle = screen.getByText("▸");
    expect(screen.queryByText("abc-output")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("▾")).toBeTruthy();
    expect(screen.getByText("abc-output")).toBeTruthy();
  });

  it("tool entry with isError paints row border and name red", () => {
    const { container } = renderView(
      <MinimalChatView
        title="t"
        status="error"
        entries={[{ kind: "tool", toolName: "Bash", input: {}, isError: true }]}
      />,
    );
    // Border red on row container
    const row = container.querySelector("div.border-l-2");
    expect(row?.className).toContain("border-red-500/50");
    // Name red
    const name = screen.getByText("Bash");
    expect(name.className).toContain("text-red-400");
  });

  it("renders the supplied empty-state message when entries is empty", () => {
    renderView(
      <MinimalChatView
        title="t"
        status="pending"
        entries={[]}
        emptyMessage="Waiting to start..."
      />,
    );
    expect(screen.getByText(/Waiting to start/)).toBeTruthy();
  });

  it("renders footer node below entries", () => {
    renderView(
      <MinimalChatView
        title="t"
        status="complete"
        entries={[]}
        footer={<div data-testid="footer">FOOTER</div>}
      />,
    );
    expect(screen.getByTestId("footer")).toBeTruthy();
  });

  it("throws when rendered without the UiPrimitiveProvider (negative case)", () => {
    // Suppress console.error noise from the rendered error
    const orig = console.error;
    console.error = () => {};
    try {
      expect(() =>
        render(<MinimalChatView title="t" status="running" entries={[]} />),
      ).toThrow();
    } finally {
      console.error = orig;
    }
  });
});
