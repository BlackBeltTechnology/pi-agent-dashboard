/**
 * The `pi-dashboard-subagents` contract (test-plan S13, S20-S24 and the double's own fidelity). Two suites:
 *  1. the RECORDED CONTRACT DOUBLE (`harness/subagents-double.ts`) reproduces the contract: claim rule, spawn / steer /
 *     interrupt / stop replies, slot queue positions, managed flags, the SAME-TICK `completed|failed` + `idle` of one run,
 *     progress `started` emissions. Always runs.
 *  2. the REAL upstream, `describe.skipIf` the release is absent (0.9.0 is NOT published; npm latest is 0.8.1): the same
 *     scripts against the live extension on a bus, plus the recorded-vs-live drift comparison. The skip carries a visible
 *     reason in its title. Rows that need a real child with a scripted model are `it.todo` until gate task 1.11.
 *  3. the LEAD HOST (`inproc-host.ts`) against the double: the spawn request whitelist (S14), the spawn reply mapping (S15), handler
 *     absent (S16), the `no_context` retry (S17), the steer result mapping (S18, S19) and stop (S25).
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/fake-clock.js";
import { createHostEnv, type HostEnv, spawnCommand, steerCommand } from "../../__tests__/harness/inproc-host-env.js";
import { createInProcPair } from "../../__tests__/harness/inproc-pair.js";
import { createDoubleBus, installSubagentsDouble, RECORDED_TRACES, validCapabilities } from "../../__tests__/harness/subagents-double.js";
import { evaluateCapabilities, LOADER_WHITELIST, type SpawnOut, type SpawnRequest, SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";

const baseRequest: SpawnRequest["request"] = {
  subagent_type: "teammate",
  description: "bob — task",
  prompt: "do it",
  inline: true,
  isolated: true,
  managed: { owner: "agent-teams", keepAlive: true },
  ask: false,
};
const spawn = (bus: ReturnType<typeof createDoubleBus>, request = baseRequest): SpawnRequest => {
  const req: SpawnRequest = { request };
  bus.emit(SUBAGENTS_CHANNEL.spawn, req);
  return req;
};
const ok = (req: SpawnRequest): Extract<SpawnOut, { ok: true }> => {
  expect(req.out).toMatchObject({ ok: true });
  return req.out as Extract<SpawnOut, { ok: true }>;
};
/** The channels emitted by `fn`, in order (a recorded trace). */
const trace = (events: Array<{ channel: string }>, from: number): string[] => events.slice(from).map((e) => e.channel);

describe("recorded contract double: fidelity (S24 double side)", () => {
  it("capabilities: a synchronous answer with apiVersion, features and limits", () => {
    const bus = createDoubleBus();
    installSubagentsDouble(bus, { clock: new FakeClock() });
    const q: { out?: unknown } = {};
    bus.emit(SUBAGENTS_CHANNEL.capabilities, q);
    expect(evaluateCapabilities(q.out)).toMatchObject({ available: true, limits: { maxConcurrent: 4 } });
  });

  it("spawn: a synchronous reply with id, agentId and status; created then started when a slot is free", () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock() });
    const reply = ok(spawn(bus));
    expect(reply).toMatchObject({ status: "running" });
    expect(reply.id).toMatch(/^bg-/);
    expect(reply.agentId).toBeTruthy();
    expect(trace(d.events, 0)).toEqual([...RECORDED_TRACES.spawnRunning]);
    expect(d.spawnRequests[0]).toMatchObject({ inline: true, isolated: true, ask: false, managed: { owner: "agent-teams", keepAlive: true } });
  });

  it("spawn beyond maxConcurrent is queued with a 1-based queuePosition and only `created`", () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock(), maxConcurrent: 1 });
    ok(spawn(bus));
    const from = d.events.length;
    const second = ok(spawn(bus));
    expect(second).toMatchObject({ status: "queued", queuePosition: 1 });
    expect(trace(d.events, from)).toEqual([...RECORDED_TRACES.spawnQueued]);
    const third = ok(spawn(bus));
    expect(third.queuePosition).toBe(2);
    expect(spawn(bus, baseRequest).out).toMatchObject({ queuePosition: 3 });
  });

  it("scripted failure replies and an EMPTY reply (no handler answered) are reproducible", () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock() });
    d.nextSpawnReply({ ok: false, reason: "cap", message: "pending cap" });
    expect(spawn(bus).out).toMatchObject({ ok: false, reason: "cap" });
    d.nextSpawnReply("empty");
    expect(spawn(bus).out).toBeUndefined();
  });

  it("one run ends: completed then idle in the SAME synchronous sequence; failed then idle likewise", () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock() });
    const { agentId } = ok(spawn(bus));
    // Emissions are recorded inside one synchronous call: no tick boundary between the pair.
    let microtaskRan = false;
    void Promise.resolve().then(() => (microtaskRan = true));
    let from = d.events.length;
    d.finishRun(agentId, { result: "done" });
    expect(microtaskRan).toBe(false);
    expect(trace(d.events, from)).toEqual([...RECORDED_TRACES.completedThenIdleSameTick]);
    expect(d.events.at(-1)?.payload).toMatchObject({ run: 1 });
    from = d.events.length;
    d.finishRun(agentId, { error: "boom" });
    expect(trace(d.events, from)).toEqual([...RECORDED_TRACES.failedThenIdleSameTick]);
  });

  it("progress `started` emissions while running do not advance the run counter", () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock() });
    const { agentId } = ok(spawn(bus));
    for (let i = 0; i < 5; i++) d.emitStarted(agentId);
    expect(d.events.filter((e) => e.channel === SUBAGENTS_CHANNEL.started).every((e) => e.payload.run === 1)).toBe(true);
  });

  it("steer: a running child answers queued, an idle child started (a new run), a queued child not_started; scripted empty/reject/pending", async () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock(), maxConcurrent: 1 });
    const a = ok(spawn(bus));
    const b = ok(spawn(bus));
    const steer = (id: string) => {
      const req = { id, message: "m", mode: "steer" as const } as { id: string; message: string; mode: "steer"; out?: Promise<string> };
      bus.emit(SUBAGENTS_CHANNEL.steerRequest, req);
      return req.out;
    };
    expect(await steer(a.id)).toBe("queued");
    expect(await steer(b.id)).toBe("not_started");
    d.finishRun(a.agentId, { result: "x" });
    expect(await steer(a.id)).toBe("started");
    expect(d.events.at(-1)?.payload).toMatchObject({ run: 2 });
    expect(steer("bg-unknown")).toBeUndefined(); // unknown id: nobody answers
    d.nextSteerResult("empty");
    expect(steer(a.id)).toBeUndefined();
    d.nextSteerResult("reject");
    await expect(steer(a.id)).rejects.toThrow("steer failed");
  });

  it("interrupt (optional feature): silent abort parks the child idle with aborted:true; absent feature → no handler", async () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock() });
    const a = ok(spawn(bus));
    const req: { id: string; out?: Promise<string> } = { id: a.id };
    bus.emit(SUBAGENTS_CHANNEL.interruptRequest, req);
    expect(await req.out).toBe("interrupted");
    expect(d.events.at(-1)).toMatchObject({ channel: SUBAGENTS_CHANNEL.idle, payload: { aborted: true } });
    const bus2 = createDoubleBus();
    installSubagentsDouble(bus2, { clock: new FakeClock(), features: [] });
    const r2: { id: string; out?: Promise<string> } = { id: "x" };
    bus2.emit(SUBAGENTS_CHANNEL.interruptRequest, r2);
    expect(r2.out).toBeUndefined();
  });

  it("stop: an idle child is disposed (event confirms); a running child ends stopped; an unknown id produces NO event", () => {
    const bus = createDoubleBus();
    const d = installSubagentsDouble(bus, { clock: new FakeClock() });
    const a = ok(spawn(bus));
    d.finishRun(a.agentId, { result: "x" });
    let from = d.events.length;
    bus.emit(SUBAGENTS_CHANNEL.stop, { agentId: a.agentId });
    expect(trace(d.events, from)).toEqual([...RECORDED_TRACES.stopIdle]);
    from = d.events.length;
    bus.emit(SUBAGENTS_CHANNEL.stop, { agentId: "agent-unknown" });
    expect(trace(d.events, from)).toEqual([...RECORDED_TRACES.stopUnknown]);
  });

  it("CLAIM RULE (S13, double side): two activations on one bus produce exactly one child and one reply; an id-addressed steer is answered only by the owner", async () => {
    const bus = createDoubleBus();
    const clock = new FakeClock();
    const a = installSubagentsDouble(bus, { clock, activation: "A" });
    const b = installSubagentsDouble(bus, { clock, activation: "B" });
    let writes = 0;
    const req: SpawnRequest = {} as SpawnRequest;
    let out: SpawnOut | undefined;
    Object.defineProperty(req, "out", { get: () => out, set: (v: SpawnOut) => ((out = v), writes++) });
    req.request = baseRequest;
    bus.emit(SUBAGENTS_CHANNEL.spawn, req);
    expect(writes).toBe(1);
    expect(a.children.size + b.children.size).toBe(1);
    const owner = a.children.size === 1 ? a : b;
    const child = [...owner.children.values()][0]?.id as string;
    const steer = { id: child, message: "m" } as { id: string; message: string; out?: Promise<string> };
    bus.emit(SUBAGENTS_CHANNEL.steerRequest, steer);
    expect(await steer.out).toBe("queued");
    const unknownInterrupt: { id: string; out?: Promise<string> } = { id: "bg-none" };
    bus.emit(SUBAGENTS_CHANNEL.interruptRequest, unknownInterrupt);
    expect(unknownInterrupt.out).toBeUndefined(); // the bridge sees an empty reply, not a false ok
  });

  it("capabilities replies of the double are claimed once as well", () => {
    const bus = createDoubleBus();
    const clock = new FakeClock();
    installSubagentsDouble(bus, { clock, answer: validCapabilities({ apiVersion: 1 }) });
    installSubagentsDouble(bus, { clock, answer: validCapabilities({ apiVersion: 7 }) });
    const q: { out?: { apiVersion: number } } = {};
    bus.emit(SUBAGENTS_CHANNEL.capabilities, q);
    expect(q.out?.apiVersion).toBe(1);
  });
});

// ── real upstream (gated) ──────────────────────────────────────────────────────────────────────────

interface Live {
  activate(pi: unknown): void;
}

async function detectUpstream(): Promise<{ live?: Live; reason: string }> {
  const specifier = "@blackbelt-technology/pi-dashboard-subagents";
  let mod: { default?: unknown };
  try {
    mod = (await import(/* @vite-ignore */ specifier)) as { default?: unknown };
  } catch {
    return { reason: "the package is not installed (release 0.9.0 is not published; npm latest 0.8.1)" };
  }
  if (typeof mod.default !== "function") return { reason: "the package has no default activate function" };
  try {
    const bus = createDoubleBus();
    const pi = { events: bus, on() {}, registerTool() {}, registerCommand() {}, registerMessageRenderer() {} };
    (mod.default as (p: unknown) => void)(pi);
    const q: { out?: unknown } = {};
    bus.emit(SUBAGENTS_CHANNEL.capabilities, q);
    const out = q.out instanceof Promise ? await q.out : q.out;
    if (!evaluateCapabilities(out).available) return { reason: "the installed package does not answer subagents:capabilities with the required API (release < 0.9.0)" };
  } catch (err) {
    return { reason: `the package could not be activated on a fake pi: ${(err as Error).message}` };
  }
  return { live: { activate: mod.default as (p: unknown) => void }, reason: "" };
}

const upstream = await detectUpstream();

describe.skipIf(!upstream.live)(`real pi-dashboard-subagents ${upstream.live ? "" : `(SKIPPED: ${upstream.reason})`}`, () => {
  const fresh = () => {
    const bus = createDoubleBus();
    const pi = { events: bus, on() {}, registerTool() {}, registerCommand() {}, registerMessageRenderer() {} };
    return { bus, pi };
  };

  it("S6/S7 on the live package: the capability answer passes the handshake and records every required feature", async () => {
    const { bus, pi } = fresh();
    upstream.live?.activate(pi);
    const q: { out?: unknown } = {};
    bus.emit(SUBAGENTS_CHANNEL.capabilities, q);
    const v = evaluateCapabilities(q.out instanceof Promise ? await q.out : q.out);
    expect(v.available).toBe(true);
  });

  it("S13 claim rule: the package activated twice on one bus produces exactly one reply per request; unknown ids leave `out` unset", async () => {
    const { bus, pi } = fresh();
    upstream.live?.activate(pi);
    upstream.live?.activate(pi);
    let writes = 0;
    const req = { request: baseRequest } as SpawnRequest;
    let out: unknown;
    Object.defineProperty(req, "out", { get: () => out, set: (v) => ((out = v), writes++) });
    bus.emit(SUBAGENTS_CHANNEL.spawn, req);
    expect(writes).toBe(1);
    const steer = { id: "bg-none", message: "m" } as { id: string; message: string; out?: unknown };
    bus.emit(SUBAGENTS_CHANNEL.steerRequest, steer);
    expect(steer.out).toBeUndefined();
    const interrupt = { id: "bg-none" } as { id: string; out?: unknown };
    bus.emit(SUBAGENTS_CHANNEL.interruptRequest, interrupt);
    expect(interrupt.out).toBeUndefined();
  });

  it("S24 drift: a spawn before any ExtensionContext is answered no_context (recorded contract), and stop of an unknown id emits no event", () => {
    const { bus, pi } = fresh();
    upstream.live?.activate(pi);
    const req = { request: baseRequest } as SpawnRequest;
    bus.emit(SUBAGENTS_CHANNEL.spawn, req);
    expect(req.out).toMatchObject({ ok: false, reason: "no_context" });
    const seen: string[] = [];
    for (const ch of Object.values(SUBAGENTS_CHANNEL)) bus.on(ch, () => seen.push(ch));
    bus.emit(SUBAGENTS_CHANNEL.stop, { agentId: "agent-none" });
    expect(seen.filter((c) => c !== SUBAGENTS_CHANNEL.stop)).toEqual([...RECORDED_TRACES.stopUnknown]);
  });

  // Rows that need a REAL child with a scripted (faux) model; enabled at gate task 1.11 once 0.9.0 is installed.
  it.todo("S24 drift: same-tick completed + idle and failed + idle per run, progress `started`, disposed — recorded trace equals the live trace");
  it.todo("S20 interrupt: present+running → silent abort, idle {aborted:true}; absent → interrupt_unavailable, child keeps running");
  it.todo("S21 managed children: no subagents:mail push, AgentControl default coverage excludes them, explicit actions refused with managed_child, dock rows still emitted");
  it.todo("S22 managed spawn ignores before_spawn patches; a veto → reply `vetoed`");
  it.todo("S23 managed children do not count toward the pending/idle caps and survive the global idle TTL; idleTtlSec frees at 900 s");
  it.todo("S45 token/env are not process-wide: process.env unchanged, each child's closure env is its own");
});

// ── the lead host against the double ───────────────────────────────────────────────────────────────────

const hostSpawnSpec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...(spawnCommand().spec as object), ...over });

async function startedHost(opts: Parameters<typeof createHostEnv>[0] = {}): Promise<HostEnv> {
  const env = createHostEnv(opts);
  await env.start();
  return env;
}

function observe(env: HostEnv, channel: string): { n: () => number } {
  let n = 0;
  env.bus.on(channel, () => n++);
  return { n: () => n };
}

describe("S14 spawn request contract (field whitelist)", () => {
  it("always inline, isolated, managed {agent-teams, keepAlive}, ask:false; hostile extras and overrides are dropped; tools are the validated resolved tools", async () => {
    const extension = { name: "child-team-extension" };
    const env = await startedHost({ childExtension: () => extension });
    const hostile = spawnCommand("bob", {
      loader: { extensionPaths: ["/evil"], agentDir: "/evil", additionalExtensionPaths: ["/evil"] },
      cwd: "/not-from-spec",
      managed: { owner: "other", keepAlive: false },
      isolated: false,
      inline: false,
      ask: true,
      spec: hostSpawnSpec({ tools: ["read", "Agent", "AgentControl", "ask_parent", "SendMessage"], loader: { extensionPaths: ["/evil"] }, agentDir: "/evil" }),
    });
    env.command(hostile);
    await env.settle();
    const req = env.double.spawnRequests[0];
    expect(req).toMatchObject({ inline: true, isolated: true, ask: false, managed: { owner: "agent-teams", keepAlive: true }, cwd: "/work", subagent_type: "teammate" });
    expect(req?.tools).toEqual(["read", "SendMessage"]);
    expect(Object.keys(req?.loader ?? {}).every((k) => LOADER_WHITELIST.includes(k as never))).toBe(true);
    expect(req?.loader?.extensionFactories).toEqual([extension]);
    expect(JSON.stringify(req)).not.toMatch(/extensionPaths|agentDir|additionalExtensionPaths|evil|other/);
  });

  it("the loader carries the ordered prompt files, noContextFiles and (lean children) noExtensions; absent options send no key", async () => {
    const env = await startedHost();
    await env.spawn("bob", { spec: hostSpawnSpec({ promptFiles: ["/p/protocol.md", "/p/agent.md", "/p/member.md"], noContextFiles: true, leanChildren: true }) });
    await env.spawn("eve", { spec: hostSpawnSpec({ promptFiles: [], noContextFiles: false, leanChildren: false }) });
    expect(env.double.spawnRequests[0]?.loader).toEqual({ noExtensions: true, noContextFiles: true, appendSystemPrompt: ["/p/protocol.md", "/p/agent.md", "/p/member.md"] });
    expect(env.double.spawnRequests[1]?.loader).toEqual({ noContextFiles: false });
  });

  it("cwdScope:\"any\" is sent only when the command asked for it AND the feature cwd_scope exists", async () => {
    const withFeature = await startedHost();
    await withFeature.spawn("bob", { spec: hostSpawnSpec({ cwdScope: "any" }) });
    await withFeature.spawn("eve");
    expect(withFeature.double.spawnRequests[0]?.cwdScope).toBe("any");
    expect(withFeature.double.spawnRequests[1]?.cwdScope).toBeUndefined();
    const without = await startedHost({ double: { answer: validCapabilities({ features: ["spawn", "steer", "managed", "loader"] }) } });
    await without.spawn("bob", { spec: hostSpawnSpec({ cwdScope: "any" }) });
    expect(without.double.spawnRequests[0]?.cwdScope).toBeUndefined();
  });
});

describe("S15 spawn reply mapping", () => {
  const ok = (over: Record<string, unknown> = {}) => ({ ok: true, id: "bg-x", agentId: "agent-x", status: "running", ...over });
  const rows: Array<[string, unknown, Record<string, unknown>]> = [
    ["ok queued(pos)", ok({ status: "queued", queuePosition: 2 }), { ok: true, status: "queued", queuePosition: 2, childId: "bg-x", agentId: "agent-x" }],
    ["ok started", ok(), { ok: true, status: "running", childId: "bg-x", agentId: "agent-x" }],
    ["no_context", { ok: false, reason: "no_context", message: "m" }, { ok: false, error: "no_context" }],
    ["cap", { ok: false, reason: "cap", message: "m" }, { ok: false, error: "team_full" }],
    ["cwd_out_of_scope", { ok: false, reason: "cwd_out_of_scope", message: "m" }, { ok: false, error: "cwd_outside_scope" }],
    ["cwd_not_found", { ok: false, reason: "cwd_not_found", message: "m" }, { ok: false, error: "cwd_outside_scope" }],
    ["cwd_not_dir", { ok: false, reason: "cwd_not_dir", message: "m" }, { ok: false, error: "cwd_outside_scope" }],
    ["vetoed", { ok: false, reason: "vetoed", message: "m" }, { ok: false, error: "spawn_vetoed" }],
    ["unsupported", { ok: false, reason: "unsupported", message: "m" }, { ok: false, error: "subagents_extension_outdated" }],
    ["invalid", { ok: false, reason: "invalid", message: "m" }, { ok: false, error: "invalid_args" }],
    ["unknown reason", { ok: false, reason: "brand_new", message: "m" }, { ok: false, error: "subagents_extension_outdated" }],
    ["ok:true without agentId", { ok: true, id: "bg-x", status: "running" }, { ok: false, error: "subagents_extension_outdated" }],
    ["ok:true without id", { ok: true, agentId: "a", status: "running" }, { ok: false, error: "subagents_extension_outdated" }],
    ['ok:"yes"', { ok: "yes", id: "bg-x", agentId: "agent-x" }, { ok: false, error: "subagents_extension_outdated" }],
    ["empty (no out)", "empty", { ok: false, error: "subagents_extension_missing" }],
  ];

  it.each(rows)("%s → a defined ack and a stable code", async (_name, reply, expected) => {
    const env = await startedHost();
    env.double.nextSpawnReply(reply as never);
    const cmd = spawnCommand("bob");
    env.command(cmd);
    await env.settle();
    expect(env.ackOf(cmd.cmdId as string)).toMatchObject(expected);
    const isChild = expected.ok === true;
    // A failure leaves no child in the registry; the name is reusable at once (a fresh cmdId executes).
    expect(env.host.snapshot().members.length).toBe(isChild ? 1 : 0);
    if (!isChild) {
      expect((await env.spawn("bob", { cmdId: "again" })).ok).toBe(true);
    }
  });

  it("a malformed ok:true never becomes a child (no registry entry, no events mapped for it)", async () => {
    const env = await startedHost();
    env.double.nextSpawnReply({ ok: true, id: "bg-x", status: "running" } as never);
    env.command(spawnCommand("bob"));
    await env.settle();
    expect(env.host.snapshot().members).toEqual([]);
    expect(env.events()).toEqual([]);
  });
});

describe("S16 spawn handler absent", () => {
  it("an empty reply: the member fails subagents_extension_missing, the capability probe repeats once per empty reply, running members are not closed, the name is reusable", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("eve");
    await expect(pair.spawn("eve")).resolves.toMatchObject({ ok: true });
    pair.reserve("bob");
    const probes = observe(pair.host, SUBAGENTS_CHANNEL.capabilities);
    pair.host.double.nextSpawnReply("empty");
    const first = await pair.spawn("bob");
    expect(first).toMatchObject({ ok: false });
    expect((first as { message: string }).message).toContain("subagents_extension_missing");
    await pair.settle();
    expect(probes.n()).toBe(1);
    expect(pair.host.host.snapshot().members.map((m) => m.member)).toEqual(["eve"]); // the running teammate is untouched
    await expect(pair.spawn("bob")).resolves.toMatchObject({ ok: true }); // the name is reusable at once
    expect(pair.store.get(pair.team.id)?.status).not.toBe("closed");
  });
});

describe("S17 no_context retry (BVA on spawnTimeoutMs)", () => {
  const T = 60_000;

  it("retried after the next session_start (same cmdId, one child); a session_start at T−1 still succeeds", async () => {
    const pair = createInProcPair({ config: { spawnTimeoutMs: T } });
    await pair.start();
    pair.reserve("bob");
    pair.host.double.nextSpawnReply({ ok: false, reason: "no_context", message: "no ctx yet" });
    const outcome = pair.spawn("bob");
    await pair.settle();
    await pair.clock.advanceAsync(T - 1);
    pair.host.host.onSessionStart(); // the session_start re-fires: probe → hello → the driver retries
    await pair.settle();
    await expect(outcome).resolves.toMatchObject({ ok: true });
    const spawns = pair.cmds().filter((c) => c.cmd === "spawn");
    expect(spawns).toHaveLength(2);
    expect(spawns[0]?.cmdId).toBe(spawns[1]?.cmdId); // idempotent cmdId
    expect(pair.host.double.children.size).toBe(1);
  });

  it("no session_start at all: spawn_timeout at T (counted from the spawn command, not from started); T−1 is still retrying", async () => {
    const pair = createInProcPair({ config: { spawnTimeoutMs: T } });
    await pair.start();
    pair.reserve("bob");
    pair.host.double.nextSpawnReply({ ok: false, reason: "no_context", message: "no ctx yet" });
    const outcome = pair.spawn("bob");
    let done = false;
    void outcome.then(() => (done = true));
    await pair.settle();
    await pair.clock.advanceAsync(T - 1);
    expect(done).toBe(false);
    await pair.clock.advanceAsync(1);
    await expect(outcome).resolves.toEqual({ ok: false, message: expect.stringContaining("spawn_timeout") });
    expect(pair.host.double.children.size).toBe(0);
  });
});

describe("S18/S19 steer request contract", () => {
  async function bobEnv(): Promise<HostEnv> {
    const env = await startedHost();
    await env.spawn("bob");
    return env;
  }
  const steer = async (env: HostEnv, id: number, cmdId = `s${id}`): Promise<void> => {
    env.command(steerCommand("bob", [id], { cmdId }));
    await env.settle();
  };
  const ledger = (env: HostEnv): number[] => env.host.snapshot().members[0]?.deliveredMailIds ?? [];

  it.each([
    ["started", { ok: true, result: "started" }],
    ["queued", { ok: true, result: "queued", run: 1 }],
  ])("%s → handed over: the id enters the ledger", async (result, expected) => {
    const env = await bobEnv();
    env.double.nextSteerResult(result);
    await steer(env, 1);
    expect(env.ackOf("s1")).toMatchObject(expected);
    expect(ledger(env)).toEqual([1]);
  });

  it("not_started → the mail stays queued: no ledger entry, the result is NOT stored for replay (S19: the retry executes)", async () => {
    const env = await bobEnv();
    const steers = observe(env, SUBAGENTS_CHANNEL.steerRequest);
    env.double.nextSteerResult("not_started");
    await steer(env, 1, "retry-me");
    expect(env.ackOf("retry-me")).toMatchObject({ ok: false, error: "not_started" });
    expect(ledger(env)).toEqual([]);
    await steer(env, 1, "retry-me"); // the slot freed: same cmdId again
    expect(steers.n()).toBe(2);
    expect(env.ackOf("retry-me")).toMatchObject({ ok: true, result: "queued" });
    expect(ledger(env)).toEqual([1]); // ids enter the ledger only after started/queued
    await steer(env, 1, "retry-me"); // now stored: a third send replays
    expect(steers.n()).toBe(2);
  });

  it.each(["not_alive", "not_found"])("%s → ack not_alive and the member is reported gone: not_alive", async (result) => {
    const env = await bobEnv();
    env.double.nextSteerResult(result);
    await steer(env, 1);
    expect(env.ackOf("s1")).toMatchObject({ ok: false, error: "not_alive" });
    expect(env.events().at(-1)).toMatchObject({ kind: "gone", reason: "not_alive" });
    expect(ledger(env)).toEqual([]);
  });

  it("empty reply → the mail stays queued, the delivery_timeout counter counts, the probe is repeated", async () => {
    const env = await bobEnv();
    const probes = observe(env, SUBAGENTS_CHANNEL.capabilities);
    env.double.nextSteerResult("empty");
    await steer(env, 1);
    expect(env.ackOf("s1")).toMatchObject({ ok: false, error: "subagents_extension_missing" });
    expect(env.host.counters().inproc_delivery_timeout).toBe(1);
    expect(probes.n()).toBe(1);
    expect(ledger(env)).toEqual([]);
  });

  it.each([["a malformed string", "ok"], ["a rejected promise", "reject"]])("%s → steer_failed: queued, member not gone, no ledger entry", async (_n, result) => {
    const env = await bobEnv();
    env.double.nextSteerResult(result);
    await steer(env, 1);
    expect(env.ackOf("s1")).toMatchObject({ ok: false, error: "steer_failed" });
    expect(env.host.snapshot().members.map((m) => m.member)).toEqual(["bob"]);
    expect(ledger(env)).toEqual([]);
  });

  it("a promise pending forever frees its slot after the host deadline (125 s) with steer_failed; before that nothing is acked", async () => {
    const env = await bobEnv();
    env.double.nextSteerResult("pending");
    env.command(steerCommand("bob", [1], { cmdId: "pend" }));
    await env.settle();
    await env.clock.advanceAsync(124_999);
    expect(env.ackOf("pend")).toBeUndefined();
    await env.clock.advanceAsync(1);
    expect(env.ackOf("pend")).toMatchObject({ ok: false, error: "steer_failed" });
  });

  it("server side: a not_alive result marks the member gone (not_alive) and a not_started result retries on the next child event", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    await pair.spawn("bob");
    pair.store.patchMember(pair.team.id, "bob", { status: "busy" });
    const mail = (text: string) => pair.store.appendMail(pair.team.id, { from: "lead", to: "bob", kind: "message", text, wake: true }) as never;
    const ref = { teamId: pair.team.id, member: "bob" };
    pair.host.double.nextSteerResult("not_started");
    pair.driver.deliver(ref, [mail("a")], { wake: true });
    await pair.settle();
    expect(pair.unhanded).toEqual(["bob"]);
    pair.driver.retryNotStarted(pair.team.id);
    expect(pair.flushed).toEqual(["bob"]);
    pair.host.double.nextSteerResult("not_alive");
    pair.driver.deliver(ref, [mail("b")], { wake: true });
    await pair.settle();
    expect(pair.gone).toEqual([{ member: "bob", reason: "not_alive" }]);
  });
});

describe("S25 stop uses the existing channel", () => {
  const stopOutcome = async (setup: (env: HostEnv, agentId: string) => void) => {
    const env = await startedHost({ double: { maxConcurrent: 1 } });
    const first = await env.spawn("bob");
    const second = await env.spawn("eve"); // queued behind bob (maxConcurrent 1)
    setup(env, first.agentId as string);
    return { env, first, second };
  };

  it("a running child: stop ends the run stopped, the event confirms, the member is gone and acked", async () => {
    const { env, first } = await stopOutcome(() => undefined);
    env.command({ cmd: "stop", cmdId: "st-run", member: "bob" });
    await env.settle();
    expect(env.ackOf("st-run")).toMatchObject({ ok: true });
    expect(env.events().at(-1)).toMatchObject({ member: "bob", kind: "gone", reason: "stopped" });
    expect(env.double.children.has(first.agentId as string)).toBe(false);
  });

  it("an idle child is freed (disposed event confirms) and a queued child is removed from the queue", async () => {
    const { env, first } = await stopOutcome((e, agentId) => e.double.finishRun(agentId, { result: "done" }));
    env.command({ cmd: "stop", cmdId: "st-idle", member: "bob" });
    env.command({ cmd: "stop", cmdId: "st-queued", member: "eve" });
    await env.settle();
    expect(env.ackOf("st-idle")).toMatchObject({ ok: true });
    expect(env.ackOf("st-queued")).toMatchObject({ ok: true });
    expect(env.events().filter((e) => e.kind === "gone").map((e) => `${e.member}:${e.reason}`).sort()).toEqual(["bob:stopped", "eve:stopped"]);
    expect(env.double.children.size).toBe(0);
    expect(first.ok).toBe(true);
  });

  it("an unknown child id: no event follows, so the stop is not acked and the member goes gone: not_alive only after the command timeout T (not before)", async () => {
    const pair = createInProcPair();
    await pair.start();
    pair.reserve("bob");
    await pair.spawn("bob");
    pair.host.double.children.clear(); // upstream no longer knows the id
    let result: boolean | undefined;
    void pair.driver.shutdown({ teamId: pair.team.id, member: "bob" }).then((v) => (result = v));
    await pair.settle();
    await pair.clock.advanceAsync(9_999);
    expect(result).toBeUndefined(); // T−1: still waiting
    await pair.clock.advanceAsync(2);
    expect(result).toBe(false); // T+1: delivery_timeout ⇒ the core marks the member gone: not_alive
    expect(pair.host.acks().filter((a) => a.cmdId.startsWith("stop:")).length).toBe(0);
  });
});
