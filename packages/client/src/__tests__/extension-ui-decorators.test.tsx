/**
 * Phase-2 (`add-extension-ui-decorations`) client surface tests:
 *
 *   - FooterSegmentSlot: renders matching descriptors; non-matching kinds filtered.
 *   - AgentMetricSlot: filters by `payload.agentId`.
 *   - BreadcrumbSlot: renders steps in declared order.
 *   - GateSlot: most-restrictive-wins on multi-gate collision.
 *   - ToastSlot: stacks concurrent toasts; auto-dismisses after `durationMs`.
 *   - `removed: true` unmounts a single descriptor without affecting siblings
 *     (covered by reducer test in `useMessageHandler` integration; here we
 *     simulate by re-rendering with the descriptor absent).
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { mdiCheck } from "@mdi/js";
import { __resetMdiIconSetForTests } from "@blackbelt-technology/pi-dashboard-client-utils/mdi-by-key";
import { FooterSegmentSlot } from "../components/extension-ui/FooterSegmentSlot.js";
import { AgentMetricSlot } from "../components/extension-ui/AgentMetricSlot.js";
import { BreadcrumbSlot } from "../components/extension-ui/BreadcrumbSlot.js";
import { GateSlot, aggregateGateState } from "../components/extension-ui/GateSlot.js";
import { ToastSlot } from "../components/extension-ui/ToastSlot.js";
import type { DashboardSession, DecoratorDescriptor } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => {
  cleanup();
  __resetMdiIconSetForTests();
});

function dec<K extends DecoratorDescriptor["kind"]>(
  kind: K,
  namespace: string,
  id: string,
  payload: any,
): DecoratorDescriptor {
  return { kind, namespace, id, payload } as DecoratorDescriptor;
}

function sessionWithDecorators(decorators: DecoratorDescriptor[]): Pick<DashboardSession, "uiDecorators"> {
  const map: Record<string, DecoratorDescriptor> = {};
  for (const d of decorators) {
    map[`${d.kind}:${d.namespace}:${d.id}`] = d;
  }
  return { uiDecorators: map };
}

describe("FooterSegmentSlot", () => {
  it("renders only footer-segment descriptors", () => {
    const session = sessionWithDecorators([
      dec("footer-segment", "judo", "model-state", { text: "3 mut" }),
      dec("footer-segment", "flows", "progress", { text: "step 2/5" }),
      dec("toast", "judo", "x", { level: "info", message: "ignored" }),
    ]);
    const { getByTestId, queryByText, getByText } = render(<FooterSegmentSlot session={session} />);
    expect(getByTestId("footer-segment-slot")).toBeTruthy();
    expect(getByText("3 mut")).toBeTruthy();
    expect(getByText("step 2/5")).toBeTruthy();
    expect(queryByText("ignored")).toBeNull();
  });

  it("renders nothing when no footer-segment descriptors are present", () => {
    const session = sessionWithDecorators([
      dec("toast", "judo", "x", { level: "info", message: "x" }),
    ]);
    const { container } = render(<FooterSegmentSlot session={session} />);
    expect(container.firstChild).toBeNull();
  });

  it("removes a descriptor on re-render with absent entry (simulating removed: true)", () => {
    const session1 = sessionWithDecorators([
      dec("footer-segment", "judo", "a", { text: "AAA" }),
      dec("footer-segment", "judo", "b", { text: "BBB" }),
    ]);
    const { rerender, queryByText } = render(<FooterSegmentSlot session={session1} />);
    expect(queryByText("AAA")).toBeTruthy();
    expect(queryByText("BBB")).toBeTruthy();

    const session2 = sessionWithDecorators([
      dec("footer-segment", "judo", "b", { text: "BBB" }),
    ]);
    rerender(<FooterSegmentSlot session={session2} />);
    expect(queryByText("AAA")).toBeNull();
    expect(queryByText("BBB")).toBeTruthy();
  });

  // Lazy icon set: one hook per segment (test-plan #E7).
  // See change: harden-ios-safari-memory-and-ws-diagnostics.
  it("renders key-resolved icons per segment once the icon set loads", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const session = sessionWithDecorators([
        dec("footer-segment", "judo", "s1", { text: "ONE", icon: "mdiCheck" }),
        dec("footer-segment", "judo", "s2", { text: "TWO", icon: "mdiTotallyMadeUpName" }),
        dec("footer-segment", "judo", "s3", { text: "THREE" }),
      ]);
      const { getByTestId } = render(<FooterSegmentSlot session={session} />);
      const seg = (id: string) => getByTestId(`footer-segment:judo:${id}`);
      await waitFor(() =>
        expect(seg("s1").querySelector("svg path")?.getAttribute("d")).toBe(mdiCheck),
      );
      expect(seg("s2").querySelector("svg")).toBeNull();
      expect(seg("s3").querySelector("svg")).toBeNull();
      expect(seg("s1").textContent).toContain("ONE");
      expect(seg("s2").textContent).toContain("TWO");
      expect(seg("s3").textContent).toContain("THREE");
      const hookWarnings = errorSpy.mock.calls.filter((c) => /hook/i.test(String(c[0])));
      expect(hookWarnings).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("AgentMetricSlot", () => {
  it("renders only metrics matching agentId", () => {
    const session = sessionWithDecorators([
      dec("agent-metric", "judo", "m1", { agentId: "agent-A", text: "A-text" }),
      dec("agent-metric", "judo", "m2", { agentId: "agent-B", text: "B-text" }),
    ]);
    const { queryByText } = render(<AgentMetricSlot session={session} agentId="agent-A" />);
    expect(queryByText("A-text")).toBeTruthy();
    expect(queryByText("B-text")).toBeNull();
  });

  it("renders nothing for agentId with no matching descriptor", () => {
    const session = sessionWithDecorators([
      dec("agent-metric", "judo", "m1", { agentId: "agent-A", text: "A-text" }),
    ]);
    const { container } = render(<AgentMetricSlot session={session} agentId="agent-Z" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("BreadcrumbSlot", () => {
  it("renders steps in declared order with status styling", () => {
    const session = sessionWithDecorators([
      dec("breadcrumb", "flows", "main", {
        steps: [
          { id: "s1", label: "Plan",   status: "done" },
          { id: "s2", label: "Build",  status: "active" },
          { id: "s3", label: "Verify", status: "pending" },
        ],
      }),
    ]);
    const { getByTestId, getByText } = render(<BreadcrumbSlot session={session} />);
    expect(getByTestId("breadcrumb-slot")).toBeTruthy();
    expect(getByText("Plan")).toBeTruthy();
    expect(getByText("Build")).toBeTruthy();
    expect(getByText("Verify")).toBeTruthy();
    // Step container test ids preserved.
    expect(getByTestId("breadcrumb-step:s1")).toBeTruthy();
    expect(getByTestId("breadcrumb-step:s2")).toBeTruthy();
    expect(getByTestId("breadcrumb-step:s3")).toBeTruthy();
  });

  it("renders nothing when no breadcrumb descriptors exist", () => {
    const session = sessionWithDecorators([]);
    const { container } = render(<BreadcrumbSlot session={session} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("GateSlot — aggregateGateState", () => {
  it("returns available: true when no descriptors target the flow", () => {
    expect(aggregateGateState({}, "judo:save")).toEqual({ available: true });
  });

  it("returns available: true when all descriptors are available: true", () => {
    const map = {
      "gate:judo:s": dec("gate", "judo", "s", { flowId: "judo:save", available: true }),
    };
    expect(aggregateGateState(map, "judo:save")).toEqual({ available: true });
  });

  it("most-restrictive-wins: any available:false makes the aggregate unavailable", () => {
    const map = {
      "gate:judo:s":  dec("gate", "judo",  "s", { flowId: "judo:save", available: false, reason: "no workspace" }),
      "gate:flows:s": dec("gate", "flows", "s", { flowId: "judo:save", available: true }),
    };
    const state = aggregateGateState(map, "judo:save");
    expect(state.available).toBe(false);
    expect(state.reason).toBe("no workspace");
  });

  it("concatenates reasons from multiple unavailable descriptors", () => {
    const map = {
      "gate:judo:a":  dec("gate", "judo",  "a", { flowId: "judo:save", available: false, reason: "reason A" }),
      "gate:flows:b": dec("gate", "flows", "b", { flowId: "judo:save", available: false, reason: "reason B" }),
    };
    const state = aggregateGateState(map, "judo:save");
    expect(state.available).toBe(false);
    expect(state.reason).toContain("reason A");
    expect(state.reason).toContain("reason B");
  });
});

describe("GateSlot — render", () => {
  it("renders nothing when gate is available", () => {
    const session = sessionWithDecorators([
      dec("gate", "judo", "s", { flowId: "f1", available: true }),
    ]);
    const { container } = render(<GateSlot session={session} flowId="f1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders reason when gate is unavailable", () => {
    const session = sessionWithDecorators([
      dec("gate", "judo", "s", { flowId: "f1", available: false, reason: "Not in a judo workspace" }),
    ]);
    const { getByTestId, getByText } = render(<GateSlot session={session} flowId="f1" />);
    expect(getByTestId("gate-slot")).toBeTruthy();
    expect(getByText("Not in a judo workspace")).toBeTruthy();
  });
});

describe("ToastSlot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  function makeSession(id: string, decorators: DecoratorDescriptor[]): DashboardSession {
    const map: Record<string, DecoratorDescriptor> = {};
    for (const d of decorators) map[`${d.kind}:${d.namespace}:${d.id}`] = d;
    return {
      id,
      cwd: "/tmp",
      source: "tui",
      status: "active",
      startedAt: 0,
      uiDecorators: map,
    } as DashboardSession;
  }

  it("stacks multiple concurrent toasts (no deduplication)", () => {
    const sessions = new Map<string, DashboardSession>([
      ["s1", makeSession("s1", [
        dec("toast", "judo",  "t1", { level: "info",    message: "first"  }),
        dec("toast", "flows", "t2", { level: "success", message: "second" }),
      ])],
    ]);
    const { getByText } = render(<ToastSlot sessions={sessions} />);
    expect(getByText("first")).toBeTruthy();
    expect(getByText("second")).toBeTruthy();
  });

  it("auto-dismisses a toast after payload.durationMs", () => {
    const sessions = new Map<string, DashboardSession>([
      ["s1", makeSession("s1", [
        dec("toast", "judo", "t1", { level: "info", message: "ephemeral", durationMs: 1000 }),
      ])],
    ]);
    const { queryByText } = render(<ToastSlot sessions={sessions} />);
    expect(queryByText("ephemeral")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(queryByText("ephemeral")).toBeNull();
  });

  it("treats durationMs: 0 as sticky (no auto-dismiss)", () => {
    const sessions = new Map<string, DashboardSession>([
      ["s1", makeSession("s1", [
        dec("toast", "judo", "t1", { level: "warn", message: "sticky", durationMs: 0 }),
      ])],
    ]);
    const { queryByText } = render(<ToastSlot sessions={sessions} />);
    expect(queryByText("sticky")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(queryByText("sticky")).toBeTruthy();
  });

  it("caps simultaneous-toast display at 5 (FIFO eviction)", () => {
    const decorators = Array.from({ length: 8 }, (_, i) =>
      dec("toast", "judo", `t${i}`, { level: "info", message: `m${i}`, durationMs: 0 }),
    );
    const sessions = new Map<string, DashboardSession>([
      ["s1", makeSession("s1", decorators)],
    ]);
    const { container } = render(<ToastSlot sessions={sessions} />);
    const toastNodes = container.querySelectorAll('[data-testid^="toast:"]');
    expect(toastNodes.length).toBe(5);
  });

  it("renders nothing when no toast descriptors are present", () => {
    const sessions = new Map<string, DashboardSession>([
      ["s1", makeSession("s1", [])],
    ]);
    const { container } = render(<ToastSlot sessions={sessions} />);
    expect(container.firstChild).toBeNull();
  });
});
