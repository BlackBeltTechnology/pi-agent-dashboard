/**
 * #F4 (repair-tool-error-surfaces) — the subagent error line is the fifth of the
 * five single-line error surfaces. `AgentToolRenderer` had no sibling unit test
 * before this change; this file is the first, modelled on
 * `AskUserToolRenderer.test.tsx`.
 *
 * The line splits its two roles the way the governed rule requires: the `Error:`
 * marker carries the severity accent, the message itself stays in normal text
 * colours, and no raw red literal may re-enter either.
 */
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { AgentToolRenderer } from "../AgentToolRenderer.js";
import type { ToolContext } from "../index.js";

const ctx: ToolContext = { cwd: "/r" };

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function renderAgent(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const erroredAgent = (
  <AgentToolRenderer
    toolName="Agent"
    args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
    status="error"
    result="boom"
    toolDetails={{ status: "error", error: "subagent crashed", displayName: "Explore" }}
    context={ctx}
  />
);

describe("AgentToolRenderer — error line severity tokens", () => {
  it("#F4 the `Error:` marker takes the accent and the message stays neutral", () => {
    const { getByText } = renderAgent(erroredAgent);

    const marker = getByText("Error:") as HTMLElement;
    expect(marker.className).toContain("text-[var(--severity-error-fg)]");

    // The message is a sibling of the marker inside a neutral-coloured line.
    const line = marker.parentElement as HTMLElement;
    expect(line.className).toContain("text-[var(--text-secondary)]");
    expect(line.textContent).toContain("subagent crashed");
  });

  it("a completed agent renders no error line at all", () => {
    const { queryByText, getByText } = renderAgent(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
        status="complete"
        result="done"
        // `AgentDetails.status` vocabulary is "completed" — NOT "complete", which
        // is the separate `ToolRendererProps.status` value. Using the wrong one
        // here silently lands on the stopped fallback, so the assertion would
        // pass without ever exercising the completed branch.
        toolDetails={{ status: "completed", displayName: "Explore" }}
        context={ctx}
      />,
    );
    expect(getByText("Explore")).toBeTruthy(); // the completed card did render
    expect(queryByText("Error:")).toBeNull();
  });

  it("renders without toolDetails instead of throwing", () => {
    expect(() =>
      renderAgent(
        <AgentToolRenderer
          toolName="Agent"
          args={{ subagent_type: "Explore", prompt: "go" }}
          status="running"
          context={ctx}
        />,
      ),
    ).not.toThrow();
  });

  it("#F4 no raw red literal survives in the governed error line", () => {
    const { getByText } = renderAgent(erroredAgent);
    // Scoped to the error LINE, which is what this change governs. The
    // surrounding `AgentCardShell` frame still ships `border-red-500/30` +
    // `text-red-400`; those sit in the ~40 literals the proposal defers as
    // deliberately out of scope, so asserting over the whole card here would
    // silently widen this change into a repo-wide sweep.
    const line = (getByText("Error:") as HTMLElement).parentElement as HTMLElement;
    // `innerHTML` excludes the element's OWN class attribute, so a raw red added
    // to the line itself would slip through — assert on both.
    expect(line.className).not.toMatch(/\bred-\d{2,3}\b/);
    expect(line.innerHTML).not.toMatch(/\bred-\d{2,3}\b/);
  });
});

/**
 * `elided` on a subagent row — the CodeRabbit-found gap in D5's renderer audit.
 *
 * `toolDetails` SURVIVES on a spliced row, so a backfilled subagent whose end
 * never arrived still carries `details.status` from the last frame the window
 * delivered. The first fix checked `elided` only in the no-details branch,
 * which left exactly the case the design calls most likely — subagent rows are
 * the likeliest to be windowed — rendering a spinner or a completed card for a
 * result that is not loaded.
 * See change: fix-lazy-history-backfill-ux (D5).
 */
describe("AgentToolRenderer — elided outranks details.status", () => {
  const elidedWith = (details: Record<string, unknown> | undefined) => (
    <AgentToolRenderer
      toolName="Agent"
      args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
      status="elided"
      toolDetails={details}
      context={ctx}
    />
  );

  it("renders no spinner when stale details still say running", () => {
    const { container } = renderAgent(elidedWith({ status: "running", displayName: "Explore" }));
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("does not render a completed card when stale details say completed", () => {
    const { container } = renderAgent(elidedWith({ status: "completed", displayName: "Explore" }));
    // The green completion accent must not be claimed for an unloaded result.
    expect(container.querySelector(".text-green-400")).toBeNull();
  });

  it("still renders neutrally with no details at all", () => {
    const { container } = renderAgent(elidedWith(undefined));
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.textContent).toMatch(/result not loaded/i);
  });

  it("CONTROL: a genuinely running agent DOES render the spinner", () => {
    const { container } = renderAgent(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", description: "d", prompt: "go" }}
        status="running"
        toolDetails={{ status: "running", displayName: "Explore" }}
        context={ctx}
      />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});
