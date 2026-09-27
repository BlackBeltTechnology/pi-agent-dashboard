/**
 * Adapter overhead budget. Task 3.19 (test-plan P1): adapter work outside the
 * network attempt ≤ 5 ms at p95. Measured as total latency minus the attempt's
 * own latency. See change: add-system-one-registry.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { predict } from "../predict.js";
import type { Questions } from "../types.js";
import { chainConfig, freshState } from "./helpers/config.js";
import { type FakeBackend, startFakeBackend } from "./helpers/fake-backend.js";

let f: FakeBackend;
beforeAll(async () => {
  freshState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f = await startFakeBackend();
  chainConfig({ f: f.url });
});
afterAll(async () => f.close());

describe("P1 overhead budget (3.19)", () => {
  it("p95 overhead ≤ 5 ms over 1,000 calls with 5 questions and 2 KB state", async () => {
    const questions: Questions = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`q${i}`, { type: "noul", instructions: `question ${i}` }]),
    ) as Questions;
    const state = "x".repeat(2048);
    const overhead: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      const r = await predict({ consumer: { id: "perf", failurePolicy: "fail-open" }, state, questions });
      const total = performance.now() - t0;
      if (!r.ok) throw new Error("predict failed");
      overhead.push(total - r.attempts[0].latencyMs);
    }
    overhead.sort((a, b) => a - b);
    const p95 = overhead[Math.floor(overhead.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(5);
  }, 60_000);
});
