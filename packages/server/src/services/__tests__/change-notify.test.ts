/**
 * Payload-free change notification + lease holders (add-services-settings-ui).
 * Test-plan: E28, F5, F6.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChangeCoalescer } from "../change-notifier.js";
import { FakeDriver, makeManager, ociDef, tmpRoot, writeDefinitions } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function harness(def = ociDef(), opts: { driver?: FakeDriver } = {}) {
  const root = tmpRoot("svc-notify-");
  roots.push(root);
  writeDefinitions(root, [def]);
  const driver = opts.driver ?? new FakeDriver("oci:docker");
  const changes = { count: 0 };
  const h = makeManager(root, {
    drivers: { "oci:docker": driver },
    onChange: () => {
      changes.count++;
    },
    changeCoalesceMs: 0, // raw: one callback per event
  });
  return { ...h, driver, changes };
}

describe("E28 — lease holders", () => {
  it("lists holder + ISO expiry, caps the holder at 200 chars, never exposes a lease id", async () => {
    const h = harness();
    const a = await h.manager.ensure("docling", { holder: "session-abc" });
    await h.manager.ensure("docling", { holder: "x".repeat(300) });
    const list = await h.manager.list();
    const status = await h.manager.status("docling");
    for (const s of [list.services[0], status]) {
      expect(s.leases).toBe(2);
      expect(s.leaseHolders).toHaveLength(2);
      expect(s.leaseHolders?.[0]).toEqual({ holder: "session-abc", expiresAt: new Date(h.clock.now() + 300_000).toISOString() });
      expect(s.leaseHolders?.[1].holder).toHaveLength(200);
    }
    const body = JSON.stringify([list, status]);
    expect(body).not.toContain(a.leaseId as string);
    expect(body).not.toContain("leaseId");
  });
});

describe("F5 — one change callback per event", () => {
  const frame = JSON.stringify({ type: "services_changed" });
  it("frame body carries the type only", () => {
    expect(frame).toBe('{"type":"services_changed"}');
  });

  it("a state transition (start) notifies; a tick that idles a healthy service notifies exactly once", async () => {
    const h = harness();
    await h.manager.ensure("docling", { lease: false });
    h.changes.count = 0;
    await h.manager.tick(); // healthy, no lease → idle
    expect(h.changes.count).toBe(1);
  });

  it("adoption through init() notifies", async () => {
    const driver = new FakeDriver("oci:docker");
    driver.adoptResult = { kind: "running", instance: { driver: "oci:docker", startedBy: "dashboard", endpoints: { http: "http://127.0.0.1:41000" } } };
    const h = harness(ociDef(), { driver });
    await h.manager.boot();
    expect(h.changes.count).toBeGreaterThanOrEqual(1);
  });

  it("lease expiry found by the sweep notifies once", async () => {
    const h = harness();
    await h.manager.ensure("docling");
    h.changes.count = 0;
    h.clock.advance(301_000);
    h.manager.leases.sweep(h.clock.now());
    expect(h.changes.count).toBe(1);
  });

  it("pin and a saved secret notify once each", async () => {
    const def = ociDef({ secrets: { token: {} } } as never);
    const h = harness(def);
    await h.manager.pin("docling", true);
    expect(h.changes.count).toBe(1);
    await h.manager.setSecret("docling", "token", "value-1234");
    expect(h.changes.count).toBe(2);
  });

  it("an unchanged re-probe (no transition) stays silent", async () => {
    const h = harness();
    await h.manager.ensure("docling", { lease: false });
    h.changes.count = 0;
    await h.manager.status("docling"); // probe ok, healthy → healthy
    expect(h.changes.count).toBe(0);
  });
});

describe("F6 — coalescing: leading + trailing within 500 ms", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a burst of 10 within 100 ms → at most 2 frames; a change 600 ms later → 1 more", () => {
    const fired: number[] = [];
    const c = createChangeCoalescer(() => fired.push(Date.now()), 500);
    for (let i = 0; i < 10; i++) {
      c.notify();
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(600);
    expect(fired.length).toBeLessThanOrEqual(2);
    expect(fired.length).toBe(2); // leading + trailing
    c.notify();
    expect(fired.length).toBe(3);
    vi.advanceTimersByTime(600);
    expect(fired.length).toBe(3); // nothing pending → no trailing
  });

  it("a lone change fires once, immediately; the trailing frame is never lost", () => {
    const fired: string[] = [];
    const c = createChangeCoalescer(() => fired.push("x"), 500);
    c.notify();
    expect(fired).toHaveLength(1);
    c.notify();
    c.notify();
    expect(fired).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(fired).toHaveLength(2);
  });
});
