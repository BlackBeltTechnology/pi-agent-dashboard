/**
 * Profile registry and the bundled source (tasks 9.22, 9.23, 9.25, 9.26, 9.27, 1.10 and the teammate-only
 * `ResourceLock` row of 9.28; test-plan #E29 #X12 #X20 #D12 #S5 #S6): bundled templates are listed and
 * shadowable, profiles act only for the bundled source, missing seams fail the start, listeners are isolated.
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decideToolCall } from "../../../bridge/guard.js";
import { ENV_OPENSPEC_PROFILE, EXT_KEY_OPENSPEC_PROFILE, profileKindOfTemplate } from "../../../shared/openspec-profile.js";
import { parsePolicy, type TeammatePolicy } from "../../../shared/policy.js";
import { LEAD_ONLY_TOOLS, TEAM_TOOLS_BY_ROLE } from "../../../shared/protocol.js";
import type { Team } from "../../../shared/types.js";
import { md } from "../../__tests__/template-env.js";
import { parseTemplate } from "../../template-parse.js";
import { registerBundledTemplate } from "../../templates.js";
import { bundledTemplateProblem, listBundledFiles, registerBundledTemplates, resolveTemplatesDir } from "../bundled.js";
import { type OpenspecApi, SEAM_NAMES, selfCheckSeams } from "../profiles.js";
import { APPLY, createOpenspecEnv, fixtureTemplate, GROUP, tmp } from "./env.js";

const PKG = path.resolve(__dirname, "../../../..");

type Listed = { name: string; source: string; valid: boolean; trusted: boolean };
async function listed(e: Awaited<ReturnType<typeof createOpenspecEnv>>): Promise<Listed[]> {
  const res = await e.templates();
  if (!res.ok) throw new Error(res.error);
  return res.data.templates as Listed[];
}

describe("bundled source: listed and shadowable (9.22 #E29)", () => {
  it("both bundled templates are listed with source bundled, valid, mode session; judo-modules never", async () => {
    const e = await createOpenspecEnv();
    fs.mkdirSync(path.join(path.dirname(e.templatesDir), "examples"), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(e.templatesDir), "examples", "judo-modules.md"), md({ name: "judo-modules", spawn: "lead" }));
    const all = await listed(e);
    expect(all.filter((t) => t.source === "bundled").map((t) => t.name)).toEqual([APPLY, GROUP]);
    expect(all.every((t) => t.valid)).toBe(true);
    expect(all.some((t) => t.name === "judo-modules")).toBe(false);
    expect(((await e.templates()) as { data: { templates: Array<{ mode?: string }> } }).data.templates.every((t) => t.mode === "session")).toBe(true);
  });

  it("source precedence is project > user > bundled; the bundled one stays when nothing shadows it", async () => {
    const e = await createOpenspecEnv();
    expect((await listed(e)).filter((t) => t.name === APPLY)).toEqual([expect.objectContaining({ source: "bundled" })]);
    e.tpl("user", APPLY, md({ name: APPLY, spawn: "lead" }));
    expect((await listed(e)).filter((t) => t.name === APPLY)).toEqual([expect.objectContaining({ source: "user" })]);
    e.tpl("project", APPLY, md({ name: APPLY, spawn: "lead" }));
    expect((await listed(e)).filter((t) => t.name === APPLY)).toEqual([expect.objectContaining({ source: "project" })]);
  });

  it("in an untrusted project both bundled templates stay listed (the project file is only a stub)", async () => {
    const e = await createOpenspecEnv({ trusted: false });
    e.tpl("project", APPLY, md({ name: APPLY, spawn: "lead" }));
    const all = await listed(e);
    expect(all.filter((t) => t.source === "bundled").map((t) => t.name)).toEqual([APPLY, GROUP]);
    expect(all.find((t) => t.source === "project")).toMatchObject({ trusted: false, valid: false });
  });

  it("the templates shipped in the package are all acceptable bundled templates (mode session, no TaskCreated hook)", () => {
    const dir = resolveTemplatesDir(); // undefined until a template ships in `templates/` (git keeps no empty directory)
    if (dir === undefined) return;
    expect(dir).toBe(path.join(PKG, "templates"));
    for (const stem of listBundledFiles(dir)) expect(bundledTemplateProblem(fs.readFileSync(path.join(dir, `${stem}.md`), "utf8"), stem), stem).toBeUndefined();
  });

  it("the shipped example (examples/judo-modules.md, 6.1) is a valid plain template that is never part of the bundled set; its helper sketches are documented text", () => {
    const example = fs.readFileSync(path.join(PKG, "examples", "judo-modules.md"), "utf8");
    const parsed = parseTemplate(example, "judo-modules");
    expect(parsed.core).toBeDefined(); // parses: no frontmatter error
    expect(parsed.core).toMatchObject({ name: "judo-modules", declaredMode: "session", spawn: "lead", autoDispatch: false, maxTeammates: 4 });
    expect(parsed.core?.hooks?.TaskCompleted?.[0]?.command).toBe("bash scripts/team-verify-stamp.sh");
    expect(profileKindOfTemplate("judo-modules")).toBeUndefined();
    const dir = resolveTemplatesDir() as string;
    expect(path.basename(dir)).toBe("templates");
    expect(listBundledFiles(dir)).toEqual([APPLY, GROUP]); // the examples directory is a sibling, never a source
    const helpers = fs.readFileSync(path.join(PKG, "examples", "judo-modules.helpers.md"), "utf8");
    expect(helpers).toMatch(/Documentation only/i);
    for (const script of ["scripts/verify-module.sh", "scripts/team-verify-stamp.sh"]) expect(helpers).toContain(script);
    expect(helpers).toMatch(/exit 2/);
  });

  it("a bundled template that is not mode session, declares a TaskCreated hook or is invalid is not registered (one error log each)", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "worktree-mode.md"), md({ name: "worktree-mode", mode: "worktree", spawn: "lead" }));
    fs.writeFileSync(path.join(dir, "hooked.md"), md({ name: "hooked", mode: "session", spawn: "lead", hooks: { TaskCreated: [{ command: "true" }] } }));
    fs.writeFileSync(path.join(dir, "broken.md"), "no frontmatter at all");
    fs.writeFileSync(path.join(dir, "fine.md"), fixtureTemplate("fine"));
    fs.writeFileSync(path.join(dir, ".hidden.md"), fixtureTemplate("hidden"));
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    const errors: string[] = [];
    const reg = registerBundledTemplates(dir, { info() {}, warn() {}, error: (m: string) => void errors.push(m) });
    expect(reg.names).toEqual(["fine"]);
    expect(errors).toHaveLength(3);
    reg.dispose();
  });

  it("a missing templates directory registers nothing and does not throw", () => {
    expect(registerBundledTemplates(undefined, { info() {}, warn() {}, error() {} }).names).toEqual([]);
    expect(registerBundledTemplates(path.join(tmp(), "nope"), { info() {}, warn() {}, error() {} }).names).toEqual([]);
  });
});

describe("bundled templates resolve at runtime (9.26 #D12)", () => {
  it("the directory is found from source, from a built layout and from an unpacked tarball (same relative layout)", () => {
    const pkg = tmp("at-os-pkg-");
    fs.mkdirSync(path.join(pkg, "templates"));
    fs.writeFileSync(path.join(pkg, "templates", "x.md"), fixtureTemplate("x"));
    for (const rel of ["src/server/openspec/index.ts", "dist/server/openspec/index.js", "package/src/server/openspec/index.js"]) {
      const root = rel.startsWith("package/") ? path.join(pkg, "..", "unused") : pkg;
      const file = path.join(root, rel);
      if (rel.startsWith("package/")) {
        // an unpacked tarball is `<dir>/package/…` with `templates/` beside `src/`
        fs.mkdirSync(path.join(pkg, "package", "templates"), { recursive: true });
        fs.writeFileSync(path.join(pkg, "package", "templates", "x.md"), fixtureTemplate("x"));
        const url = new URL(`file://${path.join(pkg, rel)}`);
        expect(resolveTemplatesDir(url.href)).toBe(path.join(pkg, "package", "templates"));
      } else expect(resolveTemplatesDir(new URL(`file://${file}`).href)).toBe(path.join(pkg, "templates"));
    }
    expect(resolveTemplatesDir("file:///definitely/not/a/package/src/server/openspec/index.ts")).toBeUndefined();
  });

  it("package.json ships templates/ and examples/, and a pack lists whatever templates exist", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toEqual(expect.arrayContaining(["templates/", "examples/"]));
    // npm <= 11 prints an array, npm 12 an object keyed by package name.
    const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as unknown;
    const first = (Array.isArray(packed) ? packed[0] : Object.values(packed as Record<string, unknown>)[0]) as { files?: Array<{ path: string }> } | undefined;
    const paths = (first?.files ?? []).map((f) => f.path);
    for (const stem of listBundledFiles(path.join(PKG, "templates"))) expect(paths, stem).toContain(`templates/${stem}.md`);
    expect(paths.some((p) => p.includes("__tests__"))).toBe(false);
  });
});

describe("profiles are bound to the bundled source by name (9.27 #S5)", () => {
  async function plainStart(over: { files?: Array<[source: "project" | "user", stem: string, text: string]>; trusted?: boolean } = {}) {
    const e = await createOpenspecEnv({ ...(over.trusted === undefined ? {} : { trusted: over.trusted }) });
    const calls: string[] = [];
    e.kind("group", { stages: { resolve: () => void calls.push("preflight") }, plan: () => (calls.push("plan"), { tasks: [{ key: "a", title: "seeded" }] }) });
    for (const [source, stem, text] of over.files ?? []) e.tpl(source, stem, text);
    return { e, calls };
  }
  const shadow = (extra: Record<string, unknown> = {}) => md({ name: GROUP, spawn: "lead", ...extra });

  it.each([
    ["user template", [["user", GROUP, shadow()]]],
    ["project template", [["project", GROUP, shadow()]]],
    ["with hooks and members", [["user", GROUP, shadow({ hooks: { TaskCompleted: [{ command: "true" }] }, members: [{ name: "w", prompt: "x" }] })]]],
  ] as const)("a %s named openspec-group runs as a plain template: no preflight, no seed, no profile", async (_n, files) => {
    const { e, calls } = await plainStart({ files: files as never });
    const res = await e.start({ template: GROUP, goal: "anything at all, even prose!" });
    expect(res.ok).toBe(true);
    const team = e.rt.store.list()[0] as Team;
    await e.flush();
    expect(calls).toEqual([]);
    expect(team.tasks).toEqual([]);
    expect(e.api.profileOf(team)).toBeUndefined();
    expect(e.api.teamState(team)).toBe("inactive");
    expect(e.api.sidecar.ids()).toEqual([]);
    expect(team.template?.source).not.toBe("bundled");
  });

  it("`profile:` and a mismatching `name:` in a user file never select a profile (the file is plain or invalid)", async () => {
    const { e, calls } = await plainStart({ files: [["user", GROUP, md({ name: GROUP, spawn: "lead", profile: "openspec-group" })]] });
    const res = await e.start({ template: GROUP, goal: "g" });
    expect(calls).toEqual([]);
    expect(e.api.sidecar.ids()).toEqual([]);
    expect(res.ok ? e.api.profileOf(e.rt.store.list()[0] as Team) : res.error).toBeUndefined();
  });

  it("a case-variant file name: the profile runs exactly when the resolved source is bundled (file-system case rules decide the source, never the profile)", async () => {
    const { e, calls } = await plainStart({ files: [["user", "OpenSpec-Group", md({ name: "openspec-group", spawn: "lead" })]] });
    const res = await e.start({ template: GROUP, goal: "x" });
    expect(res.ok).toBe(true);
    const bundled = e.rt.store.list()[0]?.template?.source === "bundled";
    expect(calls.includes("preflight")).toBe(bundled);
    expect(e.api.profileOf(e.rt.store.list()[0] as Team)).toBe(bundled ? "group" : undefined);
  });

  it("an untrusted project: bundled templates are listed but a start is project_untrusted", async () => {
    const { e, calls } = await plainStart({ trusted: false });
    expect((await listed(e)).some((t) => t.name === GROUP && t.source === "bundled")).toBe(true);
    expect(await e.start({ template: GROUP, goal: "x" })).toMatchObject({ ok: false, error: "project_untrusted" });
    expect(calls).toEqual([]);
  });

  it("the bundled template does activate the profile: seeded, sidecar written, state active", async () => {
    const { e } = await plainStart();
    expect((await e.start({ template: GROUP, goal: "x" })).ok).toBe(true);
    await e.flush();
    const team = e.rt.store.list()[0] as Team;
    expect(team.template?.source).toBe("bundled");
    expect(e.api.profileOf(team)).toBe("group");
    expect(team.tasks.map((t) => t.title)).toEqual(["seeded"]);
    expect(e.api.teamState(team)).toBe("active");
  });
});

describe("seed runs before the eager roster (1.4)", () => {
  it("the profile's tasks exist when the first member is spawned; preflight ran before the team did", async () => {
    const e = await createOpenspecEnv();
    registerBundledTemplate(APPLY, md({ name: APPLY, mode: "session", spawn: "eager", members: [{ name: "dev-1", prompt: "work" }] })); // replaces the fixture (same name)
    const order: string[] = [];
    e.kind("apply", { stages: { resolve: () => void order.push(`preflight:teams=${e.rt.store.list().length}`) }, plan: () => ({ tasks: [{ key: "a", title: "A" }, { key: "b", title: "B", blockedBy: ["a"] }] }) });
    const real = e.rt.ops.spawnTeammate.bind(e.rt.ops);
    (e.rt.ops as { spawnTeammate: typeof real }).spawnTeammate = (team, args, o) => (order.push(`spawn:${args.name}:tasks=${team.tasks.length}`), real(team, args, o));
    expect((await e.restStart({ template: APPLY, goal: "x", cwd: e.cwd })).status).toBe(200);
    await e.bindLead(e.rt.store.list()[0] as Team);
    await e.flush();
    expect(order).toEqual(["preflight:teams=0", "spawn:dev-1:tasks=2"]);
  });
});

describe("spawn contributor and the ResourceLock role row (1.10, 9.28 #S6)", () => {
  const ext = (e: Awaited<ReturnType<typeof createOpenspecEnv>>, i = 0) => ((e.fake.base.spawns[i]?.scope ?? { extensionConfig: {} }) as { extensionConfig: Record<string, Record<string, string>> }).extensionConfig["agent-teams"] as Record<string, string>;

  it("a member of a bundled profile team gets PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE; a plain-team member does not", async () => {
    const e = await createOpenspecEnv();
    const group = e.team("group", "g");
    const apply = e.team("apply", "a");
    const plain = e.team("group", "p", { source: "user" });
    for (const [t, name] of [[group, "m1"], [apply, "m2"], [plain, "m3"]] as const) expect(e.rt.ops.spawnMember(t, { name, prompt: "go" }).ok).toBe(true);
    await e.settle();
    expect(ENV_OPENSPEC_PROFILE).toBe("PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE");
    expect(ext(e, 0)[EXT_KEY_OPENSPEC_PROFILE]).toBe("group");
    expect(ext(e, 1)[EXT_KEY_OPENSPEC_PROFILE]).toBe("apply");
    expect(ext(e, 2)[EXT_KEY_OPENSPEC_PROFILE]).toBeUndefined();
  });

  it("a lead call that tries to smuggle env/profile/cwd/committer args does not reach the spawn spec", async () => {
    const e = await createOpenspecEnv();
    const team = e.team("group", "g");
    e.rt.store.bindLead(team.id, e.lead);
    const res = await e.call("lead", "TeammateSpawn", { name: "m1", prompt: "go", env: { X: "1" }, profile: "group", committer: "member", cwd: "/etc" });
    await e.settle();
    expect(res.ok === false || e.rt.store.member(team, "m1")?.committer === undefined).toBe(true);
    const spawned = e.fake.base.spawns[0];
    if (spawned) {
      expect(JSON.stringify(spawned)).not.toContain('"X":"1"');
      expect(ext(e)[EXT_KEY_OPENSPEC_PROFILE]).toBe("group"); // set by the server contributor only
      expect(e.rt.store.member(team, "m1")?.cwd).not.toBe("/etc");
    }
  });

  it("ResourceLock is a teammate tool only: not for plain sessions, not for the lead", () => {
    expect(TEAM_TOOLS_BY_ROLE.member).toContain("ResourceLock");
    expect(TEAM_TOOLS_BY_ROLE.lead).not.toContain("ResourceLock");
    expect(TEAM_TOOLS_BY_ROLE.plain).not.toContain("ResourceLock");
    expect(LEAD_ONLY_TOOLS).not.toContain("ResourceLock");
  });
});

describe("TrustedSpawnOptions unreachable from an agent (9.28 #S6)", () => {
  const ext = (e: Awaited<ReturnType<typeof createOpenspecEnv>>, i = 0) => ((e.fake.base.spawns[i]?.scope ?? { extensionConfig: {} }) as { extensionConfig: Record<string, Record<string, string>> }).extensionConfig["agent-teams"] as Record<string, string>;

  it("TeammateSpawn with cwd/committer/env/profile/tools/skills extras: the member runs in the lead cwd, committer stays lead, nothing smuggled reaches the spawn", async () => {
    const e = await createOpenspecEnv();
    const team = e.team("group", "g");
    e.rt.store.bindLead(team.id, e.lead);
    const res = await e.call("lead", "TeammateSpawn", { name: "m1", prompt: "go", cwd: "/etc", committer: "member", env: { EVIL: "1" }, profile: "apply", tools: ["bash", "write"], skills: ["/etc/skills"] });
    await e.settle();
    const member = e.rt.store.member(team, "m1");
    if (res.ok && member) {
      expect(member.cwd === undefined || member.cwd === team.leadCwd).toBe(true);
      expect(member.committer).toBeUndefined();
      expect(JSON.stringify(e.fake.base.spawns[0])).not.toContain("EVIL");
      expect(ext(e).committer).toBe("lead");
      expect(ext(e)[EXT_KEY_OPENSPEC_PROFILE]).toBe("group"); // the server contributor's value, not the argument's "apply"
    } else {
      expect(res.ok).toBe(false); // refused outright is as good as ignored
    }
  });

  it("a teammate cannot call a lead-only tool (TeamCreate, TeammateSpawn, ShutdownRequest, TeamDelete, PlanDecision): refused, nothing created", async () => {
    const e = await createOpenspecEnv();
    const team = e.team("group", "g");
    e.rt.store.bindLead(team.id, e.lead);
    e.addMember(team, "os-a", "idle");
    const members = team.members.length;
    for (const [op, args] of [["TeammateSpawn", { name: "x", prompt: "go", cwd: "/etc" }], ["ShutdownRequest", { to: "os-a" }], ["TeamDelete", {}], ["PlanDecision", { to: "os-a", approve: true }], ["TeamCreate", { name: "nested" }]] as const) {
      const res = await e.call("os-a", op, args);
      expect(res.ok, op).toBe(false);
    }
    expect(team.members).toHaveLength(members);
    expect(team.status).toBe("active");
    expect(e.rt.store.list()).toHaveLength(1);
  });

  it("snapshot of TEAM_TOOLS_BY_ROLE: ResourceLock for teammates only, and no tool schema accepts a branch, path, cwd, change, committer, env or profile", async () => {
    expect(Object.fromEntries(Object.entries(TEAM_TOOLS_BY_ROLE).filter(([, tools]) => tools.includes("ResourceLock")).map(([role]) => [role, true]))).toEqual({ member: true });
    const { createTeamTools } = await import("../../../bridge/tools.js");
    const tools = createTeamTools({ call: async () => ({ ok: false, error: "x" }) } as never);
    const forbidden = new Set(["branch", "path", "cwd", "change", "committer", "env", "profile", "worktree", "base"]);
    for (const t of tools) {
      const props = Object.keys(((t.parameters as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>);
      // core's TeammateSpawn has a `cwd` argument; it is confined to the lead cwd and the extra roots (`cwd_outside_lead`, first test above)
      expect(props.filter((p) => forbidden.has(p) && !(t.name === "TeammateSpawn" && p === "cwd")), `${t.name} schema`).toEqual([]);
    }
    const lock = tools.find((t) => t.name === "ResourceLock");
    if (!lock) throw new Error("ResourceLock tool missing");
    expect(Object.keys((lock.parameters as { properties: Record<string, unknown> }).properties).sort()).toEqual(["action", "name"]);
  });
});

describe("profiles use core registries only: per-member committer (9.24 #X19)", () => {
  const WT = "/work/.worktrees/os-x";
  const spawnOf = (e: Awaited<ReturnType<typeof createOpenspecEnv>>, i: number) => e.fake.base.spawns[i] as unknown as { scope: { appendSystemPrompt: string[]; extensionConfig: Record<string, Record<string, string>> } };
  const policyOf = (e: Awaited<ReturnType<typeof createOpenspecEnv>>, i: number) => parsePolicy(spawnOf(e, i).scope.extensionConfig["agent-teams"]?.policy) as TeammatePolicy;
  const prompts = (e: Awaited<ReturnType<typeof createOpenspecEnv>>, i: number) => spawnOf(e, i).scope.appendSystemPrompt.map((p) => path.basename(p));
  const git = (p: TeammatePolicy, cmd: string) => decideToolCall("bash", { command: cmd }, p).allow;

  it("a group teammate spawned with committer member may commit/push/merge; every other member (lead-spawned in the group, apply, plain) stays barred; Team.committer stays lead", async () => {
    const e = await createOpenspecEnv();
    const group = e.team("group", "g");
    const apply = e.team("apply", "a");
    const plain = e.team("group", "p", { source: "user" });
    expect(e.rt.ops.spawnMember(group, { name: "os-x", prompt: "go" }, { cwd: WT, committer: "member" }).ok).toBe(true);
    expect(e.rt.ops.spawnMember(group, { name: "helper", prompt: "go" }).ok).toBe(true); // a plain TeammateSpawn in the group: no committer switch
    expect(e.rt.ops.spawnMember(apply, { name: "dev-1", prompt: "go" }).ok).toBe(true);
    expect(e.rt.ops.spawnMember(plain, { name: "p1", prompt: "go" }).ok).toBe(true);
    await e.settle();
    for (const cmd of ["git commit -m x", "git push origin os/x", "git merge origin/develop"]) {
      expect(git(policyOf(e, 0), cmd)).toBe(true);
      for (const i of [1, 2, 3]) expect(git(policyOf(e, i), cmd)).toBe(false);
    }
    expect(prompts(e, 0)).toContain("teammate-member-commit.md");
    for (const i of [1, 2, 3]) expect(prompts(e, i)).toEqual(["teammate.md"]);
    for (const t of [group, apply, plain]) expect(t.committer).toBe("lead");
    expect(e.rt.store.member(group, "os-x")).toMatchObject({ committer: "member", cwd: WT });
  });

  it("regression: the group member protocol is not self-contradictory — a group-only prompt addendum overrides `never git push / the lead integrates` for the committer-switched member; nobody else gets it", async () => {
    const e = await createOpenspecEnv();
    const group = e.team("group", "g");
    const apply = e.team("apply", "a");
    const plain = e.team("group", "p", { source: "user" });
    for (const [t, name] of [[group, "os-x"], [group, "helper"], [apply, "dev-1"], [plain, "p1"]] as const) {
      expect(e.rt.ops.spawnMember(t, { name, prompt: "go" }, name === "os-x" ? { cwd: WT, committer: "member" } : undefined).ok).toBe(true);
    }
    await e.settle();
    const addendum = "openspec-group-member.md";
    // appended AFTER the protocol prompt so its override is the last word; only for a group member that got the committer switch
    expect(prompts(e, 0)).toEqual(["teammate-member-commit.md", addendum]);
    expect(prompts(e, 1)).toEqual(["teammate.md"]); // lead-spawned helper in the group: no git rights, no override
    expect(prompts(e, 2)).toEqual(["teammate.md"]);
    expect(prompts(e, 3)).toEqual(["teammate.md"]);
    const file = spawnOf(e, 0).scope.appendSystemPrompt.find((p) => p.endsWith(addendum)) as string;
    const text = fs.readFileSync(file, "utf8");
    expect(text).toMatch(/replaces the Git rule/i);
    expect(text).toMatch(/commit, push and merge/);
    expect(text).toMatch(/only in your own worktree/);
    expect(text).toMatch(/lead makes no commits/i);
  });
});

describe("seams missing at plugin start (9.25 #X20)", () => {
  it.each(SEAM_NAMES)("missing %s: templates stay listed, a start fails profile_unavailable, ONE error log, plain templates unaffected", async (seam) => {
    const e = await createOpenspecEnv({ openspec: { seamProbes: { [seam]: false } } });
    e.kind("group", {});
    expect(e.api.unavailableSeams()).toEqual([seam]);
    expect(e.fake.logs.error.filter((l) => l.includes("openspec profiles unavailable"))).toHaveLength(1);
    expect((await listed(e)).filter((t) => t.source === "bundled").map((t) => t.name)).toEqual([APPLY, GROUP]);
    expect(await e.start({ template: GROUP, goal: "x" })).toMatchObject({ ok: false, error: "profile_unavailable" });
    expect(e.rt.store.list()).toEqual([]);
    e.tpl("user", "plain", md({ name: "plain", spawn: "lead" }));
    expect((await e.start({ template: "plain", goal: "x" })).ok).toBe(true);
  });

  it("detects real absence: an ops object without requestShutdown / sendServerMail / enqueueLeadNotice, an ext without eligibility", () => {
    const full = { requestShutdown: () => {}, sendServerMail: () => {}, enqueueLeadNotice: () => {} };
    const ext = { registerDispatchEligibility: () => {} };
    expect(selfCheckSeams({ ops: full, ext } as never)).toEqual([]);
    expect(selfCheckSeams({ ops: { ...full, requestShutdown: undefined }, ext } as never)).toEqual(["requestShutdown"]);
    expect(selfCheckSeams({ ops: { ...full, sendServerMail: undefined }, ext } as never)).toEqual(["sendServerMail"]);
    expect(selfCheckSeams({ ops: { ...full, enqueueLeadNotice: undefined }, ext } as never)).toEqual(["enqueueLeadNotice"]);
    expect(selfCheckSeams({ ops: full, ext: {} } as never)).toEqual(["registerDispatchEligibility"]);
  });

  it("the real runtime passes the self-check (trusted cwd honoured by the spawn planner)", async () => {
    const e = await createOpenspecEnv();
    expect(e.api.unavailableSeams()).toEqual([]);
  });
});

describe("listener isolation (9.23 #X12, seam 2.1)", () => {
  async function completing() {
    const e = await createOpenspecEnv({ runtime: { openspec: { templatesDir: tmp() } } });
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    const id = (await e.call("lead", "TaskCreate", { title: "t" })) as { data: { task: { id: string } } };
    return { e, team, id: id.data.task.id };
  }

  it("a throwing and a rejecting listener cannot break the commit; other listeners run; the error is logged once; later events still dispatch", async () => {
    const { e, team, id } = await completing();
    const api = e.api as OpenspecApi;
    const seen: string[] = [];
    api.onStoreEvent("task_completed", () => {
      throw new Error("sync boom");
    });
    api.onStoreEvent("task_completed", async () => {
      await Promise.resolve();
      throw new Error("async boom");
    });
    api.onStoreEvent("task_completed", (ev) => void seen.push(`ok:${ev.task.id}:${ev.task.status}`));
    e.rt.store.on("task_completed", () => {
      throw new Error("raw boom"); // a raw core listener: core's own isolation
    });
    await e.call("alice", "TaskUpdate", { id, status: "in_progress" });
    const done = await e.call("alice", "TaskUpdate", { id, status: "completed", result: "r" });
    await e.settle();
    expect(done.ok).toBe(true);
    expect(team.tasks.find((t) => t.id === id)?.status).toBe("completed");
    expect(seen).toEqual([`ok:${id}:completed`]); // the commit was visible to the listener
    expect(e.fake.logs.error.filter((l) => l.includes("listener_failed"))).toHaveLength(2); // one per distinct failure
    const id2 = ((await e.call("lead", "TaskCreate", { title: "t2" })) as { data: { task: { id: string } } }).data.task.id;
    await e.call("alice", "TaskUpdate", { id: id2, status: "in_progress" });
    await e.call("alice", "TaskUpdate", { id: id2, status: "completed", result: "r" });
    await e.settle();
    expect(seen).toEqual([`ok:${id}:completed`, `ok:${id2}:completed`]);
    expect(e.fake.logs.error.filter((l) => l.includes("listener_failed"))).toHaveLength(2); // the same failure is not logged again
  });

  it("the disposer removes the listener", async () => {
    const { e, id } = await completing();
    const fn = vi.fn();
    const off = (e.api as OpenspecApi).onStoreEvent("task_completed", fn);
    off();
    await e.call("alice", "TaskUpdate", { id, status: "in_progress" });
    await e.call("alice", "TaskUpdate", { id, status: "completed", result: "r" });
    expect(fn).not.toHaveBeenCalled();
  });
});
