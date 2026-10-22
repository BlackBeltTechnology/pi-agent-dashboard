/**
 * SubagentDockGroup — the subagents plugin's `composer-dock-process-group` claim.
 * Rows mode lists running + pending subagents via `ComposerDockRow`; summary
 * mode renders no DOM and reports `{ count, noun }`.
 *
 * See change: add-composer-dock (task 3.3, test-plan #E25).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentState } from "../types.js";

let subagents: ReadonlyMap<string, SubagentState> = new Map();

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blackbelt-technology/dashboard-plugin-runtime")>()),
  useSessionSubagents: () => subagents,
}));

const { SubagentDockGroup } = await import("../SubagentDockGroup.js");

const NOW = new Date("2026-01-01T00:00:00.000Z").getTime();
const session = { id: "s1", cwd: "/repo", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

function sub(over: Partial<SubagentState> & { id: string }): SubagentState {
  return { type: "Explore", description: "Map the repo", status: "running", ...over };
}

function mapOf(...states: SubagentState[]): ReadonlyMap<string, SubagentState> {
  return new Map(states.map((s) => [s.id, s]));
}

function renderGroup(mode: "summary" | "rows", reportSummary = vi.fn()) {
  const view = render(
    <SubagentDockGroup session={session} pluginContext={{}} mode={mode} reportSummary={reportSummary} />,
  );
  return { ...view, reportSummary };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  subagents = new Map();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SubagentDockGroup — rows mode", () => {
  it("renders a running subagent: name, task, role · steps, elapsed, Open link", () => {
    subagents = mapOf(
      sub({
        id: "a1",
        displayName: "explorer",
        description: "Map the repo",
        startedAt: NOW - 12_000,
        entries: [
          { kind: "text", text: "a", ts: 1 },
          { kind: "text", text: "b", ts: 2 },
          { kind: "text", text: "c", ts: 3 },
        ],
      }),
    );
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-title").textContent).toBe("explorer");
    expect(screen.getByTestId("composer-dock-row-detail").textContent).toBe("Map the repo");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Explore · 3 steps");
    expect(screen.getByTestId("composer-dock-row-elapsed").textContent).toBe("12s");
    const open = screen.getByRole("link", { name: /Open subagent explorer/ });
    expect(open.getAttribute("href")).toBe("/session/s1/subagent/a1");
  });

  it("marks a not-yet-started subagent `pending` with no elapsed time (#E25)", () => {
    subagents = mapOf(sub({ id: "a2", status: "created", displayName: "queued-one" }));
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("pending");
    expect(screen.queryByTestId("composer-dock-row-elapsed")).toBeNull();
    expect(screen.getByRole("link", { name: /Open subagent queued-one/ }).getAttribute("href")).toBe(
      "/session/s1/subagent/a2",
    );
  });

  it("falls back to the type for the name and omits steps when there are none", () => {
    subagents = mapOf(sub({ id: "a3", type: "general-purpose", startedAt: NOW }));
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-title").textContent).toBe("general-purpose");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("general-purpose");
  });

  it("lists only running and pending subagents, once each even when dual-indexed", () => {
    const running = sub({ id: "a1", agentSessionId: "sess-a1", startedAt: NOW });
    subagents = new Map<string, SubagentState>([
      ["a1", running],
      ["sess-a1", running],
      ["a2", sub({ id: "a2", status: "completed" })],
      ["a3", sub({ id: "a3", status: "failed" })],
      ["a4", sub({ id: "a4", status: "created" })],
    ]);
    renderGroup("rows");
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(2);
  });

  it("renders nothing with zero subagents", () => {
    const { container } = renderGroup("rows");
    expect(container.innerHTML).toBe("");
  });
});

describe("SubagentDockGroup — summary mode", () => {
  it("renders no DOM and reports the active count", () => {
    subagents = mapOf(sub({ id: "a1" }), sub({ id: "a2", status: "created" }), sub({ id: "a3", status: "completed" }));
    const { container, reportSummary } = renderGroup("summary");
    expect(container.innerHTML).toBe("");
    expect(reportSummary).toHaveBeenCalledTimes(1);
    expect(reportSummary).toHaveBeenCalledWith({ count: 2, noun: "subagents" });
  });

  it("agrees the noun with the count (1 → subagent)", () => {
    subagents = mapOf(sub({ id: "a1" }));
    const { reportSummary } = renderGroup("summary");
    expect(reportSummary).toHaveBeenCalledWith({ count: 1, noun: "subagent" });
  });

  it("reports null with zero subagents", () => {
    const { container, reportSummary } = renderGroup("summary");
    expect(container.innerHTML).toBe("");
    expect(reportSummary).toHaveBeenCalledTimes(1);
    expect(reportSummary).toHaveBeenCalledWith(null);
  });

  it("re-reports on a count change but not on an unrelated re-render", () => {
    subagents = mapOf(sub({ id: "a1" }));
    const reportSummary = vi.fn();
    const { rerender } = renderGroup("summary", reportSummary);
    // A fresh `reportSummary` identity per render must not loop or re-report.
    rerender(
      <SubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={(s) => reportSummary(s)} />,
    );
    expect(reportSummary).toHaveBeenCalledTimes(1);
    subagents = mapOf(sub({ id: "a1" }), sub({ id: "a2" }));
    rerender(
      <SubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={(s) => reportSummary(s)} />,
    );
    expect(reportSummary).toHaveBeenCalledTimes(2);
    expect(reportSummary).toHaveBeenLastCalledWith({ count: 2, noun: "subagents" });
  });

  it("starts no ticking timer (no DOM, no elapsed)", () => {
    subagents = mapOf(sub({ id: "a1", startedAt: NOW }));
    renderGroup("summary");
    expect(vi.getTimerCount()).toBe(0);
  });
});
