/**
 * Outbound pacing + single-flight (change: add-chat-gateway-team-controls).
 * Scenarios: P1 (burst budget), P3 (one post in flight), elision on coalesce.
 */
import { describe, expect, it, vi } from "vitest";
import { createPacer } from "../pacing.js";

function maxPostsInAnyWindow(times: number[], windowMs: number): number {
  let max = 0;
  for (const start of times) {
    const count = times.filter((t) => t >= start && t < start + windowMs).length;
    max = Math.max(max, count);
  }
  return max;
}

describe("createPacer", () => {
  it("P1: a 100-step burst posts at most 5 per 5s window", async () => {
    let t = 0;
    const posts: Array<{ key: string; at: number }> = [];
    const pacer = createPacer({
      now: () => t,
      send: (key) => {
        posts.push({ key, at: t });
      },
    });

    // Pump one distinct event at a time so the rate budget, not coalescing, is
    // what bounds the number of posts.
    for (let i = 0; i < 100; i++) {
      pacer.submit("c", `event ${i}`);
      await pacer.pump("c");
    }
    expect(posts.length).toBe(5);

    t = 6_000;
    await pacer.pump("c");
    expect(posts.length).toBe(6);

    expect(maxPostsInAnyWindow(posts.map((p) => p.at), 5_000)).toBeLessThanOrEqual(5);
  });

  it("P1b: sustained stream never exceeds the budget", async () => {
    let t = 0;
    const posts: number[] = [];
    const pacer = createPacer({
      now: () => t,
      send: () => {
        posts.push(t);
      },
    });
    for (let step = 0; step < 1_000; step++) {
      t = step * 100; // one event every 100ms for 100s
      pacer.submit("c", `e${step}`);
      await pacer.pump("c");
    }
    expect(maxPostsInAnyWindow(posts, 5_000)).toBeLessThanOrEqual(5);
  });

  it("P3: at most one post in flight per thread", async () => {
    const releaseRef: { fn: (() => void) | null } = { fn: null };
    let firstCall = true;
    const send = vi.fn(() => {
      if (firstCall) {
        firstCall = false;
        return new Promise<void>((resolve) => {
          releaseRef.fn = resolve;
        });
      }
      return Promise.resolve();
    });
    const pacer = createPacer({ now: () => 0, send });
    pacer.submit("c", "first");

    const p1 = pacer.pump("c");
    expect(pacer.inFlight("c")).toBe(1);
    pacer.submit("c", "second");
    const p2 = pacer.pump("c"); // must not issue a concurrent post
    expect(send).toHaveBeenCalledTimes(1);

    releaseRef.fn?.();
    await p1;
    await p2;
    expect(send).toHaveBeenCalledTimes(2); // the queued second post follows
  });

  it("coalesced content is elision-marked, never silently cut", async () => {
    const posts: string[] = [];
    const pacer = createPacer({
      now: () => 0,
      maxChars: 50,
      send: (_k, content) => {
        posts.push(content);
      },
    });
    for (let i = 0; i < 50; i++) pacer.submit("c", "y".repeat(10));
    await pacer.pump("c");
    expect(posts[0]).toContain("elided");
  });
});
