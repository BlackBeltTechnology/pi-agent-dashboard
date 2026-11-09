/**
 * Queued / stopped card presentation + per-subagent stop (producer ≥ 0.6.0).
 *
 * Covers test-plan #E1-#E4 (queued card, older producer, slot reading guard,
 * wait vs run time), #E7 (claim stop + stopLabel), #E11 (stopped card copy),
 * #X1-#X3 (stop refused, not confirmed, terminal frame clears pending).
 *
 * The card has no stop control of its own: the stop starts from the chat row
 * (claim `agentStop`) and the card shows the feedback only.
 *
 * See change: subagent-queue-visibility.
 * See change: drop-subagent-card-stop-button.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSubagentStopsForTests,
  agentRowStatus,
  agentStop,
  agentStopLabel,
  STOP_CONFIRM_TIMEOUT_MS,
} from "../subagentStop.js";
import type { SubagentState } from "../types.js";
import { AgentToolRenderer, withHostPrimitives } from "./agent-test-harness.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

const SID = "sess-1";
const session = { subagents: new Map<string, SubagentState>() };

function card(details: Record<string, unknown>, status: "running" | "complete" = "running") {
  return withHostPrimitives(
    <AgentToolRenderer
      toolName="Agent"
      status={status}
      args={{ description: "probe", subagent_type: "Explore" }}
      toolDetails={{ agentId: "ag-1", displayName: "Explore", ...details }}
      context={{ sessionId: SID, session }}
    />,
  );
}

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = global.fetch;
  __resetSubagentStopsForTests();
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  cleanup();
});

describe("queued card (#E1-#E3)", () => {
  it("#E1 with producer queue info: position, slot reading, wait time, no spinner, popout disabled", () => {
    const { container } = render(card({ status: "queued", queuePosition: 2, activeSlots: 4, maxConcurrent: 4, durationMs: 1000 }));
    expect(screen.getByTestId("agent-queue-pill").textContent).toBe("#2 in queue");
    expect(screen.getByTestId("agent-slot-reading").textContent).toBe("4/4");
    expect(screen.getByTestId("agent-wait-time")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.innerHTML).not.toMatch(/border-yellow-500/);
    expect(container.innerHTML).toMatch(/border-dashed/);
    const popout = screen.getByRole("button", { name: /popout/i }) as HTMLButtonElement;
    expect(popout.disabled).toBe(true);
  });

  it("#E1 position update re-renders #1", () => {
    const { rerender } = render(card({ status: "queued", queuePosition: 2 }));
    rerender(card({ status: "queued", queuePosition: 1 }));
    expect(screen.getByTestId("agent-queue-pill").textContent).toBe("#1 in queue");
  });

  it("#E2 older producer: Queued, no slot reading, no spinner", () => {
    const { container } = render(card({ status: "queued" }));
    expect(screen.getByTestId("agent-queue-pill").textContent).toBe("Queued");
    expect(screen.queryByTestId("agent-slot-reading")).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByTestId("agent-stop-button")).toBeNull(); // not stoppable
    expect(screen.queryAllByTestId("agent-stop-row")).toHaveLength(0);
  });

  it.each(["queued", "running"])("#E1 stoppable %s card with no stop requested: no card stop button, no stop line", (status) => {
    render(card({ status, stoppable: true, queuePosition: 1 }));
    expect(screen.queryAllByTestId("agent-stop-button")).toHaveLength(0);
    expect(screen.queryAllByTestId("agent-stop-row")).toHaveLength(0);
  });

  it.each([
    [0, null],
    [undefined, null],
    [1, "1/1"],
  ])("#E3 maxConcurrent=%s with activeSlots:1 → slot reading %s", (maxConcurrent, expected) => {
    render(card({ status: "queued", queuePosition: 1, activeSlots: 1, ...(maxConcurrent === undefined ? {} : { maxConcurrent }) }));
    const reading = screen.queryByTestId("agent-slot-reading");
    expect(reading?.textContent ?? null).toBe(expected);
  });
});

describe("wait vs run time (#E4)", () => {
  it("running with slotGrantedAt counts from the grant, not from call creation", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { rerender } = render(card({ status: "queued", durationMs: 100_000 }));
    // Wait time is labelled as such (stub badge prints startedAt).
    expect(screen.getByTestId("agent-wait-time").textContent).toContain(String(now - 100_000));
    rerender(card({ status: "running", durationMs: 105_000, slotGrantedAt: now - 5000 }));
    expect(screen.getByTestId("agent-run-time").textContent).toBe(String(now - 5000));
    expect(screen.queryByTestId("agent-wait-time")).toBeNull();
  });

  it("running without slotGrantedAt falls back to today's durationMs timer", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    render(card({ status: "running", durationMs: 7000 }));
    expect(screen.getByTestId("agent-run-time").textContent).toBe(String(now - 7000));
  });
});

describe("claim stop + stopLabel (#E7)", () => {
  it.each([
    [true, "queued", "ag-1", true, "Remove from queue"],
    [true, "running", "ag-1", true, "Stop subagent"],
    [true, "running", undefined, false, "Stop (ends the whole turn)"],
    [undefined, "queued", "ag-1", false, "Stop (ends the whole turn)"],
    [undefined, "running", "ag-1", false, "Stop (ends the whole turn)"],
  ])("stoppable=%s status=%s agentId=%s → stop()=%s, label %s", (stoppable, status, agentId, handled, label) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const toolDetails = { status, ...(stoppable === undefined ? {} : { stoppable }), ...(agentId ? { agentId } : {}) };
    expect(agentStop({ sessionId: SID, toolCallId: "tc-1", toolDetails })).toBe(handled);
    expect(fetchMock).toHaveBeenCalledTimes(handled ? 1 : 0);
    if (handled) {
      expect(fetchMock.mock.calls[0][0]).toBe("/api/plugins/subagents/stop");
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ sessionId: SID, agentId });
    }
    expect(agentStopLabel(toolDetails)).toBe(label);
  });

  it("a second stop while pending is consumed without a second POST", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const toolDetails = { status: "running", stoppable: true, agentId: "ag-1" };
    expect(agentStop({ sessionId: SID, toolCallId: "tc-1", toolDetails })).toBe(true);
    expect(agentStop({ sessionId: SID, toolCallId: "tc-1", toolDetails })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("row status (claim rowStatus)", () => {
  it("queued → queued · #n; older producer → queued", () => {
    expect(agentRowStatus({ status: "queued", queuePosition: 2 }, undefined)).toEqual({ state: "queued", label: "queued · #2" });
    expect(agentRowStatus({ status: "queued" }, undefined)).toEqual({ state: "queued", label: "queued" });
  });

  it("stopped from the row details or from the subagent map", () => {
    expect(agentRowStatus({ status: "stopped", stopReason: "queued" }, undefined)?.state).toBe("stopped");
    const s = { subagents: new Map([["ag-1", { status: "stopped", stopReason: "running" }]]) };
    expect(agentRowStatus({ status: "completed", agentId: "ag-1" }, s)?.state).toBe("stopped");
    expect(agentRowStatus({ status: "running" }, undefined)).toBeUndefined();
    expect(agentRowStatus(undefined, undefined)).toBeUndefined();
  });
});

describe("stopped card (#E11)", () => {
  it("removed while queued", () => {
    const { container } = render(card({ status: "stopped", stopReason: "queued" }, "complete"));
    expect(screen.getByTestId("agent-stopped-note").textContent).toBe("removed from queue · never started");
    expect(container.innerHTML).not.toMatch(/border-red-500|text-green-400/);
  });

  it("stopped while running shows its run time", () => {
    render(card({ status: "stopped", stopReason: "running", durationMs: 12_000 }, "complete"));
    expect(screen.getByTestId("agent-stopped-note").textContent).toBe("stopped by you · ran 12.0s");
  });
});

describe("card stop feedback (#X1-#X3)", () => {
  const running = { status: "running", stoppable: true, durationMs: 1000 };
  /** Start the stop the way the chat row ■ does: through the claim `stop`. */
  async function rowStop() {
    await act(async () => {
      expect(agentStop({ sessionId: SID, toolCallId: "tc-1", toolDetails: { agentId: "ag-1", ...running } })).toBe(true);
      await Promise.resolve();
    });
  }

  it("#X1 a refused row stop shows the reason on the card", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "operate authority required" }), { status: 403 }),
    ) as unknown as typeof fetch;
    render(card(running));
    await rowStop();
    expect(screen.getByTestId("agent-stop-error").textContent).toMatch(/operate authority required/);
    expect(screen.queryAllByTestId("agent-stop-button")).toHaveLength(0);
  });

  it("#X2 stopping… until 10 s, then stop not confirmed", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) as unknown as typeof fetch;
    render(card(running));
    await rowStop();
    expect(screen.getByTestId("agent-stop-pending")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(STOP_CONFIRM_TIMEOUT_MS - 100);
    });
    expect(screen.getByTestId("agent-stop-pending")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId("agent-stop-pending")).toBeNull();
    expect(screen.getByTestId("agent-stop-unconfirmed")).toBeTruthy();
  });

  it("#X3 a terminal frame clears a pending stop", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const { rerender } = render(card(running));
    await rowStop();
    expect(screen.getByTestId("agent-stop-pending")).toBeTruthy();
    rerender(card({ status: "completed", durationMs: 2000 }, "complete"));
    expect(screen.queryByTestId("agent-stop-pending")).toBeNull();
    // Back to running (a hypothetical reuse) shows no stale notice either.
    rerender(card(running));
    expect(screen.queryByTestId("agent-stop-pending")).toBeNull();
    expect(screen.queryByTestId("agent-stop-unconfirmed")).toBeNull();
    expect(screen.queryAllByTestId("agent-stop-row")).toHaveLength(0);
  });
});

// See change: show-background-subagents-in-dock (tasks 4.3, 4.5; test-plan #F1, #F3).
describe("dock row Stop shares the card's stop state", () => {
  it("#F1 dock Stop then chat-row stop: one POST, card shows stopping…, no abort", async () => {
    const { SubagentDockRow } = await import("../SubagentDockGroup.js");
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const running = { status: "running", stoppable: true, durationMs: 1000 };
    render(
      withHostPrimitives(
        <>
          <AgentToolRenderer
            toolName="Agent"
            status="running"
            args={{ description: "probe", subagent_type: "Explore" }}
            toolDetails={{ agentId: "C094", displayName: "Explore", ...running }}
            context={{ sessionId: SID, session }}
          />
          <SubagentDockRow
            sessionId={SID}
            sub={{ id: "C094", type: "Explore", description: "probe", status: "running", stoppable: true }}
          />
        </>,
      ),
    );
    await act(async () => {
      screen.getByRole("button", { name: "Stop subagent Explore" }).click();
    });
    await act(async () => {
      expect(agentStop({ sessionId: SID, toolCallId: "tc-1", toolDetails: { agentId: "C094", ...running } })).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/plugins/subagents/stop");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ sessionId: SID, agentId: "C094" });
    expect(screen.getByTestId("agent-stop-pending").textContent).toBe("stopping…");
  });

  it("#F3 a pending background stop shows on the dock row, never on the started card", async () => {
    const { SubagentDockRow } = await import("../SubagentDockGroup.js");
    const { requestSubagentStop } = await import("../subagentStop.js");
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;
    void requestSubagentStop(SID, "dw");
    const cardUi = (
      <AgentToolRenderer
        toolName="Agent"
        status="complete"
        args={{ description: "write docs", subagent_type: "docs-writer" }}
        toolDetails={{ background: true, id: "bg-7a3f", status: "running" }}
        context={{ sessionId: SID, session }}
      />
    );
    const before = render(withHostPrimitives(cardUi)).container.innerHTML;
    cleanup();
    const { container } = render(
      withHostPrimitives(
        <>
          {cardUi}
          <SubagentDockRow
            sessionId={SID}
            sub={{ id: "dw", type: "docs-writer", description: "write docs", status: "running", stoppable: true, background: true } as SubagentState}
          />
        </>,
      ),
    );
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stopping…");
    expect(screen.queryByTestId("agent-stop-row")).toBeNull();
    expect(container.querySelector("[data-testid=agent-bg-started]")!.closest(".rounded-lg")!.outerHTML).toBe(
      before.trim(),
    );
  });
});
