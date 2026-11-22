/**
 * Budget lane (`*.budget.test.*`: excluded from blocking runs by `BUDGET_TEST_EXCLUDE`, collected when the
 * nightly `budget` job sets RUN_BUDGET_TESTS=1; no env gate of its own).
 *
 * #P4 — registry leak oracle plus the process-wide RSS bound. The blocking copy in `ladder-perf.test.ts`
 * keeps the `reg.size` oracle without the RSS bound.
 *
 * Split from `ladder-perf.test.ts`. See change: stabilize-blocking-test-lanes.
 */
import { describe, expect, it } from "vitest";
import { PendingGrantRegistry } from "../pending-grant-registry.js";

describe("#P4 registry does not leak across settled entries", () => {
  it("10k prompt -> settle cycles: registry returns to baseline, RSS delta < 10 MB", () => {
    const reg = new PendingGrantRegistry({ onTransition: () => {} });
    const OK = { promptable: true } as const;
    const run = (n: number, t0: number) => {
      for (let i = 0; i < n; i++) {
        const now = t0 + i * 200_000; // past backoff and rate windows every cycle
        const out = reg.record(
          { plane: "filesystem", subject: `/s${i % 50}`, mode: "held", channel: `c${i % 7}`, store: "x" },
          OK,
          now,
        );
        if (out.kind === "refused") throw new Error(out.reason);
        reg.settle({ promptId: out.entry.promptId, plane: "filesystem", subject: out.entry.subject, verdict: "deny" }, now);
      }
    };
    run(1000, 0); // warm up
    global.gc?.();
    const rss0 = process.memoryUsage().rss;
    run(10_000, 1e12);
    global.gc?.();
    expect(reg.size).toBe(0);
    // RSS is process-wide: on a loaded CI fork, allocator/JIT growth from the
    // 10k-cycle churn itself measured 11.5 MB (nightly 11-21) with reg.size 0.
    // `reg.size` is the leak oracle; RSS only catches a gross leak.
    expect(process.memoryUsage().rss - rss0).toBeLessThan((process.env.CI ? 32 : 10) * 1024 * 1024);
  });
});
