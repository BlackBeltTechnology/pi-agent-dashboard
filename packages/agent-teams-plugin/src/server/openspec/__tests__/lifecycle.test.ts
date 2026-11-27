/**
 * Team lifecycle hygiene (tasks 9.33 #D13, 9.34 #P6): after 200 launch / complete / lock cycles and a team
 * close the module holds no timer, no store listener and no queue, the sidecar stays bounded by the task cap and
 * is pruned with the closed team, and heap and handles do not grow. Real runtime over the fake host and the
 * harness `FakeClock`.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import type { Team } from "../../../shared/types.js";
import { launcherOf } from "../launcher.js";
import { createOpenspecEnv } from "./env.js";
import { createGroupEnv, type GroupEnv } from "./launcher-env.js";

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const N = 50; // maxTasks: the most tasks one team can hold
const LOCK_CYCLES_PER_CHANGE = 4; // 50 × 4 = 200 lock cycles

type Listeners = Map<string, Set<unknown>>;
/** Number of store listeners (all events). The registry is private; counted through a cast, test-only. */
const listenerCount = (e: GroupEnv): number => [...(e.rt.store as unknown as { listeners: Listeners }).listeners.values()].reduce((n, s) => n + s.size, 0);

function gc(): () => void {
  v8.setFlagsFromString("--expose_gc");
  return vm.runInNewContext("gc") as () => void;
}

/** A launched member gets a live session so it can use the lock lane. */
function live(e: GroupEnv, name: string): void {
  if (!e.fake.sessions?.has?.(`S-${name}`)) e.fake.addSession(`S-${name}`, { cwd: e.cwd });
  e.rt.store.patchMember(e.gteam.id, name, { sessionId: `S-${name}`, status: "busy" });
}

const names = Array.from({ length: N }, (_, i) => `c${String(i).padStart(2, "0")}`);

/** Run every change through launch → lock cycles → complete → member gone, one after the other (the cap frees slots). */
async function runAll(e: GroupEnv): Promise<{ lockCycles: number }> {
  await e.run();
  let lockCycles = 0;
  for (const c of names) {
    await settle();
    expect(e.launched(c)?.state, c).toBe("launched");
    live(e, `os-${c}`);
    for (let k = 0; k < LOCK_CYCLES_PER_CHANGE; k++) {
      expect((await e.call(`os-${c}`, "ResourceLock", { action: "acquire", name: "harness" })).ok).toBe(true);
      expect((await e.call(`os-${c}`, "ResourceLock", { action: "release", name: "harness" })).ok).toBe(true);
      lockCycles++;
    }
    e.complete(c);
    await settle();
    e.member(`os-${c}`, "gone");
    await settle();
  }
  return { lockCycles };
}

describe("200 launch / complete / lock cycles, then close (9.33 #D13, 9.34 #P6)", () => {
  async function bigEnv() {
    return createGroupEnv({ changes: names, pluginConfig: { maxTeammates: 5, openspecGroupParallel: 5, maxTasks: N } });
  }

  it("every change launches once and completes; 200 lock cycles; the lock ends free; the sidecar holds ≤ 50 task records", async () => {
    const e = await bigEnv();
    const { lockCycles } = await runAll(e);
    expect(lockCycles).toBe(200);
    expect(e.fx.spawnCalls).toHaveLength(N);
    const d = e.api.sidecar.get(e.gteam.id);
    expect(Object.keys(d?.launched ?? {}).length).toBeLessThanOrEqual(N);
    expect(Object.keys(d?.refs ?? {}).length).toBeLessThanOrEqual(N);
    expect(Object.keys(d?.names ?? {}).length).toBeLessThanOrEqual(N);
    expect(d?.locks.harness?.holder).toBeUndefined();
    expect(d?.locks.harness?.queue ?? []).toEqual([]);
    const file = path.join(e.api.sidecar.dir, `${e.gteam.id}.json`);
    expect(fs.statSync(file).size).toBeLessThan(64 * 1024); // bounded by the task cap, not by the cycle count
  });

  it("after the close: no timer left, the module's store listeners are gone, queues are empty, nothing is launched any more", async () => {
    const e = await bigEnv();
    const listenersWithModule = listenerCount(e);
    expect(listenersWithModule).toBeGreaterThan(0);
    await runAll(e);
    expect(listenerCount(e)).toBe(listenersWithModule); // 200 cycles added no listener
    const team = e.rt.store.get(e.gteam.id) as Team;
    expect(e.rt.ops.teamDelete(team, { actor: "user", force: true }).ok).toBe(true);
    e.clock.advance(120_000);
    await settle();
    expect(team.status).toBe("closed");
    expect(e.clock.pendingCount).toBe(0);
    expect(launcherOf(e.api)).toBeDefined();
    const spawns = e.fx.spawnCalls.length;
    await launcherOf(e.api)?.evaluate(team); // a closed team never launches again
    expect(e.fx.spawnCalls).toHaveLength(spawns);
    e.rt.dispose();
    expect(listenerCount(e)).toBeLessThan(listenersWithModule); // the module's listeners were removed with the runtime
    expect(e.clock.pendingCount).toBe(0);
  });

  it("TeamDelete in the middle of a run: the pending launches and timers are dropped, nothing leaks", async () => {
    const e = await bigEnv();
    await e.run();
    await settle();
    const team = e.rt.store.get(e.gteam.id) as Team;
    for (const c of names.slice(0, 5)) live(e, `os-${c}`);
    expect((await e.call("os-c00", "ResourceLock", { action: "acquire", name: "harness" })).ok).toBe(true);
    expect((await e.call("os-c01", "ResourceLock", { action: "acquire", name: "harness" })).ok).toBe(true); // queued
    expect(e.rt.ops.teamDelete(team, { actor: "user", force: true }).ok).toBe(true);
    e.clock.advance(300_000);
    await settle();
    for (const m of (e.rt.store.get(e.gteam.id) as Team).members) if (m.status !== "gone") e.rt.ops.releaseMember(e.rt.store.get(e.gteam.id) as Team, m.name, "gone", "session ended");
    e.clock.advance(300_000);
    await settle();
    expect((e.rt.store.get(e.gteam.id) as Team).status).toBe("closed");
    expect(e.clock.pendingCount).toBe(0);
    const spawns = e.fx.spawnCalls.length;
    expect(spawns).toBeLessThanOrEqual(5); // only the first slots ever launched
    e.rt.store.patchTeam(e.gteam.id, { description: "after close" });
    await settle();
    expect(e.fx.spawnCalls).toHaveLength(spawns);
  });

  it("the sidecar of a closed team is pruned at the next start (after the team store is hydrated); a live team's is kept", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"] });
    const other = e.team("group", "other", { seeded: true });
    e.api.sidecar.create({ teamId: other.id, kind: "group", goal: "other", repo: e.cwd }, (d) => void (d.seeded = true));
    const closed = e.rt.store.get(e.gteam.id) as Team;
    expect(e.rt.ops.teamDelete(closed, { actor: "user", force: true }).ok).toBe(true);
    e.clock.advance(120_000);
    await settle();
    expect(closed.status).toBe("closed");
    e.rt.persistence.flushSync();
    await new Promise((r) => setTimeout(r, 60));
    const e2 = await createOpenspecEnv({ dataDir: e.dataDir });
    expect(e2.api.sidecar.has(closed.id)).toBe(false);
    expect(fs.existsSync(path.join(e2.api.sidecar.dir, `${closed.id}.json`))).toBe(false);
    expect(e2.api.sidecar.has(other.id)).toBe(true);
  });

  it("heap and handles do not grow with the cycles (after GC); an idle runtime holds zero timers", async () => {
    const collect = gc();
    const e = await bigEnv();
    expect(e.clock.pendingCount).toBeGreaterThanOrEqual(0);
    await runAll(e); // warm-up round: compilation, caches
    collect();
    const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length;
    const heap0 = process.memoryUsage().heapUsed;
    const e2 = await bigEnv();
    await runAll(e2);
    for (const x of [e, e2]) x.rt.ops.teamDelete(x.rt.store.get(x.gteam.id) as Team, { actor: "user", force: true });
    e.clock.advance(120_000);
    e2.clock.advance(120_000);
    await settle();
    e.rt.dispose();
    e2.rt.dispose();
    collect();
    const growth = process.memoryUsage().heapUsed - heap0;
    expect(growth).toBeLessThan(40 * 1024 * 1024); // a leak per cycle would be far above this; a runtime's own state is below
    if (handles !== undefined) expect((process as unknown as { _getActiveHandles: () => unknown[] })._getActiveHandles().length - handles).toBeLessThanOrEqual(2);
    expect(e2.clock.pendingCount).toBe(0);
  });
});
