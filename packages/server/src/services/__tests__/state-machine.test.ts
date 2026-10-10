/**
 * Lifecycle state machine through the real ServiceManager with a scripted
 * driver and a fake clock. See change: add-service-registry-core
 * (test-plan E12–E17, X1–X4, P1).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backoffMs,
  DIAGRAM_EDGES,
  isLegalEdge,
  LIFECYCLE_LOCK_OPTIONS,
  LifecycleLockTimeoutError,
  startPhaseOutcome,
  withLifecycleLock,
} from "../state-machine.js";
import { FakeClock, FakeDriver, makeManager, ociDef, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
function root(): string {
  const r = tmpRoot("svc-sm-");
  roots.push(r);
  return r;
}

function setup(defOverrides = {}) {
  const r = root();
  writeDefinitions(r, [ociDef(defOverrides)]);
  const clock = new FakeClock();
  const driver = new FakeDriver("oci:docker", clock.sleep);
  const h = makeManager(r, { drivers: { "oci:docker": driver }, clock });
  return { ...h, driver };
}

const EDGE = /^\[services\] docling (\S+)→(\S+) reason=(.+)$/;
function edgesOf(logs: string[]): Array<[string, string]> {
  return logs.flatMap((l) => {
    const m = EDGE.exec(l);
    return m && !l.endsWith("(init)") ? [[m[1], m[2]] as [string, string]] : [];
  });
}

describe("E12 — every D2 edge, one log line per transition", () => {
  it("drives the whole diagram and logs from→to with a reason", async () => {
    const { manager, driver, clock, logs, probeOk } = setup({ startTimeoutSec: 5 });
    // stopped → starting → healthy
    let p = await manager.ensure("docling");
    expect(p.state).toBe("healthy");
    // healthy → idle (lease released, scheduler tick)
    manager.release("docling", p.leaseId as string);
    await manager.tick();
    // idle → healthy
    p = await manager.ensure("docling");
    manager.release("docling", p.leaseId as string);
    // healthy → blocked (alive, probe failing) — via a leased re-probe
    p = await manager.ensure("docling");
    probeOk.value = false;
    await manager.tick();
    // blocked → healthy (probe recovers)
    probeOk.value = true;
    await manager.ensure("docling");
    // → idle → blocked (ensure while idle, probe failing)
    clock.advance(400_000); // every lease expired
    await manager.tick();
    probeOk.value = false;
    await manager.ensure("docling");
    probeOk.value = true;
    p = await manager.ensure("docling");
    manager.release("docling", p.leaseId as string);
    await manager.tick();
    // idle → stopping → stop-failed (idle-stop, no exit observed)
    driver.stopOutcome = "stop-failed";
    clock.advance(16 * 60_000);
    await manager.tick();
    // stop-failed → stopping → stopped (manual stop)
    driver.stopOutcome = "stopped";
    await manager.stop("docling");
    // stopped → starting → failed
    driver.startError = new Error("boom");
    expect((await manager.ensure("docling")).state).toBe("failed");
    // failed → starting → blocked (alive, probe failing past startTimeout)
    driver.startError = undefined;
    clock.advance(10_000);
    probeOk.value = false;
    expect((await manager.ensure("docling")).state).toBe("blocked");

    const seen = edgesOf(logs);
    for (const [from, to] of DIAGRAM_EDGES) {
      expect(seen, `${from}→${to}`).toContainEqual([from, to]);
    }
    for (const [from, to] of seen) expect(isLegalEdge(from as never, to as never), `${from}→${to}`).toBe(true);
    expect(logs.some((l) => l.includes("illegal"))).toBe(false);
    for (const l of logs.filter((x) => EDGE.test(x))) expect(l).toMatch(/reason=\S/);
  });

  it("rejects edges the diagram does not have", () => {
    expect(isLegalEdge("stopped", "healthy")).toBe(false);
    expect(isLegalEdge("blocked", "idle")).toBe(false);
    expect(isLegalEdge("starting", "idle")).toBe(false);
  });
});

describe("E13 — never healthy without a passing probe", () => {
  it("idle + probe failing + alive → blocked, no lease, no endpoints", async () => {
    const { manager, probeOk } = setup();
    const first = await manager.ensure("docling");
    manager.release("docling", first.leaseId as string);
    await manager.tick();
    probeOk.value = false;
    const p = await manager.ensure("docling");
    expect(p.state).toBe("blocked");
    expect(p.leaseId).toBeUndefined();
    expect(p.endpoints).toBeUndefined();
  });
});

describe("E14 — startTimeout boundary", () => {
  it("startPhaseOutcome: 119.9 s starting, 120.1 s blocked", () => {
    const base = { probeOk: false, alive: true as const, startTimeoutMs: 120_000 };
    expect(startPhaseOutcome({ ...base, elapsedMs: 119_900 })).toBe("starting");
    expect(startPhaseOutcome({ ...base, elapsedMs: 120_100 })).toBe("blocked");
    expect(startPhaseOutcome({ ...base, alive: false, elapsedMs: 1 })).toBe("failed");
    expect(startPhaseOutcome({ ...base, probeOk: true, elapsedMs: 200_000 })).toBe("healthy");
  });
  it("manager: blocked only once 120 s have elapsed", async () => {
    const { manager, probeOk, clock } = setup();
    probeOk.value = false;
    const t0 = clock.now();
    const p = await manager.ensure("docling");
    expect(p.state).toBe("blocked");
    expect(clock.now() - t0).toBeGreaterThan(120_000);
    expect(clock.now() - t0).toBeLessThanOrEqual(121_000);
  });
});

describe("E15 — exponential backoff", () => {
  it("5,10,20,40,80,160,300,300 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffMs(n) / 1000)).toEqual([5, 10, 20, 40, 80, 160, 300, 300]);
  });
  it("retryAt deltas grow, and reset after healthy", async () => {
    const { manager, driver, clock } = setup();
    driver.startError = new Error("nope");
    const deltas: number[] = [];
    for (let i = 0; i < 8; i++) {
      const p = await manager.ensure("docling");
      expect(p.state).toBe("failed");
      const retryAt = Date.parse(p.retryAt as string);
      deltas.push((retryAt - clock.now()) / 1000);
      clock.t = retryAt;
    }
    expect(deltas).toEqual([5, 10, 20, 40, 80, 160, 300, 300]);
    driver.startError = undefined;
    expect((await manager.ensure("docling")).state).toBe("healthy");
    await manager.stop("docling");
    driver.startError = new Error("again");
    const p = await manager.ensure("docling");
    expect((Date.parse(p.retryAt as string) - clock.now()) / 1000).toBe(5);
  });
});

describe("E16 — no start path overrides retryAt", () => {
  it("ensure/start return failed+retryAt without starting; retry clears and starts once", async () => {
    const { manager, driver } = setup();
    driver.startError = new Error("bad");
    await manager.ensure("docling");
    driver.startError = undefined;
    const before = driver.calls.start;
    const e = await manager.ensure("docling");
    const s = await manager.start("docling");
    expect(e.state).toBe("failed");
    expect(e.retryAt).toBeDefined();
    expect(s.state).toBe("failed");
    expect(driver.calls.start).toBe(before);
    const r = await manager.retry("docling");
    expect(r.state).toBe("healthy");
    expect(driver.calls.start).toBe(before + 1);
  });
});

describe("E17 — stale definition on a live instance", () => {
  it("keeps serving the old instance and reports restartRequired", async () => {
    const { manager, driver } = setup();
    driver.adoptResult = {
      kind: "running",
      instance: { driver: "oci:docker", startedBy: "dashboard", endpoints: { http: "http://127.0.0.1:50000" }, defHash: "old-hash" },
    };
    const p = await manager.ensure("docling");
    expect(p.state).toBe("healthy");
    expect(p.endpoints).toEqual({ http: "http://127.0.0.1:50000" });
    expect(p.restartRequired).toBe(true);
    expect(driver.calls.start).toBe(0);
  });
});

describe("X1 — concurrent ensure starts once", () => {
  it("5 concurrent ensures → 1 start, same endpoint", async () => {
    const r = root();
    writeDefinitions(r, [ociDef()]);
    const driver = new FakeDriver("oci:docker");
    driver.startDelayMs = 100;
    const { manager } = makeManager(r, { drivers: { "oci:docker": driver } });
    const all = await Promise.all(Array.from({ length: 5 }, () => manager.ensure("docling")));
    expect(driver.calls.start).toBe(1);
    for (const p of all) {
      expect(p.state).toBe("healthy");
      expect(p.endpoints).toEqual(all[0].endpoints);
      expect(p.leaseId).toBeDefined();
    }
    expect(new Set(all.map((p) => p.leaseId)).size).toBe(5);
  });
});

describe("X2 — two servers, one HOME, one lifecycle lock", () => {
  it("a second manager waits on the lock, then adopts instead of starting", async () => {
    const r = root();
    writeDefinitions(r, [ociDef()]);
    const world = { running: false };
    const mk = () => {
      const d = new FakeDriver("oci:docker");
      d.startDelayMs = 300;
      const orig = d.start.bind(d);
      d.start = async (def, ctx) => {
        const inst = await orig(def, ctx);
        world.running = true;
        return inst;
      };
      d.adoptResult = () =>
        world.running
          ? { kind: "running", instance: { driver: "oci:docker", startedBy: "dashboard", endpoints: { http: "http://127.0.0.1:41000" } } }
          : { kind: "none" };
      return d;
    };
    const dA = mk();
    const dB = mk();
    const a = makeManager(r, { drivers: { "oci:docker": dA } }).manager;
    const b = makeManager(r, { drivers: { "oci:docker": dB } }).manager;
    const [pa, pb] = await Promise.all([a.ensure("docling"), b.ensure("docling")]);
    expect(pa.state).toBe("healthy");
    expect(pb.state).toBe("healthy");
    expect(dA.calls.start + dB.calls.start).toBe(1);
  });

  it("the lock is refreshed while held: not stolen after `stale`", async () => {
    expect(LIFECYCLE_LOCK_OPTIONS.update).toBeLessThan(LIFECYCLE_LOCK_OPTIONS.stale);
    const target = path.join(root(), "svc", "lifecycle");
    // proper-lockfile floors stale at 2 s / update at 1 s; hold > 2×stale.
    const holding = withLifecycleLock(target, () => new Promise((res) => setTimeout(res, 4_600)), { stale: 2_000, update: 1_000 });
    await new Promise((res) => setTimeout(res, 4_200));
    await expect(withLifecycleLock(target, async () => "stolen", { stale: 2_000, update: 1_000, waitMs: 0 })).rejects.toBeInstanceOf(
      LifecycleLockTimeoutError,
    );
    await holding;
    await expect(withLifecycleLock(target, async () => "free", { stale: 2_000, waitMs: 0 })).resolves.toBe("free");
  }, 15_000);
});

describe("X3/X4 — a stop is confirmed only by observed exit", () => {
  it("X3: driver observed exit → stopped", async () => {
    const { manager, driver } = setup();
    await manager.ensure("docling");
    driver.stopOutcome = "stopped";
    expect((await manager.stop("docling")).state).toBe("stopped");
  });
  it("X4: no exit within stopTimeout → stop-failed, and ensure does not restart over it", async () => {
    const { manager, driver } = setup();
    await manager.ensure("docling");
    driver.stopOutcome = "stop-failed";
    expect((await manager.stop("docling")).state).toBe("stop-failed");
    const starts = driver.calls.start;
    expect((await manager.ensure("docling")).state).toBe("stop-failed");
    expect(driver.calls.start).toBe(starts);
  });
});

describe("P1 — probe concurrency cap", () => {
  it("20 leased services with stalling probes: ≤ 4 in flight in one 30 s cycle", async () => {
    const r = root();
    const defs = Array.from({ length: 20 }, (_, i) => ociDef({ id: `svc-${i}` }));
    writeDefinitions(r, defs);
    const driver = new FakeDriver("oci:docker");
    let inFlight = 0;
    let maxInFlight = 0;
    let stall = false;
    const clock = new FakeClock();
    const { manager } = makeManager(r, {
      clock,
      drivers: { "oci:docker": driver },
      probe: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (stall) await new Promise((res) => setTimeout(res, 20));
        inFlight--;
        return true;
      },
    });
    for (const d of defs) await manager.ensure(d.id);
    maxInFlight = 0;
    stall = true;
    clock.advance(30_000);
    await manager.tick();
    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});
