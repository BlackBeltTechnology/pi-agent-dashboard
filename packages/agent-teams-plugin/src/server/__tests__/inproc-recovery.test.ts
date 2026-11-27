/**
 * Server load with in-process teams (test-plan S11, S12): open in-process teams are closed `mode_unavailable` when the mode is
 * gone and kept (members `disconnected`) while it is available; the additive optional record fields round-trip and an older
 * record still loads. The lifecycle re-bind after the lead's hello + snapshot is a later task.
 * Also the LANE side of recovery that the lead host owns: commands queued for a disconnected lead (S32), lifecycle reports that survive a
 * lane outage (S38, S40) and the outbox bounds (S118). What the server DOES with a report (dedupe by `lastSettleId`, re-bind from a
 * snapshot) is the lifecycle intake of a later task.
 * See change: add-agent-teams-in-process.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHostEnv, type LanePayload, settle } from "../../__tests__/harness/inproc-host-env.js";
import { linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { createInProcPair } from "../../__tests__/harness/inproc-pair.js";
import { createInProcStack } from "../../__tests__/harness/inproc-stack.js";
import { memberFixture } from "../../__tests__/harness/store-env.js";
import { createTeamsEnv } from "../../__tests__/harness/teams-env.js";
import { createInProcHost } from "../../bridge/inproc-host.js";
import { createOutbox, OUTBOX_MAX_BYTES, OUTBOX_MAX_ENTRIES, type ReportResult } from "../../bridge/inproc-outbox.js";
import type { InProcEvent } from "../../shared/inproc-protocol.js";
import type { Member, Team } from "../../shared/types.js";
import { resolveProxied } from "../proxy-identity.js";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "at-inproc-rec-"));

/** Persist an open in-process team (2 members) over `dataDir` and return its id. */
async function persistTeam(dataDir: string): Promise<string> {
  const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
  const link = linkInProcBridge(env);
  await link.hello({ available: true });
  const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
  const teamId = created.data.teamId as string;
  for (const name of ["bob", "eve"]) env.rt.store.reserveMember(teamId, memberFixture(name, { status: "idle", childId: `bg-${name}`, childAgentId: `agent-${name}`, proxyToken: `${name}-token`.padEnd(64, "0") }) as Member);
  env.rt.persistence.flushSync();
  return teamId;
}

describe("S11 open in-process teams on server load", () => {
  it("the mode is not registered (rollback / forced off): closed mode_unavailable, members gone, tasks released", async () => {
    const dataDir = tmp();
    const teamId = await persistTeam(dataDir);
    const env = createTeamsEnv({ dataDir }); // default runtime: the in-process mode is not registered
    const team = env.rt.store.get(teamId) as Team;
    expect(team.status).toBe("closed");
    expect(team.closeReason).toBe("mode_unavailable");
    expect(team.members.map((m) => m.status)).toEqual(["gone", "gone"]);
    expect(team.members.every((m) => m.goneReason === "mode_unavailable")).toBe(true);
  });

  it("mode registered and the lead not yet connected: stays open, members disconnected, NOT closed", async () => {
    const dataDir = tmp();
    const teamId = await persistTeam(dataDir);
    const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    env.fake.base.sessions.delete(env.lead); // the lead has not (re)connected after the restart (no `onSessionEnded`: a session that never returned is not an ended one)
    const team = env.rt.store.get(teamId) as Team;
    expect(team.status).not.toBe("closed");
    expect(team.members.map((m) => m.status)).toEqual(["disconnected", "disconnected"]);
  });

  it("package removed meanwhile: the lead's FIRST hello reports unavailable → closed mode_unavailable, members gone", async () => {
    const dataDir = tmp();
    const teamId = await persistTeam(dataDir);
    const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    expect((env.rt.store.get(teamId) as Team).status).not.toBe("closed");
    await link.hello({ available: false, reason: "subagents_extension_missing" });
    const team = env.rt.store.get(teamId) as Team;
    expect(team.status).toBe("closed");
    expect(team.closeReason).toBe("mode_unavailable");
    expect(team.members.every((m) => m.status === "gone")).toBe(true);
  });
});

describe("S11 (cont.) the lead connected and available", () => {
  it("mode available + lead connected: the team stays open and its members are re-bound by the lead's hello + snapshot (not closed)", async () => {
    const dataDir = tmp();
    const teamId = await persistTeam(dataDir);
    const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    expect((env.rt.store.get(teamId) as Team).members.map((m) => m.status)).toEqual(["disconnected", "disconnected"]);
    await link.lane({
      op: "hello",
      incarnation: "inc-1",
      commandSecret: "s",
      inProcess: { available: true, apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } },
      snapshot: { members: ["bob", "eve"].map((m) => ({ member: m, childId: `bg-${m}`, agentId: `agent-${m}`, state: m === "bob" ? "busy" : "idle", run: 1, lastIdleRun: m === "bob" ? 0 : 1, deliveredMailIds: [] })) },
    });
    const team = env.rt.store.get(teamId) as Team;
    expect(team.status).toBe("active");
    expect(team.members.map((m) => [m.name, m.status])).toEqual([["bob", "busy"], ["eve", "idle"]]);
  });
});

describe("S12 additive optional fields keep schemaVersion 1", () => {
  const record = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "t_00000001",
    name: "t",
    leadSessionId: "S-lead",
    leadConnected: false,
    leadCwd: "/work",
    mode: "in-process",
    status: "active",
    committer: "lead",
    maxTeammates: 5,
    members: [{ name: "bob", spawnToken: "at-1", cwd: "/work", status: "disconnected", guardActive: true, noMcp: false, noContextFiles: false, lastSettleId: 2, childId: "bg-1", childAgentId: "agent-1", proxyToken: "a".repeat(64), queuePosition: 1, steerAckRun: 3 }],
    tasks: [],
    nextTaskId: 1,
    nextMailId: 1,
    createdAt: 1_700_000_000_000,
    leadIncarnation: "inc-1",
    subagentsApi: { apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } },
    pendingStops: [{ childId: "bg-9", agentId: "agent-9", incarnation: "inc-0", at: 1_699_999_999_000 }],
    schemaVersion: 1,
    ...over,
  });
  const write = (dir: string, rec: Record<string, unknown>): string => {
    fs.mkdirSync(path.join(dir, "teams"), { recursive: true, mode: 0o700 });
    const file = path.join(dir, "teams", `${rec.id as string}.json`);
    fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o600 });
    return file;
  };

  it("(a) a session-mode record written before this change loads with defaults and unchanged behaviour", () => {
    const dir = tmp();
    const old = record({ mode: "session" });
    for (const k of ["leadIncarnation", "subagentsApi", "pendingStops"]) delete old[k];
    for (const k of ["childId", "childAgentId", "proxyToken", "queuePosition", "steerAckRun"]) delete (old.members as Array<Record<string, unknown>>)[0]?.[k];
    write(dir, old);
    const env = createTeamsEnv({ dataDir: dir });
    const team = env.rt.store.get("t_00000001") as Team;
    expect(team).toMatchObject({ mode: "session", status: "active", schemaVersion: 1 });
    expect(team.leadIncarnation).toBeUndefined();
    expect(team.members[0]?.status).toBe("disconnected");
  });

  it("(b) an in-process record round-trips byte-stable", () => {
    const dir = tmp();
    const file = write(dir, record());
    const before = fs.readFileSync(file, "utf8");
    const env = createTeamsEnv({ dataDir: dir, runtime: { inProcess: true } });
    const team = env.rt.store.get("t_00000001") as Team;
    expect(team).toMatchObject({ leadIncarnation: "inc-1", schemaVersion: 1, subagentsApi: { apiVersion: 1 } });
    expect(team.pendingStops).toHaveLength(1);
    expect(team.members[0]).toMatchObject({ childId: "bg-1", childAgentId: "agent-1", queuePosition: 1, steerAckRun: 3 });
    env.rt.store.patchTeam(team.id, {}, { writeThrough: true });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("(c) an unknown extra field is preserved or ignored without a crash", () => {
    const dir = tmp();
    const file = write(dir, record({ futureField: { x: 1 } }));
    const env = createTeamsEnv({ dataDir: dir, runtime: { inProcess: true } });
    const team = env.rt.store.get("t_00000001");
    expect(team?.status).toBe("active");
    env.rt.store.patchTeam("t_00000001", {}, { writeThrough: true });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).futureField).toEqual({ x: 1 });
  });

  it("(d) a member record without its proxyToken cannot authenticate (usable only after a respawn) and is flagged in the log", () => {
    const dir = tmp();
    const rec = record();
    delete (rec.members as Array<Record<string, unknown>>)[0]?.proxyToken;
    write(dir, rec);
    const env = createTeamsEnv({ dataDir: dir, runtime: { inProcess: true } });
    expect(env.fake.logs.warn.join("\n")).toContain("has no proxy token");
    expect(resolveProxied(env.rt.store, "S-lead", { member: "bob", token: "a".repeat(64) })).toEqual({ ok: false, error: "forbidden" });
  });

  it("a rollback build ignores the new fields: a record with them stripped loads like (a)", () => {
    const dir = tmp();
    const rec = record();
    for (const k of ["leadIncarnation", "subagentsApi", "pendingStops"]) delete rec[k];
    write(dir, rec);
    const env = createTeamsEnv({ dataDir: dir });
    expect(env.rt.store.get("t_00000001")?.closeReason).toBe("mode_unavailable"); // the mode is gone in that build
    expect(env.rt.store.get("t_00000001")?.schemaVersion).toBe(1);
  });
});

describe("S32 lead not connected", () => {
  it("commands issued while the lead is away flush in issue order after its hello, each once; a 5 minute absence does not time out the spawn", async () => {
    const pair = createInProcPair({ config: { spawnTimeoutMs: 60_000 } });
    pair.connected.delete("S-lead");
    for (const n of ["bob", "eve"]) pair.reserve(n);
    const spawnBob = pair.spawn("bob");
    void pair.driver.shutdown({ teamId: pair.team.id, member: "eve" });
    let settled = false;
    void spawnBob.then(() => (settled = true));
    await pair.clock.advanceAsync(5 * 60_000); // > spawnTimeoutMs: the clock does not run while the lead is away
    expect(settled).toBe(false);
    expect(pair.cmds()).toHaveLength(0);
    pair.connected.add("S-lead");
    await pair.start(); // the lead's hello
    await pair.settle();
    expect(pair.cmds().map((c) => `${c.cmd}:${(c as { member?: string }).member}`)).toEqual(["spawn:bob", "stop:eve"]);
    await expect(spawnBob).resolves.toMatchObject({ ok: true });
    pair.host.host.onReconnect(); // a second hello re-emits nothing
    await pair.settle();
    expect(pair.cmds()).toHaveLength(2);
  });

  it("a hello with a DIFFERENT incarnation drops the queued commands (the children are gone) and the members are lead_reloaded; none of them reaches the new activation", async () => {
    const env = createTeamsEnv({ runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    await link.hello({ available: true });
    const teamId = (await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).data.teamId as string;
    env.fake.base.sessions.delete(env.lead); // the lead is away: commands queue
    await env.fake.call(env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    expect(env.rt.inProcess?.driver.queueSize()).toBe(1);
    env.fake.addSession(env.lead);
    await link.hello({ available: true }, { incarnation: "inc-other", commandSecret: "s2" });
    await env.settle();
    expect(env.rt.inProcess?.driver.queueSize()).toBe(0);
    expect(link.commands).toHaveLength(0);
    const team = env.rt.store.get(teamId) as Team;
    expect(team).toMatchObject({ status: "closed", closeReason: "lead_reloaded" });
    expect(team.members[0]?.status === "gone" || team.members[0]?.status === "failed").toBe(true);
  });
});

describe("S38 lifecycle reports survive a lane outage (host outbox)", () => {
  const event = (p: LanePayload): boolean => p.op === "event";

  it("entries leave only on ok:true; a transport failure keeps them, and they flush IN ORDER after the next hello (started r1, idle r1 with finalText, gone)", async () => {
    let outage = false;
    const delivered: InProcEvent[] = [];
    const env = createHostEnv({
      send: (p) => {
        if (!event(p)) return { ok: true };
        if (outage) return { ok: false, transport: true, error: "disconnected" };
        delivered.push(p as unknown as InProcEvent);
        return { ok: true };
      },
    });
    await env.start();
    const { agentId } = await env.spawn("bob");
    expect(delivered.map((e) => e.kind)).toEqual(["started"]);
    outage = true; // the lane drops
    env.double.finishRun(agentId as string, { result: "the final answer" });
    await env.settle();
    env.double.dispose(agentId as string, "cancel");
    await env.settle();
    expect(delivered.map((e) => e.kind)).toEqual(["started"]); // nothing got through
    expect(env.host.outbox.entries().map((e) => e.kind)).toEqual(["idle", "gone"]); // kept
    outage = false;
    env.host.onReconnect(); // the next hello
    await env.settle();
    expect(delivered.map((e) => `${e.kind}:${e.run}`)).toEqual(["started:1", "idle:1", "gone:1"]);
    expect(delivered[1]?.finalText).toBe("the final answer");
    expect(env.host.outbox.size).toBe(0);
  });

  it("a report acknowledged but whose ok:true was lost is re-sent (the server dedupes by lastSettleId)", async () => {
    const seen: string[] = [];
    let loseOk = true;
    const env = createHostEnv({
      send: (p) => {
        if (!event(p)) return { ok: true };
        seen.push(`${p.kind}:${p.run}`);
        return loseOk ? { ok: false, transport: true, error: "timeout" } : { ok: true };
      },
    });
    loseOk = false;
    await env.start();
    const { agentId } = await env.spawn("bob");
    loseOk = true; // the idle report reaches the server but its ok:true is lost
    env.double.finishRun(agentId as string, { result: "x" });
    await env.settle();
    loseOk = false;
    env.host.onReconnect();
    await env.settle();
    expect(seen.filter((s) => s === "idle:1").length).toBeGreaterThanOrEqual(2); // delivered at least twice: harmless for a deduping server
    expect(env.host.outbox.size).toBe(0);
  });

  it("the snapshot carries the unacknowledged settle, matching the queued outbox entry (one (member, run), not two)", async () => {
    const env = createHostEnv({ send: (p) => (event(p) ? { ok: false, transport: true } : { ok: true }) });
    await env.start();
    const { agentId } = await env.spawn("bob");
    env.double.finishRun(agentId as string, { result: "pending answer" });
    await env.settle();
    const member = env.host.snapshot().members[0];
    expect(member?.unackedSettle).toEqual({ run: 1, finalText: "pending answer" });
    expect(env.host.outbox.entries().filter((e) => e.kind === "idle" && e.run === 1)).toHaveLength(1);
  });

  it("server: the lead gets the final answer exactly once when the same settle arrives from the outbox and from the snapshot (lifecycle intake, task 7.1)", async () => {
    const st = createInProcStack();
    await st.start();
    const team = await st.createTeam();
    await st.spawn(team, "bob");
    st.lane.up = false; // the lane drops while the child finishes
    st.double.finishRun(st.agentOf(team, "bob"), { result: "the one answer" });
    await st.settle();
    expect(st.member(team, "bob").status).toBe("busy"); // the server has not heard of it
    expect(st.host.snapshot().members[0]?.unackedSettle).toMatchObject({ run: 1, finalText: "the one answer" });
    st.lane.up = true;
    st.host.onReconnect(); // the hello carries the snapshot (with the unacked settle), then the outbox flushes the same (member, run)
    await st.settle();
    await st.flushNotices();
    expect(st.member(team, "bob")).toMatchObject({ status: "idle", lastSettleId: 1 });
    expect(st.notices(team).filter((m) => m.text.includes("the one answer"))).toHaveLength(1);
  });

  it("server: an idle report whose ok:true was lost is re-sent; the lead still gets the answer once (dedupe by lastSettleId)", async () => {
    const st = createInProcStack();
    await st.start();
    const team = await st.createTeam();
    await st.spawn(team, "bob");
    st.lane.loseOk = (p) => p.op === "event" && p.kind === "idle";
    st.double.finishRun(st.agentOf(team, "bob"), { result: "answer once" });
    await st.settle();
    expect(st.member(team, "bob").status).toBe("idle"); // the server processed it
    st.lane.loseOk = undefined;
    st.host.onReconnect();
    await st.settle();
    await st.flushNotices();
    expect(st.sent.filter((p) => p.op === "event" && p.kind === "idle").length).toBeGreaterThanOrEqual(2); // delivered at least twice
    expect(st.notices(team).filter((m) => m.text.includes("answer once"))).toHaveLength(1);
  });
});

describe("S39 lifecycle reports survive a server restart", () => {
  it("a child completed while the lane was down and the server restarted: the lead hears the final answer exactly once (snapshot's unacked settle + the outbox entry)", async () => {
    const dataDir = tmp();
    const teamId = await persistTeam(dataDir);
    const env = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    const snapshot = { members: [{ member: "bob", childId: "bg-bob", agentId: "agent-bob", state: "idle", run: 1, lastIdleRun: 1, deliveredMailIds: [], unackedSettle: { run: 1, finalText: "finished during the restart" } }, { member: "eve", childId: "bg-eve", agentId: "agent-eve", state: "idle", run: 1, lastIdleRun: 1, deliveredMailIds: [] }] };
    await link.lane({ op: "hello", incarnation: "inc-1", commandSecret: "s", inProcess: { available: true, apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } }, snapshot });
    await link.lane({ op: "event", member: "bob", run: 1, kind: "idle", finalText: "finished during the restart" }); // the outbox entry of the same (member, run)
    await env.settle();
    env.clock.advance(2000);
    const log = env.rt.store.mailLog(teamId).filter((m) => m.to === "lead" && m.kind === "notice");
    expect(log.filter((m) => m.text.includes("finished during the restart"))).toHaveLength(1);
    expect(env.rt.store.member(env.rt.store.get(teamId) as Team, "bob")).toMatchObject({ status: "idle", lastSettleId: 1 });
  });
});

describe("S88 server restart keeps children", () => {
  const HELLO = { op: "hello", incarnation: "inc-1", commandSecret: "s", inProcess: { available: true, apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } } };
  const child = (member: string, state: "busy" | "idle" | "spawning", over: Record<string, unknown> = {}) => ({ member, childId: `bg-${member}`, agentId: `agent-${member}`, state, run: 1, lastIdleRun: state === "idle" ? 1 : 0, deliveredMailIds: [], ...over });

  /** An open in-process team (bob busy with a task, eve idle, sue spawning, no child yet) persisted; then the server "restarts" over the same dataDir. */
  async function restarted() {
    const dataDir = tmp();
    const env0 = createTeamsEnv({ dataDir, runtime: { inProcess: true } });
    const link0 = linkInProcBridge(env0);
    await link0.hello({ available: true });
    const teamId = (await env0.fake.call(env0.lead, "TeamCreate", { name: "t", mode: "in-process" })).data.teamId as string;
    env0.rt.store.reserveMember(teamId, memberFixture("bob", { status: "busy", childId: "bg-bob", childAgentId: "agent-bob", proxyToken: "b".repeat(64) }) as Member);
    env0.rt.store.reserveMember(teamId, memberFixture("eve", { status: "idle", childId: "bg-eve", childAgentId: "agent-eve", proxyToken: "e".repeat(64) }) as Member);
    env0.rt.store.reserveMember(teamId, memberFixture("sue", { status: "spawning", proxyToken: "s".repeat(64) }) as Member);
    const task = env0.rt.store.addTask(teamId, { title: "bob's job", description: "d", createdBy: "lead" });
    env0.rt.store.patchTask(teamId, task?.id as string, { status: "in_progress", owner: "bob" });
    env0.rt.persistence.flushSync();
    const env = createTeamsEnv({ dataDir, config: { autoDispatch: false }, runtime: { inProcess: true } }); // a released task must not be re-dispatched to the idle member
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => ({ ack: { cmdId: cmd.cmdId, ok: true, result: "started" } }));
    const team = () => env.rt.store.get(teamId) as Team;
    return { env, link, team, teamId, taskId: task?.id as string };
  }

  it.each([1_000, 90_000, 10 * 60_000, 3 * 3_600_000])("members stay disconnected however long the lead takes to return (%i ms): never gone, no 'did not reconnect' notice", async (delay) => {
    const { env, team, teamId } = await restarted();
    await env.clock.advanceAsync(delay);
    expect(team().members.filter((m) => m.name !== "sue").map((m) => m.status)).toEqual(["disconnected", "disconnected"]);
    expect(team().status).toBe("active");
    expect(env.rt.store.mailLog(teamId).filter((m) => m.kind === "notice" && /did not reconnect/.test(m.text))).toHaveLength(0);
  });

  it("the lead returns (same incarnation) with a snapshot: present members are re-bound by state, queued mail is flushed once, absent ones end", async () => {
    const { env, link, team, teamId, taskId } = await restarted();
    await env.fake.call(env.lead, "SendMessage", { to: "eve", message: "queued while disconnected" });
    expect(link.commands).toHaveLength(0);
    await link.lane({ ...HELLO, snapshot: { members: [child("bob", "busy"), child("eve", "idle")] } });
    await env.settle();
    expect(team().members.find((m) => m.name === "bob")?.status).toBe("busy");
    expect(team().members.find((m) => m.name === "eve")?.status).toBe("busy"); // the flushed waking mail made it provisionally busy
    const steers = link.commands.filter((c) => c.cmd === "steer") as unknown as Array<{ member: string; blocks: string[] }>;
    expect(steers.filter((c) => c.member === "eve")).toHaveLength(1);
    expect(steers[0]?.blocks.join("\n")).toContain("queued while disconnected");
    expect(team().tasks.find((x) => x.id === taskId)?.status).toBe("in_progress"); // bob is alive: its task stays
    expect(env.rt.store.mailLog(teamId).filter((m) => m.kind === "notice" && /not_alive/.test(m.text))).toHaveLength(0);
  });

  it("a busy member missing from the snapshot: gone not_alive, its task released, the lead woken; a spawning one with no pending command: failed", async () => {
    const { env, link, team, teamId, taskId } = await restarted();
    await link.lane({ ...HELLO, snapshot: { members: [child("eve", "idle")] } });
    await env.settle();
    env.clock.advance(2000);
    expect(team().members.find((m) => m.name === "bob")).toMatchObject({ status: "gone", goneReason: "not_alive" });
    expect(team().members.find((m) => m.name === "sue")?.status).toBe("failed");
    expect(team().members.find((m) => m.name === "eve")?.status).toBe("idle");
    expect(team().tasks.find((x) => x.id === taskId)).toMatchObject({ status: "pending" });
    const notices = env.rt.store.mailLog(teamId).filter((m) => m.to === "lead" && m.kind === "notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ wake: true });
  });

  it("a spawning member whose spawn command is still queued/in flight is NOT failed by a snapshot that lacks it", async () => {
    const { env, link, team } = await restarted();
    link.setOnCommand(() => undefined); // never acked
    env.fake.base.sessions.delete(env.lead);
    await env.fake.call(env.lead, "TeammateSpawn", { name: "zed", prompt: "p" });
    env.fake.addSession(env.lead);
    await link.lane({ ...HELLO, snapshot: { members: [child("bob", "busy"), child("eve", "idle")] } });
    await env.settle();
    expect(team().members.find((m) => m.name === "zed")?.status).toBe("spawning");
  });

  it("a lead that never returns ends through onSessionEnded: the team closes lead_ended (no 30-minute orphan window)", async () => {
    const { env, team } = await restarted();
    env.fake.endSession(env.lead);
    expect(team()).toMatchObject({ status: "closed", closeReason: "lead_ended" });
    expect(team().members.every((m) => m.status === "gone" || m.status === "failed")).toBe(true);
  });
});

describe("S40 outbox head-of-line", () => {
  it("an application-error report is retried 3 times, dead-lettered (+1, ids only) and the 4 behind it are still delivered in order", async () => {
    const attempts: Record<string, number> = {};
    const delivered: string[] = [];
    const env = createHostEnv({ double: { maxConcurrent: 10 } });
    await env.start();
    // Hold the lane until all five children exist, so five reports queue behind the first.
    env.setSend((p) => (p.op === "event" ? { ok: false, transport: true } : { ok: true }));
    for (const m of ["m1", "m2", "m3", "m4", "m5"]) await env.spawn(m);
    expect(env.host.outbox.size).toBe(5);
    env.setSend((p) => {
      if (p.op !== "event") return { ok: true };
      attempts[p.member as string] = (attempts[p.member as string] ?? 0) + 1;
      if (p.member === "m1") return { ok: false, transport: false, error: "unknown_member" };
      delivered.push(p.member as string);
      return { ok: true };
    });
    env.host.onReconnect();
    await env.settle();
    expect(attempts.m1).toBe(3);
    expect(delivered).toEqual(["m2", "m3", "m4", "m5"]);
    expect(env.host.counters().inproc_dead_letter).toBe(1);
    expect(env.logs.filter((l) => l.includes("dead-lettered")).join("\n")).toMatch(/member=m1 run=1 kind=started error=unknown_member/);
    expect(env.host.outbox.size).toBe(0);
  });
});

describe("S118 lifecycle outbox bounds", () => {
  const report = (i: number, over: Partial<InProcEvent> = {}): InProcEvent => ({ op: "event", member: `m${i}`, run: 1, kind: "started", ...over });
  const stalled = (): ReportResult => ({ ok: false, transport: true });
  const bounded = (maxEntries?: number, maxBytes?: number) => {
    const overflow: InProcEvent[] = [];
    const outbox = createOutbox({ send: async () => stalled(), onOverflow: (r) => void overflow.push(r), onDeadLetter: () => undefined, ...(maxEntries ? { maxEntries } : {}), ...(maxBytes ? { maxBytes } : {}) });
    return { outbox, overflow };
  };

  it.each([
    [999, 0],
    [1000, 0],
    [1001, 1],
  ])("%i queued reports: %i evicted; order preserved", (n, evicted) => {
    const { outbox, overflow } = bounded();
    for (let i = 0; i < n; i++) outbox.push(report(i));
    expect(OUTBOX_MAX_ENTRIES).toBe(1000);
    expect(outbox.size).toBe(Math.min(n, 1000));
    expect(overflow).toHaveLength(evicted);
    const members = outbox.entries().map((e) => e.member);
    expect(members).toEqual(Array.from({ length: Math.min(n, 1000) }, (_, i) => `m${i + evicted}`)); // oldest dropped, the rest in order
  });

  it("byte bound: 8 MiB fits, one byte over evicts", () => {
    const member = "m0";
    const sizeFor = (bytes: number): number => bytes - (120 + member.length);
    const one = (finalText: number, i: number): InProcEvent => ({ op: "event", member: `m${i}`.padEnd(2, "0"), run: 1, kind: "idle", finalText: "x".repeat(finalText) });
    const half = OUTBOX_MAX_BYTES / 2;
    const { outbox, overflow } = bounded();
    outbox.push(one(sizeFor(half), 0));
    outbox.push(one(sizeFor(half) - 1, 1)); // total = 8 MiB − 1
    expect(overflow).toHaveLength(0);
    const exact = bounded();
    exact.outbox.push(one(sizeFor(half), 0));
    exact.outbox.push(one(sizeFor(half), 1)); // total = 8 MiB exactly
    expect(exact.overflow).toHaveLength(0);
    const over = bounded();
    over.outbox.push(one(sizeFor(half), 0));
    over.outbox.push(one(sizeFor(half) + 1, 1)); // 8 MiB + 1
    expect(over.overflow).toHaveLength(1);
  });

  it("over the cap the oldest NON-settle report goes first; an idle with finalText only when nothing else is left", () => {
    const { outbox, overflow } = bounded(4);
    outbox.push(report(0, { kind: "idle", finalText: "answer 0" }));
    outbox.push(report(1)); // started
    outbox.push(report(2, { kind: "idle", finalText: "answer 2" }));
    outbox.push(report(3, { kind: "state", state: "busy" }));
    outbox.push(report(4, { kind: "idle", finalText: "answer 4" })); // over: the oldest non-settle (m1 started) goes
    expect(overflow.map((r) => r.member)).toEqual(["m1"]);
    outbox.push(report(5, { kind: "idle", finalText: "answer 5" })); // next: m3 state
    expect(overflow.map((r) => r.member)).toEqual(["m1", "m3"]);
    outbox.push(report(6, { kind: "idle", finalText: "answer 6" })); // only settles left: the oldest settle goes
    expect(overflow.map((r) => r.member)).toEqual(["m1", "m3", "m0"]);
    expect(outbox.entries().every((e) => e.kind === "idle")).toBe(true);
  });

  it("the host counts evictions as inproc_outbox_overflow", async () => {
    const counts: string[] = [];
    const host = createInProcHost({ bus: { on: () => undefined, emit: () => undefined }, clock: { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined }, send: async () => ({ ok: false, transport: true }), log: (m) => void counts.push(m) });
    for (let i = 0; i < OUTBOX_MAX_ENTRIES + 1; i++) host.outbox.push(report(i));
    await settle();
    expect(host.counters().inproc_outbox_overflow).toBe(1);
    expect(host.outbox.size).toBe(OUTBOX_MAX_ENTRIES);
  });
});
