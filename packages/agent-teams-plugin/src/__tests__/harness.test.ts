/**
 * Harness self-tests: the injected clock, the fake host ctx and (when `pi` is
 * on PATH) one real faux `pi --mode rpc` round trip. These guard the test
 * infrastructure the later sections build on (task 1.15).
 * See change: add-agent-teams-core.
 */
import { describe, expect, it } from "vitest";
import { systemClock } from "../shared/clock.js";
import { createFakeHostCtx, FakeClock, FauxPiProcess, fauxPiAvailable, loadConfigDefaults } from "./harness/index.js";

describe("FakeClock", () => {
  it("fires a timer exactly at its due time, not before", () => {
    const clock = new FakeClock(1000);
    let fired = 0;
    clock.setTimeout(() => fired++, 10_000);
    clock.advance(9_999);
    expect(fired).toBe(0);
    expect(clock.now()).toBe(10_999);
    clock.advance(1);
    expect(fired).toBe(1);
    expect(clock.pendingCount).toBe(0);
  });

  it("fires in due order and honours timers scheduled by a firing timer", () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push("b");
      clock.setTimeout(() => order.push("c"), 5);
    }, 20);
    clock.setTimeout(() => order.push("a"), 10);
    clock.advance(30);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("clearTimeout cancels and advanceAsync flushes promise continuations between timers", async () => {
    const clock = new FakeClock();
    const seen: string[] = [];
    const cancelled = clock.setTimeout(() => seen.push("never"), 5);
    clock.clearTimeout(cancelled);
    clock.setTimeout(() => {
      void Promise.resolve().then(() => seen.push("continuation"));
    }, 10);
    clock.setTimeout(() => seen.push("second"), 11);
    await clock.advanceAsync(20);
    expect(seen).toEqual(["continuation", "second"]);
  });

  it("systemClock satisfies the same contract", () => {
    const h = systemClock.setTimeout(() => {}, 1_000_000);
    systemClock.clearTimeout(h);
    expect(typeof systemClock.now()).toBe("number");
  });
});

describe("fake host ctx", () => {
  it("starts from the shipped configSchema defaults and accepts patches", () => {
    const host = createFakeHostCtx();
    const cfg = host.ctx.getPluginConfig<Record<string, unknown>>();
    expect(cfg).toMatchObject({ maxTeammates: 5, maxActiveTeams: 3, autoDispatch: true, orphanTtlMs: 1_800_000 });
    expect(cfg).toEqual(loadConfigDefaults());
    host.setConfig({ maxTeammates: 3 });
    expect(host.ctx.getPluginConfig<{ maxTeammates: number }>().maxTeammates).toBe(3);
  });

  it("records emit/abort/shutdown/spawn and reports unknown sessions as false", async () => {
    const host = createFakeHostCtx({ knownSessions: ["s1"] });
    expect(host.ctx.emitEventToSession("s1", "agent-teams:mail", { id: 1 })).toBe(true);
    expect(host.ctx.emitEventToSession("nope", "agent-teams:mail")).toBe(false);
    expect(host.ctx.abortSession("s1")).toBe(true);
    await expect(host.ctx.shutdownSession("s1")).resolves.toBe(true);
    await expect(host.ctx.shutdownSession("nope")).resolves.toBe(false);
    const res = await host.ctx.spawnSession({ cwd: "/tmp" });
    expect(res).toEqual({ success: true, spawnToken: "spawn-1" });
    expect(host.emits.map((e) => e.eventType)).toEqual(["agent-teams:mail", "agent-teams:mail"]);
    expect(host.aborts).toEqual(["s1"]);
    expect(host.shutdowns).toEqual(["s1", "nope"]);
    expect(host.spawns).toHaveLength(1);
  });

  it("spawn and shutdown behaviour is scriptable", async () => {
    const host = createFakeHostCtx();
    host.onSpawn(() => ({ success: false, message: "boom" }));
    host.onShutdown(async () => false);
    await expect(host.ctx.spawnSession({ cwd: "/tmp" })).resolves.toEqual({ success: false, message: "boom" });
    await expect(host.ctx.shutdownSession("x")).resolves.toBe(false);
  });
});

describe.skipIf(!fauxPiAvailable())("faux pi --mode rpc process", () => {
  it("answers a prompt with the scripted faux text", async () => {
    const pi = new FauxPiProcess({ fauxScript: "plain-text" });
    try {
      await pi.start();
      pi.prompt("hello faux");
      const settled = await pi.waitFor((r) => r.type === "agent_settled" || r.type === "agent_end", 60_000);
      expect(settled.type).toMatch(/agent_(settled|end)/);
      expect(JSON.stringify(pi.records)).toContain("The quick brown faux jumps over the lazy dog.");
    } finally {
      await pi.stop();
    }
  }, 90_000);
});
