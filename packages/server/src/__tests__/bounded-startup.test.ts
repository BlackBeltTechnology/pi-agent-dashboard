/**
 * Bounded-startup scenarios E2, E3, E20.
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect, vi } from "vitest";
import { runBoundedStartup, StartupDeadlineError } from "../lifecycle/bounded-startup.js";

describe("runBoundedStartup", () => {
  it("E3: successful startup never invokes teardown", async () => {
    const teardown = vi.fn();
    await runBoundedStartup({ core: async () => {}, teardown, deadlineMs: 1000 });
    expect(teardown).not.toHaveBeenCalled();
  });

  it("E2: a post-gateway failure tears down, then rejects with the ORIGINAL error", async () => {
    const closes: string[] = [];
    const teardown = vi.fn(() => { closes.push("gateway"); });

    await expect(
      runBoundedStartup({
        core: async () => { throw new Error("plugin load failed"); },
        teardown,
        deadlineMs: 1000,
      }),
    ).rejects.toThrow("plugin load failed");

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(closes).toEqual(["gateway"]);
  });

  it("E2: a teardown error never replaces the original startup error", async () => {
    await expect(
      runBoundedStartup({
        core: async () => { throw new Error("plugin load failed"); },
        teardown: () => { throw new Error("close() blew up"); },
        deadlineMs: 1000,
      }),
    ).rejects.toThrow("plugin load failed");
  });

  it("E20: a startup that never settles hits the deadline, tears down and rejects", async () => {
    const teardown = vi.fn();

    await expect(
      runBoundedStartup({
        core: () => new Promise<void>(() => { /* never settles */ }),
        teardown,
        deadlineMs: 20,
      }),
    ).rejects.toBeInstanceOf(StartupDeadlineError);

    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("E20: the deadline timer does not itself keep the loop alive after success", async () => {
    const timers: Array<{ unrefed: boolean }> = [];
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: any) => {
      const t = realSetTimeout(fn, ms);
      const rec = { unrefed: false };
      timers.push(rec);
      const origUnref = t.unref?.bind(t);
      (t as any).unref = () => { rec.unrefed = true; return origUnref?.(); };
      return t;
    }) as any);

    try {
      await runBoundedStartup({ core: async () => {}, teardown: vi.fn(), deadlineMs: 50_000 });
    } finally {
      spy.mockRestore();
    }

    expect(timers.some(t => t.unrefed)).toBe(true);
  });
});
