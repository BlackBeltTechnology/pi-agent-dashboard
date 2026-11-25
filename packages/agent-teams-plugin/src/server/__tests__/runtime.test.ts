/**
 * Runtime lifecycle over the real request-lane handlers (test-plan S34 names,
 * S35 caps, S36 lead role, S37 modes, S43 store events, S63–S65 races that need
 * no host spawn, S88–S93 identity/origin/confinement, S141/S142 actor ops, S143
 * defaults). Host spawn bindings are a seam (`starter` spy) until §5.
 * See change: add-agent-teams-core.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeRuntimeHost, createTeamsEnv, FakeClock, loadConfigDefaults, memberFixture } from "../../__tests__/harness/index.js";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import { createSessionDriver } from "../driver.js";
import { applySpawnContributors, createExtensionPoints, runOpGates } from "../extension-points.js";
import type { MailFlusher, SpawnStarter } from "../ops.js";
import { createTeamsRuntime } from "../runtime.js";

interface SetupOptions {
  config?: Record<string, unknown>;
  noLane?: boolean;
}

function setup(over: SetupOptions = {}) {
  const clock = new FakeClock(1_700_000_000_000);
  const fake = createFakeRuntimeHost({
    ...(over.config ? { config: over.config } : {}),
    ...(over.noLane ? { noLane: true } : {}),
  });
  let n = 0;
  let tok = 0;
  const starts: Array<{ team: string; member: string; prompt: string }> = [];
  const starter: SpawnStarter = ({ team, member, prompt }) => {
    starts.push({ team: team.id, member: member.name, prompt });
  };
  const flushes: Array<[string, string]> = [];
  const mailer: MailFlusher = { flush: (teamId, to) => void flushes.push([teamId, to]) };
  const rt = createTeamsRuntime(fake.host, {
    clock,
    ext: createExtensionPoints(),
    idFactory: () => `t_${String(++n).padStart(8, "0")}`,
    newToken: () => `tok-${++tok}`,
    starter,
    mailer,
  });
  const lead = fake.addSession("S-lead", { cwd: "/work", principalOwner: "owner-1" });
  /** Make `name` a live teammate of `teamId` with its own host session. */
  const addMember = (teamId: string, name: string, status: "idle" | "busy" = "idle") => {
    const sessionId = fake.addSession(`S-${name}`, { cwd: "/work" });
    rt.store.reserveMember(teamId, memberFixture(name, { sessionId, status }) as never);
    return sessionId;
  };
  const createTeam = async (sessionId = lead, name = "alpha") => {
    const res = await fake.call(sessionId, "TeamCreate", { name });
    if (!res.ok) throw new Error(`TeamCreate failed: ${res.error}`);
    return rt.store.get(res.data.teamId) as NonNullable<ReturnType<typeof rt.store.get>>;
  };
  return { clock, fake, rt, lead, starts, flushes, addMember, createTeam };
}

describe("member names (S34)", () => {
  it("accepts valid names, refuses reserved with name_reserved and bad grammar with invalid_args", async () => {
    const s = setup({ config: { maxTeammates: 10 } });
    const team = await s.createTeam();
    const spawn = (name: unknown) => s.fake.call(s.lead, "TeammateSpawn", { name, prompt: "go" });
    expect((await spawn("a")).ok).toBe(true);
    expect((await spawn("b".repeat(32))).ok).toBe(true);
    for (const bad of ["c".repeat(33), "Alice", "1bob", "a_b", "", " ", 7, null]) {
      const r = await spawn(bad);
      expect(r, JSON.stringify(bad)).toMatchObject({ ok: false, error: "invalid_args" });
    }
    for (const reserved of ["lead", "server", "system", "all", "user"]) {
      expect(await spawn(reserved)).toMatchObject({ ok: false, error: "name_reserved" });
    }
    expect(team.members.map((m) => m.name)).toEqual(["a", "b".repeat(32)]);
  });

  it("a live name is name_taken; a gone or failed name is replaced by a fresh record", async () => {
    const s = setup();
    const team = await s.createTeam();
    const first = await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "one" });
    expect(first.data).toEqual({ member: "alice", status: "spawning" });
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "two" })).toMatchObject({ ok: false, error: "name_taken" });
    const oldToken = s.rt.store.member(team, "alice")?.spawnToken;
    s.rt.ops.releaseMember(team, "alice", "gone", "test");
    expect((await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "three" })).ok).toBe(true);
    const replaced = s.rt.store.member(team, "alice");
    expect(replaced?.status).toBe("spawning");
    expect(replaced?.spawnToken).not.toBe(oldToken);
    expect(team.members.filter((m) => m.name === "alice")).toHaveLength(1);
    s.rt.ops.releaseMember(team, "alice", "failed", "test");
    expect((await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "four" })).ok).toBe(true);
  });

  it("persists the spawn prompt as the first waking spawn_prompt mail from the lead", async () => {
    const s = setup();
    const team = await s.createTeam();
    await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "write the parser", role: "coder" });
    const [mail] = s.rt.store.pendingMail(team.id, "alice");
    expect(mail).toMatchObject({ from: "lead", kind: "spawn_prompt", wake: true, text: expect.stringMatching(/^Team "alpha" · you are teammate "alice" \(role: coder\)[\s\S]*\n\nwrite the parser$/) });
    expect(s.starts).toEqual([{ team: team.id, member: "alice", prompt: "write the parser" }]);
  });
});

describe("team caps (S35)", () => {
  it("clamps maxTeammates into 1–10 with exactly one log line per out-of-range value", async () => {
    for (const [configured, effective] of [[0, 1], [11, 10]] as const) {
      const s = setup({ config: { maxTeammates: configured } });
      const team = await s.createTeam();
      const res = await s.fake.call("S-lead", "TeamStatus");
      expect(res.ok).toBe(true);
      for (let i = 0; i < effective; i++) {
        expect((await s.fake.call(s.lead, "TeammateSpawn", { name: `m${i}`, prompt: "go" })).ok).toBe(true);
      }
      expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "extra", prompt: "go" })).toMatchObject({ ok: false, error: "team_full" });
      expect(team.members).toHaveLength(effective);
      expect(s.starts).toHaveLength(effective);
      expect(s.fake.base.spawns).toHaveLength(0);
      expect(s.fake.logs.warn.filter((l) => l.includes("maxTeammates"))).toHaveLength(1);
    }
  });

  it("spawns at cap-1 and cap succeed/refuse exactly at the boundary", async () => {
    const s = setup();
    await s.createTeam();
    for (let i = 0; i < 4; i++) await s.fake.call(s.lead, "TeammateSpawn", { name: `m${i}`, prompt: "go" });
    expect((await s.fake.call(s.lead, "TeammateSpawn", { name: "m4", prompt: "go" })).ok).toBe(true); // cap-1 live → cap
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "m5", prompt: "go" })).toMatchObject({ error: "team_full" }); // cap → cap+1
  });

  it("a gone teammate frees a slot", async () => {
    const s = setup({ config: { maxTeammates: 1 } });
    const team = await s.createTeam();
    await s.fake.call(s.lead, "TeammateSpawn", { name: "a", prompt: "go" });
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "b", prompt: "go" })).toMatchObject({ error: "team_full" });
    s.rt.ops.releaseMember(team, "a", "gone", "x");
    expect((await s.fake.call(s.lead, "TeammateSpawn", { name: "b", prompt: "go" })).ok).toBe(true);
  });

  it("TeamCreate maxTeammates beyond the configured cap is invalid_args; a smaller one caps the team", async () => {
    const s = setup();
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "t", maxTeammates: 6 })).toMatchObject({ error: "invalid_args" });
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "t", maxTeammates: 0 })).toMatchObject({ error: "invalid_args" });
    const ok = await s.fake.call(s.lead, "TeamCreate", { name: "t", maxTeammates: 2 });
    expect(ok.data.limits).toEqual({ maxTeammates: 2, maxTasks: 50 });
  });

  it("maxActiveTeams counts starting+active+orphaned but not closed (4th team → team_cap_reached)", async () => {
    const s = setup();
    const a = s.fake.addSession("S-a");
    const b = s.fake.addSession("S-b");
    const c = s.fake.addSession("S-c");
    const d = s.fake.addSession("S-d");
    await s.createTeam(a, "a");
    const bTeam = await s.createTeam(b, "b");
    expect(s.rt.ops.createTeam({ name: "starting", leadCwd: "/w", starting: true }).ok).toBe(true); // starting counts
    expect(await s.fake.call(c, "TeamCreate", { name: "c" })).toMatchObject({ ok: false, error: "team_cap_reached" });
    s.fake.endSession(b); // b's team orphans: still counts
    expect(bTeam.status).toBe("orphaned");
    expect(await s.fake.call(c, "TeamCreate", { name: "c" })).toMatchObject({ error: "team_cap_reached" });
    s.rt.ops.teamDelete(bTeam, { actor: "server" }); // closed no longer counts
    expect(bTeam.status).toBe("closed");
    expect((await s.fake.call(c, "TeamCreate", { name: "c" })).ok).toBe(true);
    expect(await s.fake.call(d, "TeamCreate", { name: "d" })).toMatchObject({ error: "team_cap_reached" });
  });

  it("limits come from config read per operation (no restart)", async () => {
    const s = setup();
    await s.createTeam();
    s.fake.base.setConfig({ maxTeammates: 1 });
    expect((await s.fake.call(s.lead, "TeammateSpawn", { name: "a", prompt: "go" })).ok).toBe(true);
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "b", prompt: "go" })).toMatchObject({ error: "team_full" });
    s.fake.base.setConfig({ maxTeammates: 3 });
    expect((await s.fake.call(s.lead, "TeammateSpawn", { name: "b", prompt: "go" })).ok).toBe(true);
  });
});

describe("lead role (S36)", () => {
  it("plain + TeamCreate → lead; the team records the socket session as lead, its cwd and owner", async () => {
    const s = setup();
    const res = await s.fake.call(s.lead, "TeamCreate", { name: "alpha", description: "d" });
    expect(res).toMatchObject({ ok: true, data: { name: "alpha", role: "lead", limits: { maxTeammates: 5, maxTasks: 50 } } });
    const team = s.rt.store.get(res.data.teamId);
    expect(team).toMatchObject({ leadSessionId: s.lead, leadCwd: "/work", status: "active", mode: "session", owner: "owner-1", committer: "lead", schemaVersion: 1 });
    expect(s.rt.store.findBySession(s.lead)).toEqual({ teamId: team?.id, who: "lead" });
  });

  it("plain + TeammateSpawn → default team auto-created, then the spawn proceeds", async () => {
    const s = setup();
    const res = await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "go" });
    expect(res.ok).toBe(true);
    const teams = s.rt.store.list();
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ leadSessionId: s.lead, name: "work team" });
    expect(teams[0]?.members.map((m) => m.name)).toEqual(["alice"]);
  });

  it("a refused first spawn leaves no default team behind", async () => {
    const s = setup();
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "Bad", prompt: "go" })).toMatchObject({ error: "invalid_args" });
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "a", prompt: "go", cwd: "/elsewhere" })).toMatchObject({ error: "cwd_outside_lead" });
    expect(s.rt.store.list()).toHaveLength(0);
  });

  it("lead + TeamCreate → already_in_team; teammate → nested_team_forbidden", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "again" })).toMatchObject({ ok: false, error: "already_in_team" });
    expect(await s.fake.call(alice, "TeamCreate", { name: "nested" })).toMatchObject({ ok: false, error: "nested_team_forbidden" });
    expect(s.rt.store.list()).toHaveLength(1);
  });

  it("a lead of a closed team loses the role: lead-only ops are not_in_team, TeamCreate succeeds, tools dropped via team_closed", async () => {
    const s = setup();
    const team = await s.createTeam();
    expect((await s.fake.call(s.lead, "TeamDelete")).ok).toBe(true);
    expect(team.status).toBe("closed");
    const closed = s.fake.base.emits.filter((e) => e.eventType === "agent-teams:team_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ sessionId: s.lead, data: { teamId: team.id, closeReason: "team_delete" } });
    expect(await s.fake.call(s.lead, "TeamStatus")).toMatchObject({ error: "not_in_team" });
    const again = await s.fake.call(s.lead, "TeamCreate", { name: "second" });
    expect(again.ok).toBe(true);
    expect(again.data.teamId).not.toBe(team.id);
  });

  it("a team that is closed answers team_closed for a spawn", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.rt.ops.teamDelete(team, { actor: "server" });
    const caller = { sessionId: s.lead, role: "lead" as const, name: "lead", team };
    expect(s.rt.ops.call("TeammateSpawn", { name: "a", prompt: "x" }, caller)).toMatchObject({ ok: false, error: "team_closed" });
  });
});

describe("modes (S37)", () => {
  it("absent mode with config unset → session; `session` ok", async () => {
    const s = setup();
    const a = await s.fake.call(s.lead, "TeamCreate", { name: "a" });
    expect(s.rt.store.get(a.data.teamId)?.mode).toBe("session");
    const b = await s.fake.call(s.fake.addSession("S-b"), "TeamCreate", { name: "b", mode: "session" });
    expect(b.ok).toBe(true);
  });

  it("unknown or unavailable modes → mode_unavailable and no team is created", async () => {
    const s = setup();
    s.rt.modes.register("closed-mode", { driver: s.rt.modes.get("session")!.driver, available: () => ({ ok: false, reason: "nope" }) });
    s.rt.modes.register("open-mode", { driver: s.rt.modes.get("session")!.driver, available: (id) => ({ ok: id === "S-lead" }) as never });
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "t", mode: "x" })).toMatchObject({ ok: false, error: "mode_unavailable" });
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "t", mode: "closed-mode" })).toMatchObject({ error: "mode_unavailable" });
    expect(s.rt.store.list()).toHaveLength(0);
    const other = s.fake.addSession("S-other");
    expect(await s.fake.call(other, "TeamCreate", { name: "t", mode: "open-mode" })).toMatchObject({ error: "mode_unavailable" }); // per-caller predicate
    expect((await s.fake.call(s.lead, "TeamCreate", { name: "t", mode: "open-mode" })).ok).toBe(true);
  });

  it("an absent mode resolves from config teammateMode", async () => {
    const s = setup({ config: { teammateMode: "missing" } });
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "t" })).toMatchObject({ error: "mode_unavailable" });
    s.fake.base.setConfig({ teammateMode: "session" });
    expect((await s.fake.call(s.lead, "TeamCreate", { name: "t" })).ok).toBe(true);
  });
});

describe("role → tool table (S38, table half)", () => {
  it("plain has exactly TeamCreate+TeammateSpawn; a teammate never gets nested-team tools; lead is a superset of plain", () => {
    expect([...TEAM_TOOLS_BY_ROLE.plain]).toEqual(["TeamCreate", "TeammateSpawn"]);
    const member = TEAM_TOOLS_BY_ROLE.member;
    for (const forbidden of ["TeamCreate", "TeammateSpawn", "ShutdownRequest", "TeamDelete"] as const) expect(member).not.toContain(forbidden);
    for (const required of ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "SendMessage", "TeamStatus", "ShutdownResponse"] as const) {
      expect(member).toContain(required);
    }
    for (const t of TEAM_TOOLS_BY_ROLE.plain) expect(TEAM_TOOLS_BY_ROLE.lead).toContain(t);
    expect(TEAM_TOOLS_BY_ROLE.lead).toContain("TeamStatus");
    expect(TEAM_TOOLS_BY_ROLE.lead).toContain("ShutdownRequest");
    expect(TEAM_TOOLS_BY_ROLE.lead).not.toContain("ShutdownResponse");
  });
});

describe("store events (S43)", () => {
  it("a throwing listener never affects the commit; rev is +1 per committed change; task_completed fires after change", async () => {
    const s = setup();
    const team = await s.createTeam();
    const order: string[] = [];
    s.rt.store.on("change", () => {
      throw new Error("boom");
    });
    s.rt.store.on("change", ({ team: t, rev }) => order.push(`change:${rev}:${t.tasks.map((x) => x.status[0]).join("")}`));
    s.rt.store.on("task_completed", ({ task, team: t }) => order.push(`completed:${task.id}:${t.tasks[0]?.status}`));
    s.rt.store.on("member_status", ({ from, to }) => order.push(`member:${from}>${to}`));
    const r0 = s.rt.store.rev(team.id);
    s.rt.store.addTask(team.id, { title: "t", description: "d", createdBy: "lead" });
    expect(s.rt.store.rev(team.id)).toBe(r0 + 1);
    expect(team.tasks).toHaveLength(1); // commit unaffected by the throw
    s.rt.store.patchTask(team.id, "1", { status: "completed" });
    expect(s.rt.store.rev(team.id)).toBe(r0 + 2);
    s.addMember(team.id, "alice");
    s.rt.store.patchMember(team.id, "alice", { status: "busy" });
    expect(order).toEqual([
      `change:${r0 + 1}:p`,
      `change:${r0 + 2}:c`,
      "completed:1:completed",
      `change:${r0 + 3}:c`, // reserveMember
      `change:${r0 + 4}:c`,
      "member:idle>busy",
    ]);
    expect(s.fake.logs.error.filter((l) => l.includes("listener")).length).toBeGreaterThan(0);
  });

  it("emits team_created, lead_bound and team_closed", async () => {
    const s = setup();
    const seen: string[] = [];
    s.rt.store.on("team_created", () => seen.push("created"));
    s.rt.store.on("lead_bound", ({ rebind }) => seen.push(`bound:${rebind}`));
    s.rt.store.on("team_closed", ({ team }) => seen.push(`closed:${team.closeReason}`));
    const starting = s.rt.ops.createTeam({ name: "s", leadCwd: "/w", starting: true });
    if (!starting.ok) throw new Error("create");
    s.rt.ops.bindLead(starting.data.id, "S-x");
    s.rt.ops.teamDelete(starting.data, { actor: "user" });
    expect(seen).toEqual(["created", "bound:false", "closed:user"]);
  });
});

describe("team without a bound lead / owner / committer (S55, 3.4)", () => {
  it("a starting team keeps notices queued, binds through onSessionResolved, keeps its owner and flushes the lead queue", async () => {
    const s = setup();
    const created = s.rt.ops.createTeam({ name: "srv", leadCwd: "/repo", starting: true, owner: "O" });
    if (!created.ok) throw new Error("create");
    const team = created.data;
    expect(team).toMatchObject({ status: "starting", leadCwd: "/repo", owner: "O" });
    expect(team.leadSessionId).toBeUndefined();
    s.rt.ops.enqueueLeadNotice(team, { text: "alice idle", wake: true });
    expect(s.rt.store.pendingMail(team.id, "lead")).toHaveLength(1);
    expect(s.rt.ops.canDispatch(team)).toBe(false);

    const leadSession = s.fake.addSession("S-srvlead", { cwd: "/repo", principalOwner: "P" });
    s.fake.resolveSession(leadSession, { "agent-teams": { teamId: team.id, role: "lead" }, principalOwner: "P" });
    expect(team).toMatchObject({ status: "active", leadSessionId: leadSession, owner: "O", committer: "lead" });
    expect(s.rt.store.findBySession(leadSession)).toEqual({ teamId: team.id, who: "lead" });
    expect(s.rt.ops.canDispatch(team)).toBe(true);
    expect(s.flushes).toContainEqual([team.id, "lead"]);
    expect(s.rt.store.pendingMail(team.id, "lead")).toHaveLength(1); // still unacked until delivered
  });

  it("a lead-less team takes the lead's principalOwner when no owner was given", async () => {
    const s = setup();
    const created = s.rt.ops.createTeam({ name: "srv", leadCwd: "/repo", starting: true });
    if (!created.ok) throw new Error("create");
    s.fake.addSession("S-l", { cwd: "/repo" });
    s.fake.resolveSession("S-l", { "agent-teams": { teamId: created.data.id, role: "lead" }, principalOwner: "P" });
    expect(created.data.owner).toBe("P");
  });

  it("ignores a resolved ref that is not a lead ref or names a team that is not starting", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.fake.resolveSession("S-z", { "agent-teams": { teamId: team.id, role: "lead" } });
    s.fake.resolveSession("S-y", { other: {} });
    expect(team.leadSessionId).toBe(s.lead);
  });

  it("per-member committer is recorded on that member only; Team.committer stays lead", async () => {
    const s = setup();
    const team = await s.createTeam();
    expect(s.rt.ops.spawnMember(team, { name: "wt", prompt: "go" }, { committer: "member", cwd: "/work/.worktrees/wt" }).ok).toBe(true);
    expect(s.rt.ops.spawnMember(team, { name: "plain", prompt: "go" }).ok).toBe(true);
    expect(team.committer).toBe("lead");
    expect(s.rt.store.member(team, "wt")).toMatchObject({ committer: "member", cwd: "/work/.worktrees/wt" });
    expect(s.rt.store.member(team, "plain")?.committer).toBeUndefined();
  });
});

describe("races without a host spawn (S65 / S64 / S63 sync half)", () => {
  it("double TeamCreate in one tick → one team, second already_in_team", async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.fake.call(s.lead, "TeamCreate", { name: "a" }), s.fake.call(s.lead, "TeamCreate", { name: "b" })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok).error).toBe("already_in_team");
    expect(s.rt.store.list()).toHaveLength(1);
    expect(s.rt.store.activeTeamCount()).toBe(1);
  });

  it("concurrent same-name spawns → one record, loser name_taken, one starter call", async () => {
    const s = setup();
    const team = await s.createTeam();
    const res = await Promise.all([
      s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "1" }),
      s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "2" }),
    ]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.find((r) => !r.ok)?.error).toBe("name_taken");
    expect(team.members).toHaveLength(1);
    expect(s.starts).toHaveLength(1);
  });

  it("10 concurrent spawns with 4 live and cap 5 → exactly one ok, nine team_full, no name stays reserved by a refused call", async () => {
    const s = setup();
    const team = await s.createTeam();
    for (let i = 0; i < 4; i++) await s.fake.call(s.lead, "TeammateSpawn", { name: `m${i}`, prompt: "go" });
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => s.fake.call(s.lead, "TeammateSpawn", { name: `n${i}`, prompt: "go" })));
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.filter((r) => !r.ok && r.error === "team_full")).toHaveLength(9);
    expect(team.members).toHaveLength(5);
    expect(s.starts).toHaveLength(5);
  });

  it("a failing starter marks the member failed and wakes the lead; the name is released", async () => {
    const clock = new FakeClock();
    const fake = createFakeRuntimeHost();
    const rt = createTeamsRuntime(fake.host, {
      clock,
      ext: createExtensionPoints(),
      starter: async () => {
        throw new Error("spawn exploded");
      },
    });
    fake.addSession("S-lead", { cwd: "/work" });
    const created = await fake.call("S-lead", "TeamCreate", { name: "t" });
    await fake.call("S-lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    await new Promise((r) => setTimeout(r, 0));
    const team = rt.store.get(created.data.teamId);
    expect(team && rt.store.member(team, "alice")?.status).toBe("failed");
    clock.advance(2000); // lifecycle notices are coalesced (design D9): one notice per window
    expect(rt.store.pendingMail(created.data.teamId, "lead").some((m) => m.wake && m.text.includes("alice"))).toBe(true);
    expect((await fake.call("S-lead", "TeammateSpawn", { name: "alice", prompt: "again" })).ok).toBe(true);
  });
});

describe("identity (S88)", () => {
  it("acts as the socket-bound identity; payload member/team/as fields are never consulted", async () => {
    const s = setup();
    const a = await s.createTeam(s.lead, "A");
    const bSession = s.fake.addSession("S-leadB", { cwd: "/work" });
    const b = await s.createTeam(bSession, "B");
    const alice = s.addMember(a.id, "alice");
    const bob = s.addMember(b.id, "bob");
    const forged = { member: "lead", team: b.id, as: "lead", name: "lead" };
    const status = await s.fake.call(alice, "TeamStatus", forged);
    expect(status.data.team.id).toBe(a.id);
    expect(status.data.members.map((m: { name: string }) => m.name)).toEqual(["alice"]);
    expect(await s.fake.call(alice, "TeamDelete", { ...forged, force: true })).toMatchObject({ ok: false, error: "not_lead" });
    expect(a.status).toBe("active");
    expect(b.status).toBe("active");
    expect((await s.fake.call(bob, "TeamStatus", forged)).data.team.id).toBe(b.id);
  });

  it("an unbound socket gets not_in_team for every team op except the create paths", async () => {
    const s = setup();
    const stranger = s.fake.addSession("S-stranger");
    for (const op of ["TeamStatus", "TeamDelete", "SendMessage", "TaskList", "ShutdownRequest"]) {
      expect(await s.fake.call(stranger, op, {}), op).toMatchObject({ ok: false, error: "not_in_team" });
    }
    expect(s.rt.store.list()).toHaveLength(0);
  });
});

describe("origin (S90)", () => {
  it("registers every lane type hub-local only", () => {
    const s = setup();
    expect([...s.fake.registered.keys()].sort()).toEqual(["agent-teams/ack", "agent-teams/busy", "agent-teams/call", "agent-teams/hello", "agent-teams/idle"]);
    for (const e of s.fake.registered.values()) expect(e.opts).toEqual({ hubLocalOnly: true });
  });

  it("a remote-origin (or origin-less) session is origin_denied: no team, no session spawned", async () => {
    const s = setup();
    for (const meta of [{ origin: { local: false } }, { origin: undefined }] as const) {
      for (const [op, args] of [["TeamCreate", { name: "t" }], ["TeammateSpawn", { name: "a", prompt: "go" }], ["TaskList", {}]] as const) {
        expect(await s.fake.call(s.lead, op, args, meta as never), `${op} ${JSON.stringify(meta)}`).toMatchObject({ ok: false, error: "origin_denied" });
      }
      expect(await s.fake.lane(s.lead, "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false }, meta as never)).toMatchObject({ error: "origin_denied" });
    }
    expect(s.rt.store.list()).toHaveLength(0);
    expect(s.starts).toHaveLength(0);
    expect(s.fake.base.spawns).toHaveLength(0);
  });
});

describe("confinement (S91, server half)", () => {
  it("a session spawned by another plugin cannot lead (pluginRefs) — nothing is created or spawned", async () => {
    const s = setup();
    const persona = s.fake.addSession("S-persona", { cwd: "/work", pluginRefs: { team: { personaKey: "x" } } });
    expect(await s.fake.call(persona, "TeamCreate", { name: "t" })).toMatchObject({ ok: false, error: "lead_confined" });
    expect(await s.fake.call(persona, "TeammateSpawn", { name: "a", prompt: "go" })).toMatchObject({ error: "lead_confined" });
    expect(s.rt.store.list()).toHaveLength(0);
    expect(s.starts).toHaveLength(0);
  });

  it("a session that reported confined:true in hello cannot lead", async () => {
    const s = setup();
    const r = await s.fake.lane(s.lead, "agent-teams/hello", { isIdle: true, toolsActive: false, guardActive: false, confined: true });
    expect(r).toMatchObject({ ok: false, error: "not_in_team" });
    expect(await s.fake.call(s.lead, "TeamCreate", { name: "t" })).toMatchObject({ error: "lead_confined" });
  });

  it("a session whose only plugin ref is agent-teams is not confined", async () => {
    const s = setup();
    const own = s.fake.addSession("S-own", { cwd: "/work", pluginRefs: { "agent-teams": { teamId: "x" } } });
    expect((await s.fake.call(own, "TeamCreate", { name: "t" })).ok).toBe(true);
  });
});

describe("trusted options are not on the lane (S92)", () => {
  it("an outside cwd is refused; committer and spawnToken in the payload are ignored", async () => {
    const s = setup();
    const team = await s.createTeam();
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "a", prompt: "go", cwd: "/etc" })).toMatchObject({ error: "cwd_outside_lead" });
    expect(await s.fake.call(s.lead, "TeammateSpawn", { name: "a", prompt: "go", trusted: { cwd: "/etc" } })).toMatchObject({ ok: true });
    expect(s.rt.store.member(team, "a")?.cwd).toBe("/work");
    const forged = await s.fake.call(s.lead, "TeammateSpawn", { name: "b", prompt: "go", committer: "member", spawnToken: "forged" });
    expect(forged.ok).toBe(true);
    const b = s.rt.store.member(team, "b");
    expect(b?.committer).toBeUndefined();
    expect(b?.spawnToken).toBe("tok-2");
    expect(team.committer).toBe("lead");
  });
});

describe("nested / forced tools (S93)", () => {
  it("a teammate calling lead-only or team-creating ops is refused with no state change", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    const snapshot = JSON.stringify(team);
    const rev = s.rt.store.rev(team.id);
    expect(await s.fake.call(alice, "TeammateSpawn", { name: "x", prompt: "go" })).toMatchObject({ error: "not_lead" });
    expect(await s.fake.call(alice, "TeamDelete", { force: true })).toMatchObject({ error: "not_lead" });
    expect(await s.fake.call(alice, "ShutdownRequest", { to: "alice" })).toMatchObject({ error: "not_lead" });
    expect(await s.fake.call(alice, "TeamCreate", { name: "n" })).toMatchObject({ error: "nested_team_forbidden" });
    expect(JSON.stringify(team)).toBe(snapshot);
    expect(s.rt.store.rev(team.id)).toBe(rev);
    expect(s.rt.store.list()).toHaveLength(1);
  });

  it("unknown ops and malformed payloads are refused without throwing", async () => {
    const s = setup();
    expect(await s.fake.call(s.lead, "Bogus", {})).toMatchObject({ error: "unknown_op" });
    expect(await s.fake.lane(s.lead, "agent-teams/call", "nope")).toMatchObject({ error: "invalid_args" });
    expect(await s.fake.lane(s.lead, "agent-teams/call", null)).toMatchObject({ error: "invalid_args" });
    expect(await s.fake.call(s.lead, "TeamCreate", "string-args")).toMatchObject({ error: "invalid_args" });
  });
});

describe("hostile args (S98 op-level half)", () => {
  it("strips controls, refuses over-limit and wrong types, never pollutes prototypes", async () => {
    const s = setup();
    const hostile = JSON.parse('{"name":"te\\u0000am\\u202e","__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}');
    const res = await s.fake.call(s.lead, "TeamCreate", hostile);
    expect(res.ok).toBe(true);
    expect(s.rt.store.get(res.data.teamId)?.name).toBe("team");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const s2 = setup();
    expect(await s2.fake.call(s2.lead, "TeamCreate", { name: "x".repeat(41) })).toMatchObject({ error: "invalid_args" });
    expect(await s2.fake.call(s2.lead, "TeamCreate", { name: "x".repeat(40) })).toMatchObject({ ok: true });
    const s3 = setup();
    expect(await s3.fake.call(s3.lead, "TeamCreate", { name: "x".repeat(10_000_000) })).toMatchObject({ error: "invalid_args" });
    for (const bad of [{ name: 5 }, { name: ["a"] }, { name: {} }, { name: "t", description: 5 }, { name: "t", skills: "x" }, { name: "t", tools: [1] }, { name: "t", maxTeammates: "3" }]) {
      expect(await s3.fake.call(s3.lead, "TeamCreate", bad), JSON.stringify(bad)).toMatchObject({ ok: false, error: "invalid_args" });
    }
    expect(s3.rt.store.list()).toHaveLength(0);
  });
});

describe("TeamStatus", () => {
  it("lists members with status, role, owned open task ids; released names stay listed", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice", "busy");
    s.rt.store.patchMember(team.id, "alice", { role: "coder" });
    s.rt.store.addTask(team.id, { title: "a", description: "d", createdBy: "lead", owner: "alice" });
    s.rt.store.addTask(team.id, { title: "b", description: "d", createdBy: "lead", owner: "alice" });
    s.rt.store.patchTask(team.id, "2", { status: "completed" });
    s.addMember(team.id, "bob");
    s.rt.ops.releaseMember(team, "bob", "gone", "x");
    for (const caller of [s.lead, alice]) {
      const res = await s.fake.call(caller, "TeamStatus");
      expect(res.data.members).toEqual([
        { name: "alice", status: "busy", role: "coder", taskIds: ["1"] },
        { name: "bob", status: "gone", taskIds: [] },
      ]);
      expect(res.data.counts).toEqual({ members: 2, tasks: { pending: 1, in_progress: 0, completed: 1 } });
      expect(res.data.team).toMatchObject({ id: team.id, name: "alpha", status: "active", mode: "session" });
    }
  });
});

describe("TeamDelete and actor operations (S141, S142, 3.3)", () => {
  it("without force it refuses while a member is live and names it", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice");
    s.addMember(team.id, "bob");
    s.rt.ops.releaseMember(team, "bob", "failed", "x");
    const res = await s.fake.call(s.lead, "TeamDelete");
    expect(res).toMatchObject({ ok: false, error: "members_active", details: { members: ["alice"] } });
    expect(team.status).toBe("active");
    expect((await s.fake.call(s.lead, "TeamDelete", { force: "yes" })).error).toBe("invalid_args");
  });

  for (const actor of ["lead", "user"] as const) {
    it(`forced delete by actor ${actor}: non-waking notice first, shutdown after the grace despite a rejection, closed once`, async () => {
      const s = setup();
      const team = await s.createTeam();
      const alice = s.addMember(team.id, "alice");
      const bob = s.addMember(team.id, "bob");
      const res = s.rt.ops.teamDelete(team, { actor, force: actor === "lead" });
      expect(res).toEqual({ ok: true, data: { closed: true, shutdown: ["alice", "bob"] } });
      expect(team.status).toBe("closing");
      for (const name of ["alice", "bob"]) {
        const mails = s.rt.store.mailLog(team.id).filter((m) => m.to === name);
        expect(mails[0]).toMatchObject({ kind: "notice", wake: false, from: "server" });
        expect(mails[0]?.text).toMatch(/closed by force/);
        expect(mails[1]).toMatchObject({ kind: "shutdown_request", wake: true });
      }
      // bob "rejects" the shutdown: back to idle. Force ignores it.
      s.rt.store.patchMember(team.id, "bob", { status: "idle" });
      expect(s.fake.base.shutdowns).toEqual([]);
      s.clock.advance(9_999);
      expect(s.fake.base.shutdowns).toEqual([]);
      s.clock.advance(1);
      await vi.waitFor(() => expect(team.status).toBe("closed"));
      expect(s.fake.base.shutdowns.sort()).toEqual([alice, bob].sort());
      expect(team.members.map((m) => m.status)).toEqual(["gone", "gone"]);
      expect(team.closeReason).toBe(actor === "user" ? "user" : "team_delete");
      const closedEvents = s.fake.base.emits.filter((e) => e.eventType === "agent-teams:team_closed");
      expect(closedEvents).toHaveLength(1);
      // the lead session itself is never shut down
      expect(s.fake.base.shutdowns).not.toContain(s.lead);
      expect(s.rt.store.findBySession(alice)).toBeUndefined();
    });
  }

  it("force delete with a spawn in flight aborts the spawn by its token and still closes the team", async () => {
    const s = setup();
    const team = await s.createTeam();
    await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "go" });
    const alice = s.rt.store.member(team, "alice");
    expect(alice?.status).toBe("spawning");
    expect(await s.fake.call(s.lead, "TeamDelete")).toMatchObject({ ok: false, error: "members_active" });
    expect(s.fake.abortedRuns).toEqual([]);
    expect(await s.fake.call(s.lead, "TeamDelete", { force: true })).toMatchObject({ ok: true });
    expect(s.fake.abortedRuns).toEqual([{ spawnToken: alice?.spawnToken }]);
    s.clock.advance(10_000);
    await vi.waitFor(() => expect(team.status).toBe("closed"));
    expect(alice?.status).toBe("gone");
  });

  it("a team with only released members closes immediately", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice");
    s.rt.ops.releaseMember(team, "alice", "gone", "x");
    expect(await s.fake.call(s.lead, "TeamDelete")).toMatchObject({ ok: true, data: { closed: true, shutdown: [] } });
    expect(team.status).toBe("closed");
  });

  it("requestShutdown by the server is `from server`, wakes the member and marks it shutdown_pending", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice");
    expect(s.rt.ops.requestShutdown(team, "ghost", { actor: "server" })).toMatchObject({ ok: false, error: "unknown_recipient" });
    expect(s.rt.ops.requestShutdown(team, "alice", { actor: "server" }).ok).toBe(true);
    expect(s.rt.store.member(team, "alice")?.status).toBe("shutdown_pending");
    expect(s.rt.store.pendingMail(team.id, "alice")[0]).toMatchObject({ from: "server", kind: "shutdown_request", wake: true });
    s.rt.ops.releaseMember(team, "alice", "gone", "x");
    expect(s.rt.ops.requestShutdown(team, "alice", { actor: "server" })).toMatchObject({ error: "member_gone" });
  });

  it("sendServerMail needs a registered kind and a live member; enqueueLeadNotice queues for the lead", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice");
    expect(s.rt.ops.sendServerMail(team, "alice", { kind: "plan_request_unregistered", text: "x", wake: true })).toMatchObject({ error: "invalid_args" });
    expect(s.rt.ops.sendServerMail(team, "nobody", { kind: "notice", text: "x", wake: true })).toMatchObject({ error: "unknown_recipient" });
    const sent = s.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "hi\u0007", wake: false });
    expect(sent.ok).toBe(true);
    expect(s.rt.store.pendingMail(team.id, "alice")[0]).toMatchObject({ from: "server", kind: "notice", text: "hi", wake: false });
    s.rt.ops.enqueueLeadNotice(team, { text: "hello lead", wake: true });
    expect(s.rt.store.pendingMail(team.id, "lead")[0]).toMatchObject({ from: "server", kind: "notice", wake: true });
    expect(s.flushes).toContainEqual([team.id, "alice"]);
  });

  it("abortMember aborts the run only: tasks stay in_progress, the member is not mailed, the lead gets one waking notice", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice", "busy");
    s.rt.store.addTask(team.id, { title: "a", description: "d", createdBy: "lead" });
    s.rt.store.patchTask(team.id, "1", { status: "in_progress", owner: "alice" });
    const res = s.rt.ops.abortMember(team, "alice", { actor: "user" });
    expect(res).toEqual({ ok: true, data: { member: "alice", aborted: true } });
    expect(s.fake.base.aborts).toEqual([alice]);
    expect(team.tasks[0]).toMatchObject({ status: "in_progress", owner: "alice" });
    expect(s.rt.store.mailLog(team.id).filter((m) => m.to === "alice")).toEqual([]);
    const leadMail = s.rt.store.mailLog(team.id).filter((m) => m.to === "lead");
    expect(leadMail).toHaveLength(1);
    expect(leadMail[0]).toMatchObject({ wake: true });
    expect(s.rt.store.member(team, "alice")?.status).toBe("busy");
    // the member later settles idle but still owns an in_progress task: the dispatcher skips it
    s.rt.store.patchMember(team.id, "alice", { status: "idle" });
    expect(s.rt.ops.isDispatchEligible(team, s.rt.store.member(team, "alice") as never)).toBe(false);
    s.rt.store.patchTask(team.id, "1", { status: "completed" });
    expect(s.rt.ops.isDispatchEligible(team, s.rt.store.member(team, "alice") as never)).toBe(true);
  });

  it("abortMember reports interrupt_unavailable when the driver cannot abort", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice", "busy");
    s.fake.base.sessions.delete("S-alice"); // host no longer connected
    expect(s.rt.ops.abortMember(team, "alice", { actor: "user" })).toMatchObject({ ok: false, error: "interrupt_unavailable" });
    expect(s.rt.store.mailLog(team.id)).toEqual([]);
  });
});

describe("member exit (releaseMember)", () => {
  it("releases in_progress tasks to pending unowned, unowns pending ones, discards queued mail, wakes the lead naming both", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice");
    for (const t of ["a", "b", "c"]) s.rt.store.addTask(team.id, { title: t, description: "d", createdBy: "lead", owner: "alice" });
    s.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    s.rt.store.patchTask(team.id, "3", { status: "completed" });
    s.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "queued", wake: false });
    const out = s.rt.ops.releaseMember(team, "alice", "gone", "session ended");
    expect(out).toEqual({ released: ["1"], unowned: ["2"] });
    expect(team.tasks.map((t) => [t.status, t.owner])).toEqual([["pending", undefined], ["pending", undefined], ["completed", "alice"]]);
    expect(s.rt.store.pendingMail(team.id, "alice")).toEqual([]);
    s.clock.advance(2000); // lifecycle notices are coalesced (design D9): one notice per window
    const notice = s.rt.store.pendingMail(team.id, "lead")[0];
    expect(notice).toMatchObject({ wake: true });
    expect(notice?.text).toContain("released to pending: 1");
    expect(notice?.text).toContain("unowned: 2");
    expect(s.rt.store.member(team, "alice")).toMatchObject({ status: "gone", goneReason: "session ended" });
  });

  it("onSessionEnded of a member marks it gone; of the lead orphans the team", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    s.fake.endSession(alice);
    expect(s.rt.store.member(team, "alice")?.status).toBe("gone");
    s.fake.endSession(s.lead);
    expect(team.status).toBe("orphaned");
  });
});

describe("orphaned teams (3.4 / 3.6)", () => {
  it("lead end → orphaned, members get a non-waking notice, sessions are left running", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.addMember(team.id, "alice");
    s.fake.endSession(s.lead);
    expect(team.status).toBe("orphaned");
    expect(team.leadConnected).toBe(false);
    expect(s.rt.store.pendingMail(team.id, "alice")[0]).toMatchObject({ kind: "notice", wake: false });
    expect(s.rt.store.pendingMail(team.id, "alice")[0]?.text).toMatch(/lead is gone/);
    expect(s.fake.base.shutdowns).toEqual([]);
    expect(s.fake.base.aborts).toEqual([]);
    expect(s.rt.ops.canDispatch(team)).toBe(false);
  });

  it("a lead hello before the TTL re-binds and returns the team to active", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.fake.endSession(s.lead);
    s.clock.advance(1_800_000 - 1);
    s.fake.addSession(s.lead, { cwd: "/work" });
    // The lead session was dropped from the index on end? No: it stays bound for re-bind by id.
    const hello = await s.fake.lane(s.lead, "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false });
    expect(hello).toMatchObject({ ok: true, data: { role: "lead", teamId: team.id } });
    expect(team.status).toBe("active");
    expect(team.leadConnected).toBe(true);
    expect(s.rt.ops.canDispatch(team)).toBe(true);
    s.clock.advance(10 * 60_000);
    expect(team.status).toBe("active"); // timer cancelled
    expect(s.flushes).toContainEqual([team.id, "lead"]);
  });

  it("the TTL closes the team with orphan_ttl and kills nothing; a hello exactly at the TTL does not re-bind", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    s.fake.endSession(s.lead);
    s.clock.advance(1_800_000);
    expect(team).toMatchObject({ status: "closed", closeReason: "orphan_ttl" });
    expect(s.fake.base.shutdowns).toEqual([]);
    expect(s.fake.base.aborts).toEqual([]);
    expect(s.rt.store.findBySession(alice)).toBeUndefined();

    // exact boundary through hello (timer disarmed so only the hello decides): elapsed === ttl → closed, not re-bound
    const s2 = setup();
    const t2 = await s2.createTeam();
    s2.fake.endSession(s2.lead);
    s2.rt.ops.dispose();
    s2.clock.advance(1_800_000);
    expect(t2.status).toBe("orphaned");
    s2.fake.addSession(s2.lead, { cwd: "/work" });
    const late = await s2.fake.lane(s2.lead, "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false });
    expect(late).toMatchObject({ ok: false, error: "not_in_team" });
    expect(t2).toMatchObject({ status: "closed", closeReason: "orphan_ttl" });
    expect(t2.leadConnected).toBe(false);
  });

  it("an orphaned team still serves team ops and queues lead mail", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    s.fake.endSession(s.lead);
    expect((await s.fake.call(alice, "TeamStatus")).data.team.status).toBe("orphaned");
    expect((await s.fake.call("S-alice", "TeamStatus")).ok).toBe(true);
    s.rt.ops.enqueueLeadNotice(team, { text: "alice finished", wake: true });
    expect(s.rt.store.pendingMail(team.id, "lead").some((m) => m.text === "alice finished")).toBe(true);
  });

  it("an orphaned team survives a restart: its TTL is re-armed from the original orphanedAt", async () => {
    const s = setup();
    const team = await s.createTeam();
    s.fake.endSession(s.lead);
    s.clock.advance(1_000_000);
    await s.rt.persistence.flush();
    const clock2 = s.clock;
    const fake2 = createFakeRuntimeHost({ dataDir: s.fake.dataDir });
    const rt2 = createTeamsRuntime(fake2.host, { clock: clock2, ext: createExtensionPoints() });
    expect(rt2.store.get(team.id)?.status).toBe("orphaned");
    clock2.advance(799_999);
    expect(rt2.store.get(team.id)?.status).toBe("orphaned");
    clock2.advance(1);
    expect(rt2.store.get(team.id)).toMatchObject({ status: "closed", closeReason: "orphan_ttl" });
  });
});

describe("old host without the request lane (S111-lane)", () => {
  it("logs once, reports the lane unavailable and does not throw", () => {
    const s = setup({ noLane: true });
    expect(s.rt.laneRegistered).toBe(false);
    expect(s.fake.logs.warn.filter((l) => l.includes("request lane unavailable"))).toHaveLength(1);
    expect(s.fake.registered.size).toBe(0);
  });
});

describe("ratified defaults (S143)", () => {
  it("defaults: autoDispatch true, orphanTtlMs 30 min, TeamStatus in lead and teammate sets, spawn spec has no hidden flag", async () => {
    const s = setup();
    const { loadConfigDefaults } = await import("../../__tests__/harness/index.js");
    const defaults = loadConfigDefaults();
    expect(defaults.autoDispatch).toBe(true);
    expect(defaults.orphanTtlMs).toBe(1_800_000);
    expect(TEAM_TOOLS_BY_ROLE.lead).toContain("TeamStatus");
    expect(TEAM_TOOLS_BY_ROLE.member).toContain("TeamStatus");
    const driver = createSessionDriver(s.fake.base.ctx);
    const out = await driver.spawn({
      teamId: "t",
      teamName: "alpha",
      member: "alice",
      spawnToken: "tok",
      spec: { cwd: "/work", noMcp: false, noContextFiles: false, promptFiles: ["/p/teammate.md"], env: { teamId: "t", member: "alice" } },
    });
    expect(out.ok).toBe(true);
    const opts = s.fake.base.spawns[0];
    expect(opts?.lifecycle).toEqual({ recover: false, finalizeOnSocketClose: false });
    expect(JSON.stringify(opts)).not.toMatch(/hidden|invisible/i);
    expect(opts?.initialPrompt).toBeUndefined();
    expect(opts?.pluginRef).toEqual({ "agent-teams": { teamId: "t", member: "alice", role: "member" } });
    expect(opts?.scope?.extensionConfig).toEqual({ "agent-teams": { teamId: "t", member: "alice" } });
    expect(opts?.name).toBe("alpha/alice");
  });
});

describe("session driver contract (2.9)", () => {
  it("deliver hands mails to the session over agent-teams:mail (false when unknown), abort/shutdown report outcomes, spawnLead uses a lead pluginRef", async () => {
    const s = setup();
    const driver = createSessionDriver(s.fake.base.ctx);
    const alice = s.fake.addSession("S-alice");
    const mail = { id: 1, from: "lead", to: "alice", kind: "message", text: "hi", priority: "normal" as const, wake: false, createdAt: 1 };
    expect(driver.deliver({ teamId: "t", member: "alice", sessionId: alice }, [mail], { wake: true })).toBe(true);
    expect(s.fake.base.emits.at(-1)).toMatchObject({ sessionId: alice, eventType: "agent-teams:mail", data: { mails: [{ id: 1, wake: true }] } });
    expect(driver.deliver({ teamId: "t", member: "alice", sessionId: "S-unknown" }, [mail], { wake: false })).toBe(false);
    expect(driver.deliver({ teamId: "t", member: "alice" }, [mail], { wake: false })).toBe(false);
    expect(driver.abort({ teamId: "t", member: "alice", sessionId: alice })).toEqual({ ok: true });
    expect(driver.abort({ teamId: "t", member: "alice", sessionId: "S-unknown" })).toMatchObject({ ok: false, reason: "not_connected" });
    expect(driver.abort({ teamId: "t", member: "alice" })).toMatchObject({ ok: false });
    expect(await driver.shutdown({ teamId: "t", member: "alice", sessionId: alice })).toBe(true);
    expect(await driver.shutdown({ teamId: "t", member: "alice" })).toBe(false);
    const team = await s.createTeam();
    const lead = await driver.spawnLead?.(team, { principalOwner: "P" });
    expect(lead?.ok).toBe(true);
    expect(s.fake.base.spawns.at(-1)?.pluginRef).toEqual({ "agent-teams": { teamId: team.id, role: "lead" }, principalOwner: "P" });
    expect(s.fake.base.spawns.at(-1)?.scope).toBeUndefined();
    s.fake.base.onSpawn(() => ({ success: false, message: "no" }));
    expect(await driver.spawnLead?.(team, {})).toEqual({ ok: false, message: "no" });
  });
});

describe("extension points (S57 partial, 2.10)", () => {
  const spec = () => ({ cwd: "/work", tools: ["read", "bash"], skills: ["/s/a"], noMcp: false, noContextFiles: false, promptFiles: ["/p/protocol.md"], env: { teamId: "t" } });
  const ctx = (logger = setup().fake.host.logger) => ({ team: {} as never, member: {} as never, logger });

  it("empty registries are inert: spec unchanged, no gates, everyone eligible, no visibility hook", () => {
    const ext = createExtensionPoints();
    expect(ext.spawnContributors).toEqual([]);
    expect(ext.gatesFor("TaskCreate")).toEqual([]);
    expect(ext.isEligible({} as never, {} as never)).toBe(true);
    expect(ext.routeVisibility).toBeUndefined();
    expect(applySpawnContributors(spec(), ext.spawnContributors, ctx())).toEqual(spec());
  });

  it("contributors only narrow tools/skills, append prompt files/env, and cannot change cwd (logged once)", () => {
    const warns: string[] = [];
    const logger = { info() {}, error() {}, warn: (m: string) => void warns.push(m) };
    const out = applySpawnContributors(
      spec(),
      [
        () => ({ tools: ["bash", "write"], cwd: "/evil", promptFiles: ["/p/extra.md"], env: { extra: "1" } }),
        () => ({ skills: [], cwd: "/evil2", env: { teamId: "override" } }),
        () => {
          throw new Error("bad contributor");
        },
      ],
      { ...ctx(logger), logger },
    );
    expect(out.cwd).toBe("/work");
    expect(out.tools).toEqual(["bash"]); // `write` would widen → dropped
    expect(out.skills).toEqual([]);
    expect(out.promptFiles).toEqual(["/p/protocol.md", "/p/extra.md"]);
    expect(out.env).toEqual({ teamId: "t", extra: "1" }); // existing env keys are not overridden
    expect(warns.filter((w) => w.includes("cwd"))).toHaveLength(1);
  });

  it("a contributor may restrict an unrestricted spec", () => {
    const out = applySpawnContributors({ ...spec(), tools: undefined as never }, [() => ({ tools: ["read"] })], ctx());
    expect(out.tools).toEqual(["read"]);
  });

  it("registration closes at the first lane request", async () => {
    const s = setup();
    s.rt.ext.registerOpGate("TaskCreate", () => undefined);
    await s.fake.call(s.lead, "TeamStatus");
    expect(s.rt.ext.sealed).toBe(true);
    expect(() => s.rt.ext.registerOpGate("TaskCreate", () => undefined)).toThrow(/before the first request/);
    expect(() => s.rt.ext.registerDispatchEligibility(() => true)).toThrow();
  });

  it("any dispatch eligibility returning false skips the member", () => {
    const ext = createExtensionPoints();
    ext.registerDispatchEligibility(() => true);
    ext.registerDispatchEligibility((_t, m) => m.name !== "held");
    expect(ext.isEligible({} as never, { name: "ok" } as never)).toBe(true);
    expect(ext.isEligible({} as never, { name: "held" } as never)).toBe(false);
  });

  it("op gates run in order under one shared budget; a veto, a throw or a hang blocks the op", async () => {
    const clock = new FakeClock();
    const team = {} as never;
    const input = { op: "TaskCreate", team, callerName: "lead", args: {} };
    expect(await runOpGates([], input, 1000, clock)).toBeUndefined();
    const order: string[] = [];
    const pass = (n: string) => () => void order.push(n);
    expect(await runOpGates([pass("a"), pass("b")], input, 1000, clock)).toBeUndefined();
    expect(order).toEqual(["a", "b"]);
    expect(await runOpGates([pass("c"), () => ({ block: true as const, feedback: "needs a plan" }), pass("never")], input, 1000, clock)).toEqual({ ok: false, error: "op_blocked", message: "needs a plan" });
    expect(order).not.toContain("never");
    expect(await runOpGates([() => Promise.reject(new Error("boom"))], input, 1000, clock)).toMatchObject({ ok: false, error: "op_blocked" });
    const hang = runOpGates([() => new Promise<undefined>(() => {})], input, 500, clock);
    clock.advance(500);
    expect(await hang).toMatchObject({ ok: false, error: "op_blocked", message: "op gate timed out" });
    // the budget is shared: two 300 ms gates inside a 500 ms budget exhaust it
    const slow = () => new Promise<undefined>((resolve) => clock.setTimeout(() => resolve(undefined), 300));
    const shared = runOpGates([slow, slow], input, 500, clock);
    clock.advance(300);
    await Promise.resolve();
    await Promise.resolve();
    clock.advance(200);
    expect(await shared).toMatchObject({ ok: false, error: "op_blocked" });
  });
});

describe("lane reports: hello / busy / idle / ack", () => {
  it("hello restores idle/busy from isIdle and keeps the session file; an unknown member is not_in_team", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    s.rt.store.patchMember(team.id, "alice", { status: "disconnected" });
    const report = (isIdle: boolean, extra: object = {}) => ({ isIdle, toolsActive: true, guardActive: true, confined: false, ...extra });
    expect(await s.fake.lane(alice, "agent-teams/hello", report(false, { sessionFile: "/s/a.jsonl" }))).toEqual({ ok: true, data: { role: "member", teamId: team.id, member: "alice" } });
    expect(s.rt.store.member(team, "alice")).toMatchObject({ status: "busy", sessionFile: "/s/a.jsonl", guardActive: true });
    await s.fake.lane(alice, "agent-teams/hello", report(true));
    expect(s.rt.store.member(team, "alice")?.status).toBe("idle");
    expect(await s.fake.lane("S-nobody", "agent-teams/hello", report(true))).toMatchObject({ ok: false, error: "not_in_team" });
    expect(await s.fake.lane(alice, "agent-teams/hello", { isIdle: "yes" })).toMatchObject({ error: "invalid_args" });
  });

  it("a guarded hello advances a spawning member to busy and flushes its spawn_prompt (the spawn flow owns that edge)", async () => {
    const s = setup();
    const team = await s.createTeam();
    await s.fake.call(s.lead, "TeammateSpawn", { name: "alice", prompt: "go" });
    s.rt.store.patchMember(team.id, "alice", { sessionId: "S-alice" });
    s.fake.addSession("S-alice");
    await s.fake.lane("S-alice", "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false });
    expect(s.rt.store.member(team, "alice")?.status).toBe("busy");
    expect(s.flushes).toContainEqual([team.id, "alice"]);
  });

  it("busy and idle reports move the member; a repeated or older settleId is ignored", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    expect(await s.fake.lane(alice, "agent-teams/busy", {})).toMatchObject({ ok: true });
    expect(s.rt.store.member(team, "alice")?.status).toBe("busy");
    expect(await s.fake.lane(alice, "agent-teams/idle", { settleId: 1, finalText: "done" })).toEqual({ ok: true, data: { ignored: false } });
    expect(s.rt.store.member(team, "alice")).toMatchObject({ status: "idle", lastSettleId: 1 });
    await s.fake.lane(alice, "agent-teams/busy", {});
    expect(await s.fake.lane(alice, "agent-teams/idle", { settleId: 1 })).toEqual({ ok: true, data: { ignored: true } });
    expect(s.rt.store.member(team, "alice")?.status).toBe("busy");
    expect(await s.fake.lane(alice, "agent-teams/idle", { settleId: "x" })).toMatchObject({ error: "invalid_args" });
    expect(await s.fake.lane(s.lead, "agent-teams/busy", {})).toMatchObject({ error: "not_in_team" });
  });

  it("ack acknowledges the caller's own mail only and is idempotent", async () => {
    const s = setup();
    const team = await s.createTeam();
    const alice = s.addMember(team.id, "alice");
    s.addMember(team.id, "bob");
    const mine = s.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text: "1" });
    const bobs = s.rt.store.appendMail(team.id, { from: "lead", to: "bob", kind: "message", text: "2" });
    const res = await s.fake.lane(alice, "agent-teams/ack", { ids: [mine?.id, bobs?.id, 99, "x"] });
    expect(res).toEqual({ ok: true, data: { acked: [mine?.id] } });
    expect(s.rt.store.pendingMail(team.id, "bob")).toHaveLength(1);
    expect(await s.fake.lane(alice, "agent-teams/ack", { ids: [mine?.id] })).toEqual({ ok: true, data: { acked: [] } });
    expect(await s.fake.lane(alice, "agent-teams/ack", { ids: "nope" })).toMatchObject({ error: "invalid_args" });
  });
});

describe("args helpers (2.7 / 2.12)", () => {
  it("own-property reads ignore the prototype chain; text is bounded in code points; raw oversize input is refused unscanned", async () => {
    const { own, textField, stringList } = await import("../args.js");
    const inherited = Object.create({ name: "from-proto" });
    expect(own(inherited, "name")).toBeUndefined();
    expect(textField("😀".repeat(40), 40)).toEqual({ ok: true, value: "😀".repeat(40) });
    expect(textField("😀".repeat(41), 40)).toEqual({ ok: false });
    expect(textField("x".repeat(81), 40)).toEqual({ ok: false });
    expect(textField("  a\u0007b  ", 40)).toEqual({ ok: true, value: "ab" });
    expect(textField("a\nb", 40, { multiline: true })).toEqual({ ok: true, value: "a\nb" });
    expect(textField("a\nb", 40)).toEqual({ ok: true, value: "ab" });
    expect(textField(undefined, 40, { required: true })).toEqual({ ok: false });
    expect(textField("   ", 40, { required: true })).toEqual({ ok: false });
    expect(textField(5, 40)).toEqual({ ok: false });
    expect(stringList(["a", "b"])).toEqual(["a", "b"]);
    expect(stringList(["a", ""])).toBe("invalid");
    expect(stringList("a")).toBe("invalid");
    expect(stringList(undefined)).toBeUndefined();
  });

  it("a message of 4000 emoji (8000 UTF-16 units) is accepted at maxMessageChars 8000; 8001 code points is not", async () => {
    const { textField } = await import("../args.js");
    expect(textField("😀".repeat(4000), 8000, { multiline: true }).ok).toBe(true);
    expect(textField("😀".repeat(8001), 8000, { multiline: true }).ok).toBe(false);
  });
});

// ── delivery, dispatch and notices across lead states (real mail engine) ───────

describe("lead exit: dispatch pauses and resumes (S39, dispatch half)", () => {
  it("an orphaned team dispatches nothing; a lead hello within the TTL re-binds and dispatch resumes", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    e.fake.endSession(e.lead);
    expect(team.status).toBe("orphaned");
    e.rt.store.addTask(team.id, { title: "waiting", description: "d", createdBy: "lead" });
    e.rt.ops.createTask(team, { title: "also waiting", description: "d" }, { actor: "server" });
    expect(team.tasks.filter((t) => t.status === "in_progress")).toEqual([]);
    e.clock.advance(1_800_000 - 1);
    e.fake.addSession(e.lead, { cwd: "/work" });
    expect(await e.hello("lead")).toMatchObject({ ok: true, data: { role: "lead" } });
    expect(team.status).toBe("active");
    expect(team.tasks.filter((t) => t.status === "in_progress")).toHaveLength(1);
  });
});

describe("orphan activity (S40)", () => {
  it("complete / SendMessage lead / TaskCreate all work while orphaned; notices and lead mail queue and flush on re-bind; only dispatch is paused", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    e.rt.store.addTask(team.id, { title: "mid-task", description: "d", createdBy: "lead", owner: "alice" });
    e.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    e.fake.endSession(e.lead);
    expect(team.status).toBe("orphaned");
    expect((await e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "done" })).ok).toBe(true);
    expect((await e.call("alice", "SendMessage", { to: "lead", message: "finished while you were away" })).ok).toBe(true);
    expect((await e.call("alice", "TaskCreate", { title: "follow-up", description: "d" })).ok).toBe(true);
    await e.idle("alice", { settleId: 1, finalText: "all done" });
    e.flushNotices();
    expect(team.tasks[0]).toMatchObject({ status: "completed", result: "done" });
    expect(team.tasks[1]?.owner).toBeUndefined(); // no dispatch while orphaned
    expect(e.wireMails("lead")).toEqual([]); // nothing is emitted to an absent lead
    const queued = e.rt.store.pendingMail(team.id, "lead");
    expect(queued.map((m) => m.kind)).toEqual(expect.arrayContaining(["message", "notice"]));

    e.fake.addSession(e.lead, { cwd: "/work" });
    await e.hello("lead");
    expect(e.wireMails("lead").map((m) => m.id).sort()).toEqual(queued.map((m) => m.id).sort());
    expect(team.tasks[1]).toMatchObject({ owner: "alice", status: "in_progress" }); // dispatch resumed with the re-bind
  });
});

describe("lead-bound-late team (S42)", () => {
  it("a starting team queues the idle notice and the dispatch, delivers once after bind and emits lead_bound", async () => {
    const e = createTeamsEnv();
    const created = e.rt.ops.createTeam({ name: "srv", leadCwd: "/repo", starting: true });
    if (!created.ok) throw new Error("create");
    const team = created.data;
    const seen: string[] = [];
    e.rt.store.on("lead_bound", () => seen.push("bound"));
    e.addMember(team, "alice", "busy");
    e.rt.ops.createTask(team, { title: "queued work", description: "d" }, { actor: "server" });
    await e.idle("alice", { settleId: 1, finalText: "hello from alice" });
    e.flushNotices();
    expect(team.tasks[0]?.owner).toBeUndefined(); // dispatch queued while starting
    const pending = e.rt.store.pendingMail(team.id, "lead");
    expect(pending).toHaveLength(1);
    expect(e.wireMails("lead")).toEqual([]);

    const leadSession = e.fake.addSession("S-srvlead", { cwd: "/repo", principalOwner: "P" });
    e.fake.resolveSession(leadSession, { "agent-teams": { teamId: team.id, role: "lead" }, principalOwner: "P" });
    expect(seen).toEqual(["bound"]);
    expect(e.fake.base.emits.filter((m) => m.sessionId === leadSession)).toHaveLength(1);
    const wire = e.fake.base.emits.filter((m) => m.sessionId === leadSession).flatMap((m) => (m.data as { mails: Array<{ id: number; kind: string }> }).mails);
    expect(wire.map((m) => m.id)).toEqual(pending.map((m) => m.id));
    expect(team.tasks[0]).toMatchObject({ owner: "alice", status: "in_progress" }); // dispatch ran once the lead bound
  });
});

describe("exit vs dispatch (S67)", () => {
  it("a session ending between the claim and the mail hand-over releases the task, discards the queued task_assigned, and a respawned same name does not receive it", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "bob", "idle");
    e.fake.base.sessions.delete(e.sid("bob")); // the hand-over cannot happen: the mail stays queued
    await e.call("lead", "TaskCreate", { title: "three", description: "d" });
    expect(team.tasks[0]).toMatchObject({ owner: "bob", status: "in_progress" });
    expect(e.rt.store.pendingMail(team.id, "bob").map((m) => m.kind)).toEqual(["task_assigned"]);
    e.fake.endSession(e.sid("bob"));
    expect(team.tasks[0]).toMatchObject({ status: "pending" });
    expect(team.tasks[0]?.owner).toBeUndefined();
    expect(e.rt.store.pendingMail(team.id, "bob")).toEqual([]);
    e.addMember(team, "bob", "idle", { spawnToken: "again" }); // a fresh member of the same name
    const discarded = e.log(team).find((m) => m.kind === "task_assigned")?.id;
    const from = e.fake.base.emits.length;
    await e.hello("bob");
    const after = e.fake.base.emits.slice(from).flatMap((m) => (m.data as { mails: Array<{ id: number; kind: string }> }).mails);
    expect(after.filter((m) => m.kind === "task_assigned")).toHaveLength(1); // only the fresh dispatch of the pending task
    expect(after.map((m) => m.id)).not.toContain(discarded);
    expect(e.mailsTo(team, "bob").filter((m) => m.kind === "task_assigned")).toHaveLength(2);
  });
});

describe("server actor ops (S56)", () => {
  const wakesWith = (e: ReturnType<typeof createTeamsEnv>, marker: string) => e.wireMails("lead").filter((m) => m.text.includes(marker) && m.wake).length;

  it("server mail is `from server`; the lead is woken only by a rejection or a timeout, never by an approval", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    for (const n of ["alice", "bob", "carol"]) e.addMember(team, n, "idle");

    // sendServerMail / enqueueLeadNotice: the wake flag decides
    expect(e.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "fyi-server", wake: false }).ok).toBe(true);
    e.rt.ops.enqueueLeadNotice(team, { text: "notice-quiet", wake: false });
    e.rt.ops.enqueueLeadNotice(team, { text: "notice-loud", wake: true });
    expect(e.mailsTo(team, "alice").find((m) => m.text === "fyi-server")).toMatchObject({ from: "server", kind: "notice", wake: false });
    expect(wakesWith(e, "notice-quiet")).toBe(0);
    expect(wakesWith(e, "notice-loud")).toBe(1);

    // approve: no wake
    expect(e.rt.ops.requestShutdown(team, "alice", { actor: "server" }).ok).toBe(true);
    expect(e.mailsTo(team, "alice").find((m) => m.kind === "shutdown_request")).toMatchObject({ from: "server", wake: true });
    expect(await e.call("alice", "ShutdownResponse", { approve: true })).toMatchObject({ ok: true, data: { approved: true } });
    await e.idle("alice", { settleId: 1, finalText: "bye" });
    await e.settle();
    e.flushNotices();
    expect(e.member(team, "alice").status).toBe("gone");
    expect(e.wireMails("lead").filter((m) => m.wake && m.text.includes("alice"))).toEqual([]);

    // reject: wakes the lead
    expect(e.rt.ops.requestShutdown(team, "bob", { actor: "server" }).ok).toBe(true);
    expect(await e.call("bob", "ShutdownResponse", { approve: false, reason: "mid-task" })).toMatchObject({ ok: true, data: { approved: false } });
    e.flushNotices();
    expect(e.wireMails("lead").filter((m) => m.wake && m.text.includes("bob rejected"))).toHaveLength(1);

    // timeout: wakes the lead once the grace passes unanswered
    expect(e.rt.ops.requestShutdown(team, "carol", { actor: "server" }).ok).toBe(true);
    e.flushNotices(10_000);
    e.flushNotices();
    expect(e.wireMails("lead").filter((m) => m.wake && m.text.includes("carol did not answer"))).toHaveLength(1);
    expect(e.member(team, "carol").status).toBe("idle");
  });

  it("the actor ops never widen what a lane caller may do, and refuse unknown members", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    e.addMember(team, "bob", "idle");
    expect(await e.call("alice", "ShutdownRequest", { to: "bob" })).toMatchObject({ ok: false, error: "not_lead" });
    expect(await e.call("alice", "SendMessage", { to: "bob", message: "x", kind: "shutdown_request" })).toMatchObject({ ok: false, error: "kind_reserved" });
    expect(e.rt.ops.requestShutdown(team, "ghost", { actor: "server" })).toMatchObject({ ok: false, error: "unknown_recipient" });
    expect(e.rt.ops.sendServerMail(team, "ghost", { kind: "notice", text: "x", wake: true })).toMatchObject({ ok: false, error: "unknown_recipient" });
    expect(e.mailsTo(team, "bob").filter((m) => m.from === "alice")).toEqual([]);
  });
});

describe("registries are inert, then bound by the server (S57)", () => {
  const golden = (e: ReturnType<typeof createTeamsEnv>, team: { id: string }) => {
    const sp = e.fake.base.spawns[0] as unknown as { cwd: string; name: string; scope: Record<string, unknown> & { appendSystemPrompt: string[] } };
    return {
      cwd: sp.cwd,
      name: sp.name,
      scopeKeys: Object.keys(sp.scope).sort(),
      extensionConfig: sp.scope.extensionConfig,
      noMcp: sp.scope.noMcp,
      noContextFiles: sp.scope.noContextFiles,
      prompts: sp.scope.appendSystemPrompt.map((p) => p.split("/").pop()),
      teamId: team.id,
    };
  };

  it("empty registries == the plain session flow (golden spawn spec)", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    await e.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    expect(golden(e, team)).toEqual({
      cwd: "/work",
      name: "alpha/alice",
      scopeKeys: ["appendSystemPrompt", "extensionConfig", "noContextFiles", "noMcp"],
      extensionConfig: { "agent-teams": { teamId: team.id, member: "alice", policy: '{"v":1,"blockSleepPolling":true,"blockGitWrite":true,"committer":"lead"}', committer: "lead" } },
      noMcp: false,
      noContextFiles: false,
      prompts: ["teammate.md"],
      teamId: team.id,
    });
  });

  it("registered hooks: tools are only narrowed, cwd is kept, eligibility skips a member, a gate vetoes an op", async () => {
    const ext = createExtensionPoints();
    ext.registerSpawnContributor(() => ({ tools: ["read", "write", "bash"], cwd: "/evil" }));
    ext.registerDispatchEligibility((_team, member) => member.name !== "alice");
    ext.registerOpGate("TaskCreate", ({ args }) => ((args as { title?: string }).title === "gated" ? { block: true, feedback: "needs a plan" } : undefined));
    const e = createTeamsEnv({ ext });
    const team = await e.createTeam();
    await e.call("lead", "TeammateSpawn", { name: "carol", prompt: "go", tools: ["read"] });
    const sp = e.fake.base.spawns[0] as unknown as { cwd: string; scope: { tools: string[] } };
    expect(sp.cwd).toBe("/work"); // the contributor's cwd is ignored
    expect(sp.scope.tools).toEqual(["read", "TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "SendMessage", "TeamStatus", "ShutdownResponse"]); // `write`/`bash` would widen
    expect(e.fake.logs.warn.filter((l) => l.includes("cwd")).length).toBeGreaterThan(0);

    e.addMember(team, "alice", "idle");
    e.addMember(team, "bob", "idle");
    expect(await e.call("lead", "TaskCreate", { title: "gated", description: "d" })).toMatchObject({ ok: false, error: "op_blocked", message: "needs a plan" });
    expect(team.tasks).toHaveLength(0);
    expect((await e.call("lead", "TaskCreate", { title: "open", description: "d" })).ok).toBe(true);
    expect(team.tasks[0]).toMatchObject({ status: "in_progress", owner: "bob" }); // alice is skipped by the hook
    expect(e.rt.ext.routeVisibility).toBeUndefined();
  });
});

describe("op gates on completion (S57, gate half)", () => {
  it("TaskUpdate{completed} awaits its gates (veto, throw and hang block it); other updates are not gated", async () => {
    const ext = createExtensionPoints();
    let mode: "veto" | "throw" | "hang" | "pass" = "veto";
    ext.registerOpGate("TaskUpdate", () => {
      if (mode === "veto") return { block: true, feedback: "tests first" };
      if (mode === "throw") throw new Error("gate crashed");
      if (mode === "hang") return new Promise<undefined>(() => {});
      return undefined;
    });
    const e = createTeamsEnv({ ext });
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    await e.call("lead", "TaskCreate", { title: "t", description: "d" });
    expect(team.tasks[0]).toMatchObject({ status: "in_progress", owner: "alice" });
    expect(await e.call("alice", "TaskUpdate", { id: "1", status: "completed" })).toMatchObject({ ok: false, error: "op_blocked", message: "tests first" });
    expect(team.tasks[0]?.status).toBe("in_progress");
    mode = "throw";
    expect(await e.call("alice", "TaskUpdate", { id: "1", status: "completed" })).toMatchObject({ ok: false, error: "op_blocked" });
    mode = "hang";
    const hung = e.call("alice", "TaskUpdate", { id: "1", status: "completed" });
    e.clock.advance(loadConfigDefaults().opGateBudgetMs as number);
    expect(await hung).toMatchObject({ ok: false, error: "op_blocked", message: "op gate timed out" });
    mode = "veto";
    expect((await e.call("alice", "TaskUpdate", { id: "1", note: "progress" })).ok).toBe(true); // not a completion: ungated
    mode = "pass";
    expect((await e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "ok" })).ok).toBe(true);
    expect(team.tasks[0]?.status).toBe("completed");
  });
});

describe("config changes limits at runtime (S58)", () => {
  it("team size, open tasks and message size follow the live config; per-team overrides win for autoDispatch", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.fake.base.setConfig({ maxTeammates: 3, maxTasks: 2, maxMessageChars: 10 });
    for (const n of ["a1", "a2", "a3"]) expect((await e.call("lead", "TeammateSpawn", { name: n, prompt: "go" })).ok, n).toBe(true);
    expect(await e.call("lead", "TeammateSpawn", { name: "a4", prompt: "go" })).toMatchObject({ ok: false, error: "team_full" });
    expect((await e.call("lead", "TaskCreate", { title: "t1", description: "d" })).ok).toBe(true);
    expect((await e.call("lead", "TaskCreate", { title: "t2", description: "d" })).ok).toBe(true);
    expect(await e.call("lead", "TaskCreate", { title: "t3", description: "d" })).toMatchObject({ ok: false, error: "task_cap_reached" });
    e.addMember(team, "bob", "busy");
    expect((await e.call("lead", "SendMessage", { to: "bob", message: "x".repeat(10) })).ok).toBe(true);
    expect(await e.call("lead", "SendMessage", { to: "bob", message: "x".repeat(11) })).toMatchObject({ ok: false, error: "message_too_long" });
    // no restart: raising the limit applies at once
    e.fake.base.setConfig({ maxTasks: 3 });
    expect((await e.call("lead", "TaskCreate", { title: "t3", description: "d" })).ok).toBe(true);
  });

  it("autoDispatch=false (changed at runtime) stops auto-claim; Team.overrides.autoDispatch wins over the config", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    await e.call("lead", "TaskCreate", { title: "auto", description: "d" });
    expect(team.tasks[0]).toMatchObject({ status: "in_progress", owner: "alice" });
    await e.call("alice", "TaskUpdate", { id: "1", status: "completed" });
    await e.idle("alice", { settleId: 1, finalText: "done" });
    e.fake.base.setConfig({ autoDispatch: false });
    await e.call("lead", "TaskCreate", { title: "manual", description: "d" });
    expect(team.tasks[1]).toMatchObject({ status: "pending" });
    expect(team.tasks[1]?.owner).toBeUndefined();
    e.rt.store.patchTeam(team.id, { overrides: { autoDispatch: true } }); // the per-team override wins
    await e.call("lead", "TaskCreate", { title: "override", description: "d" });
    expect(team.tasks.find((t) => t.title === "manual")?.status).toBe("in_progress");
  });
});

describe("store listener throws (S118)", () => {
  it("the completion commits, the op result is returned, and the listener error is logged once", async () => {
    const e = createTeamsEnv();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    e.rt.store.on("task_completed", () => {
      throw new Error("listener boom");
    });
    await e.call("lead", "TaskCreate", { title: "t", description: "d" });
    expect(team.tasks[0]).toMatchObject({ status: "in_progress", owner: "alice" });
    const res = await e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "ok" });
    expect(res).toMatchObject({ ok: true, data: { task: { id: "1", status: "completed" } } });
    expect(team.tasks[0]).toMatchObject({ status: "completed", result: "ok" });
    expect(e.fake.logs.error.filter((l) => l.includes("task_completed") && l.includes("listener boom"))).toHaveLength(1);
  });
});
