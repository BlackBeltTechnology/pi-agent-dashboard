/**
 * The group kind with its REAL stage checks and plan (tasks 3.4, 3.5; tests 7.17 #E7, 7.18 #E13, 7.15 #E11,
 * 7.35): dependency mapping, skip propagation, one task per change, the 50-task cap, and the seeded sidecar
 * (`refs`, `names`, `ext.group`) the launcher and the completion gate read.
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it } from "vitest";
import { memberNameFor } from "../names.js";
import { runPreflight } from "../profiles.js";
import { createOpenspecEnv, GROUP, type OpenspecEnv } from "./env.js";
import { blockedBy, initRepoAt, makeRepo, writeGroupFiles } from "./git-env.js";

const withShipSkill = (e: OpenspecEnv): void => e.fake.setPiResources({ local: { skills: [{ name: "ship-it", filePath: "/s/ship-it/SKILL.md" }] }, global: { skills: [] }, packages: [] });

async function planFor(e: OpenspecEnv, changes: Record<string, string | undefined>, assignments: Record<string, string>, extra: { changeOrder?: Record<string, string[]>; archive?: string[] } = {}) {
  const repo = makeRepo();
  writeGroupFiles(repo, { assignments, changes, ...extra });
  const res = await runPreflight(e.api, "group", "g", repo);
  return { repo, res };
}

const assignAll = (...names: string[]): Record<string, string> => Object.fromEntries(names.map((n) => [n, "g"]));

describe("dependency mapping (7.17 #E7)", () => {
  it("in-group edges become blockedBy: deduped, the self-edge dropped, order kept", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { a: undefined, b: blockedBy("a", "a", "b"), c: blockedBy("b", "a") }, assignAll("a", "b", "c"));
    if (!res.ok) throw new Error(res.error);
    const by = Object.fromEntries(res.plan.tasks.map((t) => [t.key, t.blockedBy]));
    expect(by).toEqual({ a: [], b: ["a"], c: ["b", "a"] });
    expect(res.plan.tasks.every((t) => (t.ref as { kind: string }).kind === "group")).toBe(true);
  });

  it("an out-of-group blocker leaves no edge and is named in the lead notice and ext.group.outOfGroup", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { b: blockedBy("z"), z: undefined }, { b: "g" });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks.find((t) => t.key === "b")?.blockedBy).toEqual([]);
    expect(res.plan.notes?.join("\n")).toContain("out-of-group change(s): z");
    expect(res.plan.sidecar?.ext?.group).toHaveProperty("outOfGroup", { b: ["z"] });
  });

  it("a blocker with no active directory, or archived, counts as out-of-group: listed, no edge, the dependant still gets a task", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { b: blockedBy("a", "gone") }, { b: "g" }, { archive: ["2025-01-01-a"] });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks.map((t) => [t.key, t.blockedBy])).toEqual([["b", []]]);
    expect(res.plan.sidecar?.ext?.group).toHaveProperty("outOfGroup", { b: ["a", "gone"] });
  });

  it("a member assigned to the group but archived is skipped and named, and a dependant keeps no edge to it", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { b: blockedBy("a") }, assignAll("a", "b"), { archive: ["2025-01-01-a"] });
    if (!res.ok) throw new Error(res.error);
    const ext = res.plan.sidecar?.ext?.group as { skipped: unknown; changeOrder: string[] };
    expect(ext.skipped).toEqual([{ change: "a", reason: "no_active_directory" }]);
    expect(ext.changeOrder).toEqual(["b"]);
  });

  it("an invalid dependencies.yaml skips its change AND, transitively, its dependants; unrelated changes are created", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { a: "blocked_by: [not valid", b: blockedBy("a"), c: blockedBy("b"), d: undefined }, assignAll("a", "b", "c", "d"));
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks.map((t) => t.key)).toEqual(["d"]);
    const ext = res.plan.sidecar?.ext?.group as { skipped: Array<{ change: string; reason: string }> };
    expect(ext.skipped).toEqual(
      expect.arrayContaining([
        { change: "a", reason: "invalid_dependencies" },
        { change: "b", reason: "depends_on_skipped" },
        { change: "c", reason: "depends_on_skipped" },
      ]),
    );
    expect(res.plan.notes?.join("\n")).toMatch(/skipped a: invalid_dependencies/);
  });

  it("an oversize or aliased dependencies.yaml is invalid (skipped, named)", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const bomb = "blocked_by: &a [x]\nrelated: *a\n";
    const { res } = await planFor(e, { a: bomb, b: undefined }, assignAll("a", "b"));
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks.map((t) => t.key)).toEqual(["b"]);
  });

  it("two changes that block each other are skipped (cycle), with their dependants; the rest is created", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { a: blockedBy("c"), c: blockedBy("a"), d: blockedBy("a"), ok: undefined }, assignAll("a", "c", "d", "ok"));
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks.map((t) => t.key)).toEqual(["ok"]);
    const ext = res.plan.sidecar?.ext?.group as { skipped: Array<{ change: string; reason: string }> };
    expect(ext.skipped.filter((s) => s.reason === "cycle").map((s) => s.change).sort()).toEqual(["a", "c"]);
    expect(ext.skipped).toContainEqual({ change: "d", reason: "depends_on_skipped" });
  });

  it("every member skipped ⇒ group_empty (nothing to seed)", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { a: "garbage: [", b: blockedBy("a") }, assignAll("a", "b"));
    expect(res).toMatchObject({ ok: false, error: "group_empty" });
  });
});

describe("one task per change; caps (7.18 #E13, 7.15 #E11)", () => {
  const many = (n: number): { changes: Record<string, undefined>; assignments: Record<string, string> } => {
    const names = Array.from({ length: n }, (_, i) => `c${String(i).padStart(2, "0")}`);
    return { changes: Object.fromEntries(names.map((c) => [c, undefined])), assignments: assignAll(...names) };
  };

  it.each([49, 50])("%i active changes seed %i tasks (maxTasks 50, maxTeammates 5)", async (n) => {
    const e = await createOpenspecEnv({ config: { maxTasks: 50, maxTeammates: 5 } });
    withShipSkill(e);
    const { changes, assignments } = many(n);
    const { res } = await planFor(e, changes, assignments);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks).toHaveLength(n);
  });

  it("51 active changes: too_many_tasks from the preflight, before anything exists (REST start)", async () => {
    const e = await createOpenspecEnv({ config: { maxTasks: 50 } });
    withShipSkill(e);
    initRepoAt(e.cwd);
    const { changes, assignments } = many(51);
    writeGroupFiles(e.cwd, { assignments, changes });
    const rest = await e.restStart({ template: GROUP, goal: "g", cwd: e.cwd });
    expect(rest.body).toMatchObject({ ok: false, error: "too_many_tasks" });
    expect(e.rt.store.list()).toEqual([]);
    expect(e.api.sidecar.ids()).toEqual([]);
  });

  it("one included change: one task, no edges", async () => {
    const e = await createOpenspecEnv();
    withShipSkill(e);
    const { res } = await planFor(e, { solo: undefined }, { solo: "g" });
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.tasks).toMatchObject([{ key: "solo", title: "solo", blockedBy: [] }]);
    expect(res.plan.tasks[0]?.description).toContain(".worktrees/os-solo");
    expect(res.plan.tasks[0]?.description).toContain("os/solo");
  });
});

describe("seed end to end: tasks, refs, names, ext.group", () => {
  it("creates the tasks topologically and records refs, the name mapping and ext.group in the sidecar", async () => {
    const e = await createOpenspecEnv({ config: { openspecWorktreeBase: "develop", openspecMergeBase: "develop" } });
    withShipSkill(e);
    initRepoAt(e.cwd);
    const long = "add-agent-teams-templates-hooks";
    writeGroupFiles(e.cwd, {
      assignments: assignAll("a", "b", long),
      changeOrder: { g: [long, "a"] },
      changes: { a: blockedBy("b", "zzz"), b: undefined, [long]: undefined },
    });
    const res = await e.restStart({ template: GROUP, goal: "g", cwd: e.cwd });
    expect(res.status).toBe(200);
    const team = e.rt.store.list()[0];
    if (!team) throw new Error("no team");
    await e.bindLead(team);
    await e.flush();
    const d = e.api.sidecar.get(team.id);
    expect(d).toMatchObject({ seeded: true, kind: "group", goal: "g" });
    // order: persisted [long, a] then b; `a` waits for `b`, so `b` is created before `a`
    const byTitle = Object.fromEntries(team.tasks.map((t) => [t.title, t]));
    expect(Object.keys(byTitle).sort()).toEqual(["a", "b", long].sort());
    const aTask = byTitle.a;
    expect(aTask?.blockedBy).toEqual([byTitle.b?.id]);
    expect(team.tasks.findIndex((t) => t.title === "b")).toBeLessThan(team.tasks.findIndex((t) => t.title === "a"));
    for (const t of team.tasks) expect(d?.refs[t.id]).toEqual({ kind: "group", change: t.title });
    expect(d?.names).toEqual({ "os-a": "a", "os-b": "b", [memberNameFor(long)]: long });
    expect(d?.ext.group).toEqual({
      changeOrder: [long, "a", "b"], // launch order = membership order (the launcher skips blocked tasks)
      base: "develop",
      merge: "develop",
      outOfGroup: { a: ["zzz"] },
      skipped: [],
    });
    expect(team.tasks.every((t) => t.owner === undefined || t.owner === null || typeof t.owner === "string")).toBe(true);
  });
});
