/**
 * Hook gates through the real request lane + core ops (store, idle path, mail engine) with a fake
 * process boundary on the env's fake clock: re-validation after the gate, contention, supersession,
 * the feedback loop bound and the lane-timeout guarantee.
 * See change: add-agent-teams-templates-hooks (test-plan #R1–#R4, #X10).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import type { Team, TeamHooks } from "../../shared/types.js";
import { IDLE_GATE_OP } from "../extension-points.js";
import { HOOK_DEADLINE_MARGIN_MS } from "../hook-engine.js";
import { setHookIoOverride } from "../hooks.js";
import { advance, FakeProcs, lazyIo } from "./hook-fakes.js";

const DEADLINE = 12_000 - HOOK_DEADLINE_MARGIN_MS;

afterEach(() => setHookIoOverride(undefined));

async function setup(hooks: TeamHooks, config?: Record<string, unknown>) {
  let procs!: FakeProcs;
  setHookIoOverride(lazyIo(() => procs));
  const env = createTeamsEnv(config ? { config } : {});
  procs = new FakeProcs(env.clock);
  const team = await env.createTeam();
  env.rt.store.patchTeam(team.id, { hooks });
  return { env, procs, team };
}

const seedTask = (env: TeamsEnv, team: Team, over: Record<string, unknown> = {}) => {
  const t = env.rt.store.addTask(team.id, { title: "seed", description: "d", createdBy: "lead", ...over });
  if (!t) throw new Error("seed failed");
  return t;
};
const hook = (command: string, timeoutMs?: number) => ({ command, ...(timeoutMs ? { timeoutMs } : {}) });
const feedbackMails = (env: TeamsEnv, team: Team, to: string) => env.mailsTo(team, to).filter((m) => m.kind === "hook_feedback");
const notices = (env: TeamsEnv, team: Team) => env.mailsTo(team, "lead").filter((m) => m.kind === "notice");

describe("registration", () => {
  it("installs the TaskCreate, TaskUpdate and idle gates before the registries seal; hook-less teams pass through", async () => {
    const env = createTeamsEnv();
    for (const op of ["TaskCreate", "TaskUpdate", IDLE_GATE_OP]) expect(env.rt.ext.gatesFor(op).length).toBeGreaterThanOrEqual(1);
    const team = await env.createTeam();
    expect(await env.call("lead", "TaskCreate", { title: "plain", description: "d" })).toMatchObject({ ok: true });
    expect(team.tasks).toHaveLength(1);
  });
});

describe("gate contention on one task (12.18, #R1)", () => {
  it("two same-tick completions: one runs the hook and commits, the other fails hook_blocked + hook_pending; dependants unblock once", async () => {
    const { env, procs, team } = await setup({ TaskCompleted: [hook("check")] });
    env.addMember(team, "alice", "busy");
    seedTask(env, team, { owner: "alice" });
    env.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    seedTask(env, team, { title: "dependant", blockedBy: ["1"] });
    procs.exitAfter(1000, 0);
    const args = { id: "1", status: "completed", result: "done" };
    const a = env.call("alice", "TaskUpdate", args);
    const b = env.call("lead", "TaskUpdate", args);
    await advance(env.clock, 1000);
    const [ra, rb] = await Promise.all([a, b]);
    const ok = [ra, rb].filter((r) => r.ok);
    const failed = [ra, rb].filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ ok: false, error: "hook_blocked" });
    expect((failed[0] as { message: string }).message).toContain("hook_pending");
    expect(procs.spawns).toHaveLength(1);
    expect((ok[0] as { data: { unblocked: string[] } }).data.unblocked).toEqual(["2"]);
    expect(team.tasks.find((t) => t.id === "1")?.status).toBe("completed");
  });
});

describe("state changes during the hook (12.19, #R2)", () => {
  it("the team reaches maxTasks while a TaskCreated hook (allow) runs → task_cap_reached, nothing persisted", async () => {
    const { env, procs, team } = await setup({ TaskCreated: [hook("check")] }, { maxTasks: 2 });
    procs.exitAfter(500, 0);
    const create = env.call("lead", "TaskCreate", { title: "late", description: "d" });
    await advance(env.clock, 100);
    seedTask(env, team);
    seedTask(env, team);
    await advance(env.clock, 500);
    expect(await create).toMatchObject({ ok: false, error: "task_cap_reached" });
    expect(team.tasks.map((t) => t.title)).toEqual(["seed", "seed"]);
  });

  it("the team is closed during the hook → the call fails, no task is created", async () => {
    const { env, procs, team } = await setup({ TaskCreated: [hook("check")] });
    procs.exitAfter(500, 0);
    const create = env.call("lead", "TaskCreate", { title: "late", description: "d" });
    await advance(env.clock, 100);
    env.rt.store.setTeamStatus(team.id, "closed", { closeReason: "user" });
    await advance(env.clock, 500);
    expect((await create).ok).toBe(false);
    expect(team.tasks).toHaveLength(0);
  });

  it("the task changes owner during the completion hook → ownership error, the task stays in_progress", async () => {
    const { env, procs, team } = await setup({ TaskCompleted: [hook("check")] });
    env.addMember(team, "alice", "busy");
    env.addMember(team, "bob", "busy");
    seedTask(env, team, { owner: "alice" });
    env.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    procs.exitAfter(500, 0);
    const done = env.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "x" });
    await advance(env.clock, 100);
    env.rt.store.patchTask(team.id, "1", { owner: "bob" });
    await advance(env.clock, 500);
    expect(await done).toMatchObject({ ok: false, error: "not_owner" });
    expect(team.tasks[0]?.status).toBe("in_progress");
  });
});

describe("lane timeout vs gate: no phantom commit (12.20, #R3)", () => {
  it("a hook that uses the whole budget answers by the deadline (< 15 s lane timeout) with a committed task", async () => {
    const { env, procs, team } = await setup({ TaskCreated: [hook("slow", 60_000)] });
    procs.onSpawn = () => {}; // never exits: killed at the deadline
    const t0 = env.clock.now();
    let answeredAt = -1;
    const create = env.call("lead", "TaskCreate", { title: "same", description: "d" }).then((r) => {
      answeredAt = env.clock.now() - t0;
      return r;
    });
    await advance(env.clock, DEADLINE);
    expect(await create).toMatchObject({ ok: true });
    expect(answeredAt).toBeLessThanOrEqual(12_000);
    expect(answeredAt).toBeLessThan(15_000);
    expect(team.tasks.filter((t) => t.title === "same")).toHaveLength(1);
  });

  it("an error answer leaves no task before the retry; the retry creates exactly one", async () => {
    const { env, procs, team } = await setup({ TaskCreated: [hook("slow", 60_000)] });
    procs.script((i) => (i === 0 ? { code: 2, stderr: "title must start with a ticket id", afterMs: DEADLINE - 100 } : { code: 0 }));
    const first = env.call("lead", "TaskCreate", { title: "same", description: "d" });
    await advance(env.clock, DEADLINE - 100);
    expect(await first).toMatchObject({ ok: false, error: "hook_blocked", message: "title must start with a ticket id" });
    expect(team.tasks.filter((t) => t.title === "same")).toHaveLength(0);
    const retry = env.call("lead", "TaskCreate", { title: "same", description: "d" });
    await advance(env.clock, 0);
    expect(await retry).toMatchObject({ ok: true });
    expect(team.tasks.filter((t) => t.title === "same")).toHaveLength(1);
  });
});

describe("idle superseded by a waking mail (12.21, #R4)", () => {
  const setupIdle = async (code: number) => {
    const s = await setup({ TeammateIdle: [hook("check")] });
    s.env.addMember(s.team, "alice", "busy");
    s.procs.exitAfter(2000, code, code === 2 ? "write the summary first" : undefined);
    return s;
  };
  const supersede = (s: Awaited<ReturnType<typeof setupIdle>>) =>
    s.env.rt.ops.sendServerMail(s.team, "alice", { kind: "hook_feedback", text: "meanwhile", wake: true });

  it.each([0, 2])("hook exit %i: the idle is dropped, alice stays busy, the lead gets no idle notice, no extra hook_feedback", async (code) => {
    const s = await setupIdle(code);
    const idle = s.env.idle("alice", { settleId: 1, finalText: "done" });
    await advance(s.env.clock, 1000);
    expect(supersede(s).ok).toBe(true);
    await advance(s.env.clock, 1000);
    expect(await idle).toMatchObject({ ok: true, data: { ignored: true } });
    expect(s.env.member(s.team, "alice").status).toBe("busy");
    expect(notices(s.env, s.team)).toHaveLength(0);
    expect(feedbackMails(s.env, s.team, "alice")).toHaveLength(1); // only the superseding mail: ≤ 1 wake
  });
});

describe("hook_feedback loop with a member that ignores feedback (12.15, #X10)", () => {
  it("exactly 3 hook_feedback wakes, then the idle is accepted with one lead notice; 4 turns, no unbounded loop", async () => {
    const { env, procs, team } = await setup({ TeammateIdle: [hook("gate")] }, { hookMaxRetries: 3 });
    env.addMember(team, "alice", "busy");
    procs.script([{ code: 2, stderr: "write the summary first" }]);
    const t0 = env.clock.now();
    let turns = 0;
    let accepted = false;
    while (!accepted && turns < 10) {
      turns++;
      const out = await env.idle("alice", { settleId: turns, finalText: "TEAM DONE" });
      expect(out).toMatchObject({ ok: true });
      accepted = env.member(team, "alice").status === "idle";
      if (!accepted) expect(env.member(team, "alice").status).toBe("busy"); // the veto keeps it working
    }
    expect(turns).toBe(4);
    const mails = feedbackMails(env, team, "alice");
    expect(mails).toHaveLength(3);
    expect(mails.every((m) => m.wake && m.text.includes("write the summary first"))).toBe(true);
    expect(notices(env, team).filter((m) => m.text.includes("TeammateIdle hook blocked alice"))).toHaveLength(1);
    expect(env.clock.now() - t0).toBeLessThan(60_000);
  });
});
