/**
 * The lead-side host's command channel (test-plan S27–S29, S33–S36, S46, S92, S112, S119): idempotent execution with a
 * `cmdId` → ack replay map and in-flight join, command timeouts and the late-ack orphan stop (real server driver ↔ real host
 * over the recorded contract double), per-member ordering, strict command validation, the forged-bus-command rule and the
 * per-activation `commandSecret`, the dock row text, and the idle-TTL pass-through. All on the fake clock.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { createHostEnv, type HostEnv, settle, spawnCommand, steerCommand } from "../../__tests__/harness/inproc-host-env.js";
import { createInProcPair } from "../../__tests__/harness/inproc-pair.js";
import { AGENT_TEAMS_EVENT_INPROC } from "../../shared/plugin-id.js";
import { SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";
import { createInProcHost } from "../inproc-host.js";
import { toWellFormed } from "../inproc-text.js";

/** Count the emits of a bus channel (the double answers them; this only observes). */
function counter(env: HostEnv, channel: string): { n: () => number; messages: string[] } {
  const messages: string[] = [];
  let n = 0;
  env.bus.on(channel, (p: unknown) => {
    n++;
    const m = (p as { message?: unknown }).message;
    if (typeof m === "string") messages.push(m);
  });
  return { n: () => n, messages };
}

const ackJson = (env: HostEnv, cmdId: string): string[] =>
  env.acks()
    .filter((a) => a.cmdId === cmdId)
    .map((a) => JSON.stringify(a));

async function started(opts: Parameters<typeof createHostEnv>[0] = {}): Promise<HostEnv> {
  const env = createHostEnv(opts);
  await env.start();
  return env;
}

describe("S27 idempotent command channel (replay)", () => {
  it("spawn sent twice, the second after a lane reconnect: upstream called once, the stored ack replayed byte-identical", async () => {
    const env = await started();
    const spawns = counter(env, SUBAGENTS_CHANNEL.spawn);
    const cmd = spawnCommand("bob");
    env.command(cmd);
    await env.settle();
    env.host.onReconnect();
    await env.settle();
    env.command(cmd);
    await env.settle();
    expect(spawns.n()).toBe(1);
    expect(env.double.children.size).toBe(1);
    const acks = ackJson(env, cmd.cmdId as string);
    expect(acks).toHaveLength(2);
    expect(acks[0]).toBe(acks[1]);
    expect(JSON.parse(acks[0] as string)).toMatchObject({ ok: true, childId: expect.stringMatching(/^bg-/), agentId: expect.any(String) });
  });

  it("steer, interrupt and stop likewise execute once and replay", async () => {
    const env = await started();
    await env.spawn("bob");
    const steers = counter(env, SUBAGENTS_CHANNEL.steerRequest);
    const interrupts = counter(env, SUBAGENTS_CHANNEL.interruptRequest);
    const stops = counter(env, SUBAGENTS_CHANNEL.stop);
    const cmds = [steerCommand("bob", [1]), { cmd: "interrupt", cmdId: "int-1", member: "bob" }, { cmd: "stop", cmdId: "stop-1", member: "bob" }];
    for (const cmd of cmds) {
      env.command(cmd);
      await env.settle();
      env.host.onReconnect();
      await env.settle();
      env.command(cmd);
      await env.settle();
      const acks = ackJson(env, cmd.cmdId as string);
      expect(acks.length).toBe(2);
      expect(acks[0]).toBe(acks[1]);
    }
    expect([steers.n(), interrupts.n(), stops.n()]).toEqual([1, 1, 1]);
  });

  it("snapshot is never replayed from a stored copy: a repeat shows the CURRENT state", async () => {
    const env = await started();
    const { agentId } = await env.spawn("bob");
    const snap = { cmd: "snapshot", cmdId: "snap-1" };
    env.command(snap);
    await env.settle();
    expect(env.ackOf("snap-1")?.snapshot?.members[0]).toMatchObject({ member: "bob", state: "busy", lastIdleRun: 0 });
    env.double.finishRun(agentId as string, { result: "done" });
    await env.settle();
    env.command(snap);
    await env.settle();
    expect(env.ackOf("snap-1")?.snapshot?.members[0]).toMatchObject({ member: "bob", state: "idle", lastIdleRun: 1 });
  });

  it("a result that must be RETRIED is not stored: an empty spawn reply executes again with the same cmdId", async () => {
    const env = await started();
    const cmd = spawnCommand("bob");
    env.double.nextSpawnReply("empty");
    env.command(cmd);
    await env.settle();
    expect(env.ackOf(cmd.cmdId as string)).toMatchObject({ ok: false, error: "subagents_extension_missing" });
    env.command(cmd);
    await env.settle();
    expect(env.ackOf(cmd.cmdId as string)).toMatchObject({ ok: true });
    expect(env.double.children.size).toBe(1);
  });
});

describe("S28 in-flight duplicate joins the first execution", () => {
  it("a steer re-sent at the cmd timeout while the first is pending (child inside a 30 s tool): one steer_request, equal acks, mail text once", async () => {
    const env = await started();
    await env.spawn("bob");
    const steers = counter(env, SUBAGENTS_CHANNEL.steerRequest);
    env.double.nextSteerResult({ afterMs: 25_000, result: "queued" });
    const cmd = steerCommand("bob", [1]);
    env.command(cmd);
    await env.settle();
    await env.clock.advanceAsync(10_000);
    env.command(cmd);
    await env.clock.advanceAsync(15_000);
    expect(steers.n()).toBe(1);
    expect(steers.messages).toHaveLength(1);
    const acks = ackJson(env, cmd.cmdId as string);
    expect(acks).toHaveLength(2);
    expect(acks[0]).toBe(acks[1]);
    expect(JSON.parse(acks[0] as string)).toMatchObject({ ok: true, result: "queued", run: 1 });
  });
});

describe("S29 steer acked after delivery_timeout", () => {
  it("the late result still records the ids: a re-send under another cmdId is dropped by the ledger and the child sees the mail once", async () => {
    const env = await started();
    await env.spawn("bob");
    const steers = counter(env, SUBAGENTS_CHANNEL.steerRequest);
    env.double.nextSteerResult({ afterMs: 12_000, result: "queued" });
    env.command(steerCommand("bob", [7]));
    await env.clock.advanceAsync(12_000);
    expect(env.host.snapshot().members[0]?.deliveredMailIds).toEqual([7]);
    env.command(steerCommand("bob", [7], { cmdId: "steer-retry-other-id" }));
    await env.settle();
    expect(env.ackOf("steer-retry-other-id")).toMatchObject({ ok: true, result: "duplicate" });
    expect(steers.n()).toBe(1);
    expect(steers.messages).toHaveLength(1);
  });
});

describe("S33 commands that time out (server driver ↔ host)", () => {
  async function pairWithBob() {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    return pair;
  }

  it("spawn: an ack at T−1 is fine (no timeout counted)", async () => {
    const pair = await pairWithBob();
    pair.lag.ackDelayMs = 9_999;
    const outcome = pair.spawn("bob");
    await pair.settle(); // the host's delayed ack timer exists before time moves
    pair.lag.ackDelayMs = 0;
    await pair.clock.advanceAsync(9_999);
    await expect(outcome).resolves.toMatchObject({ ok: true });
    expect(pair.counters.get("inproc_delivery_timeout")).toBe(0);
  });

  it("spawn: at T+1 the command fails delivery_timeout (+1); the member stays reserved until stop + snapshot reconcile, then the name is released", async () => {
    const pair = await pairWithBob();
    pair.lag.ackDelayMs = 10_001;
    const outcome = pair.spawn("bob");
    let released = false;
    void outcome.then(() => (released = true));
    await pair.settle();
    pair.lag.ackDelayMs = 0;
    await pair.clock.advanceAsync(10_000);
    expect(pair.counters.get("inproc_delivery_timeout")).toBe(1);
    await pair.clock.advanceAsync(1);
    await expect(outcome).resolves.toMatchObject({ ok: false });
    expect(((await outcome) as { message: string }).message).toContain("delivery_timeout");
    expect(released).toBe(true);
    const names = pair.cmds().map((c) => c.cmd);
    expect(names.slice(0, 3)).toEqual(["spawn", "stop", "snapshot"]);
    expect(pair.host.double.children.size).toBe(0); // the stop freed the child the late-acked spawn created
  });

  it("steer: T−1 hands the mail over", async () => {
    const pair = await pairWithBob();
    await pair.spawn("bob");
    pair.store.patchMember(pair.team.id, "bob", { status: "busy" });
    const mail = pair.store.appendMail(pair.team.id, { from: "lead", to: "bob", kind: "message", text: "hi", wake: true });
    pair.lag.ackDelayMs = 9_999;
    expect(pair.driver.deliver({ teamId: pair.team.id, member: "bob" }, [mail as never], { wake: true })).toBe(true);
    await pair.settle();
    pair.lag.ackDelayMs = 0;
    await pair.clock.advanceAsync(9_999);
    expect(pair.store.pendingMail(pair.team.id, "bob")).toHaveLength(0); // acked: handed over
    expect(pair.counters.get("inproc_delivery_timeout")).toBe(0);
  });

  it("steer: at T+1 the mail stays queued and the member is disconnected (+1 delivery_timeout); the late ack hands it over and the member returns", async () => {
    const pair = await pairWithBob();
    await pair.spawn("bob");
    pair.store.patchMember(pair.team.id, "bob", { status: "busy" });
    const mail = pair.store.appendMail(pair.team.id, { from: "lead", to: "bob", kind: "message", text: "hi", wake: true });
    pair.lag.ackDelayMs = 10_500;
    expect(pair.driver.deliver({ teamId: pair.team.id, member: "bob" }, [mail as never], { wake: true })).toBe(true);
    await pair.settle();
    pair.lag.ackDelayMs = 0;
    await pair.clock.advanceAsync(10_001);
    expect(pair.counters.get("inproc_delivery_timeout")).toBe(1);
    expect(pair.member("bob")?.status).toBe("disconnected");
    expect(pair.store.pendingMail(pair.team.id, "bob")).toHaveLength(1); // still queued
    expect(pair.unhanded).toContain("bob");
    await pair.clock.advanceAsync(500); // the late ack arrives
    expect(pair.member("bob")?.status).toBe("busy");
    expect(pair.store.pendingMail(pair.team.id, "bob")).toHaveLength(0);
  });
});

describe("S34 late ack leaves no orphan child", () => {
  it("the spawn executed, its ack arrived after the timeout: the child is stopped, the name stays taken until the snapshot shows none", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    pair.lag.ackDelayMs = 10_500;
    const outcome = pair.spawn("bob");
    await pair.settle();
    pair.lag.ackDelayMs = 0;
    await pair.clock.advanceAsync(10_000); // timeout fires: stop + snapshot reconcile run
    expect(pair.member("bob")?.status).toBe("spawning"); // still reserved: a re-spawn of the same name is core's name-in-use
    expect(pair.host.double.children.size).toBe(0);
    await pair.clock.advanceAsync(1_000);
    await expect(outcome).resolves.toMatchObject({ ok: false });
    expect(pair.host.host.snapshot().members).toEqual([]);
    expect(pair.host.double.children.size).toBe(0);
  });

  it("commands to one member are strictly serialised: a stop waits behind an unacked spawn", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    const release = pair.holdAcks();
    void pair.spawn("bob");
    await pair.settle();
    void pair.driver.shutdown({ teamId: pair.team.id, member: "bob" });
    await pair.settle();
    expect(pair.cmds().map((c) => c.cmd)).toEqual(["spawn"]); // the stop is not emitted yet
    release();
    await pair.settle();
    expect(pair.cmds().map((c) => c.cmd)).toEqual(["spawn", "stop"]);
  });
});

describe("S35 command ordering per member", () => {
  it("a reordered flush (stop, steer, spawn) is answered with defined errors; in issue order the outcome is the in-order one", async () => {
    const env = await started();
    env.command({ cmd: "stop", cmdId: "c1", member: "bob" });
    env.command(steerCommand("bob", [1], { cmdId: "c2" }));
    await env.settle();
    expect(env.ackOf("c1")).toMatchObject({ ok: false, error: "unknown_member" });
    expect(env.ackOf("c2")).toMatchObject({ ok: false, error: "unknown_member" });
    expect(env.double.children.size).toBe(0);
    // In issue order: spawn, steer, stop.
    await env.spawn("bob");
    env.command(steerCommand("bob", [1], { cmdId: "c3" }));
    env.command({ cmd: "stop", cmdId: "c4", member: "bob" });
    await env.settle();
    expect(env.ackOf("c3")).toMatchObject({ ok: true, result: "queued" });
    expect(env.ackOf("c4")).toMatchObject({ ok: true });
    expect(env.double.children.size).toBe(0); // no child left running after the stop
  });
});

describe("S36 validated command fields", () => {
  const canary = "CANARY-DO-NOT-LOG";
  const proto = (extra: string): Record<string, unknown> => JSON.parse(`{"__proto__":{"x":1}${extra}}`) as Record<string, unknown>;
  const rejected: Array<[string, Record<string, unknown>, string]> = [
    ["unknown cmd", { cmd: "explode", cmdId: "x1" }, "cmd"],
    ["member with path chars", spawnCommand("../etc", { cmdId: "x2" }), "member"],
    ["member with NUL", { cmd: "stop", cmdId: "x3", member: "a\u0000b" }, "member"],
    ["tools not an array", spawnCommand("bob", { cmdId: "x4", spec: { ...(spawnCommand().spec as object), tools: canary } }), "spec.tools"],
    ["5 MB prompt", spawnCommand("bob", { cmdId: "x5", prompt: canary + "x".repeat(5 * 1024 * 1024) }), "prompt"],
    ["negative number", spawnCommand("bob", { cmdId: "x6", promptMailId: -1 }), "promptMailId"],
    ["negative ttl", spawnCommand("bob", { cmdId: "x7", spec: { ...(spawnCommand().spec as object), idleTtlSec: -5 } }), "spec.idleTtlSec"],
    ["__proto__ key", proto(`,"cmd":"snapshot","cmdId":"x8"`), "payload"],
    ["constructor key", { cmd: "snapshot", cmdId: "x9", constructor: { prototype: {} } }, "payload"],
    ["steer blocks mismatch", { cmd: "steer", cmdId: "x10", member: "bob", mailIds: [1, 2], blocks: ["one"] }, "blocks"],
  ];

  it.each(rejected)("%s → ack invalid_args naming the field, no upstream call, no throw", async (_name, cmd, field) => {
    const env = await started();
    env.command({ ...cmd, secret: undefined } as Record<string, unknown>, env.secret);
    await env.settle();
    const ack = env.ackOf(cmd.cmdId as string);
    expect(ack).toMatchObject({ ok: false, error: "invalid_args" });
    expect(ack?.message).toContain(field);
    expect(JSON.stringify(env.sent)).not.toContain(canary); // the value is never echoed
    expect(env.logs.join("\n")).not.toContain(canary);
    expect(env.double.spawnRequests).toHaveLength(0);
    // The host keeps serving later commands.
    expect((await env.spawn("alice")).ok).toBe(true);
  });

  it("a missing, non-string or 1 MiB cmdId cannot be acknowledged: ignored and counted, never an upstream call", async () => {
    const env = await started();
    const spawns = counter(env, SUBAGENTS_CHANNEL.spawn);
    const base = spawnCommand("bob");
    env.command({ ...base, cmdId: undefined });
    env.command({ ...base, cmdId: 42 });
    env.command({ ...base, cmdId: "x".repeat(1024 * 1024) });
    await env.settle();
    expect(spawns.n()).toBe(0);
    expect(env.acks()).toHaveLength(0);
    expect(env.host.counters().inproc_invalid_command).toBe(3);
  });

  it("log lines carry ids and sizes only (no prompt, no token)", async () => {
    const env = await started();
    await env.spawn("bob", { prompt: `${canary} prompt body`, proxyToken: "TOKEN-CANARY" });
    expect(env.logs.length).toBeGreaterThan(0);
    expect(env.logs.join("\n")).not.toMatch(/CANARY/);
  });
});

describe("S46 forged bus command", () => {
  it("a command without the per-activation secret, or with a wrong one, is ignored and counted; no upstream call", async () => {
    const env = await started();
    await env.spawn("bob");
    const spawns = counter(env, SUBAGENTS_CHANNEL.spawn);
    const stops = counter(env, SUBAGENTS_CHANNEL.stop);
    const forged = spawnCommand("evil", { cmdId: "f1", prompt: "…", spec: { cwd: "/", tools: ["bash", "write"], noMcp: true, noContextFiles: true, promptFiles: [], env: {}, leanChildren: false } });
    env.command(forged, null);
    env.command(forged, "wrong-secret");
    env.command({ cmd: "stop", cmdId: "f2", member: "bob" }, "wrong-secret");
    env.command({ cmd: "stop", cmdId: "f3", member: "bob" }, null);
    await env.settle();
    expect(spawns.n()).toBe(0);
    expect(stops.n()).toBe(0);
    expect(env.host.counters().inproc_bad_command).toBe(4);
    expect(env.ackOf("f1")).toBeUndefined(); // nothing is acknowledged to a forger
    expect(env.double.children.size).toBe(1);
  });
});

describe("S119 per-activation commandSecret lifecycle", () => {
  it("after a reload the old activation's secret and a missing one are ignored (+1 each); the new secret executes; it never leaks", async () => {
    const a = await started({ secret: "secret-A" });
    const logsBefore = a.logs.length;
    a.host.dispose(); // /reload: the old activation ends
    const sentB: Array<Record<string, unknown>> = [];
    const hostB = createInProcHost({ bus: a.bus, clock: a.clock, send: async (p) => (sentB.push(p), { ok: true }), newSecret: () => "secret-B", newIncarnation: () => "inc-B", readFile: async () => new Uint8Array() });
    hostB.onSessionStart();
    await settle();
    const spawns = counter(a, SUBAGENTS_CHANNEL.spawn);
    const cmd = spawnCommand("bob", { cmdId: "r1" });
    a.bus.emit(AGENT_TEAMS_EVENT_INPROC, { ...cmd, secret: "secret-A" });
    a.bus.emit(AGENT_TEAMS_EVENT_INPROC, { ...cmd });
    await settle();
    expect(spawns.n()).toBe(0);
    expect(hostB.counters().inproc_bad_command).toBe(2);
    a.bus.emit(AGENT_TEAMS_EVENT_INPROC, { ...cmd, secret: "secret-B" });
    await settle();
    expect(spawns.n()).toBe(1);
    expect(sentB.find((p) => p.op === "ack")).toMatchObject({ cmdId: "r1", ok: true });
    // The secret is announced to the server in the hello only; never in the snapshot, the spawn request or logs.
    expect(sentB.find((p) => p.op === "hello")).toMatchObject({ commandSecret: "secret-B", incarnation: "inc-B" });
    expect(JSON.stringify(hostB.snapshot())).not.toContain("secret-B");
    expect(JSON.stringify(a.double.spawnRequests)).not.toContain("secret-B");
    expect(a.logs.slice(logsBefore).join("\n")).not.toContain("secret-");
    hostB.dispose();
  });
});

describe("S112 dock row text", () => {
  const prefix = "bob — ";
  const description = async (title: string | undefined, prompt = "first line\nPROMPT-CANARY second line"): Promise<string> => {
    const env = await started();
    await env.spawn("bob", { ...(title !== undefined ? { title } : {}), prompt });
    const req = env.double.spawnRequests[0];
    expect(req?.subagent_type).toBe("teammate");
    return req?.description as string;
  };

  it.each([
    [73, 79],
    [74, 80],
    [75, 80],
  ])("title of %i characters gives a %i-code-point description (cut at 80)", async (len, expected) => {
    const d = await description("t".repeat(len));
    expect([...d]).toHaveLength(expected);
    expect(d.startsWith(prefix)).toBe(true);
  });

  it("multi-byte and emoji titles are cut on a code-point boundary (no broken surrogate); RTL text is kept", async () => {
    const emoji = await description("😀".repeat(100));
    expect([...emoji]).toHaveLength(80);
    expect(toWellFormed(emoji)).toBe(emoji);
    const rtl = await description("שלום עולם");
    expect(rtl).toBe("bob — שלום עולם");
  });

  it("an empty title uses the spawn summary (first prompt line); no token or later prompt text appears", async () => {
    const d = await description("", "Implement the parser\nPROMPT-CANARY");
    expect(d).toBe("bob — Implement the parser");
    expect(d).not.toContain("CANARY");
    expect(d).not.toContain("tok-secret");
  });
});

describe("S92 idle TTL pass-through", () => {
  it("inProcessIdleTtlSec reaches managed.idleTtlSec; absent ⇒ no key (keep alive until stopped)", async () => {
    const env = await started();
    await env.spawn("bob", { spec: { ...(spawnCommand().spec as object), idleTtlSec: 900 } });
    await env.spawn("eve");
    expect(env.double.spawnRequests[0]?.managed).toEqual({ owner: "agent-teams", keepAlive: true, idleTtlSec: 900 });
    expect(env.double.spawnRequests[1]?.managed).toEqual({ owner: "agent-teams", keepAlive: true });
  });

  it("a ttl disposal of an idle child maps to gone: idle_disposed", async () => {
    const env = await started();
    const { agentId } = await env.spawn("bob");
    env.double.finishRun(agentId as string, { result: "x" });
    env.double.dispose(agentId as string, "ttl");
    await env.settle();
    expect(env.events().at(-1)).toMatchObject({ member: "bob", kind: "gone", reason: "idle_disposed" });
  });

  // The 899 / 900 / 901 s clock and "delivery at 899 s restarts the idle clock" are behaviours of the UPSTREAM package (it frees the child):
  // the recorded double does not model upstream's TTL. Covered by the gated real-upstream suite (task 2.6).
  it.todo("upstream frees an idle managed child at idleTtlSec and a delivery restarts the idle clock (needs the real upstream release 0.9.0)");
});
