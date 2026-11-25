/**
 * Doorbell accumulation (test-plan S77, design D3, task 10.2): the shell appends every
 * `plugin_event` to the lead session's events array (copy-on-append, uncapped). At the
 * 1 s coalesce ceiling a continuously busy 2 h run is ≤ 7 200 frames. Gate: the 7 200th
 * append ≤ 5 ms and the total copy time ≤ 2 s; failing either widens the window to
 * 2 000 ms (CHANGED_COALESCE_MS). Also: one open view refetches at most once per frame
 * window and never overlaps. Numbers of the last run are printed (record in design.md).
 * See change: add-agent-teams-ui.
 */
import { getSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime";
import { publishSessionEvent } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionEventsStoreForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANGED_COALESCE_MS, snapshotEtag } from "../../shared/ui-protocol.js";
import { createTeamsStore } from "../teams-store.js";
import { makeSnapshot } from "./fixtures.js";

const FRAMES = 2 * 60 * 60; // 2 h at one frame per second
const frame = (rev: number) => ({ seq: rev, timestamp: new Date(rev * 1000).toISOString(), eventType: "agent-teams:changed", data: { teamId: "t1", epoch: "E", rev } });

beforeEach(() => __resetSessionEventsStoreForTests());
afterEach(() => {
  __resetSessionEventsStoreForTests();
  vi.useRealTimers();
});

describe("doorbell accumulation (S77)", () => {
  it("the coalesce window the numbers below assume is 1 000 ms", () => {
    expect(CHANGED_COALESCE_MS).toBe(1000);
  });

  it("7 200 frames: the last append ≤ 5 ms, total copy time ≤ 2 s", () => {
    let last = 0;
    const started = performance.now();
    for (let i = 1; i <= FRAMES; i++) {
      const t0 = performance.now();
      publishSessionEvent("LEAD", frame(i) as never);
      if (i === FRAMES) last = performance.now() - t0;
    }
    const total = performance.now() - started;
    expect(getSessionEvents("LEAD")).toHaveLength(FRAMES);
    console.info(`[doorbell] frames=${FRAMES} last-append=${last.toFixed(3)}ms total=${total.toFixed(1)}ms`);
    expect(last).toBeLessThanOrEqual(5);
    expect(total).toBeLessThanOrEqual(2000);
  });
});

describe("refetch rate in a continuously busy run (task 10.2)", () => {
  it("one frame per second for 2 h: at most one request per frame window plus the 60 s safety timer, never overlapping", async () => {
    vi.useFakeTimers();
    let rev = 1;
    let inflight = 0;
    let maxInflight = 0;
    let snapshotGets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("?sessionId=")) return new Response(JSON.stringify({ teams: [{ id: "t1" }] }), { status: 200 });
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      snapshotGets++;
      await Promise.resolve();
      inflight--;
      const inm = new Headers(init?.headers).get("if-none-match");
      if (inm === snapshotEtag("E", rev)) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(makeSnapshot({ rev, epoch: "E" })), { status: 200 });
    });
    const store = createTeamsStore({ fetch: fetchMock as unknown as typeof fetch });
    const release = store.watchSession("S1");
    await vi.advanceTimersByTimeAsync(0);
    snapshotGets = 0;
    for (let i = 0; i < FRAMES; i++) {
      rev++;
      store.ingestFrame("t1", { epoch: "E", rev });
      await vi.advanceTimersByTimeAsync(1000);
    }
    console.info(`[doorbell] busy 2 h: snapshot GETs=${snapshotGets} over ${FRAMES} frames (max in flight ${maxInflight})`);
    expect(maxInflight).toBe(1);
    // one per frame + the 60 s visible safety timer (a conditional request, 304 when nothing changed)
    expect(snapshotGets).toBeLessThanOrEqual(FRAMES + FRAMES / 60 + 1);
    release();
    store.dispose();
  });
});
