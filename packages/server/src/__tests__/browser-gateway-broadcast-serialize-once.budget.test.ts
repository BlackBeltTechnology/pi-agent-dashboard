/**
 * Budget lane (`*.budget.test.*`: excluded from blocking runs by `BUDGET_TEST_EXCLUDE`, collected when the
 * nightly `budget` job sets RUN_BUDGET_TESTS=1; no env gate of its own).
 *
 * P2 — the shed path's per-frame cost. The functional shed assertions (every frame counted as dropped) are
 * asserted by the blocking `browser-gateway-dropped-frames.test.ts`.
 *
 * Split from `browser-gateway-broadcast-serialize-once.test.ts`.
 * See change: stabilize-blocking-test-lanes.
 */

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeWs, makeStubPiGateway } from "./helpers/browser-gateway-fakes.js";

// ── P2: debt capture adds no per-frame cost to non-status frames ────────
// The dirty-id argument threads through EVERY `fanout` call, and the occupancy
// sample now runs at the shed site, so a regression here taxes the whole
// broadcast hot path.
//
// A literal "same build without the argument" baseline is not constructible
// in-process, so the measured control is the SAME loop over a frame type that
// never enters the debt path: for it the added work is exactly the two guards
// (`msg.type === "session_updated"` in `broadcast`, `dirtyId !== undefined` at
// the shed site). The assertion is that the non-status arm is not more than 5 %
// above a `session_updated` arm whose debt work is fully exercised — i.e. the
// untouched frame types do NOT pay for the feature — plus an absolute
// per-frame ceiling so a heavyweight guard (e.g. a JSON parse) fails loudly.
//
// KNOWN BLIND SPOT: the relative arm cannot see COMMON-MODE cost, i.e. work
// added to both arms. `noteOccupancy` is exactly such a cost. Only the absolute
// per-frame ceiling bounds it, so that ceiling — not the ratio — is what guards
// the occupancy sampler.
//
// See change: fix-backpressure-status-and-subagent-frames (test-plan #P2).
describe("debt capture adds no per-frame cost to the shed path (P2)", () => {
  const ITERATIONS = 10_000;
  /** Generous vs. the ~µs reality; catches an order-of-magnitude regression. */
  const ABSOLUTE_PER_FRAME_BUDGET_MS = 0.05;

  function timeShedLoop(build: (i: number) => ServerToBrowserMessage): number {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
    );
    const ws = makeFakeWs({ bufferedAmount: 5 * 1024 * 1024 }); // permanently saturated
    gateway.wss.emit("connection", ws, {});

    const frames = Array.from({ length: ITERATIONS }, (_, i) => build(i));
    const t0 = performance.now();
    for (const frame of frames) gateway.broadcastToAll(frame);
    const elapsed = performance.now() - t0;

    expect(gateway.getDroppedFrameStats().total).toBeGreaterThanOrEqual(ITERATIONS);
    return elapsed;
  }

  it("sheds non-status frames no slower than status frames that do the debt work", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Warm-up: let the JIT settle so the comparison is not a tiering artefact.
      timeShedLoop((i) => ({ type: "file_changed", cwd: `/repo/${i % 8}`, path: "a.ts" }) as unknown as ServerToBrowserMessage);
      timeShedLoop((i) => ({ type: "session_updated", sessionId: `s${i % 100}`, updates: { status: "streaming" } }) as ServerToBrowserMessage);

      // One ~7 ms sample per arm swung >20 % on a loaded CI fork (nightly
      // 11-15/11-18/11-21). Interleave the arms and compare medians so a
      // scheduler hiccup in one sample cannot decide the verdict.
      const SAMPLES = 7;
      const nonStatus: number[] = [];
      const status: number[] = [];
      for (let s = 0; s < SAMPLES; s++) {
        nonStatus.push(
          timeShedLoop((i) => ({ type: "file_changed", cwd: `/repo/${i % 8}`, path: "a.ts" }) as unknown as ServerToBrowserMessage),
        );
        status.push(
          timeShedLoop(
            (i) => ({ type: "session_updated", sessionId: `s${i % 100}`, updates: { status: "streaming" } }) as ServerToBrowserMessage,
          ),
        );
      }
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const nonStatusMs = median(nonStatus);
      const statusMs = median(status);

      // The untouched frame type must not pay for the feature (CI: contention
      // headroom per parallel-test-execution spec; the absolute ceiling below
      // still catches a heavyweight guard).
      expect(nonStatusMs).toBeLessThan(statusMs * (process.env.CI ? 1.25 : 1.05));
      // …and neither arm may blow an absolute per-frame ceiling.
      expect(nonStatusMs / ITERATIONS).toBeLessThan(ABSOLUTE_PER_FRAME_BUDGET_MS);
      expect(statusMs / ITERATIONS).toBeLessThan(ABSOLUTE_PER_FRAME_BUDGET_MS);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
