/**
 * Spawn resolver over the full runtime + fake host (tasks 4.3–4.8, 6.2; tests 11.11–11.15, 11.24, 11.30, 11.46,
 * 11.49; test-plan #E14 #E15 #E16 #E17 #E18 #E40 #X14 #S11 #P5): template cap, 4-source precedence, tool/skill
 * ceilings, plan floor, prompt files + team tools, atomic prompt writes, privilege floor and cost scope.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import { PLAN_HOLD } from "../../shared/plan-mode.js";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import type { Member, PlanApprovalPolicy, Team, TeamTemplateSnapshot, TemplateMember } from "../../shared/types.js";
import { promptDirFor } from "../agent-prompts.js";
import { buildPlanMemberToolList, planPolicyFor } from "../plan-policy.js";
import { md } from "./template-env.js";

const MEMBER_TOOLS = TEAM_TOOLS_BY_ROLE.member as readonly string[];
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface Opts {
  trusted?: boolean;
  config?: Record<string, unknown>;
}

/** Real lead dir + pi agent dir; the lead session's cwd is the lead dir (project agents live below it). */
function setup(opts: Opts = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-sr-")));
  made.push(root);
  const leadDir = path.join(root, "lead");
  const agentDir = path.join(root, "pi-agent");
  fs.mkdirSync(leadDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  const env = createTeamsEnv({ ...(opts.config ? { config: opts.config } : {}), runtime: { templatesHost: { resolvePiAgentDir: () => agentDir, isProjectTrusted: () => opts.trusted ?? true } } });
  env.fake.sessions.set(env.lead, { cwd: leadDir, principalOwner: { iss: "idp", sub: "u1" } as never });
  const agent = (name: string, front: Record<string, unknown>, body = "", source: "project" | "user" = "user"): void => {
    const dir = source === "project" ? path.join(leadDir, ".pi", "agents") : path.join(agentDir, "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), md(front, body));
  };
  const rawAgent = (name: string, text: string): void => {
    fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "agents", `${name}.md`), text);
  };
  return { env, root, leadDir, agentDir, agent, rawAgent };
}

/** `spawn: "lead"` by default: the start phase (C1b) must not eager-spawn the roster behind these tests; the tests spawn by hand. */
const snap = (over: Partial<TeamTemplateSnapshot> = {}): TeamTemplateSnapshot => ({ name: "t", source: "user", hash: "h", goal: "fix login", playbook: "pb", members: [], spawn: "lead", ...over });

/** A team led by the lead session, with a persisted template snapshot (what `team.start` writes). */
async function teamWith(env: TeamsEnv, template?: Partial<TeamTemplateSnapshot>): Promise<Team> {
  const team = await env.createTeam();
  if (template) env.rt.store.patchTeam(team.id, { template: snap(template) });
  return team;
}

type Scope = { tools?: string[]; skills?: string[]; appendSystemPrompt?: string[]; extensionConfig: Record<string, Record<string, string>> };
const spawnAt = (env: TeamsEnv, i = 0) => env.fake.base.spawns[i] as { cwd?: string; model?: string; thinkingLevel?: string; scope: Scope; initialPrompt?: unknown } | undefined;
const spawn = (env: TeamsEnv, name: string, extra: Record<string, unknown> = {}) => env.call("lead", "TeammateSpawn", { name, prompt: `work as ${name}`, ...extra });
/** Spawn, then release the member so the same template member name can be spawned again in one team. */
async function spawnOnce(env: TeamsEnv, team: Team, name: string, extra: Record<string, unknown> = {}) {
  const res = await spawn(env, name, extra);
  if (res.ok) env.rt.store.patchMember(team.id, name, { status: "gone" });
  return res;
}
const tm = (name: string, extra: Partial<TemplateMember> = {}): TemplateMember => ({ name, ...extra });
const withTeamTools = (xs: string[]): string[] => [...new Set([...xs, ...MEMBER_TOOLS])];
const skill = (n: string) => ({ name: n, filePath: `/skills/${n}/SKILL.md` });

describe("template maxTeammates caps roster + lead-spawned members (11.11, #E14)", () => {
  it("template cap 3 under config 5: roster of 2 + 1 extra ok, the 4th total is team_full and leaves no member or session", async () => {
    const { env } = setup({ config: { maxTeammates: 5 } });
    const team = await teamWith(env, { maxTeammates: 3, spawn: "lead", members: [tm("rev-1"), tm("rev-2")] });
    expect(team.maxTeammates).toBeGreaterThanOrEqual(5);
    expect((await spawn(env, "rev-1")).ok).toBe(true);
    expect((await spawn(env, "rev-2")).ok).toBe(true);
    expect((await spawn(env, "noop")).ok).toBe(true);
    const spawnsBefore = env.fake.base.spawns.length;
    const refused = await spawn(env, "x");
    expect(refused).toMatchObject({ ok: false, error: "team_full" });
    expect(team.members.map((m) => m.name)).toEqual(["rev-1", "rev-2", "noop"]);
    expect(env.fake.base.spawns).toHaveLength(spawnsBefore);
    expect(env.rt.store.mailLog(team.id).some((m) => m.to === "x")).toBe(false);
  });

  it("the eager in-process path hits the same cap; a released member frees a slot; name_taken is not masked", async () => {
    const { env } = setup();
    const team = await teamWith(env, { maxTeammates: 2 });
    expect((await env.rt.ops.spawnTeammate(team, { name: "a", prompt: "go" })).ok).toBe(true);
    expect((await env.rt.ops.spawnTeammate(team, { name: "b", prompt: "go" })).ok).toBe(true);
    expect(await env.rt.ops.spawnTeammate(team, { name: "c", prompt: "go" })).toMatchObject({ ok: false, error: "team_full" });
    expect(await env.rt.ops.spawnTeammate(team, { name: "a", prompt: "again" })).toMatchObject({ ok: false, error: "name_taken" });
    env.rt.store.patchMember(team.id, "a", { status: "gone" });
    expect((await env.rt.ops.spawnTeammate(team, { name: "c", prompt: "go" })).ok).toBe(true);
  });
});

describe("precedence resolver, first defined wins (11.12, #E15)", () => {
  it("model: spawn arg > template member > agent > team default; absent everywhere = host default", async () => {
    const { env, agent } = setup();
    agent("Fast", { model: "@fast" });
    const team = await teamWith(env, { defaultModel: "@default", members: [tm("m-all", { agent: "Fast", model: "@member" }), tm("m-agent", { agent: "Fast" }), tm("m-plain")] });
    const models = async (name: string, extra: Record<string, unknown> = {}) => {
      const before = env.fake.base.spawns.length;
      expect((await spawnOnce(env, team, name, extra)).ok).toBe(true);
      return spawnAt(env, before)?.model;
    };
    expect(await models("m-all", { model: "@arg" })).toBe("@arg");
    expect(await models("m-all")).toBe("@member");
    expect(await models("m-agent")).toBe("@fast");
    expect(await models("m-plain")).toBe("@default");
    expect(team.members).toHaveLength(3);
    expect(env.fake.base.spawns).toHaveLength(4);

    const bare = setup();
    await bare.env.createTeam();
    expect((await spawn(bare.env, "x")).ok).toBe(true);
    expect(spawnAt(bare.env)?.model).toBeUndefined();
  });

  it("tools: spawn arg > template member > agent > defaultTools; unrestricted without any", async () => {
    const { env, agent } = setup();
    agent("Reader", { tools: ["read", "bash"] });
    const team = await teamWith(env, { defaultTools: ["read", "grep", "bash"], members: [tm("m-agent", { agent: "Reader" }), tm("m-own", { agent: "Reader", tools: ["read"] }), tm("m-default")] });
    const toolsOf = async (name: string, extra: Record<string, unknown> = {}) => {
      const before = env.fake.base.spawns.length;
      expect((await spawnOnce(env, team, name, extra)).ok).toBe(true);
      return spawnAt(env, before)?.scope.tools;
    };
    expect(await toolsOf("m-agent", { tools: ["grep"] })).toEqual(withTeamTools(["grep"]));
    expect(await toolsOf("m-own")).toEqual(withTeamTools(["read"]));
    expect(await toolsOf("m-agent")).toEqual(withTeamTools(["read", "bash"]));
    expect(await toolsOf("m-default")).toEqual(withTeamTools(["read", "grep", "bash"]));
    const bare = setup();
    await bare.env.createTeam();
    await spawn(bare.env, "x");
    expect(spawnAt(bare.env)?.scope).not.toHaveProperty("tools");
  });

  it("skills: spawn arg > template member > defaultSkills; an agent `skills` key is ignored", async () => {
    const { env, agent } = setup();
    env.fake.setPiResources({ local: { skills: [skill("a"), skill("b"), skill("c")] }, global: { skills: [] }, packages: [] });
    agent("Sk", { skills: ["c"], tools: ["read"] });
    const team = await teamWith(env, { defaultSkills: ["a", "b"], members: [tm("m-own", { skills: ["a", "c"] }), tm("m-default"), tm("m-agent", { agent: "Sk" })] });
    const skillsOf = async (name: string, extra: Record<string, unknown> = {}) => {
      const before = env.fake.base.spawns.length;
      const res = await spawnOnce(env, team, name, extra);
      expect(res.ok).toBe(true);
      return spawnAt(env, before)?.scope.skills;
    };
    expect(await skillsOf("m-own", { skills: ["c"] })).toEqual(["/skills/c/SKILL.md"]);
    expect(await skillsOf("m-own")).toEqual(["/skills/a/SKILL.md", "/skills/c/SKILL.md"]);
    expect(await skillsOf("m-default")).toEqual(["/skills/a/SKILL.md", "/skills/b/SKILL.md"]);
    expect(await skillsOf("m-agent")).toEqual(["/skills/a/SKILL.md", "/skills/b/SKILL.md"]);
  });

  it("thinkingLevel is agent-only: `high` reaches the host spawn, `ludicrous` is ignored with a warning and the spawn proceeds", async () => {
    const { env, agent } = setup();
    agent("Deep", { thinking: "high" });
    agent("Odd", { thinking: "ludicrous" });
    await env.createTeam();
    expect((await spawn(env, "deep", { agent: "Deep" })).ok).toBe(true);
    expect(spawnAt(env, 0)?.thinkingLevel).toBe("high");
    expect((await spawn(env, "odd", { agent: "Odd" })).ok).toBe(true);
    expect(spawnAt(env, 1)).toBeDefined();
    expect(spawnAt(env, 1)?.thinkingLevel).toBeUndefined();
    expect(env.fake.logs.warn.some((l) => l.includes("Odd") && l.includes("ludicrous"))).toBe(true);
    expect((await spawn(env, "plain")).ok).toBe(true);
    expect(spawnAt(env, 2)?.thinkingLevel).toBeUndefined();
  });

  it("cwd: spawn arg > template member > lead cwd, always through core confinement", async () => {
    const { env, leadDir } = setup();
    fs.mkdirSync(path.join(leadDir, "a"));
    fs.mkdirSync(path.join(leadDir, "b"));
    const team = await teamWith(env, { members: [tm("m-cwd", { cwd: "a" }), tm("m-out", { cwd: "../../outside" }), tm("m-none")] });
    expect((await spawnOnce(env, team, "m-cwd", { cwd: "b" })).ok).toBe(true);
    expect(spawnAt(env, 0)?.cwd).toBe(path.join(leadDir, "b"));
    expect((await spawnOnce(env, team, "m-cwd")).ok).toBe(true);
    expect(spawnAt(env, 1)?.cwd).toBe(path.join(leadDir, "a"));
    expect((await spawn(env, "m-none")).ok).toBe(true);
    expect(spawnAt(env, 2)?.cwd).toBe(leadDir);
    expect(await spawn(env, "m-out")).toMatchObject({ ok: false, error: "cwd_outside_lead" });
  });

  it("agent role: description is the default role, the agent name when absent; a spawn role wins", async () => {
    const { env, agent } = setup();
    agent("Doc", { description: "Reviews things" });
    agent("Bare", {});
    const team = await env.createTeam();
    await spawn(env, "a", { agent: "Doc" });
    await spawn(env, "b", { agent: "Bare" });
    await spawn(env, "c", { agent: "Doc", role: "mine" });
    expect(team.members.map((m) => m.role)).toEqual(["Reviews things", "Bare", "mine"]);
    expect(team.members.map((m) => m.agent)).toEqual(["Doc", "Bare", "Doc"]);
  });
});

describe("agent resolution errors refuse the spawn before anything is created", () => {
  it("agent_not_found / agent_invalid / agent_untrusted; an untrusted project file falls through to the user file", async () => {
    const { env, agent } = setup({ trusted: false });
    const team = await env.createTeam();
    expect(await spawn(env, "a", { agent: "Ghost" })).toMatchObject({ ok: false, error: "agent_not_found" });
    expect(await spawn(env, "a", { agent: "../../x" })).toMatchObject({ ok: false, error: "agent_invalid" });
    expect(await spawn(env, "a", { agent: "x".repeat(65) })).toMatchObject({ ok: false, error: "agent_invalid" });
    expect(await spawn(env, "a", { agent: "" })).toMatchObject({ ok: false, error: "agent_invalid" });
    agent("Audit", { description: "project" }, "", "project");
    expect(await spawn(env, "a", { agent: "Audit" })).toMatchObject({ ok: false, error: "agent_untrusted" });
    agent("Audit", { description: "user" }, "", "user");
    expect(await spawn(env, "a", { agent: "Audit" })).toMatchObject({ ok: true });
    expect(team.members.map((m) => [m.name, m.role])).toEqual([["a", "user"]]);
    expect(env.fake.base.spawns).toHaveLength(1);
  });

  it("tools as a comma string is agent_invalid (never widened to all tools); the eager path returns the same code", async () => {
    const { env, rawAgent } = setup();
    rawAgent("Comma", "---\ntools: read, bash\n---\nbody\n");
    const team = await env.createTeam();
    expect(await spawn(env, "a", { agent: "Comma" })).toMatchObject({ ok: false, error: "agent_invalid" });
    expect(await env.rt.ops.spawnTeammate(team, { name: "b", prompt: "go", agent: "Comma" }, { source: "server" })).toMatchObject({ ok: false, error: "agent_invalid" });
    expect(team.members).toHaveLength(0);
    expect(env.fake.base.spawns).toHaveLength(0);
  });

  it("a template member's agent is resolved for a spawn that names only the member (spawn: lead)", async () => {
    const { env, agent } = setup();
    agent("Explore", { model: "@fast", tools: ["read", "grep"] });
    await teamWith(env, { members: [tm("scout", { agent: "Explore" })] });
    expect((await spawn(env, "scout")).ok).toBe(true);
    expect(spawnAt(env)).toMatchObject({ model: "@fast", scope: { tools: withTeamTools(["read", "grep"]) } });
    const team2 = await teamWith(setup().env, { members: [tm("scout", { agent: "Missing" })] });
    expect(team2.members).toHaveLength(0);
  });
});

describe("tools ceiling intersection (11.13, #E16)", () => {
  async function run(lead: string[] | undefined) {
    const { env } = setup();
    await teamWith(env, { members: [tm("m", { tools: ["read", "grep"] })] });
    const res = await spawn(env, "m", lead ? { tools: lead } : {});
    return { res, scope: spawnAt(env)?.scope };
  }

  it("(read) narrows; (grep,read) ok; (read,bash) and () are tools_outside_template; undefined takes the template list", async () => {
    expect((await run(["read"])).scope?.tools).toEqual(withTeamTools(["read"]));
    expect((await run(["grep", "read"])).scope?.tools).toEqual(withTeamTools(["grep", "read"]));
    for (const bad of [["read", "bash"], []]) {
      const r = await run(bad);
      expect(r.res).toMatchObject({ ok: false, error: "tools_outside_template" });
      expect(r.scope).toBeUndefined();
    }
    expect((await run(undefined)).scope?.tools).toEqual(withTeamTools(["read", "grep"]));
  });

  it("team tools in the lead list are always allowed; a team default (defaultTools) is a ceiling too", async () => {
    const { env } = setup();
    await teamWith(env, { defaultTools: ["read"] });
    expect((await spawn(env, "a", { tools: ["read", "TaskList"] })).ok).toBe(true);
    expect(await spawn(env, "b", { tools: ["bash"] })).toMatchObject({ ok: false, error: "tools_outside_template" });
  });

  it("no template declaration ⇒ core behaviour unchanged (any list, no team-tool rewrite by the resolver)", async () => {
    const { env } = setup();
    await teamWith(env, { members: [tm("other")] });
    expect((await spawn(env, "free", { tools: ["bash", "edit"] })).ok).toBe(true);
    expect(spawnAt(env)?.scope.tools).toEqual(withTeamTools(["bash", "edit"]));
    const noTpl = setup();
    await noTpl.env.createTeam();
    expect((await spawn(noTpl.env, "free", { tools: ["bash"] })).ok).toBe(true);
  });
});

describe("a declared empty list is a ceiling of nothing (11.14, #E17)", () => {
  it("defaultSkills [] refuses lead skills:[a]; member tools [] refuses tools:[read] and spawns with team tools only", async () => {
    const { env } = setup();
    env.fake.setPiResources({ local: { skills: [skill("a")] }, global: { skills: [] }, packages: [] });
    await teamWith(env, { defaultSkills: [], members: [tm("m", { tools: [] })] });
    expect(await spawn(env, "m", { skills: ["a"] })).toMatchObject({ ok: false, error: "skills_outside_template" });
    expect(await spawn(env, "m", { tools: ["read"] })).toMatchObject({ ok: false, error: "tools_outside_template" });
    expect(env.fake.base.spawns).toHaveLength(0);
    expect((await spawn(env, "m", { tools: [] })).ok).toBe(true);
    expect(spawnAt(env)?.scope.tools).toEqual([...MEMBER_TOOLS]);
    expect(spawnAt(env)?.scope.skills).toEqual([]);
  });

  it("a declared skills list is a ceiling: outside → skills_outside_template, narrowing ok", async () => {
    const { env } = setup();
    env.fake.setPiResources({ local: { skills: [skill("a"), skill("b")] }, global: { skills: [] }, packages: [] });
    await teamWith(env, { members: [tm("m", { skills: ["a"] })] });
    expect(await spawn(env, "m", { skills: ["a", "b"] })).toMatchObject({ ok: false, error: "skills_outside_template" });
    expect((await spawn(env, "m", { skills: ["a"] })).ok).toBe(true);
  });
});

describe("plan floor false < true < \"user\" (11.15, #E18)", () => {
  const POLICIES: Array<PlanApprovalPolicy | undefined> = [undefined, false, true, "user"];
  const rank = (p: PlanApprovalPolicy | undefined): number => (p === "user" ? 2 : p === true ? 1 : 0);

  async function combo(tp: PlanApprovalPolicy | undefined, arg: PlanApprovalPolicy | undefined): Promise<{ ok: boolean; member: Member }> {
    const { env } = setup();
    const team = await teamWith(env, { members: [tm("m", tp === undefined ? {} : { requirePlanApproval: tp })] });
    const res = await spawn(env, "m", arg === undefined ? {} : { requirePlanApproval: arg });
    return { ok: res.ok, member: env.member(team, "m") };
  }

  it("16 combos: resolved = max(template member, spawn arg); an arg never relaxes; absent+absent = false", async () => {
    for (const tp of POLICIES) {
      for (const arg of POLICIES) {
        const label = `tpl=${String(tp)} arg=${String(arg)}`;
        const { ok, member } = await combo(tp, arg);
        const want = Math.max(rank(tp), rank(arg));
        expect(ok, label).toBe(true);
        expect(planPolicyFor(member), label).toBe(want === 2 ? "user" : want === 1);
        expect(member.planApproval, label).toBe(want > 0 ? "planning" : undefined);
      }
    }
  });

  it("the template top-level policy is the team default for members without their own; a member's own value wins over it", async () => {
    const { env } = setup();
    const team = await teamWith(env, { requirePlanApproval: "user", members: [tm("dflt"), tm("own", { requirePlanApproval: false })] });
    await spawn(env, "dflt", { requirePlanApproval: false });
    await spawn(env, "own");
    expect(planPolicyFor(env.member(team, "dflt"))).toBe("user");
    expect(planPolicyFor(env.member(team, "own"))).toBe(false);
  });

  it("a plan-mode member persists planning + hold and gets an explicit tool list incl. planModeTools and team tools", async () => {
    const { env } = setup();
    const team = await teamWith(env, { members: [tm("p", { requirePlanApproval: true })] });
    expect((await spawn(env, "p")).ok).toBe(true);
    const member = env.member(team, "p");
    expect(member).toMatchObject({ planApproval: "planning", hold: PLAN_HOLD, requirePlanApproval: true });
    const scope = spawnAt(env)?.scope as Scope;
    expect(scope.tools).toEqual(expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls", ...MEMBER_TOOLS]));
    expect(scope.extensionConfig["agent-teams"]).toMatchObject({ planMode: "1" });
    expect(scope.tools).toEqual(buildPlanMemberToolList(undefined, { planModeTools: ["read", "grep", "find", "ls"] }, MEMBER_TOOLS));
  });

  it("resuming a member that was approved keeps it approved (no hold, no plan tool list); a resumed planning member stays in plan mode", async () => {
    const { env } = setup();
    const team = await teamWith(env, { members: [tm("p", { requirePlanApproval: true }), tm("q", { requirePlanApproval: true })] });
    await spawn(env, "p");
    await spawn(env, "q");
    for (const n of ["p", "q"]) env.rt.store.patchMember(team.id, n, { status: "disconnected", sessionFile: `/s/${n}.jsonl` });
    env.rt.store.patchMember(team.id, "p", { planApproval: "approved", hold: undefined });
    expect((await spawn(env, "p", { resume: true })).ok).toBe(true);
    expect((await spawn(env, "q", { resume: true, requirePlanApproval: false })).ok).toBe(true);
    expect(env.member(team, "p")).toMatchObject({ planApproval: "approved", requirePlanApproval: true });
    expect(env.member(team, "p").hold).toBeUndefined();
    expect(env.member(team, "q")).toMatchObject({ planApproval: "planning", hold: PLAN_HOLD });
  });
});

describe("prompt files + team tools survive (11.24, #E40)", () => {
  async function agentTeam() {
    const s = setup();
    s.agent("Audit", { description: "Security auditor", tools: ["read"], inherit_context: true }, "You audit code. Be strict.");
    const team = await teamWith(s.env, { goal: "fix login", members: [tm("sec", { agent: "Audit", prompt: "Focus on auth." }), tm("plain", { prompt: "Only the member prompt." }), tm("noprompt")] });
    return { ...s, team };
  }

  it("promptFiles = protocol, agent, member (in that order); contents are the agent prompt and the member prompt", async () => {
    const { env, team } = await agentTeam();
    expect((await spawn(env, "sec")).ok).toBe(true);
    const files = spawnAt(env)?.scope.appendSystemPrompt as string[];
    expect(files).toHaveLength(3);
    expect(path.basename(files[0] as string)).toMatch(/^teammate/);
    expect(files[1]).toBe(path.join(promptDirFor(env.fake.dataDir, team.id), "sec.agent.md"));
    expect(files[2]).toBe(path.join(promptDirFor(env.fake.dataDir, team.id), "sec.member.md"));
    expect(fs.readFileSync(files[1] as string, "utf8")).toBe("You audit code. Be strict.");
    expect(fs.readFileSync(files[2] as string, "utf8")).toBe("Focus on auth.");
    expect((await spawn(env, "plain")).ok).toBe(true);
    const plain = spawnAt(env, 1)?.scope.appendSystemPrompt as string[];
    expect(plain.map((f) => path.basename(f)).slice(1)).toEqual(["plain.member.md"]);
    expect((await spawn(env, "noprompt")).ok).toBe(true);
    expect(spawnAt(env, 2)?.scope.appendSystemPrompt).toHaveLength(1);
  });

  it("agent tools:(read) + team tools (TaskList, SendMessage, PlanSubmit; never PlanDecision); the lead keeps PlanDecision", async () => {
    const { env } = await agentTeam();
    await spawn(env, "sec");
    const tools = spawnAt(env)?.scope.tools as string[];
    expect(tools.filter((t) => !MEMBER_TOOLS.includes(t))).toEqual(["read"]);
    for (const t of ["TaskList", "SendMessage", "PlanSubmit"]) expect(tools).toContain(t);
    expect(tools).not.toContain("PlanDecision");
    expect(TEAM_TOOLS_BY_ROLE.lead).toContain("PlanDecision");
    expect(TEAM_TOOLS_BY_ROLE.member).not.toContain("PlanDecision");
  });

  it("inherit_context is ignored: the first spawn_prompt carries the goal given by the spawn, no lead history, no initialPrompt", async () => {
    const { env, team } = await agentTeam();
    await env.rt.ops.spawnTeammate(team, { name: "sec", prompt: "Goal: fix login. Review the auth module." }, { source: "server" });
    const first = env.rt.store.mailLog(team.id).find((m) => m.to === "sec" && m.kind === "spawn_prompt");
    expect(first?.text).toContain("fix login");
    expect(first?.text).not.toMatch(/inherit|conversation|history/i);
    expect(spawnAt(env)).not.toHaveProperty("initialPrompt");
    expect(env.member(team, "sec").agent).toBe("Audit");
  });

  it("a bare agent file (no description, no prompt, empty body): role = name, empty prompt file, the spawn proceeds", async () => {
    const s = setup();
    s.agent("Bare", {}, "");
    const team = await s.env.createTeam();
    expect((await spawn(s.env, "b", { agent: "Bare" })).ok).toBe(true);
    const files = spawnAt(s.env)?.scope.appendSystemPrompt as string[];
    expect(fs.readFileSync(files[1] as string, "utf8")).toBe("");
    expect(s.env.member(team, "b").role).toBe("Bare");
  });

  it("the agent `prompt:` key beats the markdown body", async () => {
    const s = setup();
    s.agent("P", { prompt: "from key" }, "from body");
    await s.env.createTeam();
    await spawn(s.env, "p", { agent: "P" });
    const files = spawnAt(s.env)?.scope.appendSystemPrompt as string[];
    expect(fs.readFileSync(files[1] as string, "utf8")).toBe("from key");
  });
});

describe("eager roster through the start phase uses the same resolver (11.24 eager half)", () => {
  it("an eager member gets its agent definition, prompt files and goal prompt; a member whose agent is missing is refused without a session", async () => {
    const s = setup();
    s.agent("Audit", { description: "Security auditor", tools: ["read"], model: "@research" }, "You audit code.");
    const team = await teamWith(s.env, { spawn: "eager", goal: "fix login", members: [tm("sec", { agent: "Audit", prompt: "Focus on auth." }), tm("ghost", { agent: "Missing" })] });
    for (let i = 0; i < 10 && s.env.fake.base.spawns.length === 0; i++) await s.env.settle();
    await s.env.settle();
    expect(s.env.fake.base.spawns).toHaveLength(1);
    const first = spawnAt(s.env);
    expect(first).toMatchObject({ model: "@research", scope: { tools: withTeamTools(["read"]) } });
    expect(first?.scope.appendSystemPrompt).toHaveLength(3);
    expect(first).not.toHaveProperty("initialPrompt");
    expect(s.env.rt.store.mailLog(team.id).find((m) => m.to === "sec" && m.kind === "spawn_prompt")?.text).toContain("fix login");
    expect(s.env.member(team, "sec").agent).toBe("Audit");
    expect(team.members.find((m) => m.name === "ghost")?.status).not.toBe("spawning");
  });
});

describe("prompt-file write failure (11.30, #X14)", () => {
  it("member 2 of 3: that member fails with a code, others proceed, no half-written file, temp absent; dir is 0700", async () => {
    const s = setup();
    s.agent("Role", {}, "role prompt");
    const team = await teamWith(s.env, { members: [tm("m-1", { agent: "Role" }), tm("m-2", { agent: "Role" }), tm("m-3", { agent: "Role" })] });
    const dir = promptDirFor(s.env.fake.dataDir, team.id);
    const eager = async (n: string) => expect((await s.env.rt.ops.spawnTeammate(team, { name: n, prompt: "go" }, { source: "server" })).ok).toBe(true);
    await eager("m-1"); // creates the team's prompt dir
    // A directory squats on member 2's target: the rename cannot succeed.
    fs.mkdirSync(path.join(dir, "m-2.agent.md"));
    await eager("m-2");
    await eager("m-3");
    await s.env.settle();
    expect(s.env.member(team, "m-1").status).toBe("spawning");
    expect(s.env.member(team, "m-3").status).toBe("spawning");
    const failed = s.env.member(team, "m-2");
    expect(failed.status).toBe("failed");
    expect(failed.goneReason).toMatch(/prompt_file_unwritable/);
    expect(s.env.fake.base.spawns.map((x) => (x as { name?: string }).name)).toEqual(["alpha/m-1", "alpha/m-3"]);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(path.join(dir, "m-1.agent.md"), "utf8")).toBe("role prompt");
  });

  it("an unusable prompts root (a file) fails the spawn with the code and writes nothing", async () => {
    const s = setup();
    s.agent("Role", {}, "role prompt");
    fs.writeFileSync(path.join(s.env.fake.dataDir, "prompts"), "not a dir");
    const team = await s.env.createTeam();
    expect((await spawn(s.env, "a", { agent: "Role" })).ok).toBe(true);
    await s.env.settle();
    expect(s.env.member(team, "a")).toMatchObject({ status: "failed" });
    expect(s.env.member(team, "a").goneReason).toMatch(/prompt_file_unwritable/);
    expect(s.env.fake.base.spawns).toHaveLength(0);
  });
});

describe("closed-team retention also prunes the prompt dir (4.8)", () => {
  it("at start the prompt dirs of teams that no longer exist are removed; known teams are kept", async () => {
    const s = setup();
    const team = await s.env.createTeam();
    const keep = promptDirFor(s.env.fake.dataDir, team.id);
    const gone = promptDirFor(s.env.fake.dataDir, "t_gone0001");
    fs.mkdirSync(keep, { recursive: true });
    fs.mkdirSync(gone, { recursive: true });
    fs.writeFileSync(path.join(gone, "a.agent.md"), "x");
    s.env.rt.persistence.flushSync();
    s.env.rt.dispose();
    createTeamsEnv({ dataDir: s.env.fake.dataDir });
    expect(fs.existsSync(gone)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
  });
});

describe("privilege floor and ceiling with an injected lead (11.46, #S11)", () => {
  it("floor holds, tools beyond ceiling, cwd escapes and a path-like agent name are all refused; agent tools are NOT a ceiling", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "at-out-"));
    made.push(outside);
    const { env, agent } = setup();
    agent("Audit", { tools: ["read", "bash", "edit"] }, "audit");
    const team = await teamWith(env, { members: [tm("sec", { requirePlanApproval: "user", tools: ["read", "grep"] })] });
    expect((await spawn(env, "sec", { requirePlanApproval: false })).ok).toBe(true);
    expect(planPolicyFor(env.member(team, "sec"))).toBe("user");
    // The ceiling belongs to the named template member: another name is not bound by it.
    expect(await spawn(env, "sec2", { tools: ["bash"] })).toMatchObject({ ok: true });
    expect(await spawn(env, "other", { cwd: "/etc" })).toMatchObject({ ok: false, error: "cwd_outside_lead" });
    expect(await spawn(env, "other", { cwd: outside })).toMatchObject({ ok: false, error: "cwd_outside_lead" });
    expect(await spawn(env, "other", { agent: "../../x" })).toMatchObject({ ok: false, error: "agent_invalid" });
    // agent-def tools are a default, not a ceiling: no template declaration ⇒ the lead may pass a wider list.
    const open = setup();
    open.agent("Audit", { tools: ["read"] }, "audit");
    await open.env.createTeam();
    expect((await spawn(open.env, "wide", { agent: "Audit", tools: ["read", "bash", "edit"] })).ok).toBe(true);
    expect(spawnAt(open.env)?.scope.tools).toEqual(withTeamTools(["read", "bash", "edit"]));
  });

  it("a ceiling refusal for the named template member (tools beyond ceiling) is tools_outside_template", async () => {
    const { env } = setup();
    await teamWith(env, { members: [tm("sec", { requirePlanApproval: "user", tools: ["read", "grep"] })] });
    expect(await spawn(env, "sec", { tools: ["bash"] })).toMatchObject({ ok: false, error: "tools_outside_template" });
  });

  it("cwd outside extraCwdRoots stays refused when a root is configured; inside the root it is accepted", async () => {
    const extra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-extra-")));
    made.push(extra);
    const { env } = setup({ config: { extraCwdRoots: [extra] } });
    await env.createTeam();
    expect((await spawn(env, "in", { cwd: extra })).ok).toBe(true);
    expect(await spawn(env, "out", { cwd: path.dirname(extra) })).toMatchObject({ ok: false, error: "cwd_outside_lead" });
  });
});

describe("cost: teammate scope (11.49, #P5)", () => {
  it("agent member tools:(read), plan member list ⊆ resolved ∪ planModeTools ∪ team tools, default member unrestricted; no inherited history", async () => {
    const s = setup();
    s.agent("Reader", { tools: ["read"] }, "read only");
    const team = await teamWith(s.env, { playbook: "P".repeat(500), members: [tm("typed", { agent: "Reader" }), tm("planner", { agent: "Reader", requirePlanApproval: true }), tm("dflt")] });
    for (const n of ["typed", "planner", "dflt"]) expect((await spawn(s.env, n)).ok).toBe(true);
    const [typed, planner, dflt] = [0, 1, 2].map((i) => spawnAt(s.env, i)?.scope);
    expect(typed?.tools).toEqual(withTeamTools(["read"]));
    const allowed = new Set<string>(["read", "read", "grep", "find", "ls", ...MEMBER_TOOLS]);
    expect(planner?.tools?.every((t) => allowed.has(t))).toBe(true);
    expect(planner?.tools).toEqual(expect.arrayContaining(["read", ...MEMBER_TOOLS]));
    expect(planner?.tools).not.toContain("bash");
    expect(dflt).not.toHaveProperty("tools");
    // The first prompt is the spawn prompt only: shorter than playbook + spawn prompt, and no initialPrompt anywhere.
    for (const n of ["typed", "planner", "dflt"]) {
      const first = s.env.rt.store.mailLog(team.id).find((m) => m.to === n && m.kind === "spawn_prompt");
      expect((first?.text ?? "").length).toBeLessThan(500 + `work as ${n}`.length + 200);
      expect(first?.text).not.toContain("P".repeat(50));
    }
    for (let i = 0; i < 3; i++) expect(spawnAt(s.env, i)).not.toHaveProperty("initialPrompt");
  });
});

describe("resolver pass-through", () => {
  it("a team without a template and a spawn without agent/policy are untouched (core behaviour)", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    expect((await spawn(env, "plain", { role: "r", model: "m1" })).ok).toBe(true);
    const m: Member = env.member(team, "plain");
    expect(m).toMatchObject({ role: "r", model: "m1" });
    expect(m.agent).toBeUndefined();
    expect(m.requirePlanApproval).toBeUndefined();
    expect(m.planApproval).toBeUndefined();
    expect(spawnAt(env)?.scope.appendSystemPrompt).toHaveLength(1);
  });
});
