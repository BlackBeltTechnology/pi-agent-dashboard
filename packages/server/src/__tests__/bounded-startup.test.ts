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

  it("E20: a core that rejects AFTER the deadline is owned, not an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);

    try {
      await expect(
        runBoundedStartup({
          core: () => new Promise<void>((_r, reject) => {
            setTimeout(() => reject(new Error("late boot failure")), 40);
          }),
          teardown: vi.fn(),
          deadlineMs: 10,
        }),
      ).rejects.toBeInstanceOf(StartupDeadlineError);

      // Give the late rejection time to land.
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("deadlineMs: null runs teardown-only — a slow core is never killed", async () => {
    const teardown = vi.fn();
    let resolved = false;

    await runBoundedStartup({
      core: () => new Promise<void>((r) => setTimeout(() => { resolved = true; r(); }, 60)),
      teardown,
      deadlineMs: null,
    });

    expect(resolved).toBe(true);
    expect(teardown).not.toHaveBeenCalled();
  });

  it("deadlineMs: null still tears down on a failure", async () => {
    const teardown = vi.fn();
    await expect(
      runBoundedStartup({
        core: async () => { throw new Error("plugin load failed"); },
        teardown,
        deadlineMs: null,
      }),
    ).rejects.toThrow("plugin load failed");
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("E20: teardown runs AGAIN when a superseded core settles, sweeping late binds", async () => {
    const teardown = vi.fn();

    await expect(
      runBoundedStartup({
        // Stands in for a boot that crawls past the deadline and only then
        // reaches `fastify.listen()` — it must not keep what it opened.
        core: () => new Promise<void>((resolve) => setTimeout(resolve, 40)),
        teardown,
        deadlineMs: 10,
      }),
    ).rejects.toBeInstanceOf(StartupDeadlineError);

    expect(teardown).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(teardown).toHaveBeenCalledTimes(2);
  });

  it("does NOT sweep after a successful startup", async () => {
    const teardown = vi.fn();
    await runBoundedStartup({ core: async () => {}, teardown, deadlineMs: 1000 });
    await new Promise((r) => setTimeout(r, 30));
    expect(teardown).not.toHaveBeenCalled();
  });
});
