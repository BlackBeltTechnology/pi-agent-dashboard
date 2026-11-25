/**
 * Host bindings and teammate scope, server half (test-plan S45, S48–S52, S75, S86,
 * S112–S114, S119, S120 and S44): cwd confinement, spawn scope/env/policy, the
 * spawn → bind → guarded hello → prompt ack flow, spawn failures, resume,
 * restart reconciliation and the guard-ready handshake.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv, type TeamsEnvOptions } from "../../__tests__/harness/index.js";
import { policyHash } from "../../shared/policy.js";
import type { Team } from "../../shared/types.js";

const tmp = (label: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `at-${label}-`)));

function setup(over: TeamsEnvOptions = {}) {
  const leadDir = tmp("lead");
  const env = createTeamsEnv(over);
  env.fake.sessions.set(env.lead, { cwd: leadDir, principalOwner: { iss: "idp", sub: "u1" } as never });
  return { env, leadDir };
}

type Ext = Record<string, string>;
const scopeOf = (env: TeamsEnv, i = 0) => env.fake.base.spawns[i]?.scope as { tools?: string[]; extensionConfig: Record<string, Ext> } | undefined;
const extOf = (env: TeamsEnv, i = 0): Ext => scopeOf(env, i)?.extensionConfig["agent-teams"] as Ext;

/** The host resolves the spawned session (first register): bind it to its member. */
function register(env: TeamsEnv, team: Team, name: string, cwd = "/work"): string {
  const sid = env.fake.addSession(`S-${name}`, { cwd, sessionFile: `/sessions/${name}.jsonl` });
  env.fake.resolveSession(sid, { "agent-teams": { teamId: team.id, member: name, role: "member" } });
  return sid;
}

/** A guarded hello carrying exactly the policy the member was spawned with. */
const guardedHello = (env: TeamsEnv, name: string, spawnIndex = 0, over: Record<string, unknown> = {}) =>
  env.hello(name, { policyHash: policyHash(extOf(env, spawnIndex).policy as string), ...over });

/** Spawn, bind, guarded hello, ack the prompt: a fully started teammate (busy until its settle). */
async function startMember(env: TeamsEnv, team: Team, name: string, spawnIndex = 0): Promise<string> {
  await env.call("lead", "TeammateSpawn", { name, prompt: `work as ${name}` });
  const sid = register(env, team, name);
  await guardedHello(env, name, spawnIndex);
  await env.ack(name, env.wireMails(name).map((m) => m.id));
  return sid;
}

describe("cwd confinement (S45)", () => {
  async function spawnWith(cwd: string | undefined, over: TeamsEnvOptions = {}, prep?: (leadDir: string) => void) {
    const { env, leadDir } = setup(over);
    prep?.(leadDir);
    const team = await env.createTeam();
    const res = await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", ...(cwd !== undefined ? { cwd } : {}) });
    return { env, leadDir, team, res };
  }

  it("absent cwd → the lead's cwd from the host record, never from the payload", async () => {
    const { env, leadDir, team, res } = await spawnWith(undefined);
    expect(res.ok).toBe(true);
    expect(env.member(team, "alice").cwd).toBe(leadDir);
    expect(env.fake.base.spawns[0]?.cwd).toBe(leadDir);
  });

  it("a subdirectory of the lead cwd and a relative path are accepted", async () => {
    const sub = await spawnWith("sub", {}, (d) => fs.mkdirSync(path.join(d, "sub")));
    expect(sub.res.ok).toBe(true);
    expect(sub.env.member(sub.team, "alice").cwd).toBe(path.join(sub.leadDir, "sub"));
    const abs = await spawnWith(undefined, {}, (d) => fs.mkdirSync(path.join(d, "deep")));
    expect(abs.res.ok).toBe(true);
  });

  it("a `..` escape, a symlink pointing outside and a prefix-sharing sibling are cwd_outside_lead", async () => {
    const outside = tmp("outside");
    const escape = await spawnWith("..", {}, () => {});
    expect(escape.res).toMatchObject({ ok: false, error: "cwd_outside_lead" });
    const link = await spawnWith("link", {}, (d) => fs.symlinkSync(outside, path.join(d, "link")));
    expect(link.res).toMatchObject({ ok: false, error: "cwd_outside_lead" });
    const { env, leadDir } = setup();
    const sibling = `${leadDir}-evil`;
    fs.mkdirSync(sibling);
    const team = await env.createTeam();
    expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", cwd: sibling })).toMatchObject({ ok: false, error: "cwd_outside_lead" });
    expect(team.members).toHaveLength(0);
    expect(env.fake.base.spawns).toHaveLength(0);
  });

  it("an extraCwdRoots entry is accepted; its siblings are not", async () => {
    const extra = tmp("extra");
    fs.mkdirSync(path.join(extra, "wt"));
    const ok = await spawnWith(path.join(extra, "wt"), { config: { extraCwdRoots: [extra] } });
    expect(ok.res.ok).toBe(true);
    const other = tmp("other");
    const refused = await spawnWith(other, { config: { extraCwdRoots: [extra] } });
    expect(refused.res).toMatchObject({ ok: false, error: "cwd_outside_lead" });
  });

  it("a non-existent path inside the roots, or a file, is invalid_args; outside + non-existent stays cwd_outside_lead (confinement first)", async () => {
    const missing = await spawnWith("nope");
    expect(missing.res).toMatchObject({ ok: false, error: "invalid_args" });
    const file = await spawnWith("f.txt", {}, (d) => fs.writeFileSync(path.join(d, "f.txt"), "x"));
    expect(file.res).toMatchObject({ ok: false, error: "invalid_args" });
    const gone = await spawnWith("/definitely/not/there");
    expect(gone.res).toMatchObject({ ok: false, error: "cwd_outside_lead" });
    expect(gone.team.members).toHaveLength(0);
  });
});

describe("spawn scope, env and policy (S48, S50)", () => {
  it("maps cost flags and the model to the spawn scope; defaults inherit the lead context", async () => {
    const { env } = setup();
    await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "lean", prompt: "go", model: "haiku", noMcp: true, noContextFiles: true });
    await env.call("lead", "TeammateSpawn", { name: "plain", prompt: "go" });
    const [lean, plain] = env.fake.base.spawns;
    expect(lean).toMatchObject({ model: "haiku", scope: { noMcp: true, noContextFiles: true } });
    expect(plain?.model).toBeUndefined();
    expect(plain?.scope).toMatchObject({ noMcp: false, noContextFiles: false });
    expect(plain?.scope).not.toHaveProperty("tools");
    expect(plain?.scope).not.toHaveProperty("skills");
  });

  it("an unknown model fails fast with invalid_args BEFORE the member record exists and spawns nothing", async () => {
    const { env } = setup({ runtime: { isKnownModel: (m: string) => m !== "nope-9" } });
    const team = await env.createTeam();
    expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", model: "nope-9" })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", model: "bad model;rm" })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(team.members).toHaveLength(0);
    expect(env.fake.base.spawns).toHaveLength(0);
    expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", model: "@fast" })).toMatchObject({ ok: true });
  });

  it("session mode spawn: pluginRef, no recovery, pre-minted token, no initialPrompt, prompt file first, env hint", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    const o = env.fake.base.spawns[0] as unknown as Record<string, unknown> & { scope: { appendSystemPrompt: string[] } };
    expect(o).toMatchObject({
      name: "alpha/alice",
      pluginRef: { "agent-teams": { teamId: team.id, member: "alice", role: "member" }, principalOwner: { iss: "idp", sub: "u1" } },
      lifecycle: { recover: false },
      spawnToken: env.member(team, "alice").spawnToken,
    });
    expect(o).not.toHaveProperty("initialPrompt");
    const first = o.scope.appendSystemPrompt[0] as string;
    expect(path.isAbsolute(first)).toBe(true);
    expect(fs.existsSync(first)).toBe(true);
    expect(path.basename(first)).toBe("teammate.md");
    expect(extOf(env)).toMatchObject({ teamId: team.id, member: "alice", committer: "lead" });
  });

  it("a per-member committer uses the member-commit prompt variant", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    const res = env.rt.ops.spawnMember(team, { name: "wt", prompt: "go" }, { committer: "member" });
    expect(res.ok).toBe(true);
    const o = env.fake.base.spawns[0] as unknown as { scope: { appendSystemPrompt: string[] } };
    expect(path.basename(o.scope.appendSystemPrompt[0] as string)).toBe("teammate-member-commit.md");
    expect(extOf(env).committer).toBe("member");
    expect(fs.existsSync(o.scope.appendSystemPrompt[0] as string)).toBe(true);
  });

  it("tool allowlist: member list wins over the team default; team tools are always appended; [] means only team tools; unset is unrestricted", async () => {
    const { env } = setup();
    const created = await env.call("lead", "TeamCreate", { name: "alpha", tools: ["read", "grep"] });
    expect(created.ok).toBe(true);
    await env.call("lead", "TeammateSpawn", { name: "dflt", prompt: "go" });
    await env.call("lead", "TeammateSpawn", { name: "own", prompt: "go", tools: ["ls"] });
    await env.call("lead", "TeammateSpawn", { name: "none", prompt: "go", tools: [] });
    const tools = env.fake.base.spawns.map((s) => (s.scope as { tools?: string[] }).tools);
    const team = ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "SendMessage", "TeamStatus", "ShutdownResponse"];
    expect(tools[0]).toEqual(["read", "grep", ...team]);
    expect(tools[1]).toEqual(["ls", ...team]);
    expect(tools[2]).toEqual(team);
    const policy = JSON.parse(extOf(env, 1).policy as string);
    expect(policy).toMatchObject({ v: 1, tools: ["ls", ...team], blockSleepPolling: true, blockGitWrite: true, committer: "lead" });
    const open = setup();
    await open.env.createTeam();
    await open.env.call("lead", "TeammateSpawn", { name: "free", prompt: "go" });
    expect(open.env.fake.base.spawns[0]?.scope).not.toHaveProperty("tools");
    expect(JSON.parse(extOf(open.env).policy as string)).not.toHaveProperty("tools");
  });

  it("blockSleepPolling / blockGitWrite come from config, read per operation", async () => {
    const { env } = setup();
    await env.createTeam();
    env.fake.base.setConfig({ blockSleepPolling: false, blockGitWrite: false });
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    expect(JSON.parse(extOf(env).policy as string)).toMatchObject({ blockSleepPolling: false, blockGitWrite: false });
  });

  it("spawn contributors only narrow tools/skills; their env cannot override the identity keys", async () => {
    const { env } = setup();
    env.rt.ext.registerSpawnContributor(() => ({ tools: ["read", "bash"], env: { teamId: "forged", extra: "1" }, cwd: "/etc" }));
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", tools: ["read", "write"] });
    const o = env.fake.base.spawns[0];
    expect(scopeOf(env)?.tools?.slice(0, 1)).toEqual(["read"]);
    expect(scopeOf(env)?.tools).not.toContain("bash");
    expect(extOf(env)).toMatchObject({ teamId: team.id, extra: "1" });
    expect(o?.cwd).not.toBe("/etc");
  });
});

describe("skill allowlist, layer 1 (S49 server half, S120)", () => {
  const skill = (name: string) => ({ name, filePath: `/skills/${name}/SKILL.md`, type: "skill", enabled: true });

  it("names resolve through getPiResources into skills paths + noSkills; the policy carries name+root", async () => {
    const { env, leadDir } = setup();
    env.fake.setPiResources({ local: { skills: [skill("a")] }, global: { skills: [] }, packages: [{ resources: { skills: [skill("b")] } }] });
    await env.createTeam();
    const res = await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", skills: ["a", "b"] });
    expect(res.ok).toBe(true);
    expect(env.fake.resourceCalls).toEqual([leadDir]);
    expect(env.fake.base.spawns[0]?.scope).toMatchObject({ noSkills: true, skills: ["/skills/a/SKILL.md", "/skills/b/SKILL.md"] });
    expect(JSON.parse(extOf(env).policy as string).skills).toEqual([
      { name: "a", root: "/skills/a" },
      { name: "b", root: "/skills/b" },
    ]);
  });

  it("[] means no skills (noSkills with an empty list) and needs no host lookup", async () => {
    const { env } = setup({ noPiResources: true });
    await env.createTeam();
    expect((await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", skills: [] })).ok).toBe(true);
    expect(env.fake.base.spawns[0]?.scope).toMatchObject({ noSkills: true, skills: [] });
  });

  it("an unresolvable name → skill_not_found; no session spawned, no member record", async () => {
    const { env } = setup();
    env.fake.setPiResources({ local: { skills: [skill("a")] }, global: { skills: [] }, packages: [] });
    const team = await env.createTeam();
    expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", skills: ["a", "ghost"] })).toMatchObject({
      ok: false,
      error: "skill_not_found",
      details: { skills: ["ghost"] },
    });
    expect(team.members).toHaveLength(0);
    expect(env.fake.base.spawns).toHaveLength(0);
  });

  it("a host without getPiResources, or one that throws → skill_resolution_unavailable (never unrestricted)", async () => {
    const absent = setup({ noPiResources: true });
    const t1 = await absent.env.createTeam();
    expect(await absent.env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", skills: ["a"] })).toMatchObject({ error: "skill_resolution_unavailable" });
    expect(t1.members).toHaveLength(0);
    const broken = setup();
    broken.env.fake.setPiResources(new Error("scan failed"));
    await broken.env.createTeam();
    expect(await broken.env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", skills: ["a"] })).toMatchObject({ error: "skill_resolution_unavailable" });
    expect(broken.env.fake.base.spawns).toHaveLength(0);
  });

  it("a team default allowlist applies to a member without its own; a plain first spawn is also refused when unresolvable", async () => {
    const { env } = setup();
    env.fake.setPiResources({ local: { skills: [skill("a")] }, global: { skills: [] }, packages: [] });
    await env.call("lead", "TeamCreate", { name: "alpha", skills: ["a"] });
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    expect(env.fake.base.spawns[0]?.scope).toMatchObject({ noSkills: true, skills: ["/skills/a/SKILL.md"] });
    const plain = setup({ noPiResources: true });
    expect(await plain.env.call("lead", "TeammateSpawn", { name: "bob", prompt: "go", skills: ["a"] })).toMatchObject({ error: "skill_resolution_unavailable" });
    expect(plain.env.rt.store.list()).toHaveLength(0);
  });
});

const leadNotices = (env: TeamsEnv, team: Team): string[] => env.mailsTo(team, "lead").filter((m) => m.kind === "notice").map((m) => m.text);

describe("spawn prompt (S51)", () => {
  it("returns spawning at once; the prompt waits for bind + guarded hello, then arrives as the first waking spawn_prompt with the team header and nothing else", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    const res = await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "write the parser", role: "coder" });
    expect(res).toEqual({ ok: true, data: { member: "alice", status: "spawning" } });
    expect(env.fake.base.spawns[0]).not.toHaveProperty("initialPrompt");
    expect(env.emitCount("alice")).toBe(0);
    register(env, team, "alice");
    expect(env.member(team, "alice")).toMatchObject({ status: "spawning", sessionId: "S-alice", sessionFile: "/sessions/alice.jsonl" });
    expect(env.emitCount("alice")).toBe(0);
    await guardedHello(env, "alice");
    expect(env.member(team, "alice").status).toBe("busy");
    const [first, ...rest] = env.wireMails("alice");
    expect(rest).toEqual([]);
    expect(first).toMatchObject({ kind: "spawn_prompt", wake: true, from: "lead" });
    expect(first?.text).toContain('Team "alpha"');
    expect(first?.text).toContain('teammate "alice" (role: coder)');
    expect(first?.text.endsWith("write the parser")).toBe(true);
  });

  it("concurrent same-cwd spawns that register in reverse order keep their own prompts, addressed by session id", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "prompt-for-alice" });
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "prompt-for-bob" });
    register(env, team, "bob");
    register(env, team, "alice");
    await guardedHello(env, "bob", 1);
    await guardedHello(env, "alice", 0);
    expect(env.wireMails("alice").map((m) => m.text.split("\n\n")[1])).toEqual(["prompt-for-alice"]);
    expect(env.wireMails("bob").map((m) => m.text.split("\n\n")[1])).toEqual(["prompt-for-bob"]);
  });

  it("a prompt ack completes the spawn: no timeout failure afterwards", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await startMember(env, team, "alice");
    env.clock.advance(60_000);
    expect(env.member(team, "alice").status).toBe("busy");
    expect(env.fake.abortedRuns).toEqual([]);
  });
});

describe("resume (S52)", () => {
  async function goneMember(env: TeamsEnv, team: Team, how: "gone" | "disconnected") {
    await startMember(env, team, "alice");
    await env.idle("alice", { settleId: 1, finalText: "done" });
    if (how === "gone") env.fake.endSession("S-alice");
    else env.rt.store.patchMember(team.id, "alice", { status: "disconnected" });
  }

  it("gone or disconnected + recorded session file → respawn with resume{sessionFile}, same name/scope/env, no inherited tasks", async () => {
    for (const how of ["gone", "disconnected"] as const) {
      const { env } = setup();
      const team = await env.createTeam();
      await goneMember(env, team, how);
      const res = await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "carry on", resume: true });
      expect(res).toEqual({ ok: true, data: { member: "alice", status: "spawning" } });
      expect(env.fake.base.spawns).toHaveLength(2);
      const again = env.fake.base.spawns[1] as unknown as { resume: unknown; pluginRef: unknown; name: string };
      expect(again.resume).toEqual({ sessionFile: "/sessions/alice.jsonl" });
      expect(again.name).toBe("alpha/alice");
      expect(extOf(env, 1)).toMatchObject({ teamId: team.id, member: "alice" });
      expect(env.member(team, "alice")).toMatchObject({ status: "spawning" });
      expect(env.member(team, "alice").sessionId).toBeUndefined();
      expect(team.tasks.filter((t) => t.owner === "alice")).toEqual([]);
      // the resumed session binds to the same member
      register(env, team, "alice");
      expect(env.member(team, "alice").sessionId).toBe("S-alice");
    }
  });

  it("no recorded session file → nothing_to_resume; an idle member → name_taken; an unknown name → nothing_to_resume", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    env.addMember(team, "bob", "idle");
    expect(await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "x", resume: true })).toMatchObject({ error: "name_taken" });
    env.rt.store.patchMember(team.id, "bob", { status: "gone" });
    expect(await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "x", resume: true })).toMatchObject({ error: "nothing_to_resume" });
    expect(await env.call("lead", "TeammateSpawn", { name: "ghost", prompt: "x", resume: true })).toMatchObject({ error: "nothing_to_resume" });
    expect(env.fake.base.spawns).toHaveLength(0);
  });

  it("every hello refreshes the recorded session file", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await startMember(env, team, "alice");
    await env.hello("alice", { sessionFile: "/sessions/rotated.jsonl", policyHash: policyHash(extOf(env).policy as string) });
    expect(env.member(team, "alice").sessionFile).toBe("/sessions/rotated.jsonl");
  });
});

describe("spawn failure handling (S112–S114)", () => {
  it("spawnSession {success:false} → failed with the message, pre-assigned tasks unowned and named in a waking notice, name released", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    let release: () => void = () => undefined;
    env.fake.base.onSpawn(() => new Promise((resolve) => void (release = () => resolve({ success: false, message: "boom" }))));
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    await env.call("lead", "TaskCreate", { title: "pre-assigned", owner: "alice" });
    expect(team.tasks[0]?.owner).toBe("alice");
    release();
    await env.settle();
    expect(env.member(team, "alice")).toMatchObject({ status: "failed" });
    expect(env.member(team, "alice").goneReason).toContain("boom");
    expect(team.tasks[0]?.owner).toBeUndefined();
    env.flushNotices();
    const notice = env.mailsTo(team, "lead").find((m) => m.kind === "notice");
    expect(notice).toMatchObject({ wake: true });
    expect(notice?.text).toMatch(/alice is failed[\s\S]*unowned: 1/);
    env.fake.base.onSpawn(() => ({ success: true, spawnToken: "ok" }));
    expect((await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "again" })).ok).toBe(true);
  });

  it("a session that never registers fails at spawnTimeoutMs (still spawning at 29999), aborted by its token, with a waking notice", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    const token = env.member(team, "alice").spawnToken;
    env.clock.advance(29_999);
    expect(env.member(team, "alice").status).toBe("spawning");
    expect(env.fake.abortedRuns).toEqual([]);
    env.clock.advance(1);
    expect(env.member(team, "alice").status).toBe("failed");
    expect(env.member(team, "alice").goneReason).toContain("never registered");
    expect(env.fake.abortedRuns).toEqual([{ spawnToken: token }]);
    env.flushNotices();
    expect(leadNotices(env, team).join("\n")).toContain("alice is failed");
    expect(env.mailsTo(team, "lead").find((m) => m.kind === "notice")?.wake).toBe(true);
  });

  it("bridge never loads: bound but no guarded hello → failed at the timeout, never idle, never dispatched to, nothing delivered", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await env.call("lead", "TaskCreate", { title: "work" });
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    register(env, team, "alice");
    env.clock.advance(15_000);
    expect(env.member(team, "alice").status).toBe("spawning");
    expect(team.tasks[0]?.owner).toBeUndefined();
    env.clock.advance(15_000);
    expect(env.member(team, "alice").status).toBe("failed");
    expect(env.member(team, "alice").goneReason).toContain("guarded hello");
    expect(env.fake.abortedRuns).toEqual([{ spawnToken: env.member(team, "alice").spawnToken, sessionId: "S-alice" }]);
    expect(team.tasks[0]?.owner).toBeUndefined();
    expect(env.emitCount("alice")).toBe(0);
  });

  it("prompt ack missing → failed at the timeout; a late registration of that spawn is ignored and aborted, never given the prompt", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    register(env, team, "alice");
    await guardedHello(env, "alice");
    expect(env.wireMails("alice")).toHaveLength(1);
    env.clock.advance(30_000);
    expect(env.member(team, "alice")).toMatchObject({ status: "failed" });
    expect(env.member(team, "alice").goneReason).toContain("not acknowledged");
    // a second session claiming the same member is not bound and gets no prompt
    env.fake.addSession("S-ghost");
    env.fake.resolveSession("S-ghost", { "agent-teams": { teamId: team.id, member: "alice", role: "member" } });
    expect(env.fake.abortedRuns.at(-1)).toMatchObject({ sessionId: "S-ghost" });
    expect(env.emitCount("alice")).toBe(1);
    expect(env.fake.base.emits.filter((e) => e.sessionId === "S-ghost")).toEqual([]);
  });

  it("a degraded spawning member never becomes idle and fails at the timeout", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    register(env, team, "alice");
    await env.hello("alice", { policyHash: "wrong" });
    expect(env.member(team, "alice")).toMatchObject({ status: "spawning", degraded: "guard_mismatch" });
    env.clock.advance(30_000);
    expect(env.member(team, "alice").status).toBe("failed");
    expect(env.emitCount("alice")).toBe(0);
  });
});

describe("hello report (S44, S119)", () => {
  async function liveIdle(env: TeamsEnv, team: Team) {
    await startMember(env, team, "alice");
    await env.idle("alice", { settleId: 1, finalText: "done" });
    expect(env.member(team, "alice").status).toBe("idle");
  }

  it("idle/busy are restored from isIdle", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await liveIdle(env, team);
    await guardedHello(env, "alice", 0, { isIdle: false });
    expect(env.member(team, "alice").status).toBe("busy");
    await guardedHello(env, "alice", 0, { isIdle: true });
    expect(env.member(team, "alice").status).toBe("idle");
  });

  it("toolsActive:false → degraded team_tools_unavailable + one waking notice; team tools refused; no dispatch", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await liveIdle(env, team);
    await guardedHello(env, "alice", 0, { toolsActive: false });
    await guardedHello(env, "alice", 0, { toolsActive: false });
    await env.call("lead", "TaskCreate", { title: "work" });
    expect(env.member(team, "alice").degraded).toBe("team_tools_unavailable");
    expect(await env.call("alice", "TaskList", {})).toMatchObject({ ok: false, error: "member_degraded" });
    expect(team.tasks.find((t) => t.title === "work")?.owner).toBeUndefined();
    env.flushNotices();
    const notices = env.mailsTo(team, "lead").filter((m) => m.kind === "notice" && m.text.includes("degraded"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ wake: true });
  });

  it("guardActive:false or no policyHash → guard_unavailable; a different hash → guard_mismatch (refused, no dispatch, waking notice)", async () => {
    for (const [over, reason] of [
      [{ guardActive: false }, "guard_unavailable"],
      [{ policyHash: undefined }, "guard_unavailable"],
      [{ policyHash: "someone-elses" }, "guard_mismatch"],
    ] as const) {
      const { env } = setup();
      const team = await env.createTeam();
      await liveIdle(env, team);
      await env.hello("alice", over);
      await env.call("lead", "TaskCreate", { title: "work" });
      expect(env.member(team, "alice").degraded).toBe(reason);
      expect(await env.call("alice", "TaskUpdate", { id: "1", status: "in_progress" })).toMatchObject({ error: "member_degraded" });
      expect(team.tasks[0]?.owner).toBeUndefined();
      env.flushNotices();
      expect(env.mailsTo(team, "lead").some((m) => m.kind === "notice" && m.wake && m.text.includes(reason))).toBe(true);
    }
  });

  it("a healthy hello clears the degraded flag and dispatch resumes", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await liveIdle(env, team);
    await guardedHello(env, "alice", 0, { toolsActive: false });
    expect(env.member(team, "alice").degraded).toBeDefined();
    await guardedHello(env, "alice");
    expect(env.member(team, "alice").degraded).toBeUndefined();
    await env.call("lead", "TaskCreate", { title: "after" });
    expect(team.tasks[0]?.owner).toBe("alice");
  });

  it("an unknown session (not bound to any team) → not_in_team and no mutation", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    env.fake.addSession("S-stranger");
    const before = JSON.stringify(team);
    expect(await env.fake.lane("S-stranger", "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false })).toMatchObject({ ok: false, error: "not_in_team" });
    expect(JSON.stringify(team)).toBe(before);
  });
});

describe("restart: reconcile and re-bind (S75, S84, S86)", () => {
  async function restarted(over: (env: TeamsEnv) => Promise<void>) {
    const { env } = setup();
    const team = await env.createTeam();
    await over(env);
    await env.rt.persistence.flush(); // what a clean shutdown (or the debounce) puts on disk
    const env2 = createTeamsEnv({ dataDir: env.fake.dataDir });
    return { env, team, env2, team2: env2.rt.store.get(team.id) as Team };
  }

  it("a live teammate re-binds through hello inside the grace with no user action: idle/busy from isIdle; queued mail is redelivered once", async () => {
    const { env2, team2 } = await restarted(async (env) => {
      const team = env.rt.store.list()[0] as Team;
      await startMember(env, team, "alice");
      await env.idle("alice", { settleId: 1, finalText: "ok" });
      env.fake.base.sessions.delete("S-alice"); // alice is unreachable when the mail is sent: it stays queued
      await env.call("lead", "SendMessage", { to: "alice", message: "ping" });
    });
    expect(env2.member(team2, "alice").status).toBe("disconnected");
    expect(team2.members[0]?.policyHash).toBeDefined();
    env2.fake.addSession("S-alice");
    env2.clock.advance(29_999);
    await env2.hello("alice", { policyHash: team2.members[0]?.policyHash });
    expect(env2.member(team2, "alice").status).toBe("busy"); // restored from isIdle, then provisionally busy: the redelivered mail wakes it
    const pings = env2.wireMails("alice").filter((m) => m.text.includes("ping"));
    expect(pings).toHaveLength(1);
    await env2.ack("alice", pings.map((m) => m.id));
    await env2.hello("alice", { isIdle: false, policyHash: team2.members[0]?.policyHash });
    expect(env2.member(team2, "alice").status).toBe("busy");
    expect(env2.wireMails("alice").filter((m) => m.text.includes("ping"))).toHaveLength(1); // ackedAt prevents re-delivery
    env2.clock.advance(60_000);
    expect(env2.fake.abortedRuns).toEqual([]);
  });

  it("spawning with no session after the grace → failed (29999 / 30000) with a waking notice and a token abort", async () => {
    const { env2, team2 } = await restarted(async (env) => {
      await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    });
    expect(env2.member(team2, "alice").status).toBe("spawning");
    env2.clock.advance(29_999);
    expect(env2.member(team2, "alice").status).toBe("spawning");
    env2.clock.advance(1);
    expect(env2.member(team2, "alice").status).toBe("failed");
    expect(env2.fake.abortedRuns).toEqual([{ spawnToken: env2.member(team2, "alice").spawnToken }]);
    env2.flushNotices();
    expect(env2.mailsTo(team2, "lead").some((m) => m.kind === "notice" && m.wake && m.text.includes("alice"))).toBe(true);
  });

  it("a late hello after the grace still re-binds (disconnected is never auto-gone); the lead is told who did not come back", async () => {
    const { env2, team2 } = await restarted(async (env) => {
      const team = env.rt.store.list()[0] as Team;
      await startMember(env, team, "alice");
    });
    env2.clock.advance(30_000);
    env2.flushNotices();
    expect(env2.mailsTo(team2, "lead").some((m) => m.kind === "notice" && m.text.includes("alice did not reconnect"))).toBe(true);
    expect(env2.member(team2, "alice").status).toBe("disconnected");
    env2.fake.addSession("S-alice");
    await env2.hello("alice", { policyHash: team2.members[0]?.policyHash });
    expect(env2.member(team2, "alice").status).toBe("idle");
  });

  it("a recovered teammate without the scope env (no policy hash) is degraded guard_unavailable; the spawn asked for no recovery", async () => {
    const { env, env2, team2 } = await restarted(async (e) => {
      const team = e.rt.store.list()[0] as Team;
      await startMember(e, team, "alice");
    });
    expect((env.fake.base.spawns[0] as unknown as { lifecycle: { recover: boolean } }).lifecycle.recover).toBe(false);
    env2.fake.addSession("S-alice");
    await env2.hello("alice", { guardActive: false });
    expect(env2.member(team2, "alice").degraded).toBe("guard_unavailable");
  });
});

describe("owner + committer (S55 spawn half)", () => {
  it("only the committer:member member's policy and prompt variant differ; the other member stays blocked; Team.committer and owner are untouched", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    const owner = team.owner;
    expect(env.rt.ops.spawnMember(team, { name: "wt", prompt: "go" }, { committer: "member" }).ok).toBe(true);
    expect((await env.call("lead", "TeammateSpawn", { name: "other", prompt: "go" })).ok).toBe(true);
    const policyOf = (i: number) => JSON.parse(extOf(env, i).policy as string) as { committer: string };
    expect(policyOf(0).committer).toBe("member");
    expect(policyOf(1).committer).toBe("lead");
    const promptOf = (i: number) => path.basename(((env.fake.base.spawns[i]?.scope as { appendSystemPrompt: string[] } | undefined)?.appendSystemPrompt ?? [])[0] as string);
    expect(promptOf(0)).toBe("teammate-member-commit.md");
    expect(promptOf(1)).toBe("teammate.md");
    expect(team.committer).toBe("lead");
    expect(team.owner).toBe(owner);
  });
});

describe("spawn races (S63, S64, S66)", () => {
  it("N concurrent spawns near the cap: exactly the free slots succeed, the rest are team_full, one spawnSession each", async () => {
    const { env } = setup({ config: { maxTeammates: 5 } });
    const team = await env.createTeam();
    for (const n of ["l1", "l2", "l3", "l4"]) env.addMember(team, n, "idle");
    env.fake.base.onSpawn(async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return { success: true, spawnToken: "t" };
    });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => env.call("lead", "TeammateSpawn", { name: `m${i}`, prompt: "go" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "team_full")).toHaveLength(9);
    expect(env.fake.base.spawns).toHaveLength(1);
    const empty = setup({ config: { maxTeammates: 5 } });
    await empty.env.createTeam();
    const again = await Promise.all(Array.from({ length: 10 }, (_, i) => empty.env.call("lead", "TeammateSpawn", { name: `m${i}`, prompt: "go" })));
    expect(again.filter((r) => r.ok)).toHaveLength(5);
    expect(empty.env.fake.base.spawns).toHaveLength(5);
  });

  it("two concurrent spawns of one name: one member record, the loser is name_taken, one spawnSession", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    const [a, b] = await Promise.all([env.call("lead", "TeammateSpawn", { name: "alice", prompt: "a" }), env.call("lead", "TeammateSpawn", { name: "alice", prompt: "b" })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)?.error).toBe("name_taken");
    expect(team.members).toHaveLength(1);
    expect(env.fake.base.spawns).toHaveLength(1);
  });

  it("TeamDelete{force} while a spawn is in flight: aborted by token, a spawn after close is team_closed, a session that registers late is aborted, nothing is left spawning", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    let release: () => void = () => undefined;
    env.fake.base.onSpawn(() => new Promise((resolve) => void (release = () => resolve({ success: true, spawnToken: "late" }))));
    await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" });
    const token = env.member(team, "alice").spawnToken;
    expect(await env.call("lead", "TeamDelete", { force: true })).toMatchObject({ ok: true });
    expect(env.fake.abortedRuns).toEqual([{ spawnToken: token }]);
    env.clock.advance(10_000);
    await env.settle();
    expect(team.status).toBe("closed");
    expect(env.rt.ops.spawnMember(team, { name: "bob", prompt: "go" })).toMatchObject({ ok: false, error: "team_closed" });
    release(); // the host finally spawns the session; it registers after the close
    env.fake.addSession("S-alice");
    env.fake.resolveSession("S-alice", { "agent-teams": { teamId: team.id, member: "alice", role: "member" } });
    expect(env.fake.abortedRuns.at(-1)).toEqual({ sessionId: "S-alice" });
    expect(team.members.filter((m) => m.status === "spawning")).toEqual([]);
  });
});

describe("host session end (S115, S116, S117)", () => {
  it("a teammate session that dies: gone with a reason, in_progress → pending unowned, a waking notice names the tasks, queued mail discarded, the task is reassigned to an idle member", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await startMember(env, team, "alice");
    await env.idle("alice", { settleId: 1, finalText: "ok" });
    env.addMember(team, "bob", "busy");
    await env.call("lead", "TaskCreate", { title: "work" });
    expect(team.tasks[0]?.owner).toBe("alice");
    await env.call("lead", "SendMessage", { to: "alice", message: "queued" });
    env.addMember(team, "carol", "idle");
    env.fake.endSession("S-alice");
    expect(env.member(team, "alice")).toMatchObject({ status: "gone", goneReason: "session ended" });
    expect(team.tasks[0]?.owner).toBe("carol"); // dispatcher reassigned to an idle member
    expect(env.rt.store.pendingMail(team.id, "alice")).toEqual([]);
    env.flushNotices();
    const notice = env.mailsTo(team, "lead").find((m) => m.kind === "notice" && m.text.includes("alice is gone"));
    expect(notice).toMatchObject({ wake: true });
    expect(notice?.text).toContain("released to pending: 1");
  });

  it("the lead session dying: orphaned, teammates keep running, one non-waking 'finish and stop' notice, closes after the TTL without touching sessions", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await startMember(env, team, "alice");
    env.fake.endSession(env.lead);
    expect(team.status).toBe("orphaned");
    const stops = env.mailsTo(team, "alice").filter((m) => m.kind === "notice" && m.text.includes("lead is gone"));
    expect(stops).toHaveLength(1);
    expect(stops[0]?.wake).toBe(false);
    env.clock.advance(30 * 60_000);
    expect(team.status).toBe("closed");
    expect(team.closeReason).toBe("orphan_ttl");
    expect(env.fake.base.shutdowns).toEqual([]);
    expect(env.fake.base.aborts).toEqual([]);
  });

  it("idle/hello/ack from a bridge whose member is gone (or whose team is closed) is not_in_team and mutates nothing", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await startMember(env, team, "alice");
    env.rt.ops.releaseMember(team, "alice", "gone", "x");
    const before = JSON.stringify(team);
    const mailBefore = env.log(team).length;
    expect(await env.idle("alice", { settleId: 5, finalText: "late" })).toMatchObject({ ok: false, error: "not_in_team" });
    expect(await env.hello("alice")).toMatchObject({ ok: false, error: "not_in_team" });
    expect(await env.ack("alice", [1])).toMatchObject({ ok: false, error: "not_in_team" });
    expect(await env.busy("alice")).toMatchObject({ ok: false, error: "not_in_team" });
    expect(JSON.stringify(team)).toBe(before);
    expect(env.log(team).length).toBe(mailBefore);
    expect(env.member(team, "alice").status).toBe("gone");
  });
});

describe("emit refused (S104)", () => {
  it("a refused emit leaves the mail queued and unacked, SendMessage lists the name in queued, hello flushes it, nothing throws", async () => {
    const { env } = setup();
    const team = await env.createTeam();
    await startMember(env, team, "alice");
    await env.idle("alice", { settleId: 1, finalText: "ok" });
    env.fake.base.sessions.delete("S-alice"); // the host refuses the emit (disconnected / manifest refusal)
    const res = await env.call("lead", "SendMessage", { to: "alice", message: "ping" });
    expect(res).toMatchObject({ ok: true, data: { delivered: [], queued: ["alice"] } });
    const [m] = env.mailsTo(team, "alice").filter((x) => x.kind === "message");
    expect(m?.ackedAt).toBeUndefined();
    env.fake.base.sessions.add("S-alice");
    await guardedHello(env, "alice");
    expect(env.wireMails("alice").filter((x) => x.id === m?.id)).toHaveLength(2); // refused attempt + the flush on hello
    await env.ack("alice", [m?.id as number]);
    expect(env.mailsTo(team, "alice").find((x) => x.id === m?.id)?.ackedAt).toBeDefined();
  });
});
