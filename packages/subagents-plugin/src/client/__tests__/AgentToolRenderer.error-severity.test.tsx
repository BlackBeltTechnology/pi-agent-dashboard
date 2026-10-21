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
import { AgentToolRenderer, type ToolContext, withHostPrimitives } from "./agent-test-harness.js";

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
  return render(withHostPrimitives(ui));
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

// See change: stream-subagent-reasoning-and-stable-card (#F1, #F3, #X2).
describe("AgentToolRenderer — stable running card + live preview", () => {
  const running = (extra: Record<string, unknown>, context: ToolContext = ctx) => (
    <AgentToolRenderer
      toolName="Agent"
      args={{ subagent_type: "Explore", description: "find", prompt: "go" }}
      status="running"
      toolDetails={{ status: "running", displayName: "Explore", agentId: "ag1", ...extra }}
      context={context}
    />
  );
  const rows = (c: HTMLElement) => ({
    activity: c.querySelector('[data-testid="agent-activity-row"]') as HTMLElement | null,
    preview: c.querySelector('[data-testid="agent-live-preview"]') as HTMLElement | null,
  });

  it("#F1 one fixed-height activity row is always mounted with identical classes (card option C)", () => {
    const variants = [
      { activity: "running Read", liveTail: { kind: "thinking", text: "hmm" } },
      { liveTail: { kind: "none", text: "" } },
      { activity: "writing", liveTail: { kind: "text", text: "hello" } },
      {},
    ];
    const seen = variants.map((v) => {
      const { container, unmount } = renderAgent(running(v));
      const r = rows(container);
      expect(r.activity).not.toBeNull();
      const cls = r.activity!.className;
      unmount();
      return cls;
    });
    for (const s of seen) expect(s).toBe(seen[0]);
    expect(seen[0]).toContain("h-4");
  });

  it("#F1 ticker shows the current sentence of a live tail inside the activity row", () => {
    const { container } = renderAgent(running({ activity: "running Read", liveTail: { kind: "thinking", text: "Done with that. Now batching ctx calls" } }));
    const r = rows(container);
    expect(r.preview!.textContent).toBe("Now batching ctx calls");
    expect(r.preview!.getAttribute("data-kind")).toBe("thinking");
    expect(r.activity!.contains(r.preview!)).toBe(true);
  });

  it("#F1 without a tail the row shows the activity", () => {
    const { container } = renderAgent(running({ activity: "running Read" }));
    expect(rows(container).preview).toBeNull();
    expect(rows(container).activity!.textContent).toContain("running Read");
  });

  it("#F3 the session-map tail (resync) wins over toolDetails; a cleared tail holds the last text", async () => {
    const { sessionEventReducer } = await import("../sessionEventReducer.js");
    const frame = (liveTail: Record<string, unknown>) => ({
      eventType: "subagent_started",
      timestamp: 1,
      data: { id: "ag1", details: { agentId: "ag1", status: "running", liveTail } },
    });
    const s1 = sessionEventReducer.reduce({ subagents: new Map() }, frame({ kind: "thinking", text: "xyz" }));
    const s2 = sessionEventReducer.reduce(s1, frame({ kind: "none", text: "" }));
    const card = (session: unknown) =>
      running({ liveTail: { kind: "thinking", text: "abc" } }, { ...ctx, session } as ToolContext);
    const { container, rerender } = renderAgent(card(s1));
    expect(rows(container).preview!.textContent).toBe("xyz");
    rerender(withHostPrimitives(card(s2)));
    expect(rows(container).preview!.textContent).toBe("xyz");
  });

  // Review B1: the session-less fallback reads raw `details.liveTail`; it must
  // be normalized exactly like the reducer (D8) before reaching the ticker.
  it.each([
    ["non-string text", { kind: "thinking", text: 1 }],
    ["unknown kind", { kind: "x", text: "abc" }],
    ["array", ["thinking", "abc"]],
  ])("#B1 a malformed raw tail (%s) renders the activity row, no ticker, no throw", (_label, liveTail) => {
    const { container } = renderAgent(running({ activity: "running Read", liveTail }));
    expect(rows(container).preview).toBeNull();
    expect(rows(container).activity!.textContent).toContain("running Read");
  });

  it("#B1 an overlong raw tail is capped to the last 280 chars before the ticker", () => {
    const text = `${"a".repeat(300)}${"b".repeat(100)}`;
    const { container } = renderAgent(running({ liveTail: { kind: "text", text } }));
    const shown = rows(container).preview!.textContent ?? "";
    expect(shown.length).toBeLessThanOrEqual(280);
    expect(shown.endsWith("b".repeat(100))).toBe(true);
  });

  it("#X2 0.2.6-shaped details (no liveTail) render the activity row, no ticker", () => {
    const { container } = renderAgent(running({ activity: "running Read" }));
    expect(rows(container).preview).toBeNull();
    expect(rows(container).activity!.className).toContain("h-4");
  });
});

// See change: stream-subagent-reasoning-and-stable-card (task 5.3).
describe("AgentToolRenderer — thinking level in stats", () => {
  const card = (extra: Record<string, unknown>) => (
    <AgentToolRenderer
      toolName="Agent"
      args={{ subagent_type: "Explore", prompt: "go" }}
      status="running"
      toolDetails={{ status: "running", displayName: "Explore", modelName: "glm-5.3-flash", ...extra }}
      context={ctx}
    />
  );
  it("shows 'thinking high' after the model", () => {
    const { container } = renderAgent(card({ thinkingLevel: "high" }));
    expect(container.textContent).toContain("glm-5.3-flash · thinking high");
  });
  it("omits the segment when absent", () => {
    const { container } = renderAgent(card({}));
    expect(container.textContent).not.toContain("thinking ");
  });
});

describe("AgentToolRenderer — ticker hold, expanded, no early resync", () => {
  const card = (liveTail: Record<string, unknown>, context: ToolContext = ctx) => (
    <AgentToolRenderer
      toolName="Agent"
      args={{ subagent_type: "Explore", prompt: "go" }}
      status="running"
      toolDetails={{ status: "running", displayName: "Explore", activity: "running Read", agentId: "ag1", liveTail }}
      context={context}
    />
  );
  const ticker = (c: HTMLElement) => c.querySelector('[data-testid="agent-live-preview"]') as HTMLElement | null;
  const row = (c: HTMLElement) => c.querySelector('[data-testid="agent-activity-row"]') as HTMLElement;

  it("keeps the last sentence visible after the tail clears", () => {
    const { container, rerender } = renderAgent(card({ kind: "text", text: "abc" }));
    rerender(withHostPrimitives(card({ kind: "none", text: "" })));
    expect(ticker(container)?.textContent).toBe("abc");
  });

  it("shows the activity (not the ticker) while the inline inspector is open; row stays mounted", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { container, getByText } = renderAgent(card({ kind: "text", text: "abc" }));
    expect(ticker(container)?.textContent).toBe("abc");
    fireEvent.click(getByText("Details"));
    expect(ticker(container)).toBeNull();
    expect(row(container).textContent).toContain("running Read");
  });

  it("A: a clearing tail sends no extra resync request", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const send = vi.fn();
    const session = { subagents: new Map([["ag1", { id: "ag1", type: "Explore", description: "", status: "running", entries: [{ kind: "text", text: "x", ts: 1 }] }]]) };
    const context = { ...ctx, sessionId: "s1", session, send } as unknown as ToolContext;
    const wrap = (ui: React.ReactElement) => withHostPrimitives(ui);
    const { getByText, rerender } = render(wrap(card({ kind: "thinking", text: "hmm" }, context)));
    fireEvent.click(getByText("Details"));
    const before = send.mock.calls.length;
    rerender(wrap(card({ kind: "none", text: "" }, context)));
    expect(send.mock.calls.length).toBe(before);
  });
});

// Healed Agent rows show the subagent's real result instead of the heal
// placeholder (superseded + session_ended); a real end keeps the tool result.
// See change: add-plugin-bridge-contributions (D10, test-plan #E22).
describe("AgentToolRenderer — healed card shows the subagent result", () => {
  const healedCtx = (subResult?: string): ToolContext => ({
    cwd: "/r",
    sessionId: "s1",
    session: {
      subagents: new Map([
        [
          "ag1",
          { id: "ag1", type: "Explore", description: "d", status: "completed", ...(subResult ? { result: subResult } : {}) },
        ],
      ]),
    },
  });
  const card = (healedBy: string | undefined, ctxValue: ToolContext, result = "result unavailable — recovered by supersede heal") => (
    <AgentToolRenderer
      toolName="Agent"
      args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
      status="complete"
      result={result}
      toolDetails={{ status: "completed", agentId: "ag1", displayName: "Explore", ...(healedBy ? { healedBy } : {}) }}
      context={ctxValue}
    />
  );

  for (const healedBy of ["superseded", "session_ended"]) {
    it(`${healedBy} heal + subagent result → renders the subagent result`, () => {
      const { queryByText, getByText } = renderAgent(card(healedBy, healedCtx("Done. Wrote x.md")));
      expect(getByText(/Done\. Wrote x\.md/)).toBeTruthy();
      expect(queryByText(/recovered by supersede heal/)).toBeNull();
    });
  }

  it("heal without a subagent result keeps the placeholder", () => {
    const { getByText } = renderAgent(card("superseded", healedCtx()));
    expect(getByText(/recovered by supersede heal/)).toBeTruthy();
  });

  it("a real end keeps the tool result even when the subagent has one", () => {
    const { getByText, queryByText } = renderAgent(card(undefined, healedCtx("from subagent"), "from tool"));
    expect(getByText(/from tool/)).toBeTruthy();
    expect(queryByText(/from subagent/)).toBeNull();
  });
});

// See change: finalize-agent-card-on-subagent-stop (test-plan F7, F8, F10).
vi.mock("@blackbelt-technology/pi-dashboard-subagents-plugin/client", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  SubagentDetailView: () => <div data-testid="subagent-detail-view" />,
}));

const sub = (over: Record<string, unknown>) =>
  new Map([["ag", { id: "ag", type: "Explore", description: "d", ...over }]]);

describe("AgentToolRenderer — finalized by subagent stop", () => {
  it("a healed completion renders done with the subagent's result (F7)", () => {
    const { container, getByText } = renderAgent(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
        status="complete"
        result="subagent finished"
        toolDetails={{ agentId: "ag", status: "completed", healedBy: "subagent_stopped", displayName: "Explore" }}
        context={{ ...ctx, session: { subagents: sub({ status: "completed", result: "done A" }) } } as unknown as ToolContext}
      />,
    );
    expect(container.querySelector('[data-testid="agent-activity-row"]')).toBeNull();
    expect(getByText(/done A/)).toBeTruthy();
  });

  it("a healed failure renders the error branch (F8)", () => {
    const { container, getByText } = renderAgent(
      <AgentToolRenderer
        toolName="Agent"
        args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
        status="error"
        result="boom"
        toolDetails={{ agentId: "ag", status: "error", error: "boom", healedBy: "subagent_stopped", displayName: "Explore" }}
        context={ctx}
      />,
    );
    expect(container.querySelector('[data-testid="agent-activity-row"]')).toBeNull();
    expect(getByText("Error:").parentElement?.textContent).toContain("boom");
  });

  it("a finalized card stops the resync cadence while its subagent is still recorded running (F10)", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const { getByTitle } = renderAgent(
        <AgentToolRenderer
          toolName="Agent"
          args={{ subagent_type: "Explore", description: "find the thing", prompt: "go" }}
          status="complete"
          result="subagent stopped — result not received"
          toolDetails={{ agentId: "ag", status: "completed", healedBy: "turn_settled", resultMissing: true, displayName: "Explore" }}
          context={{ ...ctx, sessionId: "s1", send, session: { subagents: sub({ status: "running", entries: [{ kind: "text", text: "x" }] }) } } as unknown as ToolContext}
        />,
      );
      const { fireEvent, act } = await import("@testing-library/react");
      fireEvent.click(getByTitle("Expand to inspect tool calls & messages"));
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      const cadence = send.mock.calls.filter(([m]) => m?.type === "subagent_resync_request" && m?.reason === "cadence");
      expect(cadence).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
