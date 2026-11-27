/**
 * The shared preflight tests of `preflight.test.ts` (7.3, 7.5, 7.7) and the repo-root rule (7.4), run with the
 * REAL group kind instead of fakes: real `groups.json`, real git repositories, real lock files.
 * Tests 7.3 #E3, 7.4 #E25, 7.5 #X1, 7.7 #X3, 7.14 (goal shapes). Kept in its own file because the group
 * slice and the apply slice both extend the shared preflight tests.
 * See change: add-agent-teams-openspec.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPreflight } from "../profiles.js";
import { createOpenspecEnv, GROUP, type OpenspecEnv, tmp } from "./env.js";
import { git, initRepoAt, makeRepo, writeGroupFiles } from "./git-env.js";

const SKILL = { name: "ship-it", filePath: "/s/ship-it/SKILL.md" };
const withSkill = (e: OpenspecEnv, yes = true): void => e.fake.setPiResources({ local: { skills: yes ? [SKILL] : [] }, global: { skills: [] }, packages: [] });
const files = { assignments: { a: "g" }, changes: { a: undefined } } as const;

const writeLock = (repo: string, over: Record<string, unknown> = {}, now = Date.now()): void => {
  const dir = path.join(repo, ".worktrees", ".ship-batch");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "lock"), JSON.stringify({ pid: process.pid, hostname: os.hostname(), groupId: "g", heartbeatAt: now, ...over }));
};

describe("precedence with the real group kind (7.3 #E3)", () => {
  const CONDITIONS = ["untrusted", "unknown_group", "batch_lock", "subdir", "no_skill", "no_base", "bad_config"] as const;
  type Cond = (typeof CONDITIONS)[number];
  // first failing check wins
  const ORDER: Array<[Cond, string]> = [
    ["untrusted", "project_untrusted"],
    ["bad_config", "invalid_config"],
    ["unknown_group", "group_unknown"],
    ["subdir", "lead_not_repo_root"],
    ["batch_lock", "batch_runner_active"],
    ["no_skill", "ship_skill_missing"],
    ["no_base", "base_not_found"],
  ];
  const subsets = (): Cond[][] => {
    const out: Cond[][] = [CONDITIONS.slice(), []];
    for (const a of CONDITIONS) {
      out.push([a]);
      for (const b of CONDITIONS) if (a < b) out.push([a, b]);
    }
    return out;
  };

  it("subsets of {untrusted, unknown group, live ship-batch lock, lead cwd = subdir, no ship skill, no base, bad config}: exactly ONE code, the first failing check", async () => {
    let trusted = true;
    const good = await createOpenspecEnv({ openspec: { trust: () => trusted } });
    const bad = await createOpenspecEnv({ openspec: { trust: () => trusted }, config: { openspecMergeBase: "--upload-pack=x" } });
    // two repositories built once (base `develop` / base missing); the lock is toggled per subset
    const repos = Object.fromEntries(
      [false, true].map((noBase) => {
        const repo = noBase ? makeRepo("at-os-pf-", "main") : makeRepo("at-os-pf-");
        writeGroupFiles(repo, files);
        const sub = path.join(repo, "packages", "sub");
        fs.mkdirSync(sub, { recursive: true });
        writeGroupFiles(sub, files); // the lead cwd reads groups.json under itself
        return [String(noBase), { repo, sub }];
      }),
    ) as Record<string, { repo: string; sub: string }>;
    let n = 0;
    for (const set of subsets()) {
      const has = (c: Cond): boolean => set.includes(c);
      trusted = !has("untrusted");
      const env = has("bad_config") ? bad : good;
      withSkill(env, !has("no_skill"));
      const { repo, sub } = repos[String(has("no_base"))] as { repo: string; sub: string };
      fs.rmSync(path.join(repo, ".worktrees"), { recursive: true, force: true });
      if (has("batch_lock")) writeLock(repo, {}, env.clock.now());
      const res = await runPreflight(env.api, "group", has("unknown_group") ? "nope" : "g", has("subdir") ? sub : repo);
      const expected = ORDER.find(([c]) => has(c))?.[1];
      if (expected) expect(res, `subset ${set.join("+")}`).toMatchObject({ ok: false, error: expected });
      else expect(res, "no condition").toMatchObject({ ok: true });
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(29);
  }, 120_000);
});

describe("lead_not_repo_root (7.4 #E25)", () => {
  const verdict = async (cwd: string, files?: boolean): Promise<string> => {
    const e = await createOpenspecEnv();
    withSkill(e);
    if (files !== false) writeGroupFiles(cwd, { assignments: { a: "g" }, changes: { a: undefined } });
    const res = await runPreflight(e.api, "group", "g", cwd);
    expect(fs.existsSync(path.join(cwd, ".worktrees", "os-a")), "no worktree on any outcome").toBe(false);
    return res.ok ? "ok" : res.error;
  };

  it("the real repo root passes; so does the same root reached through a symlink (realpath-equal)", async () => {
    const repo = makeRepo();
    expect(await verdict(repo)).toBe("ok");
    const link = path.join(tmp("at-os-lnk-"), "link");
    fs.symlinkSync(repo, link);
    expect(await verdict(link, false)).toBe("ok");
  });

  it("a subdirectory is refused", async () => {
    const repo = makeRepo();
    const sub = path.join(repo, "docs");
    fs.mkdirSync(sub);
    expect(await verdict(sub)).toBe("lead_not_repo_root");
  });

  it("a linked worktree (also .worktrees/os-x) is refused", async () => {
    const repo = makeRepo();
    const wt = path.join(repo, ".worktrees", "os-x");
    git(repo, "worktree", "add", "-q", "-b", "os/x", wt);
    expect(await verdict(wt)).toBe("lead_not_repo_root");
    const other = path.join(tmp("at-os-wt-"), "wt");
    git(repo, "worktree", "add", "-q", "-b", "other", other);
    expect(await verdict(other)).toBe("lead_not_repo_root");
  });

  it("a non-git directory and a bare repository are refused", async () => {
    expect(await verdict(tmp("at-os-plain-"))).toBe("lead_not_repo_root");
    const bare = tmp("at-os-bare-");
    execFileSync("git", ["init", "-q", "--bare", bare], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
    expect(await verdict(bare)).toBe("lead_not_repo_root");
  });

  it("a submodule root is the root of its own repository and passes", async () => {
    const sub = makeRepo("at-os-subsrc-");
    const parent = makeRepo("at-os-parent-");
    git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "mod");
    expect(await verdict(path.join(parent, "mod"))).toBe("ok");
  });
});

describe("typed failures leave nothing behind, on both start paths, with the real kind (7.5 #X1)", () => {
  interface Case {
    code: string;
    /** Prepare the repo (the lead cwd) and return the goal. */
    setup(e: OpenspecEnv, repo: string, root: string): string | Promise<string>;
    env?: Parameters<typeof createOpenspecEnv>[0];
  }
  const ok = (repo: string, over: Partial<Parameters<typeof writeGroupFiles>[1]> = {}): void => writeGroupFiles(repo, { assignments: { a: "g" }, changes: { a: undefined }, ...over });
  const cases: Case[] = [
    { code: "invalid_args", setup: (e, r) => (withSkill(e), ok(r), "a".repeat(65)) }, // a group goal is an id or a display name ("Copilot / Assistant" is valid): length and control characters are what is refused
    { code: "project_untrusted", env: { trusted: false }, setup: (e, r) => (withSkill(e), ok(r), "g") },
    { code: "group_unknown", setup: (e, r) => (withSkill(e), ok(r), "nope") },
    { code: "group_ambiguous", setup: (e, r) => (withSkill(e), ok(r, { groups: [{ id: "x", name: "Foo" }, { id: "y", name: "foo" }] }), "foo") },
    { code: "group_empty", setup: (e, r) => (withSkill(e), ok(r, { assignments: { gone: "g" }, changes: {} }), "g") },
    { code: "groups_invalid", setup: (e, r) => (withSkill(e), fs.mkdirSync(path.join(r, "openspec", "groups"), { recursive: true }), fs.writeFileSync(path.join(r, "openspec", "groups", "groups.json"), "{"), "g") },
    { code: "lead_not_repo_root", setup: (e, r, root) => (withSkill(e), ok(r), "g"), env: {} },
    { code: "batch_runner_active", setup: (e, r) => (withSkill(e), ok(r), writeLock(r, {}, e.clock.now()), "g") },
    { code: "ship_skill_missing", setup: (e, r) => (withSkill(e, false), ok(r), "g") },
    { code: "base_not_found", setup: (e, r) => (withSkill(e), ok(r), git(r, "branch", "-m", "develop", "main"), "g") },
    { code: "invalid_config", env: { config: { openspecShipSkill: "Bad Name" } }, setup: (e, r) => (withSkill(e), ok(r), "g") },
    { code: "too_many_tasks", env: { config: { maxTasks: 2 } }, setup: (e, r) => (withSkill(e), ok(r, { assignments: { a: "g", b: "g", c: "g" }, changes: { a: undefined, b: undefined, c: undefined } }), "g") },
  ];

  it.each(cases)("$code: the stable code on both paths; no team, sidecar, spawn, inject call or .worktrees", { timeout: 30_000 }, async (c) => {
    const calls: string[] = [];
    const e = await createOpenspecEnv({ ...(c.env ?? {}), openspec: { inject: async (r) => (calls.push(r.url), { statusCode: 200, body: { success: true } }) } });
    // lead_not_repo_root: the project dir is a subdirectory of the repository; every other case: it is the root
    const root = path.dirname(e.cwd);
    let repo = e.cwd;
    if (c.code === "lead_not_repo_root") {
      initRepoAt(root);
      repo = e.cwd;
    } else initRepoAt(e.cwd);
    const goal = await c.setup(e, repo, root);
    const cmd = await e.start({ template: GROUP, goal });
    const rest = await e.restStart({ template: GROUP, goal, cwd: e.cwd });
    expect(cmd, "command path").toMatchObject({ ok: false, error: c.code });
    expect(rest.body, "rest path").toMatchObject({ ok: false, error: c.code });
    expect(e.rt.store.list()).toEqual([]);
    expect(e.api.sidecar.ids()).toEqual([]);
    expect(fs.existsSync(path.join(e.dataDir, "openspec"))).toBe(false);
    expect(e.fake.base.spawns).toEqual([]);
    expect(calls).toEqual([]);
    // no worktree is ever created (the only thing under .worktrees may be the ship-batch lock the fixture wrote)
    for (const dir of [repo, root]) expect(fs.existsSync(path.join(dir, ".worktrees")) ? fs.readdirSync(path.join(dir, ".worktrees")).filter((n) => n !== ".ship-batch") : []).toEqual([]);
  });
});

describe("skill resolution with the real kind (7.7 #X3)", () => {
  const skill = (name: string) => ({ name, filePath: `/skills/${name}/SKILL.md` });
  async function start(setup: (e: OpenspecEnv) => void, opts: { noPiResources?: boolean } = {}) {
    const e = await createOpenspecEnv(opts);
    setup(e);
    const repo = makeRepo();
    writeGroupFiles(repo, files);
    return { e, res: await runPreflight(e.api, "group", "g", repo) };
  }

  it("missing → ship_skill_missing naming the skill", async () => {
    const { res } = await start((e) => e.fake.setPiResources({ local: { skills: [skill("other")] }, global: { skills: [] }, packages: [] }));
    expect(res).toMatchObject({ ok: false, error: "ship_skill_missing", details: { skill: "ship-it" } });
  });

  it.each(["project", "user", "package"])("a %s skill resolves", async (where) => {
    const r = { local: { skills: where === "project" ? [skill("ship-it")] : [] }, global: { skills: where === "user" ? [skill("ship-it")] : [] }, packages: where === "package" ? [{ resources: { skills: [skill("ship-it")] } }] : [] };
    expect((await start((e) => e.fake.setPiResources(r))).res).toMatchObject({ ok: true });
  });

  it("a configured skill name is the one resolved", async () => {
    const e = await createOpenspecEnv({ config: { openspecShipSkill: "my-ship" } });
    e.fake.setPiResources({ local: { skills: [skill("ship-it")] }, global: { skills: [] }, packages: [] });
    const repo = makeRepo();
    writeGroupFiles(repo, files);
    expect(await runPreflight(e.api, "group", "g", repo)).toMatchObject({ ok: false, error: "ship_skill_missing", details: { skill: "my-ship" } });
  });

  it("a resolver that throws, or an absent seam, fails closed with detail resolver_unavailable; nothing is created", async () => {
    const thrown = await start((e) => e.fake.setPiResources(new Error("boom")));
    expect(thrown.res).toMatchObject({ ok: false, error: "ship_skill_missing", details: { detail: "resolver_unavailable" } });
    const absent = await start(() => {}, { noPiResources: true });
    expect(absent.res).toMatchObject({ ok: false, error: "ship_skill_missing", details: { detail: "resolver_unavailable" } });
    expect(absent.e.rt.store.list()).toEqual([]);
    expect(absent.e.api.sidecar.ids()).toEqual([]);
  });
});

describe("goal shapes of a group start (7.14 #E10)", () => {
  it("a trailing space and the empty goal are invalid_args; a name with a space is a valid goal shape", async () => {
    const e = await createOpenspecEnv();
    withSkill(e);
    const repo = makeRepo();
    writeGroupFiles(repo, { groups: [{ id: "agent-teams", name: "Agent Teams" }], assignments: { a: "agent-teams" }, changes: { a: undefined } });
    for (const goal of ["Agent Teams ", "", " Agent Teams", "Agent\nTeams"]) expect(await runPreflight(e.api, "group", goal, repo), JSON.stringify(goal)).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await runPreflight(e.api, "group", "Agent Teams", repo)).toMatchObject({ ok: true });
    expect(await runPreflight(e.api, "group", "agent teams", repo)).toMatchObject({ ok: true });
  });
});
