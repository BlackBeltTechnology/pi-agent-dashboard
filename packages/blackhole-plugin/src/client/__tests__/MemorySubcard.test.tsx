/**
 * L1 — MEMORY subcard states (test-plan E10, E11, F5, F6, F7, F10; task 5.1–5.4).
 *
 * Every state derives from ONE `/session/:id` response fixture; accessibility
 * assertions check textual identifiers + accessible names (never colour).
 *
 * See change: add-blackhole-session-pipeline.
 */
import { cleanup, render } from "@testing-library/react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySubcard } from "../MemorySubcard.js";
import type { SessionPipelineResponse } from "../pipeline-api.js";

const SESSION_ID = "019fe770-a0a4-70bb-ac85-2e92e6aa8216";
const session = (contextTokens?: number | null): DashboardSession =>
  ({ id: SESSION_ID, contextTokens: contextTokens ?? null }) as DashboardSession;

function fixture(over: Partial<SessionPipelineResponse> = {}): SessionPipelineResponse {
  return {
    sessionId: SESSION_ID,
    activity: "active",
    pendingBatches: 0,
    cursors: {
      observer: { entryId: "aaaa1111", state: "recorded", entry: 412 },
      reflector: { entryId: "aaaa1111", state: "recorded", entry: 412 },
      dropper: { entryId: "aaaa1111", state: "empty", entry: 412 },
    },
    tip: 450,
    config: { compactAfterTokens: 81_000, memory: true, compaction: "auto" },
    workers: {
      observer: { model: "openai/gpt-x", cooldown: null },
      reflector: { model: "openai/gpt-x", cooldown: null },
      dropper: { model: "openai/gpt-x", cooldown: null },
    },
    ...over,
  };
}

function mount(vm: SessionPipelineResponse, contextTokens?: number | null) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => vm }) as unknown as Response);
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  const el = render(<MemorySubcard session={session(contextTokens)} />);
  return el;
}

afterEach(cleanup);

describe("subcard states (E10)", () => {
  it("healthy: one row of workers + lag + proximity, NO advisory", async () => {
    const { getByTestId, queryByTestId } = mount(fixture(), 40_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(getByTestId("bh-memory-workers")).toBeTruthy();
    expect(getByTestId("bh-memory-lag").textContent).toContain("38");
    expect(getByTestId("bh-memory-proximity")).toBeTruthy();
    // F3: the fill is bucketed, never a linear measured position — its width
    // must not encode the exact ratio.
    const fill = (getByTestId("bh-memory-proximity").querySelector(".bh-mem__proximity-fill") as HTMLElement);
    expect(fill.style.width).toMatch(/^(0|25|50|75|100)%$/);
    expect(queryByTestId("bh-memory-cooldown-observer")).toBeNull();
    expect(queryByTestId("bh-memory-pending-advisory")).toBeNull();
    expect(getByTestId("bh-memory-detail")).toBeTruthy(); // F10
  });

  it("no-activity-yet: distinct state, no meter, detail still reachable (F10)", async () => {
    const { getByTestId, queryByTestId } = mount(
      fixture({ activity: "none", cursors: { observer: null, reflector: null, dropper: null }, tip: null }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getByTestId("bh-memory-no-activity")).toBeTruthy();
    expect(queryByTestId("bh-memory-proximity")).toBeNull();
    expect(getByTestId("bh-memory-detail")).toBeTruthy();
  });

  it("workers-off: off copy incl. 'compaction still runs', NO meter (E10/F5)", async () => {
    const { getByTestId, queryByTestId } = mount(
      fixture({ config: { compactAfterTokens: 81_000, memory: false, compaction: "auto" } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getByTestId("bh-memory-workers-off").textContent).toMatch(/compaction still runs/i);
    expect(queryByTestId("bh-memory-proximity")).toBeNull();
    expect(queryByTestId("bh-memory-workers")).toBeNull();
  });

  it("cooldown: degraded worker + advisory naming model and remaining time (E10/F7)", async () => {
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    const { getByTestId, queryByTestId } = mount(
      fixture({
        workers: {
          observer: { model: "openai/gpt-x", cooldown: { until, reason: "429 Too Many Requests" } },
          reflector: { model: "openai/gpt-x", cooldown: null },
          dropper: { model: "openai/gpt-x", cooldown: null },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    const advisory = getByTestId("bh-memory-cooldown-observer");
    expect(advisory.textContent).toContain("openai/gpt-x");
    expect(advisory.textContent).toMatch(/min/i);
    const worker = getByTestId("bh-worker-observer");
    expect(worker.getAttribute("aria-label")).toContain("openai/gpt-x");
    expect(worker.getAttribute("aria-label")).toMatch(/cooling|fallback/i);
    // Healthy workers keep a state-describing accessible name.
    expect(getByTestId("bh-worker-reflector").getAttribute("aria-label")).toContain("reflector");
    expect(queryByTestId("bh-memory-cooldown-reflector")).toBeNull();
  });

  it("manual pending batches: advisory with count and flush hint (E10)", async () => {
    const { getByTestId } = mount(
      fixture({ pendingBatches: 4, config: { compactAfterTokens: 81_000, memory: true, compaction: "manual" } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    const advisory = getByTestId("bh-memory-pending-advisory");
    expect(advisory.textContent).toContain("4");
    expect(advisory.textContent).toMatch(/blackhole|flush/i);
  });

  it("auto-mode batches never show the flush advisory (CodeRabbit: manual-mode guard)", async () => {
    const { queryByTestId, getByTestId } = mount(fixture({ pendingBatches: 4 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(queryByTestId("bh-memory-pending-advisory")).toBeNull();
    expect(getByTestId("bh-memory-detail")).toBeTruthy();
  });
});

describe("cursor lag is exact (E11)", () => {
  it.each([
    ["behind → 38, not approximate", 412, 450, "38", /approx|≈/i],
    ["caught up → 0", 450, 450, "0", /approx|≈/i],
  ])("%s", async (_n, entry, tip, expected, notMatch) => {
    const { getByTestId } = mount(fixture({ cursors: { observer: { entryId: "a", state: "recorded", entry }, reflector: { entryId: "a", state: "recorded", entry }, dropper: { entryId: "a", state: "empty", entry } }, tip }));
    await new Promise((r) => setTimeout(r, 0));
    const lag = getByTestId("bh-memory-lag");
    expect(lag.textContent).toContain(expected);
    // Exact figure: the LAG element itself must not carry the approximate mark.
    expect(lag.textContent).not.toMatch(notMatch);
  });

  it("cursor AHEAD of tip → distinct stale-cursor indicator, no numeric/negative lag", async () => {
    const { getByTestId, queryByTestId } = mount(
      fixture({
        cursors: {
          observer: { entryId: "a", state: "recorded", entry: 450 },
          reflector: { entryId: "a", state: "recorded", entry: 450 },
          dropper: { entryId: "a", state: "empty", entry: 450 },
        },
        tip: 412,
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getByTestId("bh-memory-lag-stale")).toBeTruthy();
    expect(queryByTestId("bh-memory-lag")).toBeNull();
    expect(getByTestId("bh-memory-lag-stale").textContent).not.toMatch(/-?\d+/);
  });
});

describe("proximity constraints (F5, F6)", () => {
  it("approximate label, reachable explanation, no exact tokens/percentage, no scale marks", async () => {
    const { getByTestId, getByText } = mount(fixture(), 40_000);
    await new Promise((r) => setTimeout(r, 0));
    const meter = getByTestId("bh-memory-proximity");
    expect(meter.textContent).toMatch(/approx|≈/i);
    // Explanation reachable in the DOM (details body).
    expect(getByTestId("bh-proximity-explain").textContent).toMatch(/not convertible/i);
    // No false precision: no token counts, no percent sign on the meter.
    expect(meter.textContent).not.toMatch(/\d{3,}|%/);
    // Never an alarm.
    expect(meter.textContent).not.toMatch(/imminent|alert|warning/i);
    void getByText;
  });

  it("omitted when contextTokens unknown — indicators + lag still render (F6a)", async () => {
    const { queryByTestId, getByTestId } = mount(fixture(), null);
    await new Promise((r) => setTimeout(r, 0));
    expect(queryByTestId("bh-memory-proximity")).toBeNull();
    expect(getByTestId("bh-memory-workers")).toBeTruthy();
    expect(getByTestId("bh-memory-lag")).toBeTruthy();
  });

  it("omitted when compactAfterTokens unreadable (F6b)", async () => {
    const { queryByTestId, getByTestId } = mount(
      fixture({ config: { compactAfterTokens: null, memory: true, compaction: "auto" } }),
      40_000,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(queryByTestId("bh-memory-proximity")).toBeNull();
    expect(getByTestId("bh-memory-lag")).toBeTruthy();
  });
});

describe("detail affordance (F10)", () => {
  it("present in every state, independent of proximity", async () => {
    const states: SessionPipelineResponse[] = [
      fixture(),
      fixture({ activity: "none", cursors: { observer: null, reflector: null, dropper: null }, tip: null }),
      fixture({ config: { compactAfterTokens: null, memory: true, compaction: "manual" } }),
      fixture({ config: { compactAfterTokens: 81_000, memory: false, compaction: "auto" } }),
    ];
    for (const state of states) {
      const { getByTestId } = mount(state, null);
      await new Promise((r) => setTimeout(r, 0));
      expect(getByTestId("bh-memory-detail")).toBeTruthy();
      cleanup();
    }
  });
});
