/**
 * Shared preflight of the OpenSpec profiles (tasks 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8; test-plan #E1 #E2 #E3
 * #X1 #X2 #X3 #S14): goal rules, the fixed precedence, nothing created on a refusal, strict project trust,
 * skill resolution and the preflight→seed snapshot. Kind implementations are fakes (the group/apply slices
 * own their own stage checks); the runner owns the order.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTeamsEnv } from "../../../__tests__/harness/index.js";
import type { Team } from "../../../shared/types.js";
import { readChangeTasks } from "../inputs.js";
import { type OpenspecApi, type OpenspecKindImpl, PREFLIGHT_STAGES, type PreflightStage, type Refusal, runPreflight, SEAM_NAMES } from "../profiles.js";
import { APPLY, createOpenspecEnv, GROUP, tmp } from "./env.js";

const STAGE_CODE: Record<PreflightStage, string> = {
  resolve: "group_unknown",
  repo_root: "lead_not_repo_root",
  batch: "batch_runner_active",
  skills: "ship_skill_missing",
  base: "base_not_found",
  limits: "too_many_tasks",
  nothing: "nothing_to_do",
  in_use: "change_in_use",
};

describe("goal rules (7.1 #E1, 7.2 #E2)", () => {
  it("accepts 1 and 64 characters; 65, 255 and 256 are invalid_args and create nothing", async () => {
    const e = await createOpenspecEnv();
    e.kind("apply", {});
    for (const [goal, ok] of [["a", true], ["a".repeat(64), true], ["a".repeat(65), false], ["a".repeat(255), false], ["a".repeat(256), false]] as const) {
      const before = e.rt.store.list().length;
      const res = await e.start({ template: APPLY, goal });
      if (ok) expect(res.ok, goal).toBe(true);
      else {
        expect(res, goal).toMatchObject({ ok: false, error: "invalid_args" });
        expect(e.rt.store.list()).toHaveLength(before);
      }
    }
    expect(e.api.sidecar.ids().length).toBeLessThanOrEqual(2); // only the two accepted goals ever got state
  });

  it("only `x` is a valid change name; every other shape is invalid_args before any stage or read", async () => {
    const e = await createOpenspecEnv();
    const calls: string[] = [];
    const stages = Object.fromEntries(PREFLIGHT_STAGES.map((s) => [s, () => void calls.push(s)])) as OpenspecKindImpl["stages"];
    e.kind("apply", { stages, plan: () => (calls.push("plan"), { tasks: [] }) });
    const bad = ["../../etc", "/abs/p", "a/b", "A-b", "a--b", "-a", "a-", "a b", "a\u0000b", "x\n", "аdd-x", "x."];
    for (const goal of bad) expect(await e.api.isTrusted(e.cwd) && (await runPreflight(e.api, "apply", goal, e.cwd)), JSON.stringify(goal)).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await runPreflight(e.api, "apply", "", e.cwd)).toMatchObject({ ok: false, error: "invalid_args" });
    expect(calls).toEqual([]);
    expect(await runPreflight(e.api, "apply", "x", e.cwd)).toMatchObject({ ok: true });
    expect(calls).toEqual([...PREFLIGHT_STAGES, "plan"]);
  });

  it("group goals use the kind's own syntax but the same bound (control characters / blank / over 64 refused)", async () => {
    const e = await createOpenspecEnv();
    e.kind("group", { goalValid: (g) => /^[A-Za-z0-9 -]+$/.test(g) });
    for (const goal of ["Alpha", "alpha-2"]) expect(await runPreflight(e.api, "group", goal, e.cwd)).toMatchObject({ ok: true });
    for (const goal of ["Alpha ", " Alpha", "", "A".repeat(65), "Al\npha", "a_b"]) expect(await runPreflight(e.api, "group", goal, e.cwd), JSON.stringify(goal)).toMatchObject({ ok: false, error: "invalid_args" });
  });
});

describe("fixed precedence (7.3 #E3)", () => {
  /** A minimal handle: `runPreflight` only needs these members. */
  function fakeApi(flags: { untrusted: boolean; unavailable: boolean; badConfig: boolean; stages: Set<PreflightStage> }): OpenspecApi {
    const impl: OpenspecKindImpl = {
      stages: Object.fromEntries(PREFLIGHT_STAGES.map((s) => [s, (): Refusal | undefined => (flags.stages.has(s) ? { error: STAGE_CODE[s] } : undefined)])),
      plan: () => ({ tasks: [] }),
    };
    return {
      kindImpl: () => impl,
      isTrusted: async () => !flags.untrusted,
      unavailableSeams: () => (flags.unavailable ? [SEAM_NAMES[1]] : []),
      deps: { config: () => ({ maxTeammates: 5, maxTasks: 50 }) },
      config: () => (flags.badConfig ? { ok: false, key: "openspecMergeBase", message: "bad" } : { ok: true, config: {} as never }),
    } as unknown as OpenspecApi;
  }

  it("returns exactly ONE code, the first failing check, for every subset of 4 shared + 8 stage conditions", async () => {
    const order = ["invalid_args", "project_untrusted", "profile_unavailable", "invalid_config", ...PREFLIGHT_STAGES.map((s) => STAGE_CODE[s])];
    const conds = 4 + PREFLIGHT_STAGES.length;
    let checked = 0;
    for (let mask = 0; mask < 1 << conds; mask++) {
      const on = (i: number): boolean => (mask & (1 << i)) !== 0;
      const flags = { untrusted: on(1), unavailable: on(2), badConfig: on(3), stages: new Set(PREFLIGHT_STAGES.filter((_, i) => on(4 + i))) };
      const res = await runPreflight(fakeApi(flags), "group", on(0) ? "bad goal!" : "x", "/repo");
      const expected = order.find((_, i) => on(i));
      if (expected === undefined) expect(res.ok).toBe(true);
      else expect(res, `mask ${mask}`).toMatchObject({ ok: false, error: expected });
      checked++;
    }
    expect(checked).toBe(4096);
  });

  it("an untrusted project is refused before any stage runs (the groups.json read never happens)", async () => {
    const stage = vi.fn();
    const api = { ...fakeApi({ untrusted: true, unavailable: false, badConfig: false, stages: new Set() }), kindImpl: () => ({ stages: { resolve: stage }, plan: () => ({ tasks: [] }) }) } as unknown as OpenspecApi;
    expect(await runPreflight(api, "group", "x", "/repo")).toMatchObject({ error: "project_untrusted" });
    expect(stage).not.toHaveBeenCalled();
  });

  it("an uninstalled kind slice is profile_unavailable", async () => {
    const e = await createOpenspecEnv();
    // The real slices register their kinds at init: hand the runner a handle with no `apply` implementation.
    const bare = { ...e.api, kindImpl: () => undefined } as unknown as OpenspecApi;
    expect(await runPreflight(bare, "apply", "x", e.cwd)).toMatchObject({ ok: false, error: "profile_unavailable" });
  });

  it("a bad config value is invalid_config with the key named", async () => {
    const e = await createOpenspecEnv({ config: { openspecMergeBase: "--upload-pack=x" } });
    e.kind("group", {});
    expect(await runPreflight(e.api, "group", "x", e.cwd)).toMatchObject({ ok: false, error: "invalid_config", details: { key: "openspecMergeBase" } });
  });
});

describe("typed failures leave nothing behind, on both start paths (7.5 #X1)", () => {
  const codes = ["invalid_args", "project_untrusted", "group_unknown", "group_ambiguous", "group_empty", "lead_not_repo_root", "batch_runner_active", "ship_skill_missing", "base_not_found", "invalid_config", "change_unknown", "too_many_tasks", "review_skill_missing"];

  it.each(codes)("%s: stable code in the reply; no team, sidecar, spawn or inject call", async (code) => {
    const e = await createOpenspecEnv({ trusted: code !== "project_untrusted", ...(code === "invalid_config" ? { config: { openspecShipSkill: "Bad Name" } } : {}) });
    e.kind("group", { stages: { resolve: () => (["group_unknown", "group_ambiguous", "group_empty", "change_unknown"].includes(code) ? { error: code } : undefined), repo_root: () => (code === "lead_not_repo_root" ? { error: code } : undefined), batch: () => (code === "batch_runner_active" ? { error: code } : undefined), skills: () => (["ship_skill_missing", "review_skill_missing"].includes(code) ? { error: code } : undefined), base: () => (code === "base_not_found" ? { error: code } : undefined), limits: () => (code === "too_many_tasks" ? { error: code } : undefined) } });
    const goal = code === "invalid_args" ? "../../etc" : "x";
    const cmd = await e.start({ template: GROUP, goal });
    const rest = await e.restStart({ template: GROUP, goal, cwd: e.cwd });
    expect(cmd, "command path").toMatchObject({ ok: false, error: code });
    expect(rest.body, "rest path").toMatchObject({ ok: false, error: code });
    expect(e.rt.store.list()).toEqual([]);
    expect(e.api.sidecar.ids()).toEqual([]);
    expect(fs.existsSync(path.join(e.dataDir, "openspec"))).toBe(false);
    expect(e.fake.base.spawns).toEqual([]);
    expect(fs.existsSync(path.join(e.cwd, ".worktrees"))).toBe(false);
  });
});

describe("profile starts need a trusted project (7.6 #X2)", () => {
  const verdicts: Array<[string, () => unknown, boolean]> = [
    ["true", () => true, true],
    ["false", () => false, false],
    ["throws", () => { throw new Error("x"); }, false],
    ["rejects", () => Promise.reject(new Error("x")), false],
    ['resolves "false"', () => Promise.resolve("false"), false],
    ["resolves 1", () => Promise.resolve(1), false],
    ["resolves undefined", () => Promise.resolve(undefined), false],
    ["resolves true", () => Promise.resolve(true), true],
  ];

  it.each(verdicts)("host answer %s → trusted=%s; anything else is project_untrusted and no repo file is read", async (_name, answer, trusted) => {
    const e = await createOpenspecEnv({ openspec: { trust: answer } });
    const stage = vi.fn();
    e.kind("group", { stages: { resolve: stage } });
    const res = await runPreflight(e.api, "group", "nonexistent-group", e.cwd);
    if (trusted) expect(res.ok).toBe(true);
    else {
      expect(res).toMatchObject({ ok: false, error: "project_untrusted" });
      expect(stage).not.toHaveBeenCalled();
    }
  });

  it("an absent service (no host.isProjectTrusted consumed) is untrusted", async () => {
    const env = createTeamsEnv({ runtime: { openspec: { templatesDir: tmp() } } }); // no templatesHost override: the raw host seam answers
    const api = env.rt.openspec as OpenspecApi;
    api.registerOpenspecProfile("group", { plan: () => ({ tasks: [] }) });
    expect(await runPreflight(api, "group", "x", "/work")).toMatchObject({ ok: false, error: "project_untrusted" });
  });

  it("a check that never answers fails closed inside the 2 s bound", async () => {
    const e = await createOpenspecEnv({ openspec: { trust: () => new Promise(() => {}) } });
    e.kind("group", {});
    const pending = runPreflight(e.api, "group", "x", e.cwd);
    await Promise.resolve();
    e.clock.advance(1999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    e.clock.advance(1);
    expect(await pending).toMatchObject({ ok: false, error: "project_untrusted" });
  });
});

describe("skill resolution (7.7 #X3)", () => {
  const skill = (name: string) => ({ name, filePath: `/skills/${name}/SKILL.md` });

  async function status(setup: (e: Awaited<ReturnType<typeof createOpenspecEnv>>) => void, opts: { noPiResources?: boolean } = {}) {
    const e = await createOpenspecEnv(opts);
    setup(e);
    const impl: OpenspecKindImpl = {
      stages: { skills: async (ctx) => (await import("../profiles.js")).checkSkillStage(ctx.api, "ship", ctx.config.shipSkill, ctx.cwd) },
      plan: () => ({ tasks: [] }),
    };
    e.api.registerOpenspecProfile("group", impl);
    return { e, res: await runPreflight(e.api, "group", "x", e.cwd) };
  }

  it("missing → ship_skill_missing", async () => {
    const { res } = await status((e) => e.fake.setPiResources({ local: { skills: [skill("other")] }, global: { skills: [] }, packages: [] }));
    expect(res).toMatchObject({ ok: false, error: "ship_skill_missing", details: { skill: "ship-it" } });
  });

  it.each(["project", "user", "package"])("a %s skill resolves", async (where) => {
    const res = { local: { skills: where === "project" ? [skill("ship-it")] : [] }, global: { skills: where === "user" ? [skill("ship-it")] : [] }, packages: where === "package" ? [{ resources: { skills: [skill("ship-it")] } }] : [] };
    expect((await status((e) => e.fake.setPiResources(res))).res).toMatchObject({ ok: true });
  });

  it("a resolver that throws fails closed with detail resolver_unavailable", async () => {
    const { res } = await status((e) => e.fake.setPiResources(new Error("boom")));
    expect(res).toMatchObject({ ok: false, error: "ship_skill_missing", details: { detail: "resolver_unavailable" } });
  });

  it("an absent seam fails closed with detail resolver_unavailable; nothing is created", async () => {
    const { e, res } = await status(() => {}, { noPiResources: true });
    expect(res).toMatchObject({ ok: false, error: "ship_skill_missing", details: { detail: "resolver_unavailable" } });
    expect(e.rt.store.list()).toEqual([]);
  });

  it("the review skill of apply maps to review_skill_missing", async () => {
    const e = await createOpenspecEnv();
    e.fake.setPiResources({ local: { skills: [] }, global: { skills: [] }, packages: [] });
    const { checkSkillStage } = await import("../profiles.js");
    expect(await checkSkillStage(e.api, "review", "review-code", e.cwd)).toMatchObject({ error: "review_skill_missing" });
  });
});

describe("preflight→seed snapshot (7.8 #S14)", () => {
  it("the seed consumes the plan built at preflight: a file swapped before the bind changes nothing and nothing is read twice", async () => {
    const e = await createOpenspecEnv();
    const change = path.join(e.cwd, "openspec", "changes", "x");
    fs.mkdirSync(change, { recursive: true });
    const tasksFile = path.join(change, "tasks.md");
    fs.writeFileSync(tasksFile, "- [ ] 1.1 first\n- [ ] 1.2 second\n");
    const reads = vi.fn();
    e.kind("apply", {
      stages: {
        resolve: (ctx) => {
          reads();
          const r = readChangeTasks(ctx.cwd, "x");
          ctx.scratch.titles = r.ok ? r.text.split("\n").filter(Boolean) : [];
          return undefined;
        },
      },
      plan: (ctx) => ({ tasks: (ctx.scratch.titles as string[]).map((t, i) => ({ key: `t${i}`, title: t })) }),
    });
    const res = await e.restStart({ template: APPLY, goal: "x", cwd: e.cwd });
    expect(res.status).toBe(200);
    // mutate + symlink-swap AFTER preflight, BEFORE the lead binds (the seed runs at bind)
    fs.rmSync(tasksFile);
    fs.symlinkSync("/etc/passwd", tasksFile);
    const team = e.rt.store.list()[0] as Team;
    await e.bindLead(team);
    await e.flush();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(team.tasks.map((t) => t.title)).toEqual(["- [ ] 1.1 first", "- [ ] 1.2 second"]);
    expect(e.api.sidecar.get(team.id)).toMatchObject({ seeded: true });
  });
});
