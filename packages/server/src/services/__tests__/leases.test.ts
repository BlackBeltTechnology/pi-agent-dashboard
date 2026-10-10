/**
 * Leases, idle-stop, pin, blocked recovery. See change:
 * add-service-registry-core (test-plan E18–E23).
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { LeaseTable } from "../leases.js";
import { shouldIdleStop } from "../state-machine.js";
import { FakeClock, FakeDriver, makeManager, ociDef, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function setup(defOverrides = {}) {
  const r = tmpRoot("svc-lease-");
  roots.push(r);
  writeDefinitions(r, [ociDef(defOverrides)]);
  const clock = new FakeClock();
  const driver = new FakeDriver("oci:docker", clock.sleep);
  return { ...makeManager(r, { drivers: { "oci:docker": driver }, clock }), driver };
}

const MIN = 60_000;

describe("E18 — lease TTL boundary", () => {
  it("live at t0+299.9 s, expired at t0+300.1 s", () => {
    const t = new LeaseTable(300_000);
    const l = t.create("svc", 0);
    t.heartbeat(l.leaseId, 1_000);
    const t0 = 1_000;
    expect(t.live("svc", t0 + 299_900)).toBe(1);
    expect(t.live("svc", t0 + 300_100)).toBe(0);
    expect(t.heartbeat(l.leaseId, t0 + 300_100)).toBeUndefined();
  });
});

describe("E19 — idle-stop after 15 min", () => {
  it("running at 14:59, one stop at 15:01 after the last lease ended", async () => {
    const { manager, driver, clock } = setup();
    const p = await manager.ensure("docling");
    manager.release("docling", p.leaseId as string);
    const endedAt = clock.now();
    await manager.tick();
    clock.t = endedAt + 14 * MIN + 59_000;
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
    clock.t = endedAt + 15 * MIN + 1_000;
    await manager.tick();
    await manager.tick();
    expect(driver.calls.stop).toBe(1);
  });

  it("a crashed holder: the lease expires at TTL, the stop follows idle minutes later", async () => {
    const { manager, driver, clock } = setup();
    await manager.ensure("docling"); // never released
    const t0 = clock.now();
    clock.t = t0 + 300_000 + 15 * MIN - 1_000;
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
    clock.t = t0 + 300_000 + 15 * MIN + 1_000;
    await manager.tick();
    expect(driver.calls.stop).toBe(1);
  });
});

describe("E20 — idle-stop decision table", () => {
  it("stops only when unpinned ∧ ¬blocked ∧ dashboard-started ∧ has a stop path", () => {
    const rows: Array<[boolean, "idle" | "blocked", "dashboard" | "external", boolean]> = [];
    for (const pinned of [false, true])
      for (const state of ["idle", "blocked"] as const)
        for (const startedBy of ["dashboard", "external"] as const) for (const hasStopPath of [true, false]) rows.push([pinned, state, startedBy, hasStopPath]);
    for (const [pinned, state, startedBy, hasStopPath] of rows) {
      const expected = !pinned && state === "idle" && startedBy === "dashboard" && hasStopPath;
      expect(
        shouldIdleStop({ state, pinned, startedBy, hasStopPath, idleStopMinutes: 15, idleSince: 0, now: 20 * MIN }),
        JSON.stringify({ pinned, state, startedBy, hasStopPath }),
      ).toBe(expected);
    }
    expect(shouldIdleStop({ state: "idle", pinned: false, startedBy: "dashboard", hasStopPath: true, idleStopMinutes: null, idleSince: 0, now: 99 * MIN })).toBe(false);
  });

  it("manager: an externally started instance is never idle-stopped", async () => {
    const { manager, driver, clock } = setup();
    driver.adoptResult = { kind: "running", instance: { driver: "oci:docker", startedBy: "external", endpoints: { http: "http://127.0.0.1:1" } } };
    const p = await manager.ensure("docling");
    manager.release("docling", p.leaseId as string);
    await manager.tick();
    clock.advance(60 * MIN);
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
  });
});

describe("E21 — unpin resets the idle clock", () => {
  it("pinned idle 20 min, unpin at t: not stopped at t+14:59, stopped at t+15:01", async () => {
    const { manager, driver, clock } = setup();
    await manager.pin("docling", true);
    const p = await manager.ensure("docling");
    manager.release("docling", p.leaseId as string);
    await manager.tick();
    clock.advance(20 * MIN);
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
    await manager.pin("docling", false);
    const t = clock.now();
    clock.t = t + 14 * MIN + 59_000;
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
    clock.t = t + 15 * MIN + 1_000;
    await manager.tick();
    expect(driver.calls.stop).toBe(1);
  });
});

describe("E22 — blocked recovery resets the idle clock", () => {
  it("blocked 20 min, probe recovers: no stop one second later", async () => {
    const { manager, driver, clock, probeOk } = setup();
    const p = await manager.ensure("docling");
    manager.release("docling", p.leaseId as string);
    await manager.tick(); // idle
    probeOk.value = false;
    expect((await manager.ensure("docling")).state).toBe("blocked");
    clock.advance(20 * MIN);
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
    probeOk.value = true;
    expect((await manager.status("docling")).state).toBe("healthy");
    clock.advance(1_000);
    await manager.tick();
    await manager.tick();
    expect(driver.calls.stop).toBe(0);
  });
});

describe("E23 — no lease unless healthy", () => {
  it.each([
    ["unavailable", (d: FakeDriver) => { d.presenceResult = { ok: false, reason: "runtime-missing" }; }],
    ["failed", (d: FakeDriver) => { d.startError = new Error("x"); }],
    ["blocked", (_d: FakeDriver, probe: { value: boolean }) => { probe.value = false; }],
  ] as const)("%s → no leaseId", async (state, arrange) => {
    const { manager, driver, probeOk, clock } = setup({ startTimeoutSec: 2 });
    arrange(driver, probeOk);
    const p = await manager.ensure("docling");
    expect(p.state).toBe(state);
    expect(p.leaseId).toBeUndefined();
    expect(manager.leases.live("docling", clock.now())).toBe(0);
  });

  it("heartbeat / release on an unknown lease → lease-unknown", () => {
    const { manager } = setup();
    expect(manager.heartbeat("docling", "nope")).toEqual({ ok: false, code: "lease-unknown" });
    expect(manager.release("docling", "nope")).toEqual({ ok: false, code: "lease-unknown" });
  });
});
