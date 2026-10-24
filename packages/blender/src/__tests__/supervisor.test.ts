/**
 * Supervisor (design D6) against a scripted fake Blender host (a real child process with IPC, so kill /
 * timeout / crash semantics are real): session reset signal, queue bounds, serial execution, cancellation,
 * timeout scope, boot failure + repair, crash recovery, JSPI gate, idle shutdown, lazy start.
 *
 * See change: add-blender-wasm-mcp (test-plan E25, E53, X8, X9, X12, X15, X17, X20).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "../errors.js";
import { type Cancelled, defaultSupervisorDeps, MAX_QUEUE_DEPTH, type Outcome } from "../host/supervisor.js";
import { startTool } from "../mcp/tools.js";
import { resolveLimits } from "../mcp/workspace.js";
import { cleanupAll, makeHarness, run, runtimeResult, settlesWithin, sleep, tmpDir } from "./helpers/fake-host-kit.js";
import { isAlive, waitUntil } from "./helpers/mcp-client.js";

afterEach(cleanupAll);

const isCancelled = (o: Outcome | Cancelled): o is Cancelled => "cancelled" in o;

describe("supervisor: lazy start", () => {
  it("E54 (unit): constructing a Supervisor probes, provisions and spawns nothing", async () => {
    const h = makeHarness();
    const sup = h.supervisor();
    await sleep(50);
    expect(h.spies.probe).not.toHaveBeenCalled();
    expect(h.spies.provision).not.toHaveBeenCalled();
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
    await sup.shutdown(); // shutting down an unused supervisor is a no-op
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
    expect(sup.currentRuntime).toBeUndefined();
  });

  it("the first call probes once, provisions once and spawns once; later calls reuse the live session", async () => {
    const h = makeHarness();
    const sup = h.supervisor();
    expect((await run(sup, { op: "python" })).ok).toBe(true);
    expect((await run(sup, { op: "python" })).ok).toBe(true);
    expect(h.spies.probe).toHaveBeenCalledTimes(1);
    expect(h.spies.provision).toHaveBeenCalledTimes(1);
    expect(h.spies.spawnHost).toHaveBeenCalledTimes(1);
    expect(h.boots()).toHaveLength(1);
    expect(h.ops()).toHaveLength(2);
    expect(sup.currentRuntime?.version).toBe("0.0.5");
  });

  it("a `flag` probe result starts the host with --experimental-wasm-jspi, `native` without", async () => {
    const flagged = makeHarness({}, { probe: { mode: "flag", node: "v24.15.0" } });
    await run(flagged.supervisor(), { op: "reset" });
    expect(flagged.spies.spawnHost.mock.calls[0][0]).toEqual(["--experimental-wasm-jspi"]);
    const native = makeHarness();
    await run(native.supervisor(), { op: "reset" });
    expect(native.spies.spawnHost.mock.calls[0][0]).toEqual([]);
  });

  it("inputs are read at dequeue: a failing stage never probes, provisions or boots", async () => {
    const h = makeHarness();
    const sup = h.supervisor();
    const out = await run(sup, {
      op: "python",
      stage: async () => {
        throw new ToolError("input-not-found", "missing.obj: no such file");
      },
    });
    expect(out).toMatchObject({ ok: false, code: "input-not-found" });
    expect(h.spies.probe).not.toHaveBeenCalled();
    expect(h.spies.provision).not.toHaveBeenCalled();
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
  });

  it("a queued call's stage runs only when it is dequeued (after the call ahead of it)", async () => {
    const h = makeHarness({ steps: [{ delayMs: 400 }] });
    const sup = h.supervisor();
    const stage = vi.fn(async () => ({ files: {} }));
    const a = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 30, outputLimit: 1024 });
    const b = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 30, outputLimit: 1024, stage });
    await sleep(150);
    expect(stage).not.toHaveBeenCalled();
    await Promise.all([a.promise, b.promise]);
    expect(stage).toHaveBeenCalledTimes(1);
  });
});

describe("supervisor: session reset signal", () => {
  it("E25: sessionReset is false, false, (timeout), true, false across ok → ok → timeout → python-error → ok", async () => {
    const h = makeHarness({
      steps: [{ result: { n: 1 } }, { result: { n: 2 } }, { delayMs: 30_000 }, { error: { code: "python-error", message: "Traceback" } }, { result: { n: 5 } }],
    });
    const sup = h.supervisor();
    const r1 = await run(sup, { op: "python" });
    const r2 = await run(sup, { op: "python" });
    const r3 = await run(sup, { op: "python", timeoutSec: 0.4 });
    const r4 = await run(sup, { op: "python" });
    const r5 = await run(sup, { op: "python" });

    expect(r1).toMatchObject({ ok: true, sessionReset: false });
    expect(r2).toMatchObject({ ok: true, sessionReset: false });
    expect(r3).toMatchObject({ ok: false, code: "timeout" });
    expect(r4).toMatchObject({ ok: false, code: "python-error", sessionReset: true });
    expect(r5).toMatchObject({ ok: true, sessionReset: false });
    // The timeout ended the session: the host booted a second time, and the first host is gone.
    expect(h.boots()).toHaveLength(2);
    expect(isAlive(h.boots()[0].pid)).toBe(false);
  });

  it("a failing python call that did not lose the session does not set sessionReset", async () => {
    const h = makeHarness({ steps: [{ error: { code: "python-error", message: "x" } }, {}] });
    const sup = h.supervisor();
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: false, code: "python-error", sessionReset: false });
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true, sessionReset: false });
    expect(h.boots()).toHaveLength(1);
  });
});

describe("supervisor: queue", () => {
  it("E53: with one call in flight, 32 enqueued calls wait and the 33rd is limit-exceeded", async () => {
    const h = makeHarness({ steps: [{ delayMs: 60_000 }] });
    const sup = h.supervisor();
    const held = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 120, outputLimit: 1024 });
    expect(await waitUntil(() => h.ops().length === 1, 10_000)).toBe(true);

    const queued = Array.from({ length: MAX_QUEUE_DEPTH }, () => sup.enqueue({ op: "python", args: {} as never, timeoutSec: 120, outputLimit: 1024 }));
    expect(MAX_QUEUE_DEPTH).toBe(32);
    for (const c of queued) expect(await settlesWithin(c.promise, 0)).toBe(false);

    const overflow = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 120, outputLimit: 1024 });
    expect(await overflow.promise).toMatchObject({ ok: false, code: "limit-exceeded", sessionReset: false });
    expect(h.ops()).toHaveLength(1); // still only the held call reached the host

    await sup.shutdown();
    const settled = await Promise.all([held.promise, ...queued.map((q) => q.promise)]);
    expect(settled.every(isCancelled)).toBe(true);
  });

  it("X8: calls run serially; the second starts only after the first result was sent", async () => {
    const h = makeHarness({ steps: [{ delayMs: 200, result: { n: 1 } }, { result: { n: 2 } }] });
    const sup = h.supervisor();
    const a = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 30, outputLimit: 1024 });
    const b = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 30, outputLimit: 1024 });
    const [ra, rb] = await Promise.all([a.promise, b.promise]);
    expect(ra).toMatchObject({ ok: true, result: { n: 1 } });
    expect(rb).toMatchObject({ ok: true, result: { n: 2 } });
    const log = h.logEntries();
    const start1 = log.find((e) => e.type === "op" && e.n === 1);
    const sent0 = log.find((e) => e.type === "sent" && e.n === 0);
    expect(start1 && sent0).toBeTruthy();
    expect((start1?.t ?? 0) >= (sent0?.t ?? Number.POSITIVE_INFINITY)).toBe(true);
    // Order in the log itself: op0, sent0, op1.
    expect(log.filter((e) => e.type !== "boot").map((e) => `${e.type}${e.n}`)).toEqual(["op0", "sent0", "op1", "sent1"]);
  });
});

describe("supervisor: cancellation", () => {
  it("X9: a queued call that is cancelled never reaches the host and gets no result", async () => {
    const h = makeHarness({ steps: [{ delayMs: 600 }, {}] });
    const sup = h.supervisor();
    const stageB = vi.fn(async () => ({ files: {} }));
    const a = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 30, outputLimit: 1024 });
    const b = sup.enqueue({ op: "python", args: { code: "B" } as never, timeoutSec: 30, outputLimit: 1024, stage: stageB });
    expect(await waitUntil(() => h.ops().length === 1, 10_000)).toBe(true);
    b.cancel();
    expect(await b.promise).toEqual({ cancelled: true });
    expect(await a.promise).toMatchObject({ ok: true });
    // A later call still runs: the queue is not wedged by the cancelled entry.
    expect(await run(sup, { op: "python", args: { code: "C" } as never })).toMatchObject({ ok: true });
    expect(stageB).not.toHaveBeenCalled();
    const codes = h.ops().map((o) => (o.args as { code?: string }).code);
    expect(codes).not.toContain("B");
    expect(h.ops()).toHaveLength(2);
  });

  it("X9: cancelling the in-flight call kills the host; the next call starts a fresh session (sessionReset)", async () => {
    const h = makeHarness({ steps: [{ delayMs: 60_000 }, {}] });
    const sup = h.supervisor();
    const a = sup.enqueue({ op: "python", args: {} as never, timeoutSec: 120, outputLimit: 1024 });
    expect(await waitUntil(() => h.ops().length === 1, 10_000)).toBe(true);
    a.cancel();
    expect(await a.promise).toEqual({ cancelled: true });
    expect(await waitUntil(() => !isAlive(h.boots()[0].pid), 5000)).toBe(true);
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true, sessionReset: true });
    expect(h.boots()).toHaveLength(2);
  });

  it("enqueue after shutdown answers session-crashed without starting anything", async () => {
    const h = makeHarness();
    const sup = h.supervisor();
    await sup.shutdown();
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: false, code: "session-crashed" });
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
  });

  it("shutdown kills a live host", async () => {
    const h = makeHarness();
    const sup = h.supervisor();
    await run(sup, { op: "python" });
    const pid = h.boots()[0].pid;
    expect(isAlive(pid)).toBe(true);
    await sup.shutdown();
    expect(await waitUntil(() => !isAlive(pid), 5000)).toBe(true);
  });
});

describe("supervisor: timeout scope", () => {
  it("X12: timeoutSec covers only the operation — slow provisioning and boot on the first call are not `timeout`", async () => {
    // Scaled down from provisioning 8 s / timeoutSec 5: provision 800 ms + boot 400 ms against timeoutSec 0.5.
    const h = makeHarness({ boots: [{ delayMs: 400 }], steps: [{}, { delayMs: 3000 }] });
    h.spies.provision.mockImplementation(async () => {
      await sleep(800);
      return runtimeResult();
    });
    const sup = h.supervisor();
    const t0 = Date.now();
    const first = await run(sup, { op: "scene", timeoutSec: 0.5 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1100); // the budget was exceeded by provisioning + boot...
    expect(first.ok).toBe(true); // ...and yet the call is not a timeout
    expect(first).not.toMatchObject({ code: "timeout" });
    // The timer is real: an operation slower than timeoutSec does time out.
    expect(await run(sup, { op: "scene", timeoutSec: 0.4 })).toMatchObject({ ok: false, code: "timeout" });
  });
});

describe("supervisor: boot failure and repair", () => {
  it("X15: an override runtime that fails to boot is boot-failed; the override dir is untouched and repair is not invoked", async () => {
    const override = tmpDir("blender-override-");
    fs.writeFileSync(path.join(override, "blender.wasm"), "wasm");
    fs.mkdirSync(path.join(override, "sub"));
    fs.writeFileSync(path.join(override, "sub", "x.txt"), "x");
    const before = fs.readdirSync(override, { recursive: true }).sort();
    const h = makeHarness({ boots: [{ exitCode: 1, stderr: "kaboom: cannot instantiate" }] }, { runtime: { source: "override", dir: override, version: "9.9.9" } });
    const sup = h.supervisor();
    const out = await run(sup, { op: "python" });
    expect(out).toMatchObject({ ok: false, code: "boot-failed" });
    expect(out.ok ? "" : out.message).toContain("kaboom: cannot instantiate");
    expect(h.spies.repair).not.toHaveBeenCalled();
    expect(fs.readdirSync(override, { recursive: true }).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(override, "blender.wasm"), "utf8")).toBe("wasm");
  });

  it("boot-failed on a non-override runtime calls repair(version) exactly once", async () => {
    const h = makeHarness({ boots: [{ exitCode: 1, stderr: "bad wasm" }] }, { runtime: { source: "cache", version: "0.0.5" } });
    const sup = h.supervisor();
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: false, code: "boot-failed" });
    expect(h.spies.repair).toHaveBeenCalledTimes(1);
    expect(h.spies.repair).toHaveBeenCalledWith("0.0.5");
    // After the repair the next call provisions again and boots (the second boot is scripted to succeed).
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true });
    expect(h.spies.provision).toHaveBeenCalledTimes(2);
    expect(h.spies.repair).toHaveBeenCalledTimes(1);
  });

  it("a repair failure never masks boot-failed", async () => {
    const h = makeHarness({ boots: [{ exitCode: 3 }] });
    h.spies.repair.mockRejectedValue(new Error("disk full"));
    expect(await run(h.supervisor(), { op: "python" })).toMatchObject({ ok: false, code: "boot-failed" });
  });

  it("a host that never reports ready is killed at the boot timeout and is boot-failed", async () => {
    const h = makeHarness({ boots: [{ hang: true }] }, { deps: { bootTimeoutMs: 600 } });
    const sup = h.supervisor();
    const out = await run(sup, { op: "python" });
    expect(out).toMatchObject({ ok: false, code: "boot-failed" });
    expect(out.ok ? "" : out.message).toMatch(/did not become ready/);
    expect(await waitUntil(() => !isAlive(h.boots()[0].pid), 5000)).toBe(true);
    expect(h.spies.repair).toHaveBeenCalledTimes(1);
  });

  it("a provision failure is provision-failed (with the error code) and spawns nothing", async () => {
    const h = makeHarness();
    h.spies.provision.mockRejectedValue(Object.assign(new Error("offline"), { code: "download-failed" }));
    const out = await run(h.supervisor(), { op: "python" });
    expect(out).toMatchObject({ ok: false, code: "provision-failed" });
    expect(out.ok ? "" : out.message).toContain("download-failed: offline");
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
  });
});

describe("supervisor: crash recovery", () => {
  it("X17: a host that exits with code 1 mid-call is session-crashed (with its stderr tail); the supervisor survives and boots again", async () => {
    const h = makeHarness({ steps: [{ exitCode: 1, stderr: "RuntimeError: unreachable" }, { result: { ok: 1 } }] });
    const sup = h.supervisor();
    const crashed = await run(sup, { op: "python" });
    expect(crashed).toMatchObject({ ok: false, code: "session-crashed", sessionReset: false });
    expect(crashed.ok ? "" : crashed.message).toContain("RuntimeError: unreachable");
    const next = await run(sup, { op: "python" });
    expect(next).toMatchObject({ ok: true, sessionReset: true });
    expect(h.boots()).toHaveLength(2);
    expect(h.spies.repair).not.toHaveBeenCalled();
  });

  it("keeps only the last 20 stderr lines in a crash message", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    const h = makeHarness({ steps: [{ exitCode: 1, stderr: many }] });
    const out = await run(h.supervisor(), { op: "python" });
    const msg = out.ok ? "" : out.message;
    expect(msg).toContain("line-39");
    expect(msg).toContain("line-20");
    expect(msg).not.toContain("line-19");
  });
});

describe("supervisor: JSPI gate", () => {
  it("X20: probe `unavailable` on v22.22.0 is jspi-unavailable naming the version and Node 24; nothing is provisioned or spawned", async () => {
    const h = makeHarness({}, { probe: { mode: "unavailable", node: "v22.22.0" } });
    const sup = h.supervisor();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const run1 = startTool("blender_scene", {}, { root: h.dir, supervisor: sup, limits: resolveLimits({}) });
    const res = await run1.promise;
    if ("cancelled" in res) throw new Error("cancelled");
    expect(res.isError).toBe(true);
    const data = JSON.parse(res.content[0].text) as { code: string; message: string };
    expect(data.code).toBe("jspi-unavailable");
    expect(data.message).toContain("v22.22.0");
    expect(data.message).toContain("Node 24 or newer");
    expect(h.spies.probe).toHaveBeenCalledTimes(1);
    expect(h.spies.provision).not.toHaveBeenCalled();
    expect(h.spies.spawnHost).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The verdict is cached for the session: a second call does not probe again, and still never provisions.
    await startTool("blender_scene", {}, { root: h.dir, supervisor: sup, limits: resolveLimits({}) }).promise;
    expect(h.spies.probe).toHaveBeenCalledTimes(1);
    expect(h.spies.provision).not.toHaveBeenCalled();
  });
});

describe("supervisor: idle shutdown", () => {
  it("kills the idle host after idleMs; the next call boots a fresh session (sessionReset)", async () => {
    const h = makeHarness({}, { deps: { idleMs: 250 } });
    const sup = h.supervisor();
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true, sessionReset: false });
    const pid = h.boots()[0].pid;
    expect(await waitUntil(() => !isAlive(pid), 5000)).toBe(true);
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true, sessionReset: true });
    expect(h.boots()).toHaveLength(2);
  });

  it("does not run the idle timer while a call is in flight, even when the call outlasts idleMs", async () => {
    const h = makeHarness({ steps: [{ delayMs: 700 }] }, { deps: { idleMs: 200 } });
    const sup = h.supervisor();
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true, sessionReset: false });
    expect(h.boots()).toHaveLength(1);
  });

  it("the idle timer is re-armed by each call: a call within idleMs keeps the same session", async () => {
    const h = makeHarness({}, { deps: { idleMs: 700 } });
    const sup = h.supervisor();
    await run(sup, { op: "python" });
    await sleep(300);
    expect(await run(sup, { op: "python" })).toMatchObject({ ok: true, sessionReset: false });
    expect(h.boots()).toHaveLength(1);
  });

  it("defaultSupervisorDeps reads BLENDER_WASM_IDLE_SEC, ignoring garbage", () => {
    expect(defaultSupervisorDeps({ BLENDER_WASM_IDLE_SEC: "5" }).idleMs).toBe(5000);
    expect(defaultSupervisorDeps({ BLENDER_WASM_IDLE_SEC: "nope" }).idleMs).toBe(600_000);
    expect(defaultSupervisorDeps({ BLENDER_WASM_IDLE_SEC: "0" }).idleMs).toBe(600_000);
    expect(defaultSupervisorDeps({}).bootTimeoutMs).toBe(120_000);
  });
});
