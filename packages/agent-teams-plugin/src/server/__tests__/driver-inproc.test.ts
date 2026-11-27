/**
 * In-process driver and its server-side command channel (test-plan S30, S71, S117 + the channel rules of D3):
 * queue until the lead's hello, one outstanding command per member, emit_refused vs queued, ack correlation, timeouts,
 * late-ack orphan stop, opt-in queue deadline, synchronous caps. The lead-bridge host is a scripted fake.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/fake-clock.js";
import { linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { capturingLogger, createStoreEnv, memberFixture } from "../../__tests__/harness/store-env.js";
import { createTeamsEnv } from "../../__tests__/harness/teams-env.js";
import type { InProcAck, InProcCommand } from "../../shared/inproc-protocol.js";
import type { Member, Team } from "../../shared/types.js";
import type { TeamsConfig } from "../config.js";
import { createInProcDriver } from "../driver-inproc.js";
import { createInProcAvailability } from "../modes-inproc.js";
import { createPluginCounters } from "../templates-hooks.js";

const FEATURES = ["spawn", "steer", "managed", "loader"] as const;
const spec = { cwd: "/w", noMcp: false, noContextFiles: false, promptFiles: ["/p/protocol.md", "/p/agent.md"], env: { K: "v" }, tools: ["read", "TaskList"] };

function driverEnv(config: Partial<TeamsConfig> = {}) {
  const clock = new FakeClock(1_000);
  const store = createStoreEnv({ clock }).store;
  const { logger, logs } = capturingLogger();
  const counters = createPluginCounters();
  const availability = createInProcAvailability(clock);
  const connected = new Set<string>(["S-lead"]);
  const emitted: Array<{ sessionId: string; eventType: string; data: Record<string, unknown> }> = [];
  const state = { accept: true };
  const failed: Array<{ teamId: string; member: string; message: string }> = [];
  const driver = createInProcDriver({
    store,
    clock,
    logger,
    counters,
    availability,
    config: () => ({ inProcessCmdTimeoutMs: 10_000, inProcessLeanChildren: false, ...config }) as TeamsConfig,
    emit: (sessionId, data) => {
      emitted.push({ sessionId, eventType: "agent-teams:inproc", data });
      return state.accept;
    },
    isConnected: (id) => connected.has(id),
    failMember: (teamId, member, message) => void failed.push({ teamId, member, message }),
    newCmdId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
    newToken: (() => {
      let n = 0;
      return () => `${String(++n).padStart(64, "0")}`;
    })(),
  });
  const team = store.createTeam({ name: "t", leadSessionId: "S-lead", leadCwd: "/w", mode: "in-process", maxTeammates: 10 });
  const reserve = (name: string, over: Partial<Member> = {}): Member => store.reserveMember(team.id, memberFixture(name, { status: "spawning", ...over }) as Member) as Member;
  const hello = (features: readonly string[] = [...FEATURES, "interrupt"], sessionId = "S-lead") => {
    availability.note(sessionId, { op: "hello", incarnation: "inc", commandSecret: "sec", inProcess: { available: true, apiVersion: 1, features: features as never, limits: { maxConcurrent: 4 } } });
    driver.onHello(sessionId);
  };
  const cmds = (): InProcCommand[] => emitted.map((e) => e.data as unknown as InProcCommand);
  const ack = (cmdId: string, over: Partial<InProcAck> = {}, sessionId = "S-lead") => driver.onAck(sessionId, { op: "ack", cmdId, ok: true, ...over });
  const spawn = (name: string) => driver.spawn({ teamId: team.id, teamName: "t", member: name, role: "member", spawnToken: `st-${name}`, spec });
  return { clock, store, driver, team, logs, counters, availability, connected, emitted, state, failed, reserve, hello, cmds, ack, spawn };
}

/** Let the driver's promise continuations (the reconcile after a timeout) run. */
const turns = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe("S30 emit refused vs lead not connected", () => {
  it("(a) lead connected and announced, host refuses: fails with emit_refused at once (no timeout wait), logged with the event type", async () => {
    const d = driverEnv();
    d.hello();
    d.state.accept = false;
    d.reserve("bob");
    const outcome = await d.spawn("bob");
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toContain("emit_refused");
    expect(d.clock.pendingCount).toBe(0); // no ack timer was started: failed within the same tick
    expect(d.logs.error.join("\n")).toContain("agent-teams:inproc");
    expect(d.counters.get("inproc_emit_refused")).toBe(1);
  });

  it("(b) lead disconnected: queued, NOT refused; flushed after the lead reconnects and announces", async () => {
    const d = driverEnv();
    d.connected.delete("S-lead");
    d.reserve("bob");
    const pending = d.spawn("bob");
    await Promise.resolve();
    expect(d.emitted).toHaveLength(0);
    expect(d.counters.get("inproc_emit_refused")).toBe(0);
    expect(d.driver.queueSize()).toBe(1);
    d.connected.add("S-lead");
    d.hello();
    expect(d.cmds().map((c) => c.cmd)).toEqual(["spawn"]);
    d.ack(d.cmds()[0]?.cmdId as string, { childId: "bg-1", agentId: "agent-1", status: "running" });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("a connected lead that never announced availability is queued too (commands wait for the inproc hello)", async () => {
    const d = driverEnv();
    d.reserve("bob");
    void d.spawn("bob");
    expect(d.emitted).toHaveLength(0);
    d.hello();
    expect(d.emitted).toHaveLength(1);
  });
});

describe("command channel rules", () => {
  it("queued commands flush in issue order after the hello, each once; a repeated hello re-emits nothing", () => {
    const d = driverEnv();
    for (const n of ["a", "b", "c"]) d.reserve(n);
    void d.spawn("a");
    void d.driver.shutdown({ teamId: d.team.id, member: "b" });
    void d.spawn("c");
    d.hello();
    expect(d.cmds().map((c) => `${c.cmd}:${(c as { member: string }).member}`)).toEqual(["spawn:a", "stop:b", "spawn:c"]);
    d.hello();
    expect(d.emitted).toHaveLength(3);
  });

  it("carries the secret of the activation and only the spawn command carries the token and the resolved spec", async () => {
    const d = driverEnv();
    d.hello();
    d.reserve("bob");
    void d.spawn("bob");
    const cmd = d.cmds()[0] as unknown as Record<string, unknown>;
    expect(cmd).toMatchObject({ cmd: "spawn", member: "bob", secret: "sec", spec: { cwd: "/w", promptFiles: ["/p/protocol.md", "/p/agent.md"], env: { K: "v" }, tools: ["read", "TaskList"], leanChildren: false } });
    expect(cmd.proxyToken).toMatch(/^0+1$/);
    expect(d.store.member(d.team, "bob")?.proxyToken).toBe(cmd.proxyToken); // persisted
  });

  it("one outstanding command per member: the next waits behind its ack; other members are not held up", async () => {
    const d = driverEnv();
    d.hello();
    d.reserve("bob");
    d.reserve("eve");
    const spawnBob = d.spawn("bob");
    const stopBob = d.driver.shutdown({ teamId: d.team.id, member: "bob" });
    void d.spawn("eve");
    expect(d.cmds().map((c) => `${c.cmd}:${(c as { member: string }).member}`)).toEqual(["spawn:bob", "spawn:eve"]); // stop(bob) held
    d.ack(d.cmds()[0]?.cmdId as string, { childId: "bg-1", agentId: "agent-1", status: "running" });
    await spawnBob;
    expect(d.cmds().map((c) => c.cmd)).toEqual(["spawn", "spawn", "stop"]);
    d.ack(d.cmds()[2]?.cmdId as string);
    await expect(stopBob).resolves.toBe(true);
  });

  it("an ack from another lead session never settles our command; a duplicate ack changes nothing", async () => {
    const d = driverEnv();
    d.hello();
    d.reserve("bob");
    const p = d.spawn("bob");
    const id = d.cmds()[0]?.cmdId as string;
    expect(d.ack(id, { childId: "x", agentId: "y" }, "S-other").matched).toBe(false);
    expect(d.ack(id, { childId: "bg-1", agentId: "agent-1", status: "running" }).matched).toBe(true);
    expect(d.ack(id, { childId: "bg-2", agentId: "agent-2" }).matched).toBe(false);
    await p;
    expect(d.store.member(d.team, "bob")).toMatchObject({ childId: "bg-1", childAgentId: "agent-1" });
  });

  it("an ack with ok:false fails the spawn with the bridge's stable error code", async () => {
    const d = driverEnv();
    d.hello();
    d.reserve("bob");
    const p = d.spawn("bob");
    d.ack(d.cmds()[0]?.cmdId as string, { ok: false, error: "spawn_vetoed", message: "no" });
    expect(await p).toEqual({ ok: false, message: "spawn_vetoed: no" });
  });

  it("an unacknowledged spawn fails delivery_timeout at the configured deadline and stops its member", async () => {
    const d = driverEnv({ inProcessCmdTimeoutMs: 5000 });
    d.hello();
    d.reserve("bob");
    const p = d.spawn("bob");
    d.clock.advance(4999);
    expect(d.cmds().map((c) => c.cmd)).toEqual(["spawn"]);
    d.clock.advance(1);
    await turns();
    expect(d.cmds().map((c) => c.cmd)).toEqual(["spawn", "stop"]); // reconcile: stop for the member …
    d.ack(d.cmds()[1]?.cmdId as string);
    await turns();
    expect(d.cmds().map((c) => c.cmd)).toEqual(["spawn", "stop", "snapshot"]); // … then a snapshot; the name is released only after it (task 5.4)
    d.ack(d.cmds()[2]?.cmdId as string, { snapshot: { members: [] } });
    const out = await p;
    expect(out).toMatchObject({ ok: false });
    expect((out as { message: string }).message).toContain("delivery_timeout");
    expect(d.counters.get("inproc_delivery_timeout")).toBe(1);
  });

  it("a LATE ok-ack of a timed-out spawn stops the child it created (no orphan)", async () => {
    const d = driverEnv({ inProcessCmdTimeoutMs: 1000 });
    d.hello();
    d.reserve("bob");
    const p = d.spawn("bob");
    const spawnId = d.cmds()[0]?.cmdId as string;
    d.clock.advance(1000);
    await turns();
    d.ack(d.cmds()[1]?.cmdId as string); // the stop of the timeout reconcile
    await turns();
    d.ack(d.cmds()[2]?.cmdId as string, { snapshot: { members: [] } }); // its snapshot
    await p;
    d.ack(spawnId, { childId: "bg-late", agentId: "agent-late", status: "running" });
    const stops = d.cmds().filter((c) => c.cmd === "stop") as Array<{ childId?: string; agentId?: string }>;
    expect(stops.at(-1)).toMatchObject({ childId: "bg-late", agentId: "agent-late" });
  });

  it("failQueued rejects the not-yet-sent commands of a team and names the members of dropped spawns", async () => {
    const d = driverEnv();
    d.reserve("a");
    d.reserve("b");
    const pa = d.spawn("a");
    const pb = d.spawn("b");
    expect(d.driver.failQueued(d.team.id, "mode_unavailable")).toEqual(["a", "b"]);
    expect(await pa).toMatchObject({ ok: false });
    expect(await pb).toMatchObject({ ok: false });
    expect(d.driver.queueSize()).toBe(0);
    d.hello();
    expect(d.emitted).toHaveLength(0); // nothing is sent after the drop
  });

  it("the command queue is bounded at 1 000 entries, oldest dropped first, counted", async () => {
    const d = driverEnv();
    const results: Array<Promise<boolean>> = [];
    for (let i = 0; i < 1001; i++) {
      d.reserve(`m${i}`);
      results.push(d.driver.shutdown({ teamId: d.team.id, member: `m${i}` }));
    }
    expect(d.driver.queueSize()).toBe(1000);
    expect(d.counters.get("inproc_queue_overflow")).toBe(1);
    expect(await results[0]).toBe(false); // the oldest command failed
  });

  it("holds every mail (deliver → false) until the framing task exists", () => {
    const d = driverEnv();
    d.hello();
    expect(d.driver.deliver({ teamId: d.team.id, member: "bob" }, [], { wake: true })).toBe(false);
  });
});

describe("abort / shutdown / isConnected", () => {
  it("abort of a busy member sends interrupt when the feature exists, else interrupt_unavailable; a non-busy member is a success no-op", () => {
    const d = driverEnv();
    d.hello([...FEATURES, "interrupt"]);
    d.reserve("bob", { status: "busy", childId: "bg-1", childAgentId: "agent-1" });
    d.reserve("idler", { status: "idle" });
    expect(d.driver.abort({ teamId: d.team.id, member: "bob" })).toEqual({ ok: true });
    expect(d.cmds().map((c) => c.cmd)).toEqual(["interrupt"]);
    expect(d.driver.abort({ teamId: d.team.id, member: "idler" })).toEqual({ ok: true, noop: "not_busy" }); // B97: the no-op is named so `abortMember` can say details.noop
    expect(d.emitted).toHaveLength(1); // no upstream call for an idle member
    d.hello([...FEATURES]); // optional feature absent
    d.reserve("eve", { status: "busy" });
    expect(d.driver.abort({ teamId: d.team.id, member: "eve" })).toEqual({ ok: false, reason: "interrupt_unavailable" });
    expect(d.emitted).toHaveLength(1); // never emulated by a stop
  });

  it("shutdown stops the child by member and ids and resolves true on the ok-ack, false on a failed ack", async () => {
    const d = driverEnv();
    d.hello();
    d.reserve("bob", { status: "idle", childId: "bg-1", childAgentId: "agent-1" });
    const p = d.driver.shutdown({ teamId: d.team.id, member: "bob" });
    expect(d.cmds()[0]).toMatchObject({ cmd: "stop", member: "bob", childId: "bg-1", agentId: "agent-1" });
    d.ack(d.cmds()[0]?.cmdId as string);
    await expect(p).resolves.toBe(true);
    const q = d.driver.shutdown({ teamId: d.team.id, member: "bob" });
    d.ack(d.cmds()[1]?.cmdId as string, { ok: false, error: "unknown_member" });
    await expect(q).resolves.toBe(false);
  });

  it("isConnected needs the lead connected and announced and the child registered", () => {
    const d = driverEnv();
    d.reserve("bob", { status: "idle", childId: "bg-1" });
    expect(d.driver.isConnected({ teamId: d.team.id, member: "bob" })).toBe(false);
    d.hello();
    expect(d.driver.isConnected({ teamId: d.team.id, member: "bob" })).toBe(true);
    d.connected.delete("S-lead");
    expect(d.driver.isConnected({ teamId: d.team.id, member: "bob" })).toBe(false);
  });
});

async function runtimeWorld(config: Record<string, unknown> = {}) {
  const env = createTeamsEnv({ config, runtime: { inProcess: true } });
  const link = linkInProcBridge(env);
  await link.hello({ available: true });
  const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
  return { env, link, teamId: created.data.teamId as string };
}

describe("S71 caps are counted synchronously (spike: stray teammate)", () => {
  it("12 concurrent TeammateSpawn calls with maxTeammates 5: exactly 5 accepted, 7 rejected team_full, exactly 5 spawn commands", async () => {
    const { env, link, teamId } = await runtimeWorld();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => env.call("lead", "TeammateSpawn", { name: `m${i}`, prompt: "p" })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const rejected = results.filter((r) => !r.ok);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect(r.error).toBe("team_full");
    await env.settle();
    expect(link.commands.filter((c) => c.cmd === "spawn")).toHaveLength(5);
    const team = env.rt.store.get(teamId) as Team;
    expect(team.members).toHaveLength(5);
    // No name is left half-reserved after a rejection: a rejected name is free once a slot opens.
    const rejectedName = `m${results.findIndex((r) => !r.ok)}`;
    expect(team.members.find((m) => m.name === rejectedName)).toBeUndefined();
  });

  it("3 concurrent calls with the same name: one accepted, the others name_taken", async () => {
    const { env, link } = await runtimeWorld();
    const results = await Promise.all([1, 2, 3].map(() => env.call("lead", "TeammateSpawn", { name: "same", prompt: "p" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => r.error)).toEqual(["name_taken", "name_taken"]);
    await env.settle();
    expect(link.commands.filter((c) => c.cmd === "spawn")).toHaveLength(1);
  });
});

describe("S117 spawn clock and the opt-in queue timeout", () => {
  async function queuedWorld(config: Record<string, unknown>) {
    const w = await runtimeWorld(config);
    w.link.setOnCommand((cmd) => {
      if (cmd.cmd === "spawn") return cmd.member === "a" ? { ack: { cmdId: cmd.cmdId, ok: true, childId: "bg-a", agentId: "agent-a", status: "running" } } : { ack: { cmdId: cmd.cmdId, ok: true, childId: "bg-b", agentId: "agent-b", status: "queued", queuePosition: 1 } };
      return { ack: { cmdId: cmd.cmdId, ok: true } };
    });
    await w.env.call("lead", "TeammateSpawn", { name: "a", prompt: "p" });
    await w.env.call("lead", "TeammateSpawn", { name: "b", prompt: "p" });
    await w.env.settle();
    return w;
  }

  it("unset: B stays spawning with its 1-based queuePosition at 10× spawnTimeoutMs (never failed while queued)", async () => {
    const { env, teamId } = await queuedWorld({});
    const team = env.rt.store.get(teamId) as Team;
    expect(env.rt.store.member(team, "b")).toMatchObject({ status: "spawning", queuePosition: 1 });
    env.clock.advance(10 * 30_000);
    expect(env.rt.store.member(team, "b")).toMatchObject({ status: "spawning", queuePosition: 1 });
  });

  it("inProcessQueueTimeoutMs 1000: still queued at 999 ms, failed spawn_timeout at 1001 ms, the queued child is stopped", async () => {
    const { env, link, teamId } = await queuedWorld({ inProcessQueueTimeoutMs: 1000 });
    const team = env.rt.store.get(teamId) as Team;
    env.clock.advance(999);
    expect(env.rt.store.member(team, "b")?.status).toBe("spawning");
    env.clock.advance(2);
    await env.settle(); // stop + snapshot reconcile first (task 5.4), then the member fails and the name is reusable
    const b = env.rt.store.member(team, "b") as Member;
    expect(b.status).toBe("failed");
    expect(b.goneReason).toContain("spawn_timeout");
    expect(link.commands.filter((c) => c.cmd === "stop")).toHaveLength(1);
    expect(link.commands.map((c) => c.cmd).slice(-2)).toEqual(["stop", "snapshot"]);
    expect(link.commands.find((c) => c.cmd === "stop")).toMatchObject({ member: "b", childId: "bg-b", agentId: "agent-b" });
    expect(env.rt.store.member(team, "a")?.status).toBe("spawning"); // A is running (no event mapping yet), untouched
  });

  // Review finding: a spawn acked `running` whose `started` is lost (lane down / bridge crash) must not stay `spawning` forever.
  it("a spawn acked running that never reports started fails at spawnTimeoutMs from the ack (child stopped, name reusable); the queued sibling is never failed", async () => {
    const { env, link, teamId } = await queuedWorld({ spawnTimeoutMs: 5000 });
    const team = env.rt.store.get(teamId) as Team;
    env.clock.advance(4999);
    expect(env.rt.store.member(team, "a")?.status).toBe("spawning");
    env.clock.advance(2);
    await env.settle();
    const a = env.rt.store.member(team, "a") as Member;
    expect(a.status).toBe("failed");
    expect(a.goneReason).toContain("did not become ready"); // a failed spawn (name reusable), not a gone child
    expect(link.commands.find((c) => c.cmd === "stop")).toMatchObject({ member: "a", childId: "bg-a", agentId: "agent-a" });
    expect(env.rt.store.member(team, "b")).toMatchObject({ status: "spawning", queuePosition: 1 }); // queue wait stays unbounded
    env.clock.advance(10 * 5000);
    expect(env.rt.store.member(team, "b")?.status).toBe("spawning");
  });

  it("a running-acked spawn whose first started arrives in time restarts the readiness clock from that started (the ack deadline does not double-fire)", async () => {
    const { env, link, teamId } = await queuedWorld({ spawnTimeoutMs: 5000 });
    const team = env.rt.store.get(teamId) as Team;
    env.clock.advance(4000);
    await link.lane({ op: "event", member: "a", run: 1, kind: "started" });
    expect(env.rt.store.member(team, "a")?.status).toBe("busy");
    env.clock.advance(1500); // past the ack deadline (5000 from the ack), inside the one from `started`
    expect(env.rt.store.member(team, "a")?.status).toBe("busy");
  });
});

describe("dispose settles every unsettled promise (review B2)", () => {
  it("a spawn queued while the lead is away, one awaiting its ack, a stop queued behind it, and a spawn waiting for a hello after no_context all settle (failed) instead of hanging", async () => {
    const d = driverEnv({ spawnTimeoutMs: 60_000 });
    for (const name of ["queued", "inflight", "waiting"]) d.reserve(name);
    d.hello();
    const inflight = d.spawn("inflight"); // emitted, no ack yet
    const stopBehind = d.driver.stopChild(d.team.id, { member: "inflight" }); // queued behind the outstanding command of the same member
    const waiting = d.spawn("waiting");
    d.ack(d.cmds().find((c) => c.cmd === "spawn" && c.member === "waiting")?.cmdId as string, { ok: false, error: "no_context" });
    await turns(); // `waiting` is now parked on the lead's next hello
    d.connected.delete("S-lead");
    const queued = d.spawn("queued"); // lead away: stays in the queue
    expect(d.driver.queueSize()).toBeGreaterThan(0);
    d.driver.dispose();
    const hung = Symbol("hung");
    const settled = await Promise.race([Promise.all([queued, inflight, waiting, stopBehind]), new Promise<symbol>((resolve) => setTimeout(() => resolve(hung), 200))]);
    expect(settled).not.toBe(hung);
    const [q, i, w, s] = settled as [{ ok: boolean }, { ok: boolean }, { ok: boolean; message?: string }, boolean];
    expect([q.ok, i.ok, w.ok, s]).toEqual([false, false, false, false]);
    expect(w.message).toContain("spawn_timeout");
  });
});
