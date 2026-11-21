// @vitest-environment node
/**
 * Reindex runner (worker host) — injected `workerFactory`, no real thread. Folded from
 * openspec/changes/throttle-kb-reindex/test-plan.md: #S37 #S44 #S45 #S46 #S48 #S49 #S65 #S72.
 * Exemplars: packages/server/src/__tests__/credential-key-worker.test.ts (factory),
 * credential-key-deadline.test.ts (fake timers).
 */
import { getEventListeners } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KbJobRegistry } from "../job-registry.js";
import { mountKbRoutes } from "../kb-routes.js";
import { coalesceProgress, type ReindexCoreInput } from "../reindex-core.js";
import { createReindexRunner } from "../reindex-runner.js";
import { type FakeReindexWorker, fakeFactory } from "./helpers/fake-reindex-worker.js";

const cleanup: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const r of cleanup.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeFolder(): string {
  const root = mkdtempSync(join(tmpdir(), "kb-runner-"));
  cleanup.push(root);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "a.md"), "# Alpha\n\nSome alpha content about widgets.\n");
  mkdirSync(join(root, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(root, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify({ sources: [{ kind: "filesystem", ref: "docs" }] }));
  return root;
}

const input = (cwd: string, mode: ReindexCoreInput["mode"] = "in-place"): ReindexCoreInput => ({ cwd, dbPath: join(cwd, "index.db"), mode, gate: "g", sources: [] });
const tick = () => new Promise<void>((r) => setImmediate(r));
const q = (cwd: string) => encodeURIComponent(cwd);

function build(cwds: string[], runnerOpts: Parameters<typeof createReindexRunner>[0]) {
  const app: FastifyInstance = Fastify();
  const registry = new KbJobRegistry();
  const runner = createReindexRunner(runnerOpts);
  mountKbRoutes(app, { knownCwds: () => cwds, registry, reindexRunner: runner });
  return { app, registry, runner };
}
const post = (app: FastifyInstance, cwd: string) => app.inject({ method: "POST", url: `/api/kb/reindex?cwd=${q(cwd)}` });
const stats = async (app: FastifyInstance, cwd: string) => (await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${q(cwd)}` })).json();
async function settled(app: FastifyInstance, cwd: string) {
  for (let i = 0; i < 200; i++) {
    const s = await stats(app, cwd);
    if (s.jobStatus !== "running") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never settled");
}
const logSpy = (app: FastifyInstance) => ({ info: vi.spyOn(app.log, "info"), warn: vi.spyOn(app.log, "warn") });
const lines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.map(String).join(" "));

describe("S37 one worker per cwd", () => {
  it("a second reindex for A coalesces (202, same jobId, no new worker); B gets its own worker", async () => {
    const a = makeFolder();
    const b = makeFolder();
    const { factory, workers } = fakeFactory((w) => w.ready()); // never finishes by itself
    const { app, registry } = build([a, b], { workerFactory: factory, useWorker: () => true });
    const r1 = await post(app, a);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const r2 = await post(app, a);
    expect(r1.statusCode).toBe(202);
    expect(r2.statusCode).toBe(202);
    expect(r2.json().jobId).toBe(r1.json().jobId);
    expect(workers).toHaveLength(1);
    await post(app, b);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect(workers[1].input.cwd).toBe(b);
    for (const w of workers) w.result();
    await Promise.all([settled(app, a), settled(app, b)]);
    expect(registry.isRunning(a) || registry.isRunning(b)).toBe(false);
    await app.close();
  });

  it("the runner itself refuses a second concurrent worker for one cwd", async () => {
    const { factory, workers } = fakeFactory((w) => w.ready());
    const runner = createReindexRunner({ workerFactory: factory, useWorker: () => true });
    const cwd = makeFolder();
    const first = runner.run(input(cwd));
    await tick();
    await expect(runner.run(input(cwd))).rejects.toThrow(/already running/);
    expect(workers).toHaveLength(1);
    workers[0].result();
    await first;
  });
});

describe.each([
  ["a non-zero exit", (w: FakeReindexWorker) => w.exit(1)],
  ["an uncaught error", (w: FakeReindexWorker) => w.crash(new Error("boom in worker"))],
])("S44 worker crash after ready — %s", (_name, kill) => {
  it("fails the job with a message, logs outcome=crashed, the server answers, a later reindex spawns a fresh worker", async () => {
    const cwd = makeFolder();
    let n = 0;
    const { factory, workers } = fakeFactory((w) => {
      w.ready();
      if (++n === 1) kill(w);
      else w.result();
    });
    const { app } = build([cwd], { workerFactory: factory, useWorker: () => true });
    const log = logSpy(app);
    await post(app, cwd);
    const s = await settled(app, cwd);
    expect(s.jobStatus).toBe("error");
    expect(String(s.lastError ?? "").length).toBeGreaterThan(0);
    expect(lines(log.info).some((l) => /outcome=crashed/.test(l)) || lines(log.warn).some((l) => /outcome=crashed/.test(l))).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/kb/stats?cwd=${q(cwd)}` })).statusCode).toBe(200);
    await post(app, cwd);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    expect((await settled(app, cwd)).jobStatus).toBe("idle");
    await app.close();
  });
});

describe("S45 worker out of memory", () => {
  it("ERR_WORKER_OUT_OF_MEMORY fails the job with a memory message and leaks no listeners", async () => {
    const cwd = makeFolder();
    const { factory, workers } = fakeFactory((w) => {
      w.ready();
      w.crash(Object.assign(new Error("Worker terminated due to reaching memory limit: JS heap out of memory"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    });
    const { app } = build([cwd], { workerFactory: factory, useWorker: () => true });
    await post(app, cwd);
    const s = await settled(app, cwd);
    expect(s.jobStatus).toBe("error");
    expect(s.lastError).toMatch(/memory|worker crash/i);
    for (const ev of ["message", "error", "exit"]) expect(workers[0].listenerCount(ev)).toBe(0);
    await app.close();
  });
});

describe("S46 worker load failure before ready", () => {
  it("falls back in-process through the same core, warns, logs mode=inprocess; the next job retries the worker", async () => {
    const cwd = makeFolder();
    const { factory, workers } = fakeFactory((w) => w.loadFailed("Cannot find module './nope.ts'"));
    const { app } = build([cwd], { workerFactory: factory, useWorker: () => true });
    const log = logSpy(app);
    await post(app, cwd);
    const s = await settled(app, cwd);
    expect(s.jobStatus).toBe("idle");
    expect(s.chunks).toBeGreaterThan(0); // indexed in-process (the fake worker never indexes)
    expect(lines(log.warn).some((l) => /nope\.ts/.test(l))).toBe(true);
    expect(lines(log.info).some((l) => /mode=inprocess/.test(l))).toBe(true);
    await post(app, cwd);
    await vi.waitFor(() => expect(workers).toHaveLength(2)); // retried the worker
    await settled(app, cwd);
    await app.close();
  });

  it("an uncaught error before ready is also a load failure (fallback, not a failed job)", async () => {
    const cwd = makeFolder();
    const { factory } = fakeFactory((w) => w.crash(new Error("SyntaxError in reindex-worker.mjs")));
    const { app } = build([cwd], { workerFactory: factory, useWorker: () => true });
    await post(app, cwd);
    const s = await settled(app, cwd);
    expect(s.jobStatus).toBe("idle");
    expect(s.chunks).toBeGreaterThan(0);
    await app.close();
  });
});

describe("S48 cancel grace period", () => {
  it("terminate() is not called at 4999 ms, called once by 5000 ms; the job settles idle restoring the pre-start state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { factory, workers } = fakeFactory((w) => w.ready()); // ignores cancel
    const runner = createReindexRunner({ workerFactory: factory, useWorker: () => true });
    const registry = new KbJobRegistry();
    const cwd = "/virtual/cwd";
    const job = registry.start(cwd, (ctx) => runner.run(input(cwd), { signal: ctx.signal })).promise;
    const outcome = job.then(() => "ok", (e: Error) => e.name);
    await tick();
    registry.cancel(cwd);
    expect(workers[0].gotCancel).toBe(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(await outcome).toBe("AbortError");
    expect(registry.statusFor(cwd)).toBe("idle");
    expect(registry.get(cwd)).toBeUndefined();
  });
});

describe("S49 shutdown", () => {
  it("runner.shutdown() terminates a cancel-ignoring worker immediately (no grace wait) and resolves", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { factory, workers } = fakeFactory((w) => w.ready());
    const runner = createReindexRunner({ workerFactory: factory, useWorker: () => true });
    const run = runner.run(input("/virtual/cwd")).then(() => "ok", (e: Error) => e.name);
    await tick();
    const done = runner.shutdown();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1); // synchronously, 0 ms of fake time
    await done;
    expect(await run).toBe("AbortError");
    expect(runner.liveCount()).toBe(0);
  });

  it("Fastify onClose triggers the same immediate terminate", async () => {
    const cwd = makeFolder();
    const { factory, workers } = fakeFactory((w) => w.ready());
    const { app } = build([cwd], { workerFactory: factory, useWorker: () => true });
    await post(app, cwd);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const t0 = Date.now();
    await app.close();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("S65 cycle soak", () => {
  it("200 × {start → cancel → settle} interleaved with 200 × {start → ok} leaves nothing behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { factory, workers } = fakeFactory();
    const runner = createReindexRunner({ workerFactory: factory, useWorker: () => true });
    const registry = new KbJobRegistry();
    const cwd = "/virtual/soak";
    const handlesBefore = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles().length;
    for (let i = 0; i < 200; i++) {
      for (const cancel of [true, false]) {
        let signal!: AbortSignal;
        const p = registry.start(cwd, (ctx) => {
          signal = ctx.signal;
          return runner.run(input(cwd), { signal: ctx.signal });
        }).promise.catch(() => undefined);
        await tick();
        const w = workers.at(-1) as FakeReindexWorker;
        w.ready();
        if (cancel) {
          registry.cancel(cwd);
          w.cancelled(); // graceful: the worker honoured the cancel message
        } else w.result();
        await p;
        expect(runner.liveCount()).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(getEventListeners(signal, "abort")).toHaveLength(0);
        expect(registry.isRunning(cwd)).toBe(false);
        expect(registry.jobId(cwd)).toBeUndefined();
        for (const ev of ["message", "error", "exit"]) expect(w.listenerCount(ev)).toBe(0);
        expect(w.terminate).not.toHaveBeenCalled();
      }
    }
    expect((process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles().length).toBeLessThanOrEqual(handlesBefore);
  });
});

describe("S72 progress coalescing", () => {
  it("200 batch commits within 100 ms post at most ⌈elapsed/250⌉+1 messages, spaced ≥ 250 ms", () => {
    vi.useFakeTimers();
    const posted: number[] = [];
    const progress = coalesceProgress(() => posted.push(Date.now()), 250);
    for (let i = 1; i <= 200; i++) {
      progress({ root: "docs", done: i, total: 200 });
      vi.advanceTimersByTime(i % 2 === 0 ? 1 : 0); // 200 commits in 100 ms
    }
    expect(posted.length).toBeLessThanOrEqual(Math.ceil(100 / 250) + 1);
    expect(posted.length).toBeGreaterThanOrEqual(1);

    // a long pass: commits every 10 ms for 2 s
    posted.length = 0;
    const t0 = Date.now();
    for (let i = 1; i <= 200; i++) {
      progress({ root: "docs", done: i, total: 200 });
      vi.advanceTimersByTime(10);
    }
    const elapsed = Date.now() - t0;
    expect(posted.length).toBeLessThanOrEqual(Math.ceil(elapsed / 250) + 1);
    for (let i = 1; i < posted.length; i++) expect(posted[i] - posted[i - 1]).toBeGreaterThanOrEqual(250);
  });
});
