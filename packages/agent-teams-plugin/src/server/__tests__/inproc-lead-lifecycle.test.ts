/**
 * Lead lifecycle and team close of in-process teams (test-plan S83–S87, S89–S91, S120): children die with the lead, so a reload closes the
 * team `lead_reloaded` and a lead end closes it `lead_ended` (no orphan window), each leaving one closed team and one notice whatever the
 * arrival order; `pendingStops` retention; closing a team stops its children (grace + command timeout, leftovers `not_alive`); an approved
 * shutdown waits for the final run; two teams on one server stay apart; a team closed mid-spawn leaves no orphan; a burst of lifecycle
 * events wakes the lead once. Real server runtime ↔ real lead host over the contract double (`inproc-stack.ts`) or a scripted bridge
 * (`inproc-link.ts`) where a row needs a command the host would never answer.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { createInProcStack, type InProcStack } from "../../__tests__/harness/inproc-stack.js";
import { memberFixture } from "../../__tests__/harness/store-env.js";
import { validCapabilities } from "../../__tests__/harness/subagents-double.js";
import { createTeamsEnv } from "../../__tests__/harness/teams-env.js";
import { LANE_INPROC } from "../../shared/inproc-protocol.js";
import type { Member, Team } from "../../shared/types.js";
import { PENDING_STOP_TTL_MS } from "../inproc-lead.js";

const HOUR = 3_600_000;
const slots = (n: number) => ({ maxConcurrent: n, answer: validCapabilities({ limits: { maxConcurrent: n, maxBackgroundPending: 4, maxIdleBackground: 4, cwdScope: "repo" } }) });

async function team(st: InProcStack, names: string[]): Promise<Team> {
  await st.start();
  const t = await st.createTeam();
  for (const n of names) await st.spawn(t, n);
  return t;
}
const stored = (st: InProcStack, t: Team): Team => st.store.get(t.id) as Team;
const stops = (st: InProcStack): Array<Record<string, unknown>> => st.env.fake.base.emits.filter((e) => e.eventType === "agent-teams:inproc" && (e.data as { cmd?: string }).cmd === "stop").map((e) => e.data as Record<string, unknown>);

async function claim(st: InProcStack, t: Team, member: string, title: string): Promise<string> {
  const created = await st.env.fake.call(st.env.lead, "TaskCreate", { title, description: `${title} d`, owner: member });
  const id = created.data.task.id as string;
  const claimed = await st.callAs(t, member, "TaskUpdate", { id, status: "in_progress" });
  if (!claimed.ok) throw new Error(`claim failed: ${claimed.error}`);
  return id;
}

describe("S83 lead reload closes the team", () => {
  it.each([0, 1, 5])("a team with %i member(s) in mixed states: all gone lead_reloaded, in_progress tasks pending, ONE waking notice, team closed lead_reloaded; the hello replayed twice changes nothing", async (n) => {
    const st = createInProcStack({ double: slots(2) });
    const names = ["a", "b", "c", "d", "e"].slice(0, n);
    const t = await team(st, names);
    const taskIds: string[] = [];
    if (n >= 1) taskIds.push(await claim(st, t, "a", "job-a")); // a: busy with an in_progress task
    if (n >= 2) {
      st.double.finishRun(st.agentOf(t, "b"), { result: "b done" }); // b: idle
      await st.settle();
    }
    // c, d, e wait for a slot (spawning with a queue position)
    await st.flushNotices();
    const before = st.notices(t).length;
    const reload = { incarnation: "inc-reloaded", commandSecret: "s2" };
    await st.hello(reload);
    await st.hello(reload);
    await st.hello(reload);
    await st.flushNotices();
    const closed = stored(st, t);
    expect(closed.status).toBe("closed");
    expect(closed.closeReason).toBe("lead_reloaded");
    expect(closed.members.every((m) => m.status === "gone" && m.goneReason === "lead_reloaded")).toBe(true);
    for (const id of taskIds) expect(closed.tasks.find((x) => x.id === id)).toMatchObject({ status: "pending" });
    const fresh = st.notices(t).slice(before);
    expect(fresh).toHaveLength(n === 0 ? 0 : 1); // exactly one waking notice, whatever the replays
    if (n > 0) {
      expect(fresh[0]?.wake).toBe(true);
      expect(fresh[0]?.text).toContain("lead_reloaded");
    }
    expect(st.env.rt.store.get(t.id)?.status).toBe("closed"); // no orphan window: never `orphaned`
  });

  it("the queued commands of the old activation are dropped (its children are gone): a pending spawn fails, nothing is emitted to the new activation", async () => {
    const st = createInProcStack();
    await st.start();
    const t = await st.createTeam();
    st.env.fake.base.sessions.delete(st.env.lead); // the lead is away: commands queue
    const spawning = st.env.fake.call(st.env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    await spawning;
    await st.settle();
    expect(st.env.rt.inProcess?.driver.queueSize()).toBe(1);
    st.env.fake.addSession(st.env.lead);
    const before = st.env.fake.base.emits.filter((e) => e.eventType === "agent-teams:inproc").length;
    await st.hello({ incarnation: "inc-new", commandSecret: "s2" });
    await st.settle();
    expect(st.env.rt.inProcess?.driver.queueSize()).toBe(0);
    expect(st.env.fake.base.emits.filter((e) => e.eventType === "agent-teams:inproc").length).toBe(before); // the old spawn never reached the new activation
    expect(stored(st, t).status).toBe("closed");
    expect(stored(st, t).members.every((m) => m.status === "gone" || m.status === "failed")).toBe(true);
  });
});

describe("S84 /new, /fork, /resume of the lead", () => {
  const notice = (st: InProcStack, t: Team) => st.notices(t).filter((m) => m.text.includes("lead_"));
  async function world(): Promise<{ st: InProcStack; t: Team }> {
    const st = createInProcStack();
    const t = await team(st, ["bob"]);
    await claim(st, t, "bob", "job");
    return { st, t };
  }

  it("/new or /fork (a NEW session id): the old session's end closes the team lead_ended, in either order against the new session's hello", async () => {
    for (const endFirst of [true, false]) {
      const { st, t } = await world();
      st.env.fake.addSession("S-new");
      const hello = () => st.hello({ from: "S-new", incarnation: "inc-new", commandSecret: "s2" });
      if (endFirst) {
        st.env.fake.endSession(st.env.lead);
        await hello();
      } else {
        await hello();
        st.env.fake.endSession(st.env.lead);
      }
      await st.flushNotices();
      expect(stored(st, t)).toMatchObject({ status: "closed", closeReason: "lead_ended" });
      expect(stored(st, t).members[0]).toMatchObject({ status: "gone", goneReason: "lead_ended" });
      expect(stored(st, t).tasks[0]).toMatchObject({ status: "pending" });
      expect(notice(st, t)).toHaveLength(1);
      expect(st.env.rt.store.list().filter((x) => x.status === "closed")).toHaveLength(1); // no reopen, no second team
    }
  });

  it("/reload or /resume (the SAME id, a new incarnation): closed lead_reloaded through the incarnation change; a late end of the old process changes nothing", async () => {
    for (const endFirst of [true, false]) {
      const { st, t } = await world();
      const hello = () => st.hello({ incarnation: "inc-new", commandSecret: "s2" });
      if (endFirst) {
        st.env.fake.endSession(st.env.lead);
        st.env.fake.addSession(st.env.lead);
        await hello();
      } else {
        await hello();
        st.env.fake.endSession(st.env.lead);
      }
      await st.flushNotices();
      const closed = stored(st, t);
      expect(closed.status).toBe("closed");
      expect(closed.closeReason).toBe(endFirst ? "lead_ended" : "lead_reloaded");
      expect(closed.members[0]?.status).toBe("gone");
      expect(notice(st, t)).toHaveLength(1);
    }
  });
});

describe("S85 heartbeat lapse then reconnect, and S120 pendingStops retention", () => {
  async function lapsed() {
    const st = createInProcStack();
    const t = await team(st, ["bob", "eve"]);
    st.env.fake.endSession(st.env.lead); // the heartbeat lapse: the host reports an end
    await st.settle();
    expect(stored(st, t)).toMatchObject({ status: "closed", closeReason: "lead_ended" });
    return { st, t };
  }
  const entries = (st: InProcStack, t: Team) => stored(st, t).pendingStops ?? [];

  it("a pendingStops entry is recorded per live child (member, ids, incarnation, time)", async () => {
    const { st, t } = await lapsed();
    expect(entries(st, t).map((e) => e.member).sort()).toEqual(["bob", "eve"]);
    expect(entries(st, t).every((e) => e.incarnation === "inc-stack-1" && e.at !== undefined && e.childId.startsWith("bg-"))).toBe(true);
  });

  it("(a) the SAME incarnation reconnects: one best-effort stop per child, delivered once; the children end, no child runs without a member", async () => {
    const { st, t } = await lapsed();
    st.env.fake.addSession(st.env.lead);
    st.host.onReconnect();
    await st.settle();
    expect(stops(st).map((c) => c.member).sort()).toEqual(["bob", "eve"]);
    expect([...st.double.children.values()].every((c) => c.state !== "running")).toBe(true);
    expect(entries(st, t)).toHaveLength(0);
    st.host.onReconnect(); // a second hello re-sends nothing
    await st.settle();
    expect(stops(st)).toHaveLength(2);
  });

  it("(b) a DIFFERENT incarnation (the lead process restarted): the entries are discarded and logged, no stop is sent", async () => {
    const { st, t } = await lapsed();
    st.env.fake.addSession(st.env.lead);
    await st.hello({ incarnation: "inc-other", commandSecret: "s2" });
    await st.settle();
    expect(stops(st)).toHaveLength(0);
    expect(entries(st, t)).toHaveLength(0);
    expect(st.env.fake.logs.info.join("\n")).toMatch(/pending stop of child .* discarded/);
  });

  it("(c) the lead never returns: the entries stay until they expire", async () => {
    const { st, t } = await lapsed();
    await st.clock.advanceAsync(HOUR);
    expect(entries(st, t)).toHaveLength(2);
    st.env.rt.inProcess?.lead.expireStops();
    expect(entries(st, t)).toHaveLength(2);
  });

  it.each([
    [PENDING_STOP_TTL_MS - 60_000, 2], // 23 h 59 min: still delivered
    [PENDING_STOP_TTL_MS + 60_000, 0], // 24 h 01 min: expired
  ])("retention BVA: the same incarnation reconnects after %i ms: %i stop(s) sent", async (elapsed, sent) => {
    const { st } = await lapsed();
    st.clock.advance(elapsed);
    st.env.fake.addSession(st.env.lead);
    st.host.onReconnect();
    await st.settle();
    expect(stops(st)).toHaveLength(sent);
  });

  it("expireStops drops entries at 24 h; the list never exceeds the number of members the team ever had", async () => {
    const { st, t } = await lapsed();
    const lead = st.env.rt.inProcess?.lead;
    for (const i of [1, 2, 3, 4]) lead?.recordStop(t.id, { member: `m${i}`, childId: `bg-x${i}`, agentId: `agent-x${i}` });
    expect(entries(st, t)).toHaveLength(2); // two members ever (bob, eve)
    st.clock.advance(PENDING_STOP_TTL_MS + 1);
    lead?.expireStops();
    expect(entries(st, t)).toHaveLength(0);
  });
});

describe("S86 closing the team stops its children", () => {
  const G = 5_000;
  const T = 10_000;
  const cfg = { shutdownGraceMs: G, inProcessCmdTimeoutMs: T };

  /** A team with scripted-bridge children (`n` of them, each owning an in_progress task) over the real runtime. */
  async function linked(n: number, onStop: "confirm" | "silent" | { afterMs: number }) {
    const env = createTeamsEnv({ config: cfg, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => {
      if (cmd.cmd !== "stop") return { ack: { cmdId: cmd.cmdId, ok: true, result: "started" } }; // the shutdown notices are steered and acked
      if (onStop === "silent") return undefined;
      return { ack: { cmdId: cmd.cmdId, ok: true }, ...(typeof onStop === "object" ? { afterMs: onStop.afterMs } : {}) };
    });
    await link.hello({ available: true });
    const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    const teamId = created.data.teamId as string;
    for (let i = 1; i <= n; i++) {
      const name = `m${i}`;
      env.rt.store.reserveMember(teamId, memberFixture(name, { status: "busy", childId: `bg-${name}`, childAgentId: `agent-${name}`, proxyToken: name.padEnd(64, "0") }) as Member);
      const task = env.rt.store.addTask(teamId, { title: `job ${name}`, description: "d", createdBy: "lead" });
      env.rt.store.patchTask(teamId, task?.id as string, { status: "in_progress", owner: name });
    }
    return { env, link, teamId };
  }
  const team$ = (env: ReturnType<typeof createTeamsEnv>, id: string): Team => env.rt.store.get(id) as Team;

  it("force with two children: a stop per child after the grace; confirmed (and their gone reports) → tasks pending, team closed clean", async () => {
    const { env, link, teamId } = await linked(2, "confirm");
    link.setOnCommand((cmd) => {
      if (cmd.cmd !== "stop") return { ack: { cmdId: cmd.cmdId, ok: true, result: "started" } };
      void link.lane({ op: "event", member: cmd.member, run: 1, kind: "gone", reason: "stopped" }); // the host reports the child gone, then acks
      return { ack: { cmdId: cmd.cmdId, ok: true } };
    });
    const res = await env.fake.call(env.lead, "TeamDelete", { force: true });
    expect(res.ok).toBe(true);
    expect(link.commands.filter((c) => c.cmd === "stop")).toHaveLength(0); // the grace first: the members are asked to shut down
    await env.clock.advanceAsync(G);
    await env.settle();
    expect(link.commands.filter((c) => c.cmd === "stop").map((c) => (c as { member: string }).member).sort()).toEqual(["m1", "m2"]);
    const t = team$(env, teamId);
    expect(t).toMatchObject({ status: "closed", closeReason: "team_delete" });
    expect(t.tasks.every((x) => x.status === "pending")).toBe(true);
    expect(t.pendingStops ?? []).toHaveLength(0);
  });

  it.each([
    ["one of two confirms at G+T−1: that one is clean", { afterMs: T - 1 }],
  ])("%s", async (_name, onStop) => {
    const { env, teamId } = await linked(1, onStop);
    await env.fake.call(env.lead, "TeamDelete", { force: true });
    await env.clock.advanceAsync(G + T - 2);
    expect(team$(env, teamId).status).toBe("closing");
    await env.clock.advanceAsync(1); // G + T − 1: the confirmation arrives
    await env.settle();
    expect(team$(env, teamId).status).toBe("closed");
    expect(team$(env, teamId).members[0]?.goneReason).not.toBe("not_alive");
    expect(team$(env, teamId).pendingStops ?? []).toHaveLength(0);
  });

  it("none confirms: the team still closes at G+T, the leftovers are gone: not_alive with a pendingStops entry each, tasks released", async () => {
    const { env, link, teamId } = await linked(2, "silent");
    await env.fake.call(env.lead, "TeamDelete", { force: true });
    await env.clock.advanceAsync(G + T - 1);
    expect(team$(env, teamId).status).toBe("closing");
    await env.clock.advanceAsync(1); // G + T
    await env.settle();
    const t = team$(env, teamId);
    expect(t.status).toBe("closed");
    expect(t.members.map((m) => m.goneReason)).toEqual(["not_alive", "not_alive"]);
    expect(t.tasks.every((x) => x.status === "pending")).toBe(true);
    expect(t.pendingStops?.map((s) => s.member).sort()).toEqual(["m1", "m2"]);
    expect(link.commands.filter((c) => c.cmd === "stop")).toHaveLength(2);
  });

  it("a late ack (G+T+1) of the stop is too late: already closed with not_alive", async () => {
    const { env, teamId } = await linked(1, { afterMs: T + 1 });
    await env.fake.call(env.lead, "TeamDelete", { force: true });
    await env.clock.advanceAsync(G + T + 1);
    await env.settle();
    expect(team$(env, teamId)).toMatchObject({ status: "closed" });
    expect(team$(env, teamId).members[0]?.goneReason).toBe("not_alive");
  });

  it("no children: the team closes at once; without force a live child refuses (members_active) and nothing is stopped", async () => {
    const empty = await linked(0, "confirm");
    expect((await empty.env.fake.call(empty.env.lead, "TeamDelete", {})).ok).toBe(true);
    expect(team$(empty.env, empty.teamId).status).toBe("closed");
    const one = await linked(1, "confirm");
    expect(await one.env.fake.call(one.env.lead, "TeamDelete", {})).toMatchObject({ ok: false, error: "members_active" });
    expect(one.link.commands.filter((c) => c.cmd === "stop")).toHaveLength(0);
  });

  it("through the real host: TeamDelete {force} ends both children (stop → confirming event → gone) and releases their tasks", async () => {
    const st = createInProcStack({ config: cfg });
    const t = await team(st, ["bob", "eve"]);
    const a = await claim(st, t, "bob", "job-b");
    const b = await claim(st, t, "eve", "job-e");
    expect((await st.env.fake.call(st.env.lead, "TeamDelete", { force: true })).ok).toBe(true);
    await st.clock.advanceAsync(G);
    await st.settle();
    expect(stored(st, t).status).toBe("closed");
    expect(stored(st, t).tasks.filter((x) => [a, b].includes(x.id)).every((x) => x.status === "pending")).toBe(true);
    expect([...st.double.children.values()].every((c) => c.state !== "running" && c.state !== "idle")).toBe(true);
  });
});

describe("S87 approved shutdown waits for the final run", () => {
  const G = 5_000;
  async function approving() {
    const st = createInProcStack({ config: { shutdownGraceMs: G, inProcessCmdTimeoutMs: 10_000 } });
    const t = await team(st, ["bob"]);
    expect((await st.env.fake.call(st.env.lead, "ShutdownRequest", { to: "bob", reason: "done" })).ok).toBe(true);
    expect((await st.callAs(t, "bob", "ShutdownResponse", { approve: true })).ok).toBe(true);
    await st.settle();
    return { st, t };
  }

  it("mid-run approval: no stop until the final run settles; then stop → confirming event → gone", async () => {
    const { st, t } = await approving();
    expect(stops(st)).toHaveLength(0);
    st.double.finishRun(st.agentOf(t, "bob"), { result: "final words" });
    await st.settle();
    expect(stops(st)).toHaveLength(1);
    expect(stored(st, t).members[0]).toMatchObject({ status: "gone" });
  });

  it("a run that never settles: no watchdog; the stop is sent once shutdownGraceMs elapses and confirmed within inProcessCmdTimeoutMs", async () => {
    const { st, t } = await approving();
    await st.clock.advanceAsync(G - 1);
    expect(stops(st)).toHaveLength(0);
    await st.clock.advanceAsync(1);
    await st.settle();
    expect(stops(st)).toHaveLength(1);
    expect(stored(st, t).members[0]?.status).toBe("gone");
  });
});

describe("S89 two in-process teams on one server", () => {
  it("each lead's commands, acks and mail stay on its own team; a token of A on B's call is forbidden", async () => {
    const env = createTeamsEnv({ runtime: { inProcess: true } });
    const leadB = env.fake.addSession("S-lead-b", { cwd: "/work-b", principalOwner: "owner-b" });
    const a = linkInProcBridge(env, { secret: "sa", incarnation: "inc-a" });
    const b = linkInProcBridge(env, { lead: leadB, secret: "sb", incarnation: "inc-b" });
    for (const [link, id] of [[a, "A"], [b, "B"]] as const) {
      link.setOnCommand((cmd) => (cmd.cmd === "spawn" ? { ack: { cmdId: cmd.cmdId, ok: true, childId: `bg-${id}`, agentId: `agent-${id}`, status: "running" } } : { ack: { cmdId: cmd.cmdId, ok: true, result: "started" } }));
    }
    await a.hello({ available: true });
    await b.hello({ available: true });
    const ta = (await env.fake.call(env.lead, "TeamCreate", { name: "ta", mode: "in-process" })).data.teamId as string;
    const tb = (await env.fake.call(leadB, "TeamCreate", { name: "tb", mode: "in-process" })).data.teamId as string;
    await env.fake.call(env.lead, "TeammateSpawn", { name: "bob", prompt: "pa" });
    await env.fake.call(leadB, "TeammateSpawn", { name: "bob", prompt: "pb" });
    await env.settle();
    expect(a.commands.map((c) => (c as { teamId?: string }).teamId).filter(Boolean)).toEqual([ta]);
    expect(b.commands.map((c) => (c as { teamId?: string }).teamId).filter(Boolean)).toEqual([tb]);
    expect((a.commands[0] as { secret: string }).secret).toBe("sa");
    expect((b.commands[0] as { secret: string }).secret).toBe("sb");
    const tokenA = (env.rt.store.get(ta) as Team).members[0]?.proxyToken as string;
    const tokenB = (env.rt.store.get(tb) as Team).members[0]?.proxyToken as string;
    expect(tokenA).not.toBe(tokenB);
    const cross = await env.fake.lane(leadB, "agent-teams/call", { op: "TaskList", args: {}, as: { member: "bob", token: tokenA } });
    expect(cross).toMatchObject({ ok: false, error: "forbidden" });
    const own = await env.fake.lane(leadB, "agent-teams/call", { op: "TaskList", args: {}, as: { member: "bob", token: tokenB } });
    expect(own.ok).toBe(true);
    // an event of lead A's host for "bob" never touches B's bob
    await a.lane({ op: "event", member: "bob", run: 1, kind: "gone", reason: "stopped" });
    expect((env.rt.store.get(ta) as Team).members[0]?.status).toBe("gone");
    expect((env.rt.store.get(tb) as Team).members[0]?.status).not.toBe("gone");
    expect(LANE_INPROC).toBe("agent-teams/inproc");
  });
});

describe("S90 team closed while a spawn is in flight", () => {
  it("TeamDelete between the spawn command and its ack: the late child is stopped (no orphan), no member is resurrected, the team ends closed with one notice", async () => {
    const env = createTeamsEnv({ config: { shutdownGraceMs: 1000, inProcessCmdTimeoutMs: 30_000 }, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => {
      if (cmd.cmd === "spawn") return { ack: { cmdId: cmd.cmdId, ok: true, childId: "bg-late", agentId: "agent-late", status: "running" }, afterMs: 5000 };
      return { ack: { cmdId: cmd.cmdId, ok: true } };
    });
    await link.hello({ available: true });
    const teamId = (await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).data.teamId as string;
    await env.fake.call(env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    expect(link.commands.map((c) => c.cmd)).toEqual(["spawn"]);
    await env.fake.call(env.lead, "TeamDelete", { force: true }); // before the ack
    await env.clock.advanceAsync(6000); // grace elapsed, then the late ack arrives
    await env.settle();
    const t = env.rt.store.get(teamId) as Team;
    expect(t.status).toBe("closed");
    expect(t.members[0]?.status === "gone" || t.members[0]?.status === "failed").toBe(true);
    // The stop queues behind the unacked spawn (one outstanding command per member) and addresses the member: the host resolves its child.
    expect(link.commands.filter((c) => c.cmd === "stop").map((c) => (c as { member: string }).member)).toEqual(["bob"]);
    expect(link.commands[0]?.cmd).toBe("spawn");
    expect(env.rt.store.list().filter((x) => x.status !== "closed")).toHaveLength(0);
  });

  it("an ack that arrives after the team already closed stops the child it names (no orphan)", async () => {
    const env = createTeamsEnv({ config: { shutdownGraceMs: 1000, inProcessCmdTimeoutMs: 1000 }, runtime: { inProcess: true } });
    const link = linkInProcBridge(env);
    link.setOnCommand((cmd) => {
      if (cmd.cmd === "spawn") return { ack: { cmdId: cmd.cmdId, ok: true, childId: "bg-late", agentId: "agent-late", status: "running" }, afterMs: 20_000 };
      return { ack: { cmdId: cmd.cmdId, ok: true } };
    });
    await link.hello({ available: true });
    const teamId = (await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" })).data.teamId as string;
    await env.fake.call(env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.fake.call(env.lead, "TeamDelete", { force: true });
    await env.clock.advanceAsync(10_000); // grace + command timeout: the team closes, the spawn ack is still on its way
    await env.settle();
    expect((env.rt.store.get(teamId) as Team).status).toBe("closed");
    await env.clock.advanceAsync(10_000); // the late ack
    await env.settle();
    expect(link.commands.some((c) => c.cmd === "stop" && (c as { childId?: string }).childId === "bg-late")).toBe(true);
    expect((env.rt.store.get(teamId) as Team).members.every((m) => m.status === "gone" || m.status === "failed")).toBe(true);
  });

  it("through the real host: TeamDelete right behind TeammateSpawn leaves no running child", async () => {
    const st = createInProcStack({ config: { shutdownGraceMs: 1000 } });
    await st.start();
    const t = await st.createTeam();
    await st.env.fake.call(st.env.lead, "TeammateSpawn", { name: "bob", prompt: "p" });
    await st.env.fake.call(st.env.lead, "TeamDelete", { force: true });
    await st.clock.advanceAsync(1000);
    await st.settle();
    await st.clock.advanceAsync(10_000);
    await st.settle();
    expect(stored(st, t).status).toBe("closed");
    expect([...st.double.children.values()].every((c) => c.state !== "running" && c.state !== "idle" && c.state !== "queued")).toBe(true);
  });
});

describe("S91 a burst of lifecycle events wakes the lead once", () => {
  it("3 idle reports within 50 ms: ONE coalesced notice listing all three, at the core coalesce window", async () => {
    const st = createInProcStack();
    const t = await team(st, ["a", "b", "c"]);
    await st.flushNotices();
    const before = st.notices(t).length;
    const window = st.env.rt.ops.coalesceWindowMs(stored(st, t));
    for (const n of ["a", "b", "c"]) st.double.finishRun(st.agentOf(t, n), { result: `${n} answer` });
    await st.settle();
    st.clock.advance(window - 1);
    expect(st.notices(t)).toHaveLength(before); // still buffered
    await st.flushNotices(1);
    const fresh = st.notices(t).slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.wake).toBe(true);
    for (const n of ["a", "b", "c"]) expect(fresh[0]?.text).toContain(`${n} answer`);
  });

  it("3 members stopped from the dock within 50 ms: one notice naming all three (regression: 3 extra lead turns → 1)", async () => {
    const st = createInProcStack();
    const t = await team(st, ["a", "b", "c"]);
    await st.flushNotices();
    const before = st.notices(t).length;
    for (const n of ["a", "b", "c"]) st.double.dispose(st.agentOf(t, n), "cancel");
    await st.settle();
    await st.flushNotices();
    const fresh = st.notices(t).slice(before);
    expect(fresh).toHaveLength(1);
    for (const n of ["a", "b", "c"]) expect(fresh[0]?.text).toContain(`${n} is gone`);
  });

  it("3 members approve a shutdown within 50 ms: one notice once every request is resolved", async () => {
    const st = createInProcStack({ config: { shutdownGraceMs: 5000 } });
    const t = await team(st, ["a", "b", "c"]);
    await st.flushNotices();
    const before = st.notices(t).length;
    for (const n of ["a", "b", "c"]) await st.env.fake.call(st.env.lead, "ShutdownRequest", { to: n });
    for (const n of ["a", "b", "c"]) await st.callAs(t, n, "ShutdownResponse", { approve: true });
    for (const n of ["a", "b", "c"]) st.double.finishRun(st.agentOf(t, n), { result: "bye" });
    await st.settle();
    await st.flushNotices();
    const fresh = st.notices(t).slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.wake).toBe(true);
  });
});
