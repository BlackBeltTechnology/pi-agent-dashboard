// Tests for change: bound-kb-proximity-search — the kb query worker host
// lifecycle (design D6–D9). Folded from
// openspec/changes/bound-kb-proximity-search/test-plan.md (#W1–#W5, #W7, #W8,
// #W10–#W15, #W17, #W19). Exemplars:
// packages/server/src/attachments/__tests__/fit-worker-pool.test.ts (+ -fallback).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker as WorkerT } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withEventLoopLag } from "../../../kb/src/__tests__/helpers/event-loop-lag.js";
import { createQueryWorkerHost, type QueryWorkerHost, type QueryWorkerHostOptions } from "../query-worker-host.js";
import { resolveQueryTimeoutMs } from "../reindex.js";

// Count Worker constructions and observe each worker's exit / terminate calls.
const spy = vi.hoisted(() => ({ created: [] as Array<{ w: unknown; exited: boolean; terminateCalls: number }> }));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  class Worker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args);
      const rec = { w: this, exited: false, terminateCalls: 0 };
      spy.created.push(rec);
      this.on("exit", () => { rec.exited = true; });
      const terminate = this.terminate.bind(this);
      this.terminate = () => { rec.terminateCalls++; return terminate(); };
    }
  }
  return { ...actual, Worker };
});

const FAKE = new URL("./helpers/fake-query-worker.mjs", import.meta.url);
const hosts: QueryWorkerHost[] = [];
const mk = (o: QueryWorkerHostOptions = {}) => {
  const h = createQueryWorkerHost({ workerUrl: FAKE, useWorker: true, ...o });
  hosts.push(h);
  return h;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inProc = () => vi.fn(() => "in-process");
const alive = () => spy.created.filter((c) => !c.exited).length;
const exitOf = (i: number) => new Promise<void>((r) => (spy.created[i].exited ? r() : (spy.created[i].w as WorkerT).once("exit", () => r())));
const workerOf = (v: unknown) => (v as { worker: number }).worker;

afterEach(async () => {
  for (const h of hosts.splice(0)) h.shutdown();
  // let abandoned fake workers (blocked in a child wait) finish before the next test
  for (let i = 0; i < 100 && alive(); i++) await sleep(50);
  spy.created.length = 0;
  vi.restoreAllMocks();
});

/** Warm a host so the next op is dispatched at once; returns the live worker id. */
async function warm(h: QueryWorkerHost): Promise<number> {
  const r = await h.run({ op: "ping" }, { inProcess: inProc() });
  expect(r.kind).toBe("ok");
  return workerOf((r as { value: unknown }).value);
}

describe("abort / deadline", () => {
  it("W1: abort during a non-interruptible op resolves cancelled at once, never blocks, next op on a fresh worker", async () => {
    const h = mk();
    await warm(h);
    const ac = new AbortController();
    const { result, maxDelayMs } = await withEventLoopLag(async () => {
      const p = h.run({ op: "sleepNative", ms: 5000 }, { signal: ac.signal, inProcess: inProc() });
      await sleep(200);
      const t0 = Date.now();
      ac.abort();
      const r = await p;
      return { r, dt: Date.now() - t0 };
    });
    expect(result.r.kind).toBe("cancelled");
    expect(result.dt).toBeLessThanOrEqual(500);
    expect(maxDelayMs).toBeLessThan(100);
    const t1 = Date.now();
    const next = await h.run({ op: "ping" }, { inProcess: inProc() });
    expect(next.kind).toBe("ok");
    expect(Date.now() - t1).toBeLessThan(1000);
    expect(spy.created).toHaveLength(2);
  }, 15_000);

  it("W2: abort during a JS-bound op → cancelled ≤ 500 ms and the abandoned worker exits ≤ 500 ms", async () => {
    const h = mk();
    await warm(h);
    const ac = new AbortController();
    const p = h.run({ op: "spin", ms: 5000 }, { signal: ac.signal, inProcess: inProc() });
    await sleep(200);
    const t0 = Date.now();
    ac.abort();
    expect((await p).kind).toBe("cancelled");
    expect(Date.now() - t0).toBeLessThanOrEqual(500);
    await exitOf(0);
    expect(Date.now() - t0).toBeLessThanOrEqual(500);
  }, 15_000);

  it("W3: aborting the in-flight request moves the queued one to a fresh worker", async () => {
    const h = mk();
    const first = await warm(h);
    const ac = new AbortController();
    const a = h.run({ op: "sleepNative", ms: 3000 }, { signal: ac.signal, inProcess: inProc() });
    const b = h.run({ op: "search" }, { inProcess: inProc() });
    await sleep(100);
    ac.abort();
    expect((await a).kind).toBe("cancelled");
    const rb = await b;
    expect(rb.kind).toBe("ok");
    expect(workerOf((rb as { value: unknown }).value)).not.toBe(first);
  }, 15_000);

  it("W4: aborting a queued request leaves the in-flight one on its worker; nothing terminated", async () => {
    const h = mk();
    const first = await warm(h);
    const ac = new AbortController();
    const a = h.run({ op: "sleepNative", ms: 1000 }, { inProcess: inProc() });
    const b = h.run({ op: "search" }, { signal: ac.signal, inProcess: inProc() });
    await sleep(50);
    const t0 = Date.now();
    ac.abort();
    expect((await b).kind).toBe("cancelled");
    expect(Date.now() - t0).toBeLessThan(50);
    const ra = await a;
    expect(ra.kind).toBe("ok");
    expect(workerOf((ra as { value: unknown }).value)).toBe(first);
    expect(spy.created.reduce((n, c) => n + c.terminateCalls, 0)).toBe(0);
  }, 15_000);

  it("W5: at most two abandoned workers; a 4th call waits for one, honours abort and its deadline from enqueue", async () => {
    const h = mk();
    let maxAlive = 0;
    const probe = setInterval(() => { maxAlive = Math.max(maxAlive, alive()); }, 10);
    try {
      for (let i = 0; i < 3; i++) {
        const ac = new AbortController();
        const p = h.run({ op: "sleepNative", ms: 4000 }, { signal: ac.signal, inProcess: inProc() });
        await sleep(i === 2 ? 0 : 300); // calls 1–2 dispatch; call 3 is cap-blocked
        ac.abort();
        expect((await p).kind).toBe("cancelled");
      }
      // variant 1: abort while cap-blocked → cancelled at once
      const ac = new AbortController();
      const v1 = h.run({ op: "search" }, { signal: ac.signal, inProcess: inProc() });
      const t0 = Date.now();
      ac.abort();
      expect((await v1).kind).toBe("cancelled");
      expect(Date.now() - t0).toBeLessThan(50);
      // variant 2: deadline runs from enqueue while cap-blocked
      const t1 = Date.now();
      const v2 = await h.run({ op: "search" }, { timeoutMs: 1000, inProcess: inProc() });
      expect(v2).toEqual({ kind: "timeout", seconds: 1 });
      expect(Date.now() - t1).toBeGreaterThanOrEqual(900);
      expect(Date.now() - t1).toBeLessThan(2000);
      // the 4th call waits for a dying worker to exit, then succeeds
      const r4 = await h.run({ op: "search" }, { inProcess: inProc() });
      expect(r4.kind).toBe("ok");
    } finally {
      clearInterval(probe);
    }
    expect(maxAlive).toBeLessThanOrEqual(3); // 2 dying + 1 live
  }, 20_000);

  it("W5b: a cap-blocked request keeps its enqueue deadline after it is finally dispatched", async () => {
    const h = mk();
    for (let i = 0; i < 2; i++) {
      const ac = new AbortController();
      const p = h.run({ op: "sleepNative", ms: 1300 }, { signal: ac.signal, inProcess: inProc() });
      await sleep(300);
      ac.abort();
      expect((await p).kind).toBe("cancelled");
    }
    const t0 = Date.now();
    const r = await h.run({ op: "sleepNative", ms: 3000 }, { timeoutMs: 1500, inProcess: inProc() });
    expect(r).toEqual({ kind: "timeout", seconds: 2 });
    expect(Date.now() - t0).toBeLessThan(1900); // not restarted at the (later) dispatch
  }, 20_000);

  it("W15b: a request the worker cannot receive (non-cloneable) rejects and does not wedge the worker", async () => {
    const h = mk();
    await warm(h);
    await expect(h.run({ op: "search", fn: () => 1 }, { inProcess: inProc() })).rejects.toThrow();
    expect((await h.run({ op: "ping" }, { inProcess: inProc() })).kind).toBe("ok");
    expect(spy.created).toHaveLength(1);
  });

  it("W7: resolveQueryTimeoutMs parses strictly and clamps to [1000, 600000]", () => {
    const cases: Array<[string | undefined, number]> = [
      [undefined, 60000], ["", 60000], ["  ", 60000], ["abc", 60000], ["1.5", 60000], ["1e3", 60000], ["10ms", 60000],
      ["500", 1000], ["1000", 1000], ["90000", 90000], ["600000", 600000], ["700000", 600000],
    ];
    for (const [raw, want] of cases) expect(resolveQueryTimeoutMs(raw)).toBe(want);
  });

  it("W8: a queued request's deadline starts at its own dispatch", async () => {
    const h = mk({ timeoutMs: 2000 });
    await warm(h);
    const a = h.run({ op: "sleepNative", ms: 1500 }, { inProcess: inProc() });
    const b = h.run({ op: "sleepNative", ms: 800 }, { inProcess: inProc() });
    expect((await a).kind).toBe("ok");
    expect((await b).kind).toBe("ok");
  }, 15_000);
});

describe("fallback / start", () => {
  it("W10: load-failed disables the worker for the process; one warn names the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mk({ workerData: { loadFailed: "boom" } });
    for (let i = 0; i < 3; i++) expect(await h.run({ op: "search" }, { inProcess: () => "in-process" })).toEqual({ kind: "ok", value: "in-process" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("load-failed: boom");
    expect(spy.created).toHaveLength(1);
  });

  it("W11: KB_QUERY_WORKER=0 never spawns; one warn says disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = createQueryWorkerHost({ workerUrl: FAKE }); // env-driven (vitest env sets KB_QUERY_WORKER=0)
    hosts.push(h);
    expect(process.env.KB_QUERY_WORKER).toBe("0");
    for (let i = 0; i < 2; i++) expect(await h.run({ op: "search" }, { inProcess: () => "in-process" })).toEqual({ kind: "ok", value: "in-process" });
    expect(spy.created).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("disabled");
  });

  it("W12: start-timeout → in-process, cooldown, one retry, then disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mk({ startTimeoutMs: 200, cooldownMs: 300, workerData: { never: true } });
    const ip = () => "in-process";
    expect((await h.run({ op: "search" }, { inProcess: ip })).kind).toBe("ok"); // 1: start → timeout → in-process
    expect(spy.created).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("start-timeout");
    expect(await h.run({ op: "search" }, { inProcess: ip })).toEqual({ kind: "ok", value: "in-process" }); // 2: cooldown
    expect(spy.created).toHaveLength(1);
    await sleep(350);
    expect(await h.run({ op: "search" }, { inProcess: ip })).toEqual({ kind: "ok", value: "in-process" }); // 3: one more attempt
    expect(spy.created).toHaveLength(2);
    expect(await h.run({ op: "search" }, { inProcess: ip })).toEqual({ kind: "ok", value: "in-process" }); // 4: disabled
    expect(spy.created).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("W12 variant: ready on the 2nd attempt → call 3 is served off-thread", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const shared = new SharedArrayBuffer(8);
    const h = mk({ startTimeoutMs: 200, cooldownMs: 300, workerData: { readyOnAttempt: 2, shared } });
    expect(await h.run({ op: "search" }, { inProcess: () => "in-process" })).toEqual({ kind: "ok", value: "in-process" });
    await sleep(350);
    const r3 = await h.run({ op: "search" }, { inProcess: () => "in-process" });
    expect(r3.kind).toBe("ok");
    expect((r3 as unknown as { value: { op: string } }).value.op).toBe("search");
  }, 15_000);

  it("W13: abort during start → cancelled at once, not a start failure; late ready ignored", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mk({ startTimeoutMs: 2000, workerData: { readyDelayMs: 400 } });
    const ac = new AbortController();
    const p = h.run({ op: "search" }, { signal: ac.signal, inProcess: inProc() });
    await sleep(100);
    const t0 = Date.now();
    ac.abort();
    expect((await p).kind).toBe("cancelled");
    expect(Date.now() - t0).toBeLessThanOrEqual(200);
    const r2 = await h.run({ op: "search" }, { inProcess: () => "in-process" });
    expect((r2 as unknown as { value: { op: string } }).value.op).toBe("search");
    expect(spy.created).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  }, 15_000);
});

describe("crash / errors / lifecycle", () => {
  it("W14a: a crash after ready is retried once on a fresh worker; queued requests follow", async () => {
    const shared = new SharedArrayBuffer(8);
    const h = mk({ workerData: { crash: "first", shared } });
    const ip = vi.fn(() => "in-process");
    const rs = await Promise.all([h.run({ op: "search" }, { inProcess: ip }), h.run({ op: "search" }, { inProcess: ip }), h.run({ op: "search" }, { inProcess: ip })]);
    for (const r of rs) expect((r as unknown as { value: { op: string } }).value.op).toBe("search");
    expect(spy.created).toHaveLength(2);
    expect(ip).not.toHaveBeenCalled();
  }, 15_000);

  it("W14b: a worker crashing on every op → failed (never in-process); after 3 crashes, in-process + one warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = mk({ workerData: { crash: "always" } });
    const ip = vi.fn(() => "in-process");
    expect(await h.run({ op: "search" }, { inProcess: ip })).toEqual({ kind: "failed" }); // crashes 1 + 2
    expect(ip).not.toHaveBeenCalled();
    expect(await h.run({ op: "search" }, { inProcess: ip })).toEqual({ kind: "failed" }); // crash 3 → disabled, not re-run
    expect(ip).not.toHaveBeenCalled();
    expect(await h.run({ op: "search" }, { inProcess: ip })).toEqual({ kind: "ok", value: "in-process" });
    expect(warn).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("W15: an op error rejects with the message; no new worker, no crash counted", async () => {
    const h = mk();
    await warm(h);
    await expect(h.run({ op: "throw", message: "bad fts syntax" }, { inProcess: inProc() })).rejects.toThrow("bad fts syntax");
    for (let i = 0; i < 3; i++) await expect(h.run({ op: "throw", message: "x" }, { inProcess: inProc() })).rejects.toThrow("x");
    expect((await h.run({ op: "ping" }, { inProcess: inProc() })).kind).toBe("ok"); // 3 "crashes" would have disabled it
    expect(spy.created).toHaveLength(1);
  });

  it("W17: a database that vanished before the worker opened it → empty result, no crash, no warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = createQueryWorkerHost({ useWorker: true }); // the real query-worker.mjs
    hosts.push(h);
    const dir = mkdtempSync(join(tmpdir(), "kb-qw-gone-"));
    try {
      const ip = vi.fn(() => "in-process");
      const r = await h.run({ op: "search", dbPath: join(dir, "index.db"), query: "anything", opts: {} }, { inProcess: ip });
      expect(r).toEqual({ kind: "ok", value: [] });
      const r2 = await h.run({ op: "search", dbPath: join(dir, "index.db"), query: "x", opts: {} }, { inProcess: ip });
      expect(r2).toEqual({ kind: "ok", value: [] });
      expect(ip).not.toHaveBeenCalled();
      expect(spy.created).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("W19: an idle worker is retired by the host (not a crash); the next call gets a new worker", async () => {
    const h = mk({ idleMs: 200 });
    await warm(h);
    await sleep(400);
    expect(spy.created[0].terminateCalls).toBe(1);
    expect(spy.created[0].exited).toBe(true);
    const r = await h.run({ op: "ping" }, { inProcess: inProc() });
    expect(r.kind).toBe("ok");
    expect(spy.created).toHaveLength(2);
    // three idle retires never accumulate into a crash-disable
    for (let i = 0; i < 3; i++) {
      await sleep(400);
      expect((await h.run({ op: "ping" }, { inProcess: () => "in-process" })).kind).toBe("ok");
    }
    expect(spy.created).toHaveLength(5);
  }, 15_000);
});
