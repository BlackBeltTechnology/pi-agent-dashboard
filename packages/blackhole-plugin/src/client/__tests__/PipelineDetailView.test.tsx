/**
 * L1 — content-view drill-in (test-plan F8, F11; task 6.2/6.3).
 *
 *  - F8: the predicate is FALSE by default; explicit navigation activates it;
 *    the return affordance restores the chat view
 *  - F11: provenance (pending file / cooldown file / dashboard accounting),
 *    no in-memory-only values, transcript pointer present
 *  - 6.3: session-scoping — the global settings surface renders no per-session
 *    pipeline state
 *
 * See change: add-blackhole-session-pipeline.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDetailNavigationForTests,
  closePipelineDetail,
  isPipelineDetailActive,
  openPipelineDetail,
} from "../detail-navigation.js";
import { PipelineDetailView } from "../PipelineDetailView.js";
import { BlackholeSettings } from "../BlackholeSettings.js";

const SESSION_ID = "019fe770-a0a4-70bb-ac85-2e92e6aa8216";
const session = { id: SESSION_ID, contextTokens: 40_000 } as DashboardSession;

function fixture() {
  return {
    sessionId: SESSION_ID,
    activity: "active",
    pendingBatches: 2,
    cursors: {
      observer: { entryId: "aabb1122", state: "recorded", entry: null },
      reflector: { entryId: "ccdd3344", state: "not_due", entry: null },
      dropper: null,
    },
    tip: null,
    config: { compactAfterTokens: 81_000, memory: true, compaction: "manual" as const },
    workers: {
      observer: { model: "openai/gpt-x", cooldown: { until: new Date(Date.now() + 600_000).toISOString(), reason: "429" } },
      reflector: { model: "openai/gpt-x", cooldown: null },
      dropper: { model: null, cooldown: null },
    },
  };
}

function mountDetail() {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture() }) as unknown as Response);
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  return render(
    <PipelineDetailView session={session} routeParams={{}} onClose={() => {}} />,
  );
}

afterEach(() => {
  cleanup();
  __resetDetailNavigationForTests();
});

describe("activation is explicit only (F8)", () => {
  it("predicate returns false before any navigation", () => {
    expect(isPipelineDetailActive(session)).toBe(false);
  });

  it("openPipelineDetail activates for THAT session; close deactivates (return path)", () => {
    openPipelineDetail(SESSION_ID);
    expect(isPipelineDetailActive(session)).toBe(true);
    expect(isPipelineDetailActive({ id: "other" } as DashboardSession)).toBe(false);
    closePipelineDetail();
    expect(isPipelineDetailActive(session)).toBe(false);
  });
});

describe("provenance and at-rest-only content (F11)", () => {
  it("cursors attributed to the pending file", async () => {
    const { getByTestId } = mountDetail();
    await screen.findByTestId("bh-detail-workers");
    expect(getByTestId("bh-detail-workers").textContent).toContain("-pending.json");
    expect(getByTestId("bh-detail-worker-observer").textContent).toContain("aabb1122");
    expect(getByTestId("bh-detail-worker-observer").textContent).toContain("recorded");
  });

  it("resolved model + reason attributed to the cooldown file", async () => {
    const { getByTestId } = mountDetail();
    await screen.findByTestId("bh-detail-cooldown-source");
    expect(getByTestId("bh-detail-cooldown-source").textContent).toContain(
      "pi-blackhole-cooldown.json",
    );
    expect(getByTestId("bh-detail-cooldown-observer").textContent).toContain("429");
  });

  it("proximity attributed to dashboard accounting with the non-convertibility caveat", async () => {
    const { getByTestId } = mountDetail();
    await screen.findByTestId("bh-detail-proximity-caveat");
    const caveat = getByTestId("bh-detail-proximity-caveat");
    expect(caveat.textContent).toMatch(/dashboard/i);
    expect(caveat.textContent).toMatch(/not convertible|not persisted/i);
  });

  it("in-memory-only values are absent; transcript pointer present", async () => {
    const { getByTestId, queryByText } = mountDetail();
    await screen.findByTestId("bh-detail-transcript-note");
    expect(getByTestId("bh-detail-transcript-note").textContent).toMatch(/transcript/i);
    expect(queryByText(/consolidationInFlight/)).toBeNull();
    expect(queryByText(/compactInFlight/)).toBeNull();
    expect(queryByText(/last error/i)).toBeNull();
  });

  it("back affordance restores the chat path (predicate reset + onClose invoked)", async () => {
    openPipelineDetail(SESSION_ID);
    let closed = false;
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture() }) as unknown as Response);
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { getByTestId } = render(
      <PipelineDetailView session={session} routeParams={{}} onClose={() => (closed = true)} />,
    );
    await screen.findByTestId("bh-detail-back");
    getByTestId("bh-detail-back").click();
    expect(closed).toBe(true);
    expect(isPipelineDetailActive(session)).toBe(false);
  });
});

describe("session-scoping (6.3)", () => {
  it("the global settings surface renders no per-session pipeline state", async () => {
    const jsonRes = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/plugins/blackhole/status")) return jsonRes({ installed: true });
      if (String(url).includes("/api/plugins/blackhole/config")) return jsonRes({ status: "ok", filePath: "/x", exists: false, fields: {}, unmanagedKeys: [] });
      throw new Error(`unexpected url ${url}`);
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    const { queryByTestId, queryAllByTestId } = render(<BlackholeSettings />);
    // Wait for the config load to settle (observable) rather than a fixed tick:
    // the assertions below are NEGATIVE, so they must run AFTER the load.
    // See change: contention-harden-real-process-tests.
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/blackhole/config")),
      ).toBe(true),
    );
    expect(queryByTestId("bh-detail-view")).toBeNull();
    expect(queryAllByTestId("bh-memory-subcard")).toEqual([]);
    expect(queryAllByTestId("bh-detail-worker-observer")).toEqual([]);
  });
});
