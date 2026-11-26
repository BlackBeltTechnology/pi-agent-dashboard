/**
 * Template teams across a server restart (tasks 3.2, 3.5, 3.6, 5.6): the persisted snapshot is the only
 * source after a start, a `starting` team keeps its bind deadline, a half-finished eager start resumes
 * idempotently, prompt files follow the team record, and the additive fields never break either reader.
 * Test-plan #D1 #D2 #D3 #D4 #D8 #D9. The "restart" is a second runtime over the same data dir and clock;
 * the first is disposed (its timers die like a killed process).
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFakeRuntimeHost } from "../../__tests__/harness/index.js";
import type { Team } from "../../shared/types.js";
import { createExtensionPoints } from "../extension-points.js";
import { createTeamsRuntime } from "../runtime.js";
import { createStartEnv, type StartEnv } from "./start-env.js";
import { md } from "./template-env.js";

const T = 30_000;
const only = (e: StartEnv): Team => {
  expect(e.rt.store.list()).toHaveLength(1);
  return e.rt.store.list()[0] as Team;
};

/** Persist, kill the first runtime and boot a second one over the same data dir and clock. */
async function reboot(e: StartEnv, config: Record<string, unknown> = {}, downMs = 0) {
  await e.rt.persistence.flush();
  e.rt.dispose();
  e.clock.advance(downMs); // time passes while no server runs
  const fake = createFakeRuntimeHost({ dataDir: e.fake.dataDir, config });
  const rt = createTeamsRuntime(fake.host, {
    clock: e.clock,
    ext: createExtensionPoints(),
    templatesHost: { isProjectTrusted: () => true, knownFolderCwds: () => [e.cwd], resolvePiAgentDir: () => e.agentDir },
  });
  const helloOf = (sid: string) => fake.lane(sid, "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false });
  return { fake, rt, helloOf, spawned: (): string[] => fake.base.spawns.map((s) => (s.name as string).split("/")[1] as string) };
}

describe("the snapshot survives edits and deletion of the template file (11.37, #D1)", () => {
  it("frozen hooks, defaults, ceiling and plan floor come from the snapshot after the file is edited and deleted", async () => {
    const e = await createStartEnv();
    const file = e.tpl(
      "user",
      "review-pr",
      md({
        name: "review-pr",
        spawn: "lead",
        requirePlanApproval: "user",
        defaultModel: "@coding",
        hooks: { TaskCompleted: [{ command: "echo gate-closed >&2; exit 2" }] },
        members: [{ name: "alice", tools: ["read"] }],
      }),
    );
    const leadSid = e.newSession();
    expect(await e.start({ template: "review-pr", goal: "g" }, leadSid)).toMatchObject({ ok: true });
    const team = only(e);
    const hash = team.template?.hash;
    fs.writeFileSync(file, md({ name: "review-pr", spawn: "eager", hooks: { TaskCompleted: [] }, members: [{ name: "alice", tools: ["bash"] }] }));
    fs.rmSync(file);

    // The lead spawns the `spawn: lead` roster member after the file is gone: ceiling and floor are the snapshot's.
    expect(await e.fake.call(leadSid, "TeammateSpawn", { name: "alice", prompt: "go", tools: ["bash"] })).toMatchObject({ ok: false, error: "tools_outside_template" });
    expect(await e.fake.call(leadSid, "TeammateSpawn", { name: "alice", prompt: "go", requirePlanApproval: false })).toMatchObject({ ok: true });
    const alice = e.rt.store.member(only(e), "alice");
    expect(alice).toMatchObject({ requirePlanApproval: "user", planApproval: "planning", model: "@coding" });

    // The frozen hook still blocks a completion.
    e.rt.store.patchMember(team.id, "alice", { status: "busy", sessionId: e.sid("alice") });
    e.fake.addSession(e.sid("alice"), { cwd: e.cwd });
    e.rt.ops.createTask(only(e), { title: "t", description: "d", owner: "alice" }, { actor: "lead" });
    e.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    expect(await e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "done" })).toMatchObject({ ok: false, error: "hook_blocked" });
    expect(only(e).template?.hash).toBe(hash);
    expect(only(e).hooks).toEqual({ TaskCompleted: [{ command: "echo gate-closed >&2; exit 2", timeoutMs: 10_000 }] });
  });
});

describe("restart before the lead binds (11.38, #D2)", () => {
  it("a `starting` team's playbook mail and eager roster come from the snapshot after the file was deleted; the persisted token and deadline are honoured", async () => {
    const e = await createStartEnv();
    const file = e.tpl("user", "squad", md({ name: "squad", members: [{ name: "style", count: 2 }, { name: "sec" }] }, "Squad for {{goal}}."));
    await e.restStart({ template: "squad", goal: "ship it", cwd: e.cwd });
    const before = only(e);
    fs.rmSync(file);

    const b = await reboot(e);
    const team = b.rt.store.get(before.id) as Team;
    expect(team).toMatchObject({ status: "starting", leadSpawnToken: before.leadSpawnToken, leadBindDeadline: before.leadBindDeadline });
    expect(b.spawned()).toEqual([]); // nothing runs before the lead binds

    b.fake.addSession("S-relead", { cwd: e.cwd });
    b.fake.resolveSession("S-relead", { "agent-teams": { teamId: team.id, role: "lead" } });
    await b.helloOf("S-relead");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(b.spawned().sort()).toEqual(["sec", "style-1", "style-2"]);
    const playbook = b.rt.store.mailLog(team.id).filter((m) => m.kind === "playbook");
    expect(playbook).toHaveLength(1);
    expect(playbook[0]?.text).toContain("Goal: ship it");
    expect(playbook[0]?.text).toContain("Squad for ship it.");
    expect(b.rt.store.get(team.id)?.status).toBe("active");
  });
});

describe("restart around the bind deadline (11.39, #D3)", () => {
  it("past the deadline: closed lead_spawn_failed, the spawn aborted by token, no team slot held", async () => {
    const e = await createStartEnv();
    e.tpl("user", "t", md({ name: "t", spawn: "lead" }));
    await e.restStart({ template: "t", goal: "g", cwd: e.cwd });
    const before = only(e);
    const b = await reboot(e, { maxActiveTeams: 1 }, T + 5_000);
    expect(b.rt.store.get(before.id)).toMatchObject({ status: "closed", closeReason: "lead_spawn_failed" });
    expect(b.fake.abortedRuns).toEqual([{ spawnToken: before.leadSpawnToken }]);
    const sid = b.fake.addSession("S-next", { cwd: e.cwd });
    expect(await b.fake.call(sid, "team.start", { template: "t", goal: "g" })).toMatchObject({ ok: true }); // cap 1 and a slot is free
  });

  it("before the deadline: the timer is re-armed for the remaining time and a re-bind continues the team", async () => {
    const e = await createStartEnv();
    e.tpl("user", "t", md({ name: "t", spawn: "lead" }));
    await e.restStart({ template: "t", goal: "g", cwd: e.cwd });
    const before = only(e);
    const b = await reboot(e, {}, T - 5_000);
    e.clock.advance(4_999);
    expect(b.rt.store.get(before.id)?.status).toBe("starting");
    b.fake.addSession("S-relead", { cwd: e.cwd });
    b.fake.resolveSession("S-relead", { "agent-teams": { teamId: before.id, role: "lead" } });
    e.clock.advance(60_000);
    expect(b.rt.store.get(before.id)).toMatchObject({ status: "active", leadSessionId: "S-relead" });
    expect(b.fake.abortedRuns).toHaveLength(0);
  });

  it("before the deadline and never re-bound: closed exactly 5 s later", async () => {
    const e = await createStartEnv();
    e.tpl("user", "t", md({ name: "t", spawn: "lead" }));
    await e.restStart({ template: "t", goal: "g", cwd: e.cwd });
    const before = only(e);
    const b = await reboot(e, {}, T - 5_000);
    e.clock.advance(5_000);
    expect(b.rt.store.get(before.id)).toMatchObject({ status: "closed", closeReason: "lead_spawn_failed" });
  });
});

describe("restart in the middle of the eager spawn (11.40, #D4)", () => {
  it("only the missing members spawn, once; the playbook is not re-sent", async () => {
    const e = await createStartEnv();
    e.tpl("user", "four", md({ name: "four", members: [{ name: "m1" }, { name: "m2" }, { name: "m3" }, { name: "m4" }] }));
    // The "kill": the third spawn never returns, so the store holds exactly two members.
    const real = e.rt.ops.spawnTeammate.bind(e.rt.ops);
    let calls = 0;
    vi.spyOn(e.rt.ops, "spawnTeammate").mockImplementation((team, args, opts) => (++calls <= 2 ? real(team, args, opts) : new Promise(() => undefined)));
    await e.restStart({ template: "four", goal: "g", cwd: e.cwd });
    const team = only(e);
    const leadSid = await e.bindLead(team);
    await e.flush();
    expect(only(e).members.map((m) => m.name)).toEqual(["m1", "m2"]);
    expect(e.rt.store.mailLog(team.id).filter((m) => m.kind === "playbook")).toHaveLength(1);

    const b = await reboot(e);
    b.fake.addSession(leadSid, { cwd: e.cwd });
    await b.helloOf(leadSid); // the surviving lead session re-registers
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const after = b.rt.store.get(team.id) as Team;
    expect(b.spawned().sort()).toEqual(["m3", "m4"]);
    expect(after.members.map((m) => m.name).sort()).toEqual(["m1", "m2", "m3", "m4"]);
    expect(b.rt.store.mailLog(team.id).filter((m) => m.kind === "playbook")).toHaveLength(1);
    // A second reconnect changes nothing.
    await b.helloOf(leadSid);
    await new Promise((r) => setTimeout(r, 0));
    expect(b.spawned()).toHaveLength(2);
  });

  it("a member whose spawn was refused (a `failed` record) is not retried after the restart", async () => {
    const e = await createStartEnv();
    e.tpl("user", "ghosty", md({ name: "ghosty", members: [{ name: "a" }, { name: "g", agent: "Ghost" }] }));
    await e.start({ template: "ghosty", goal: "g" }, "S-lead");
    await e.flush();
    expect(only(e).members.find((m) => m.name === "g")?.status).toBe("failed");
    const b = await reboot(e);
    b.fake.addSession("S-lead", { cwd: "/work" });
    await b.helloOf("S-lead");
    await new Promise((r) => setTimeout(r, 0));
    expect(b.spawned()).toEqual([]);
  });
});

describe("prompt files follow the team record (11.41, #D8)", () => {
  it("a closed team's prompt dir goes with its record after retention, a running team's files survive a restart byte for byte", async () => {
    const e = await createStartEnv();
    e.agent("user", "Audit", "---\ndescription: audit\n---\nAudit carefully.\n");
    e.tpl("user", "aud", md({ name: "aud", members: [{ name: "alice", agent: "Audit", prompt: "Look at {{goal}}." }] }));
    await e.start({ template: "aud", goal: "auth" }, "S-lead");
    await e.flush();
    await e.start({ template: "aud", goal: "billing" });
    await e.flush();
    const [running, closing] = e.rt.store.list() as [Team, Team];
    const dir = (t: Team): string => path.join(e.fake.dataDir, "prompts", t.id);
    const files = (t: Team): string[] => (fs.existsSync(dir(t)) ? fs.readdirSync(dir(t)).sort() : []);
    expect(files(running)).toEqual(["alice.agent.md", "alice.member.md"]);
    const bytes = fs.readFileSync(path.join(dir(running), "alice.member.md"), "utf8");
    expect(bytes).toContain("Look at auth.");

    e.rt.ops.teamDelete(closing, { actor: "user" });
    e.clock.advance(11_000); // shutdown grace: the closing team finishes
    await e.flush();
    expect(e.rt.store.get(closing.id)?.status).toBe("closed");
    const b1 = await reboot(e);
    expect(b1.rt.store.get(closing.id)).toBeDefined(); // retention not elapsed: record and files stay
    expect(files(closing).length).toBe(2);
    e.clock.advance(8 * 24 * 3600 * 1000);
    const b2 = await reboot({ ...e, rt: b1.rt, fake: b1.fake } as unknown as StartEnv);
    expect(b2.rt.store.get(closing.id)).toBeUndefined();
    expect(files(closing)).toEqual([]);
    expect(b2.rt.store.get(running.id)).toBeDefined();
    expect(fs.readFileSync(path.join(dir(running), "alice.member.md"), "utf8")).toBe(bytes);
  });
});

describe("schemaVersion 1 additive fields (11.42, #D9)", () => {
  it("a team written by this change carries optional keys on schemaVersion 1; an unknown optional key is ignored on load", async () => {
    const e = await createStartEnv();
    e.tpl("user", "t", md({ name: "t", spawn: "lead", hooks: { TaskCompleted: [{ command: "true" }] } }));
    await e.start({ template: "t", goal: "g" }, "S-lead");
    await e.rt.persistence.flush();
    const file = path.join(e.fake.dataDir, "teams", `${only(e).id}.json`);
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;
    expect(json.schemaVersion).toBe(1);
    expect(json.template.name).toBe("t");
    expect(json.hooks.TaskCompleted).toHaveLength(1);
    fs.writeFileSync(file, JSON.stringify({ ...json, futureOptional: { x: 1 } }));
    const b = await reboot(e);
    const loaded = b.rt.store.get(json.id) as Team;
    expect(loaded.template?.name).toBe("t");
    expect(b.rt.store.unavailableTeams).toEqual([]);
  });

  it("a core-written team (no template, hooks or plans) loads with no hooks and no plan gate", async () => {
    const e = await createStartEnv();
    const sid = e.newSession();
    const res = await e.fake.call(sid, "TeamCreate", { name: "plain" });
    const team = e.rt.store.get(res.data.teamId) as Team;
    e.addMember(team, "alice", "busy", { requirePlanApproval: undefined });
    const b = await reboot(e);
    const loaded = b.rt.store.get(team.id) as Team;
    expect(loaded.template).toBeUndefined();
    expect(loaded.hooks).toBeUndefined();
    expect(loaded.plans).toBeUndefined();
    b.fake.addSession(e.sid("alice"), { cwd: e.cwd });
    expect(await b.fake.call(e.sid("alice"), "PlanSubmit", { plan: "my plan" })).toMatchObject({ ok: false, error: "plan_not_required" });
    // a completion is not gated (no hooks on a team without a template)
    b.rt.ops.createTask(loaded, { title: "t", description: "d", owner: "alice" }, { actor: "lead" });
    b.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    b.rt.store.patchMember(team.id, "alice", { status: "busy" });
    expect(await b.fake.call(e.sid("alice"), "TaskUpdate", { id: "1", status: "completed", result: "ok" })).toMatchObject({ ok: true });
  });
});
