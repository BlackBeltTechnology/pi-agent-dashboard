/**
 * KbJobRegistry — coalescing + error-state tests (task 1.3).
 * See change: add-kb-folder-slot.
 */
import { describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";

describe("KbJobRegistry", () => {
  it("coalesces concurrent starts onto one walk", async () => {
    const registry = new KbJobRegistry();
    let walks = 0;
    const fn = async () => {
      walks++;
      await new Promise((r) => setTimeout(r, 30));
      return { changed: 2, chunks: 5 };
    };
    const a = registry.start("/c", fn);
    // Second call arrives while the first is in-flight → must coalesce.
    const b = registry.start("/c", fn);
    expect(registry.isRunning("/c")).toBe(true);
    expect(b.coalesced).toBe(true);
    await Promise.all([a.promise, b.promise]);
    expect(walks).toBe(1);
    expect(registry.isRunning("/c")).toBe(false);
    expect(registry.statusFor("/c")).toBe("idle");
  });

  it("records error state + message after a failed job", async () => {
    const registry = new KbJobRegistry();
    const { promise } = registry.start("/c", async () => {
      throw new Error("boom");
    });
    await expect(promise).rejects.toThrow("boom");
    expect(registry.isRunning("/c")).toBe(false);
    expect(registry.statusFor("/c")).toBe("error");
    expect(registry.get("/c")?.error).toBe("boom");
  });

  it("clears the error status once a later job succeeds", async () => {
    const registry = new KbJobRegistry();
    await registry.start("/c", async () => { throw new Error("boom"); }).promise.catch(() => {});
    expect(registry.statusFor("/c")).toBe("error");
    await registry.start("/c", async () => ({ changed: 1, chunks: 3 })).promise;
    expect(registry.statusFor("/c")).toBe("idle");
  });
  it("X4 retains per-source outcomes; error outcomes derive a bounded job error, untrusted alone stays done", async () => {
    const registry = new KbJobRegistry();
    const t0 = Date.now();
    const mixed = [
      { ref: "docs", status: "ok" as const, at: Date.now() },
      { ref: "https://h/x.git", status: "error" as const, error: "e".repeat(800), at: Date.now() },
      { ref: "https://h/y.git", status: "untrusted" as const, error: "not trusted", at: Date.now() },
    ];
    await registry.start("/c", async () => ({ changed: 1, chunks: 2, outcomes: mixed })).promise;
    expect(registry.statusFor("/c")).toBe("error");
    const job = registry.get("/c");
    expect(job?.error?.startsWith("1 source(s) failed:")).toBe(true);
    expect(job?.error?.length).toBeLessThanOrEqual(500);
    expect(registry.outcomesFor("/c").map((o) => o.ref)).toEqual(["docs", "https://h/x.git", "https://h/y.git"]);
    for (const o of registry.outcomesFor("/c")) expect(o.at).toBeGreaterThanOrEqual(t0);

    await registry.start("/d", async () => ({ changed: 0, chunks: 0, outcomes: [mixed[2]] })).promise;
    expect(registry.statusFor("/d")).toBe("idle");
  });

  it("keeps the last outcomes while a later job runs or throws", async () => {
    const registry = new KbJobRegistry();
    await registry.start("/c", async () => ({ changed: 0, chunks: 0, outcomes: [{ ref: "docs", status: "ok" as const, at: 1 }] })).promise;
    const running = registry.start("/c", async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("boom");
    });
    expect(registry.outcomesFor("/c")).toHaveLength(1);
    await running.promise.catch(() => {});
    expect(registry.statusFor("/c")).toBe("error");
    expect(registry.outcomesFor("/c")).toHaveLength(1);
  });
});

// ── cancel + progress (change: throttle-kb-reindex, D3; test-plan #S32-#S35, #S38, #S67) ──
// Registry level only: the HTTP halves of these scenarios (POST /reindex/cancel, /stats progress,
// 202 while cancelling) are covered by the kb-routes tests (tasks 4.4x/4.50).

/** A fake worker: settles when `release()`d; observes `signal` but (by default) ignores it. */
function fakeJob<T = { changed: number; chunks: number }>(result: T) {
  let release!: (mode: "ok" | "abort") => void;
  const state = { calls: 0, aborts: 0, signal: undefined as AbortSignal | undefined };
  const fn = (ctx: { signal: AbortSignal }) => {
    state.calls++;
    state.signal = ctx.signal;
    ctx.signal.addEventListener("abort", () => state.aborts++);
    return new Promise<T>((resolve, reject) => {
      release = (mode) => (mode === "ok" ? resolve(result) : reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  };
  return { fn, state, release: (m: "ok" | "abort" = "abort") => release(m) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const OUT = [{ ref: "docs", status: "ok" as const, at: 1 }];
const ERR_OUT = [{ ref: "docs", status: "error" as const, error: "bad", at: 2 }];

describe("KbJobRegistry cancel (S32-S35, S67)", () => {
  it.each([
    ["never run", undefined],
    ["done with outcomes", { changed: 2, chunks: 5, outcomes: OUT }],
    ["retained error + outcomes", { changed: 0, chunks: 0, outcomes: ERR_OUT }],
  ])("S32 cancel restores the pre-start state exactly (%s)", async (_name, prior) => {
    const registry = new KbJobRegistry();
    if (prior) await registry.start("/c", async () => prior).promise;
    const before = structuredClone(registry.get("/c"));
    const job = fakeJob({ changed: 9, chunks: 9 });
    const { promise } = registry.start("/c", job.fn);
    expect(registry.get("/c")?.status).toBe("running");
    await tick(); // `fn` is invoked on a microtask after `start`
    expect(registry.cancel("/c")).toBe(true);
    expect(job.state.signal?.aborted).toBe(true);
    job.release("abort");
    await expect(promise).rejects.toThrow("aborted");
    expect(registry.get("/c")).toEqual(before);
    expect(registry.isRunning("/c")).toBe(false);
    expect(registry.statusFor("/c")).toBe(before?.status === "error" ? "error" : "idle");
    expect(registry.get("/c")?.error).toBe(before?.error);
  });

  it("S33 cancel with nothing running returns false and changes nothing", async () => {
    const registry = new KbJobRegistry();
    expect(registry.cancel("/c")).toBe(false);
    expect(registry.get("/c")).toBeUndefined();
    await registry.start("/c", async () => ({ changed: 1, chunks: 1, outcomes: OUT })).promise;
    const before = structuredClone(registry.get("/c"));
    expect(registry.cancel("/c")).toBe(false);
    expect(registry.get("/c")).toEqual(before);
    expect(registry.isCancelling("/c")).toBe(false);
  });

  it("S34 cancel while cancelling is idempotent: one abort, still running, one settle", async () => {
    const registry = new KbJobRegistry();
    const job = fakeJob({ changed: 0, chunks: 0 });
    const { promise } = registry.start("/c", job.fn);
    let settles = 0;
    promise.catch(() => settles++);
    await tick();
    expect(registry.cancel("/c")).toBe(true);
    expect(registry.cancel("/c")).toBe(true);
    expect(job.state.aborts).toBe(1);
    expect(registry.isCancelling("/c")).toBe(true);
    expect(registry.statusFor("/c")).toBe("running"); // no new status value
    expect(registry.isRunning("/c")).toBe(true);
    job.release("abort");
    await tick();
    expect(settles).toBe(1);
    expect(registry.isRunning("/c")).toBe(false);
    expect(registry.isCancelling("/c")).toBe(false);
    expect(registry.statusFor("/c")).toBe("idle");
  });

  it("S35 start while cancelling waits for the old job to settle, then runs once as a fresh job", async () => {
    const registry = new KbJobRegistry();
    const a = fakeJob({ changed: 0, chunks: 0 });
    const b = fakeJob({ changed: 3, chunks: 4 });
    const first = registry.start("/c", a.fn);
    first.promise.catch(() => {});
    await tick();
    registry.cancel("/c");
    const idA = registry.jobId("/c");
    const second = registry.start("/c", b.fn);
    expect(second.coalesced).toBe(false);
    await tick();
    expect(b.state.calls).toBe(0); // not before the old job settles
    // a further start meanwhile coalesces onto the pending one — not dropped, not a third job
    const third = registry.start("/c", fakeJob({ changed: 0, chunks: 0 }).fn);
    expect(third.coalesced).toBe(true);
    a.release("abort");
    await tick();
    expect(b.state.calls).toBe(1);
    expect(registry.isRunning("/c")).toBe(true);
    expect(registry.isCancelling("/c")).toBe(false);
    expect(registry.jobId("/c")).not.toBe(idA);
    b.release("ok");
    await expect(second.promise).resolves.toEqual({ changed: 3, chunks: 4 });
    await expect(third.promise).resolves.toEqual({ changed: 3, chunks: 4 });
    expect(registry.get("/c")?.changed).toBe(3);
    expect(b.state.calls).toBe(1);
  });

  it("S67 rapid reindex/cancel sequence converges to one running job from the last request", async () => {
    const registry = new KbJobRegistry();
    await registry.start("/c", async () => ({ changed: 0, chunks: 0, outcomes: ERR_OUT })).promise;
    const before = structuredClone(registry.get("/c"));
    let live = 0;
    let maxLive = 0;
    const invoked: string[] = [];
    const graceful = (name: string, result: { changed: number; chunks: number }) => async (ctx: { signal: AbortSignal }) => {
      invoked.push(name);
      live++;
      maxLive = Math.max(maxLive, live);
      try {
        return await new Promise<{ changed: number; chunks: number }>((resolve, reject) => {
          if (name === "C") setTimeout(() => resolve(result), 20);
          ctx.signal.addEventListener("abort", () => setTimeout(() => reject(new Error("aborted")), 100)); // 100 ms grace
        });
      } finally {
        live--;
      }
    };
    const a = registry.start("/c", graceful("A", { changed: 1, chunks: 1 }));
    await tick();
    expect(registry.cancel("/c")).toBe(true);
    const b = registry.start("/c", graceful("B", { changed: 2, chunks: 2 }));
    expect(registry.cancel("/c")).toBe(true); // cancels the queued B
    const c = registry.start("/c", graceful("C", { changed: 3, chunks: 3 }));
    const results = await Promise.allSettled([a.promise, b.promise, c.promise]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "fulfilled"]);
    expect(invoked).toEqual(["A", "C"]); // B never ran
    expect(maxLive).toBe(1);
    expect(registry.get("/c")?.changed).toBe(3);
    expect(registry.statusFor("/c")).toBe("idle");
    expect(before?.status).toBe("error"); // the retained error was intact through the cancelled runs…
    expect(registry.outcomesFor("/c")).toEqual([]); // …and C's success then cleared it
  });

  it("S67 cancelled runs leave a retained error unchanged", async () => {
    const registry = new KbJobRegistry();
    await registry.start("/c", async () => ({ changed: 0, chunks: 0, outcomes: ERR_OUT })).promise;
    const before = structuredClone(registry.get("/c"));
    const a = fakeJob({ changed: 0, chunks: 0 });
    const first = registry.start("/c", a.fn);
    first.promise.catch(() => {});
    await tick();
    registry.cancel("/c");
    const queued = registry.start("/c", fakeJob({ changed: 0, chunks: 0 }).fn);
    queued.promise.catch(() => {});
    registry.cancel("/c");
    a.release("abort");
    await tick();
    expect(registry.get("/c")).toEqual(before);
    expect(registry.isRunning("/c")).toBe(false);
  });

  it("backward compat: fn may ignore its argument", async () => {
    const registry = new KbJobRegistry();
    await expect(registry.start("/c", async () => ({ changed: 1, chunks: 1 })).promise).resolves.toEqual({ changed: 1, chunks: 1 });
  });
});

describe("KbJobRegistry progress (S38)", () => {
  it.each([["success", "ok"], ["error", "err"], ["cancel", "abort"]] as const)("progress is kept while running and cleared on %s", async (_n, how) => {
    const registry = new KbJobRegistry();
    let push!: (p: { root: string; done: number; total: number }) => void;
    let finish!: () => void;
    let fail!: (e: Error) => void;
    const { promise } = registry.start("/c", (ctx) => {
      push = ctx.progress;
      return new Promise((resolve, reject) => {
        finish = () => resolve({ changed: 1, chunks: 1 });
        fail = reject;
      });
    });
    promise.catch(() => {});
    await tick();
    expect(registry.progressFor("/c")).toBeUndefined(); // none before the first batch
    push({ root: "docs", done: 100, total: 250 });
    push({ root: "docs", done: 200, total: 250 });
    expect(registry.progressFor("/c")).toEqual({ root: "docs", done: 200, total: 250 }); // last value
    if (how === "ok") finish();
    else if (how === "err") fail(new Error("boom"));
    else {
      registry.cancel("/c");
      fail(new Error("aborted"));
    }
    await promise.catch(() => {});
    expect(registry.progressFor("/c")).toBeUndefined();
    push({ root: "docs", done: 250, total: 250 }); // late message from the settled job is ignored
    expect(registry.progressFor("/c")).toBeUndefined();
    let seen: unknown = "unset";
    const next = registry.start("/c", async (ctx) => {
      seen = registry.progressFor("/c");
      ctx.progress({ root: "x", done: 1, total: 1 });
      return { changed: 0, chunks: 0 };
    });
    await next.promise;
    expect(seen).toBeUndefined(); // next job starts with none
  });
});
