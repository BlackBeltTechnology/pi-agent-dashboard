import { describe, expect, it } from "vitest";
import { cappedDelay } from "../retry-tracker.js";

/**
 * Drift guard: the local `cappedDelay` mirror MUST equal pi-ai's own
 * `retryDelayMs` (the function pi's `_prepareRetry` sleeps on). The next pi
 * curve change turns this red instead of the countdown silently drifting.
 * See change: fix-retry-delay-cap (design D1/D3; test-plan #E6).
 */
describe("cappedDelay parity with pi-ai retryDelayMs (test-plan #E6)", () => {
  it("matches across the (base, cap, attempt) grid", async () => {
    const mod = (await import("@earendil-works/pi-ai")) as {
      retryDelayMs: (p: { baseDelayMs: number; maxAgentDelayMs?: number }, attempt: number) => number;
    };
    expect(typeof mod.retryDelayMs).toBe("function");
    for (const baseDelayMs of [1, 2000, 2700]) {
      for (const maxAgentDelayMs of [0, 5000, 60000, undefined]) {
        for (const attempt of [0, 1, 2, 10, 64, 2000]) {
          const policy = { baseDelayMs, maxAgentDelayMs };
          expect(cappedDelay(policy, attempt), JSON.stringify({ policy, attempt })).toBe(
            mod.retryDelayMs(policy, attempt),
          );
        }
      }
    }
  });
});
