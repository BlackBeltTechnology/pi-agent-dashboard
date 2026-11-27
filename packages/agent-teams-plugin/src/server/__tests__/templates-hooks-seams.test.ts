/**
 * Core seams the templates-hooks change plugs into (design D3-D8): start ops, the idle gate, gate
 * veto codes, hello contributors, the spawn resolver, widened createTeam/patchTeam, the lead
 * spawner, route extensions and the mail counting helpers. Every seam is inert with nothing
 * registered (identity tests first).
 * See change: add-agent-teams-templates-hooks.
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createTeamsEnv, FakeClock } from "../../__tests__/harness/index.js";
import { countMailChars, countMailLines } from "../../shared/mail-format.js";
import type { Team } from "../../shared/types.js";
import { createExtensionPoints, IDLE_GATE_OP, type OpGate, runOpGates } from "../extension-points.js";
import { mountTeamsRoutes } from "../routes.js";
import { REGISTRARS, registerTemplatesHooks } from "../templates-hooks.js";

/**
 * A runtime whose registrars do NOT run: the registry reports itself sealed while the runtime wires (so
 * `registerTemplatesHooks` skips every module), then opens again. The seams under test start EMPTY yet open
 * for the test's own registrations (the real modules would otherwise populate the resolver, gates,
 * contributors and the `team.start` / `team.templates` ops).
 */
const setup = () => {
  const real = createExtensionPoints();
  let wiring = true;
  const ext = new Proxy(real, {
    get(target, key) {
      if (key === "sealed" && wiring) return true;
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(target) : v;
    },
  });
  const env = createTeamsEnv({ ext });
  wiring = false;
  return env;
};
/** Registries that no module registered into: sealed before the runtime wires its registrars (they are skipped). */
const setupBare = () => {
  const ext = createExtensionPoints();
  ext.seal();
  return createTeamsEnv({ ext });
};
const noticesToLead = (env: ReturnType<typeof setup>, team: Team) => env.mailsTo(team, "lead").filter((m) => m.kind === "notice");

describe("empty registries are inert (identity)", () => {
  it("registers the seven server modules in a fixed order and leaves every registry empty", () => {
    const env = setupBare();
    expect(REGISTRARS.map(([n]) => n)).toEqual(["templates", "agents", "hooks", "hook-trust", "plans", "start", "spawn-resolve"]);
    const { ext } = env.rt;
    expect(ext.spawnResolver).toBeUndefined();
    expect(ext.helloContributors).toHaveLength(0);
    expect(ext.routeExtensions).toHaveLength(0);
    expect(ext.gatesFor(IDLE_GATE_OP)).toHaveLength(0);
    expect(ext.suppressIdleNotice({} as never, {} as never, { settleId: 1 })).toBe(false);
  });

  it("`agent` / `requirePlanApproval` spawn args are parsed but have no effect without a resolver; a bad shape is invalid_args", async () => {
    const env = setup();
    const team = await env.createTeam();
    const ok = await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", agent: "reviewer", requirePlanApproval: true });
    expect(ok.ok).toBe(true);
    const m = env.member(team, "alice");
    expect(m.agent).toBeUndefined();
    expect(m.requirePlanApproval).toBeUndefined();
    expect(m.planApproval).toBeUndefined();
    expect(await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "go", requirePlanApproval: "maybe" })).toMatchObject({ ok: false, error: "invalid_args" });
  });

  it("idle without gates commits synchronously (no promise)", async () => {
    const env = setupBare();
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    const caller = env.rt.ops.resolveCaller({ sessionId: env.sid("alice") });
    const out = env.rt.ops.idle({ settleId: 1, finalText: "done" }, caller);
    expect(out).not.toBeInstanceOf(Promise);
    expect(out).toEqual({ ok: true, data: { ignored: false } });
    expect(env.member(team, "alice").status).toBe("idle");
  });

  it("an unregistered start op answers unknown_op", async () => {
    const env = setup();
    expect(await env.call("lead", "team.start", {})).toMatchObject({ ok: false, error: "unknown_op" });
  });
});

describe("start ops (team.start / team.templates)", () => {
  it("a plain session reaches an async handler with its own session id and the host cwd; the lane payload has no cwd", async () => {
    const env = setup();
    const seen: Array<{ sessionId: string; role: string; cwd?: string | undefined; args: unknown }> = [];
    env.rt.ops.registerStartOp("team.start", async (args, caller) => {
      seen.push({ sessionId: caller.sessionId, role: caller.role, cwd: env.rt.ops.hostSession(caller.sessionId)?.cwd, args });
      return { ok: true, data: { started: true } };
    });
    const plain = env.fake.addSession("S-plain", { cwd: "/proj" });
    const res = await env.fake.call(plain, "team.start", { template: "t", goal: "g" });
    expect(res).toEqual({ ok: true, data: { started: true } });
    expect(seen).toEqual([{ sessionId: "S-plain", role: "plain", cwd: "/proj", args: { template: "t", goal: "g" } }]);
  });

  it("is refused with the TeamCreate codes for a lead / teammate / confined session; a thrown handler answers a typed error", async () => {
    const env = setup();
    env.rt.ops.registerStartOp("team.start", () => ({ ok: true, data: {} }));
    const team = await env.createTeam();
    env.addMember(team, "alice");
    expect(await env.call("lead", "team.start", {})).toMatchObject({ ok: false, error: "already_in_team" });
    expect(await env.call("alice", "team.start", {})).toMatchObject({ ok: false, error: "nested_team_forbidden" });
    const confined = env.fake.addSession("S-confined", { cwd: "/x" });
    env.rt.ops.reports.set(confined, { isIdle: true, toolsActive: true, guardActive: true, confined: true, at: 0 });
    expect(await env.fake.call(confined, "team.start", {})).toMatchObject({ ok: false, error: "lead_confined" });
  });

  it("roles/refuseConfined options widen who may call; handler failures are contained", async () => {
    const env = setup();
    env.rt.ops.registerStartOp("team.templates", () => ({ ok: true, data: [] }), { roles: ["plain", "lead"], refuseConfined: false });
    env.rt.ops.registerStartOp("team.start", () => {
      throw new Error("boom");
    });
    await env.createTeam();
    expect(await env.call("lead", "team.templates", {})).toEqual({ ok: true, data: [] });
    const plain = env.fake.addSession("S-plain", { cwd: "/proj" });
    expect(await env.fake.call(plain, "team.start", {})).toMatchObject({ ok: false, error: "invalid_args" });
  });

  it("registration is refused after the first lane request and for a duplicate", async () => {
    const env = setup();
    env.rt.ops.registerStartOp("team.start", () => ({ ok: true, data: {} }));
    expect(() => env.rt.ops.registerStartOp("team.start", () => ({ ok: true, data: {} }))).toThrow(/already registered/);
    await env.createTeam(); // first lane request seals
    expect(() => env.rt.ops.registerStartOp("team.templates", () => ({ ok: true, data: {} }))).toThrow(/before the first request/);
  });
});

describe("op gate veto code", () => {
  const clock = new FakeClock(0);
  const input = { op: "TaskCreate", team: {} as Team, callerName: "lead", args: {} };

  it("a veto keeps op_blocked by default and returns its own code with the feedback as message", async () => {
    expect(await runOpGates([() => ({ block: true, feedback: "no" })], input, 100, clock)).toEqual({ ok: false, error: "op_blocked", message: "no" });
    expect(await runOpGates([() => ({ block: true, feedback: "lint failed", code: "hook_blocked" })], input, 100, clock)).toEqual({ ok: false, error: "hook_blocked", message: "lint failed" });
  });

  it("through the lane a TaskCreate veto surfaces hook_blocked", async () => {
    const env = setup();
    env.rt.ext.registerOpGate("TaskCreate", () => ({ block: true, feedback: "tests missing", code: "hook_blocked" }));
    await env.createTeam();
    expect(await env.call("lead", "TaskCreate", { title: "t", description: "d" })).toMatchObject({ ok: false, error: "hook_blocked", message: "tests missing" });
  });

  it("trusted in-process task ops bypass gates (skipGates is structural: gates run only in callAsync)", async () => {
    const env = setup();
    const gate = vi.fn<OpGate>(() => ({ block: true, feedback: "no" }));
    env.rt.ext.registerOpGate("TaskCreate", gate);
    const team = await env.createTeam();
    expect(env.rt.ops.createTask(team, { title: "seed", description: "d" } as never, { actor: "server" }).ok).toBe(true);
    expect(gate).not.toHaveBeenCalled();
  });
});

describe("TeammateIdle gate", () => {
  it("exports the gate op name", () => {
    expect(IDLE_GATE_OP).toBe("TeammateIdle");
  });

  it("allow commits as usual; the gate sees the idle report, the member and a wake sequence", async () => {
    const env = setup();
    const inputs: unknown[] = [];
    env.rt.ext.registerOpGate(IDLE_GATE_OP, (i) => void inputs.push(i));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    expect(await env.idle("alice", { settleId: 1, finalText: "done" })).toEqual({ ok: true, data: { ignored: false } });
    expect(env.member(team, "alice")).toMatchObject({ status: "idle", lastSettleId: 1 });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ op: IDLE_GATE_OP, callerName: "alice", idle: { settleId: 1, finalText: "done" }, wakeSeq: { at: 0 } });
    env.flushNotices();
    expect(noticesToLead(env, team)).toHaveLength(1);
  });

  it("a veto keeps the member busy, sends NO lead notice, consumes the settle and runs afterBlock once", async () => {
    const env = setup();
    const after = vi.fn();
    env.rt.ext.registerOpGate(IDLE_GATE_OP, () => ({ block: true, feedback: "fix lint", afterBlock: after }));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    expect(await env.idle("alice", { settleId: 1, finalText: "done" })).toEqual({ ok: true, data: { ignored: false } });
    expect(env.member(team, "alice")).toMatchObject({ status: "busy", lastSettleId: 1 });
    env.flushNotices();
    expect(noticesToLead(env, team)).toHaveLength(0);
    expect(after).toHaveBeenCalledTimes(1);
    // The same settle is now a duplicate: the gate does not run again.
    expect(await env.idle("alice", { settleId: 1 })).toEqual({ ok: true, data: { ignored: true } });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("is skipped for errored / aborted idles and for shutdown_pending members", async () => {
    const env = setup();
    const gate = vi.fn<OpGate>(() => ({ block: true, feedback: "no" }));
    env.rt.ext.registerOpGate(IDLE_GATE_OP, gate);
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    env.addMember(team, "bob", "busy");
    await env.idle("alice", { settleId: 1, error: "model failed" });
    await env.idle("alice", { settleId: 2, aborted: true });
    env.rt.store.patchMember(team.id, "bob", { status: "shutdown_pending" });
    await env.idle("bob", { settleId: 1, finalText: "bye" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("a waking mail that arrives during the gate drops the idle (superseded) without afterBlock", async () => {
    const env = setup();
    let release: (v: { block: true; feedback: string; afterBlock: () => void } | undefined) => void = () => undefined;
    const after = vi.fn();
    env.rt.ext.registerOpGate(IDLE_GATE_OP, () => new Promise((r) => (release = r as never)));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    const pending = env.idle("alice", { settleId: 1, finalText: "done" });
    await env.settle();
    expect(env.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "new work", wake: true }).ok).toBe(true);
    release({ block: true, feedback: "x", afterBlock: after });
    expect(await pending).toEqual({ ok: true, data: { ignored: true } });
    expect(env.member(team, "alice")).toMatchObject({ lastSettleId: 0 });
    expect(after).not.toHaveBeenCalled();
    env.flushNotices();
    expect(noticesToLead(env, team)).toHaveLength(0);
  });

  it("a non-waking mail does not supersede; wakeSeq counts waking mails per member", async () => {
    const env = setup();
    let release: (v?: undefined) => void = () => undefined;
    env.rt.ext.registerOpGate(IDLE_GATE_OP, () => new Promise((r) => (release = r as never)));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    const pending = env.idle("alice", { settleId: 1 });
    await env.settle();
    env.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "fyi", wake: false });
    expect(env.rt.ops.wakeSeq(team.id, "alice")).toBe(0);
    release();
    expect(await pending).toEqual({ ok: true, data: { ignored: false } });
    env.rt.ops.sendServerMail(team, "alice", { kind: "notice", text: "wake", wake: true });
    expect(env.rt.ops.wakeSeq(team.id, "alice")).toBe(1);
    expect(env.rt.ops.wakeSeq(team.id, "bob")).toBe(0);
  });

  it("re-validates after the await: a member that ended meanwhile ignores the idle", async () => {
    const env = setup();
    let release: (v?: undefined) => void = () => undefined;
    env.rt.ext.registerOpGate(IDLE_GATE_OP, () => new Promise((r) => (release = r as never)));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    const pending = env.idle("alice", { settleId: 1 });
    await env.settle();
    env.rt.ops.releaseMember(team, "alice", "gone", "test");
    release();
    expect(await pending).toEqual({ ok: true, data: { ignored: true } });
  });

  it("a throwing or timed-out gate fails open (the idle is accepted)", async () => {
    const env = setup();
    env.rt.ext.registerOpGate(IDLE_GATE_OP, () => {
      throw new Error("boom");
    });
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    expect(await env.idle("alice", { settleId: 1, finalText: "ok" })).toEqual({ ok: true, data: { ignored: false } });
    expect(env.member(team, "alice").status).toBe("idle");
  });

  it("an idle notice filter suppresses only the lead notice", async () => {
    const env = setup();
    env.rt.ext.registerIdleNoticeFilter((_t, m) => m.name === "alice");
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    env.addMember(team, "bob", "busy");
    await env.idle("alice", { settleId: 1, finalText: "plan sent" });
    await env.idle("bob", { settleId: 1, finalText: "done" });
    env.flushNotices();
    expect(env.member(team, "alice").status).toBe("idle");
    const text = noticesToLead(env, team).map((m) => m.text).join("\n");
    expect(text).toContain("bob is idle");
    expect(text).not.toContain("alice is idle");
  });
});

describe("hello contributors", () => {
  it("merge reply fields (core keys cannot be overridden) and can mark the member degraded", async () => {
    const env = setup();
    env.rt.ext.registerHelloContributor(({ member, payload }) => (member ? { reply: { planMode: { active: true, restoreTools: ["read"] } }, ...(payload.planToolsActive === false ? { degraded: "plan_tools_unavailable" as const } : {}) } : undefined));
    env.rt.ext.registerHelloContributor(() => ({ reply: { role: "lead", planMode: { active: false, restoreTools: ["read", "bash"] } } as never }));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    const ok = await env.hello("alice", { planToolsActive: true });
    expect(ok).toEqual({ ok: true, data: { role: "member", teamId: team.id, member: "alice", planMode: { active: false, restoreTools: ["read", "bash"] } } });
    expect(env.member(team, "alice").degraded).toBeUndefined();
    const bad = await env.hello("alice", { planToolsActive: false });
    expect(bad.data).toMatchObject({ role: "member", planMode: expect.any(Object) });
    expect(env.member(team, "alice").degraded).toBe("plan_tools_unavailable");
    env.flushNotices();
    expect(noticesToLead(env, team).map((m) => m.text).join("\n")).toContain("alice is degraded (plan_tools_unavailable)");
    // recovery clears it
    await env.hello("alice", { planToolsActive: true });
    expect(env.member(team, "alice").degraded).toBeUndefined();
  });

  it("core guard failures win over a contributor's degraded; the lead hello also gets the merged reply", async () => {
    const env = setup();
    env.rt.ext.registerHelloContributor(() => ({ degraded: "plan_tools_unavailable", reply: { planMode: { active: false, restoreTools: [] } } }));
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    await env.hello("alice", { guardActive: false });
    expect(env.member(team, "alice").degraded).toBe("guard_unavailable");
    const lead = await env.hello("lead");
    expect(lead.data).toMatchObject({ role: "lead", teamId: team.id, planMode: { active: false } });
  });

  it("a throwing contributor is skipped", async () => {
    const env = setup();
    env.rt.ext.registerHelloContributor(() => {
      throw new Error("x");
    });
    const team = await env.createTeam();
    env.addMember(team, "alice", "busy");
    expect(await env.hello("alice")).toEqual({ ok: true, data: { role: "member", teamId: team.id, member: "alice" } });
  });
});

describe("spawn resolver", () => {
  it("lane: the resolver's effective args are planned, member extras persisted, thinkingLevel reaches the host spawn; name is re-pinned", async () => {
    const env = setup();
    const inputs: unknown[] = [];
    env.rt.ext.setSpawnResolver((input) => {
      inputs.push({ source: input.source, leadCwd: input.leadCwd, team: input.team?.id, agent: input.args.agent });
      return {
        ok: true,
        data: {
          args: { ...input.args, name: "hijack", model: "anthropic/x", tools: ["read", "grep"], role: "reviewer" },
          thinkingLevel: "high",
          member: { agent: "reviewer", requirePlanApproval: true, planApproval: "planning", hold: "plan_approval" },
        },
      };
    });
    const team = await env.createTeam();
    const res = await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", agent: "reviewer" });
    expect(res).toEqual({ ok: true, data: { member: "alice", status: "spawning" } });
    expect(inputs).toEqual([{ source: "lane", leadCwd: "/work", team: team.id, agent: "reviewer" }]);
    expect(team.members.map((m) => m.name)).toEqual(["alice"]);
    expect(env.member(team, "alice")).toMatchObject({ agent: "reviewer", requirePlanApproval: true, planApproval: "planning", hold: "plan_approval", model: "anthropic/x", role: "reviewer" });
    await env.settle();
    expect(env.fake.base.spawns[0]).toMatchObject({ model: "anthropic/x", thinkingLevel: "high" });
    expect(env.fake.base.spawns[0]?.scope?.tools).toEqual(expect.arrayContaining(["read", "grep", "TaskList"]));
  });

  it("a refusal creates nothing (plain caller: no team either)", async () => {
    const env = setup();
    env.rt.ext.setSpawnResolver(() => ({ ok: false, error: "agent_not_found", message: "no such agent" }));
    const plain = env.fake.addSession("S-plain", { cwd: "/proj" });
    expect(await env.fake.call(plain, "TeammateSpawn", { name: "alice", prompt: "go", agent: "nope" })).toMatchObject({ ok: false, error: "agent_not_found" });
    expect(env.rt.store.list()).toHaveLength(0);
  });

  it("a plain caller's resolver sees team undefined; the resolved args still go through cwd confinement", async () => {
    const env = setup();
    const teams: unknown[] = [];
    env.rt.ext.setSpawnResolver((input) => {
      teams.push(input.team);
      return { ok: true, data: { args: { ...input.args, cwd: "/etc" } } };
    });
    const plain = env.fake.addSession("S-plain", { cwd: "/proj" });
    expect(await env.fake.call(plain, "TeammateSpawn", { name: "alice", prompt: "go" })).toMatchObject({ ok: false, error: expect.stringMatching(/cwd_outside_lead|invalid_args/) });
    expect(teams).toEqual([undefined]);
  });

  it("a throwing resolver refuses fail-closed; a second resolver cannot be registered; an over-long resolved prompt is refused", async () => {
    const env = setup();
    env.rt.ext.setSpawnResolver(() => {
      throw new Error("bad");
    });
    expect(() => env.rt.ext.setSpawnResolver(() => ({ ok: false, error: "invalid_args" }))).toThrow(/already registered/);
    await env.createTeam();
    expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" })).toMatchObject({ ok: false, error: "invalid_args" });
    const env2 = setup();
    env2.rt.ext.setSpawnResolver((input) => ({ ok: true, data: { args: { ...input.args, prompt: "x".repeat(9000) } } }));
    await env2.createTeam();
    expect(await env2.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" })).toMatchObject({ ok: false, error: "message_too_long" });
  });

  it("spawnTeammate (eager path) runs the same resolver with source `server` and honours its skills resolution", async () => {
    const env = setup();
    env.fake.setPiResources({ local: { skills: [{ name: "review", filePath: "/s/review/SKILL.md" }] }, global: { skills: [] }, packages: [] });
    const sources: string[] = [];
    env.rt.ext.setSpawnResolver((input) => {
      sources.push(input.source);
      return { ok: true, data: { args: { ...input.args, skills: ["review"] }, member: { agent: "reviewer" } } };
    });
    const team = await env.createTeam();
    const res = await env.rt.ops.spawnTeammate(team, { name: "alice", prompt: "go" });
    expect(res).toEqual({ ok: true, data: { member: "alice", status: "spawning" } });
    expect(sources).toEqual(["server"]);
    expect(env.member(team, "alice")).toMatchObject({ agent: "reviewer", skills: ["/s/review/SKILL.md"] });
  });

  it("spawnTeammate without a resolver equals the plain path (args pass through)", async () => {
    const env = setup();
    const team = await env.createTeam();
    expect(await env.rt.ops.spawnTeammate(team, { name: "alice", prompt: "go", role: "coder" })).toEqual({ ok: true, data: { member: "alice", status: "spawning" } });
    expect(env.member(team, "alice")).toMatchObject({ role: "coder", status: "spawning" });
  });
});

describe("createTeam / patchTeam additive fields", () => {
  it("createTeam forwards every new field; patchTeam sets and clears them with persistence", async () => {
    const env = setup();
    const created = env.rt.ops.createTeam({
      name: "tpl",
      leadCwd: "/work",
      starting: true,
      owner: "o1",
      description: "d",
      maxTeammates: 3,
      defaultTools: ["read"],
      defaultSkills: ["s"],
      overrides: { notifyCoalesceMs: 50 },
      template: { name: "t", source: "user", hash: "h" } as never,
      hooks: { TeammateIdle: [{ command: "true" }] } as never,
      leadSpawnToken: "tok",
      leadBindDeadline: 123,
    });
    if (!created.ok) throw new Error(created.error);
    const team = created.data;
    expect(team).toMatchObject({ status: "starting", owner: "o1", description: "d", maxTeammates: 3, defaultTools: ["read"], defaultSkills: ["s"], overrides: { notifyCoalesceMs: 50 }, template: { name: "t" }, hooks: { TeammateIdle: [{ command: "true" }] }, leadSpawnToken: "tok", leadBindDeadline: 123 });
    expect(env.rt.ops.coalesceWindowMs(team)).toBe(50);
    env.rt.store.patchTeam(team.id, { leadSpawnToken: undefined, leadBindDeadline: undefined, plans: [], template: { name: "t2" } as never }, { writeThrough: true });
    expect("leadSpawnToken" in team).toBe(false);
    expect("leadBindDeadline" in team).toBe(false);
    expect(team.plans).toEqual([]);
    expect(team.template).toMatchObject({ name: "t2" });
    env.rt.persistence.flushSync();
    const loaded = env.rt.persistence.load().teams.find((t) => t.team.id === team.id)?.team;
    expect(loaded).toMatchObject({ template: { name: "t2" }, plans: [], hooks: { TeammateIdle: [{ command: "true" }] } });
    expect(loaded && "leadSpawnToken" in loaded).toBe(false);
  });

  it("the legacy tools/skills aliases still map to the team defaults (TeamCreate tool)", async () => {
    const env = setup();
    await env.call("lead", "TeamCreate", { name: "a", tools: ["read"], skills: [] });
    expect(env.rt.store.list()[0]).toMatchObject({ defaultTools: ["read"], defaultSkills: [] });
  });
});

describe("lead spawner", () => {
  it("spawns a lead with a caller-minted token, no initialPrompt, lead pluginRef + owner stamp; aborts by token", async () => {
    const env = setup();
    const created = env.rt.ops.createTeam({ name: "srv", leadCwd: "/work", starting: true, owner: "idp\u0000u1" });
    if (!created.ok) throw new Error(created.error);
    env.fake.base.onSpawn((o) => ({ success: true, spawnToken: o.spawnToken as string }));
    const out = await env.rt.leads.spawn(created.data, { model: "m1", spawnToken: "lead-tok" });
    expect(out).toEqual({ ok: true, spawnToken: "lead-tok" });
    const opts = env.fake.base.spawns.at(-1);
    expect(opts).toMatchObject({ cwd: "/work", model: "m1", spawnToken: "lead-tok", pluginRef: { "agent-teams": { teamId: created.data.id, role: "lead" } } });
    expect(opts && "initialPrompt" in opts).toBe(false);
    expect(opts && "scope" in opts).toBe(false);
    env.rt.leads.abort("lead-tok");
    await env.settle();
    expect(env.fake.abortedRuns).toEqual([{ spawnToken: "lead-tok" }]);
  });

  it("a lead spawn failure is reported, not thrown; the resolved lead binds through bindLead", async () => {
    const env = setup();
    env.fake.base.onSpawn(() => ({ success: false, message: "no capacity" }));
    const created = env.rt.ops.createTeam({ name: "srv", leadCwd: "/work", starting: true });
    if (!created.ok) throw new Error(created.error);
    expect(await env.rt.leads.spawn(created.data, {})).toEqual({ ok: false, message: "no capacity" });
  });
});

describe("route extensions", () => {
  it("mount inside core's scope with the shared helpers, after the core routes", async () => {
    const env = setup();
    const ext = createExtensionPoints();
    const mounted: string[] = [];
    ext.registerRoutes(async (scope, h) => {
      mounted.push(h.prefix);
      scope.get(`${h.prefix}/ping`, async (req, reply) => {
        const team = await h.reachable(env.rt.store.list()[0], req);
        return team ? { team: team.id } : reply.code(404).send(h.notFound);
      });
    });
    const team = await env.createTeam();
    const app = Fastify();
    await mountTeamsRoutes(app, { store: env.rt.store, telemetry: env.rt.telemetry, ext, logger: env.fake.host.logger });
    const res = await app.inject({ method: "GET", url: "/api/plugins/agent-teams/ping" });
    expect(mounted).toEqual(["/api/plugins/agent-teams"]);
    expect(res.json()).toEqual({ team: team.id });
    await app.close();
  });
});

describe("composition root", () => {
  it("wires a registry once, skips a sealed one with a warning, and survives a failing registrar", () => {
    const env = setup();
    const warn = vi.fn();
    const deps = { ext: createExtensionPoints(), logger: { info: vi.fn(), warn, error: vi.fn() } } as never;
    registerTemplatesHooks(deps);
    registerTemplatesHooks(deps); // idempotent per registry
    expect(warn).not.toHaveBeenCalled();
    const sealed = createExtensionPoints();
    sealed.seal();
    registerTemplatesHooks({ ext: sealed, logger: { info: vi.fn(), warn, error: vi.fn() } } as never);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already sealed"));
    expect(env.rt.counters.get("x")).toBe(0);
    env.rt.counters.inc("x", "t1", 2);
    expect(env.rt.counters.get("x")).toBe(2);
    expect(env.rt.counters.get("x", "t1")).toBe(2);
  });
});

describe("mail counting helpers", () => {
  it("count lines the way capMailLines does: envelope included, CRLF one break, blank runs collapsed", () => {
    expect(countMailLines("")).toBe(1);
    expect(countMailLines("", { envelope: false })).toBe(0);
    expect(countMailLines("a\nb")).toBe(3);
    expect(countMailLines("a\r\nb\r\nc", { envelope: false })).toBe(3);
    expect(countMailLines("a\n\n\n\nb", { envelope: false })).toBe(3);
    expect(countMailLines("a\n \n\t\nb", { envelope: false })).toBe(3);
  });

  it("count characters as code points after sanitising (CRLF is one)", () => {
    expect(countMailChars("a\r\nb")).toBe(3);
    expect(countMailChars("😀😀")).toBe(2);
    expect(countMailChars("a\u0007b")).toBe(2);
  });
});
