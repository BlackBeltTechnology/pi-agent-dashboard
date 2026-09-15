/**
 * Host-pressure tracker — transition-only pressure verdicts.
 * See change: fix-false-unresponsive-badge.
 *
 * The browser cannot observe bridge silence on its own: `processMetrics` is
 * pushed once in `sessions_snapshot` and never refreshed, so a client deriving
 * silence from it reads every live session as unresponsive a minute after page
 * load. The server owns the last-frame fact, so it derives the verdict and
 * emits ONLY on a state transition.
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_PRESSURE_DEGRADED_MS as SHARED_DEGRADED_MS,
  HOST_PRESSURE_UNRESPONSIVE_MS as SHARED_UNRESPONSIVE_MS,
} from "@blackbelt-technology/pi-dashboard-shared/host-pressure.js";
import { createMemorySessionManager } from "../memory-session-manager.js";
import { sessionToMeta } from "../session-to-meta.js";
import {
  createHostPressureTracker,
  HOST_PRESSURE_DEGRADED_MS,
  HOST_PRESSURE_UNRESPONSIVE_MS,
  type HostPressure,
} from "../host-pressure-tracker.js";

type Emission = { sessionId: string; pressure: HostPressure | null };

function setup() {
  const emissions: Emission[] = [];
  const tracker = createHostPressureTracker({
    onChange: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
  });
  return { emissions, tracker };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("host-pressure tracker", () => {
  it("a fresh frame emits nothing — a healthy session costs zero frames", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1);
    expect(emissions).toEqual([]);
  });

  it("crossing the degraded threshold emits degraded once, stamped with the last frame time", () => {
    const { emissions, tracker } = setup();
    const at = Date.now();
    tracker.noteFrame("s1");

    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS);
    expect(emissions).toEqual([{ sessionId: "s1", pressure: { state: "degraded", since: at } }]);

    // No further emission until the next threshold.
    vi.advanceTimersByTime(1_000);
    expect(emissions).toHaveLength(1);
  });

  it("continued silence escalates to unresponsive exactly once", () => {
    const { emissions, tracker } = setup();
    const at = Date.now();
    tracker.noteFrame("s1");

    vi.advanceTimersByTime(HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions.map((e) => e.pressure?.state)).toEqual(["degraded", "unresponsive"]);
    expect(emissions[1]?.pressure).toEqual({ state: "unresponsive", since: at });

    vi.advanceTimersByTime(10 * HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions).toHaveLength(2);
  });

  it("a frame after pressure clears it with an explicit null", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS);
    emissions.length = 0;

    tracker.noteFrame("s1");
    expect(emissions).toEqual([{ sessionId: "s1", pressure: null }]);

    // Back to healthy: no repeat clear on the next frame.
    tracker.noteFrame("s1");
    expect(emissions).toHaveLength(1);
  });

  it("clear() drops the session without emitting — an ended card has no pressure", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    tracker.clear("s1");
    vi.advanceTimersByTime(10 * HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions).toEqual([]);
  });

  it("tracks sessions independently", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1_000);
    tracker.noteFrame("s2");

    vi.advanceTimersByTime(1_000);
    expect(emissions.map((e) => e.sessionId)).toEqual(["s1"]);

    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1_000);
    expect(emissions.map((e) => e.sessionId)).toEqual(["s1", "s1", "s2"]);
  });

  it("stop() cancels every pending timer", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");
    tracker.noteFrame("s2");
    tracker.stop();
    vi.advanceTimersByTime(10 * HOST_PRESSURE_UNRESPONSIVE_MS);
    expect(emissions).toEqual([]);
    expect(tracker.size()).toBe(0);
  });

  // Test-plan #E4 — the threshold is measured from the LAST frame, so a frame
  // one millisecond short of it must restart the whole window, not shorten it.
  it("E4: a frame just below the boundary re-arms the timers", () => {
    const { emissions, tracker } = setup();
    tracker.noteFrame("s1");

    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 1);
    const secondFrameAt = Date.now();
    tracker.noteFrame("s1");

    // The original deadline passes with nothing emitted …
    vi.advanceTimersByTime(1);
    expect(emissions).toEqual([]);

    // … and the verdict lands a full window after the SECOND frame
    // (t0+34_999+35_000 = t0+69_999), stamped with that frame's time.
    vi.advanceTimersByTime(HOST_PRESSURE_DEGRADED_MS - 2);
    expect(emissions).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emissions).toEqual([
      { sessionId: "s1", pressure: { state: "degraded", since: secondFrameAt } },
    ]);
  });
});

// ── E6: one source of truth for the thresholds ────────────────────────────
// The card escalates degraded → unresponsive BETWEEN server transitions, so it
// must use the very numbers the server fires on. Two private copies drift.
// See change: fix-false-unresponsive-badge (task 6.10).

describe("E6: thresholds come from packages/shared, not from private literals", () => {
  it("the tracker re-exports the shared constants unchanged", () => {
    expect(HOST_PRESSURE_DEGRADED_MS).toBe(SHARED_DEGRADED_MS);
    expect(HOST_PRESSURE_UNRESPONSIVE_MS).toBe(SHARED_UNRESPONSIVE_MS);
  });

  it("neither consumer module redefines the numbers", () => {
    const modules = {
      tracker: new URL("../host-pressure-tracker.ts", import.meta.url),
      card: new URL(
        "../../../../client/src/components/session/SessionCard.tsx",
        import.meta.url,
      ),
    };
    for (const [label, url] of Object.entries(modules)) {
      const src = fs.readFileSync(url, "utf8");
      // A bare threshold literal is exactly the drift this forbids. The shared
      // module is the only place either number may be written.
      expect(src, `${label} defines its own threshold literal`).not.toMatch(/\b35_?000\b/);
      expect(src, `${label} defines its own threshold literal`).not.toMatch(/\b60_?000\b/);
    }
  });
});

// ── X4/X5: a verdict never outlives the live session ──────────────────────
// See change: fix-false-unresponsive-badge (tasks 6.8, 7.4).

describe("a host-pressure verdict is scoped to a live session", () => {
  it("X4: ending a session clears its verdict, so a later snapshot serves none", () => {
    const manager = createMemorySessionManager();
    manager.register({ id: "s1", cwd: "/repo/a", source: "tui" });
    manager.update("s1", { hostPressure: { state: "unresponsive", since: 1_000 } });
    expect(manager.get("s1")?.hostPressure).toEqual({ state: "unresponsive", since: 1_000 });

    manager.unregister("s1");

    expect(manager.get("s1")?.status).toBe("ended");
    expect(manager.get("s1")?.hostPressure).toBeUndefined();
  });

  it("X4: the update() seam that ends a session clears it too", () => {
    const manager = createMemorySessionManager();
    manager.register({ id: "s1", cwd: "/repo/a", source: "tui" });
    manager.update("s1", { hostPressure: { state: "degraded", since: 1_000 } });

    manager.update("s1", { status: "ended" });

    expect(manager.get("s1")?.hostPressure).toBeUndefined();
  });

  it("X5: the verdict is transient — it never reaches .meta.json", () => {
    const manager = createMemorySessionManager();
    manager.register({ id: "s1", cwd: "/repo/a", source: "tui" });
    manager.update("s1", { hostPressure: { state: "unresponsive", since: 1_000 } });

    const meta = sessionToMeta(manager.get("s1")!) as Record<string, unknown>;

    // A restart must not resurrect a verdict about a bridge that no longer
    // exists: the field is derived live, so it is absent from the persisted
    // enumeration entirely.
    expect("hostPressure" in meta).toBe(false);
  });
});
