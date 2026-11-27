/**
 * The `openspec-apply` seed and preflight (tasks 7.27 #E14, 7.28 #E15, 7.29 #E16, 7.30 #E20 and the apply
 * checks of 7.3 #E3, 7.5 #X1, 7.7 #X3): granularity, ticked boxes, section descriptions, default barrier and
 * hint overrides, the Review task, refs, and every apply start code with nothing left behind.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codePointLength } from "../../../shared/text.js";
import type { Team } from "../../../shared/types.js";
import { runPreflight } from "../profiles.js";
import { analyzeApply, REVIEW_KEY, SECTION_DESCRIPTION_MAX, sectionDescription } from "../seed-apply.js";
import type { SeedTask } from "../seed-core.js";
import type { SourceTask } from "../tasks-source.js";
import { textHash } from "../tasks-source.js";
import { createApplyEnv, ok, wideTasks } from "./apply-env.js";
import { APPLY } from "./env.js";
import { serverTasks } from "./server-src.js";

const { parseTasksMarkdown } = serverTasks;

const analyze = (md: string, maxTasks = 50) => analyzeApply({ change: "x", tasks: parseTasksMarkdown(md) as SourceTask[], raw: md, maxTasks });
const byKey = (tasks: readonly SeedTask[]): Record<string, SeedTask> => Object.fromEntries(tasks.map((t) => [t.key, t]));
/** `title → titles of blockers` of a plan (Review excluded). */
function deps(md: string, maxTasks = 50): Record<string, string[]> {
  const plan = analyze(md, maxTasks).plan;
  const map = byKey(plan.tasks);
  return Object.fromEntries(plan.tasks.filter((t) => t.key !== REVIEW_KEY).map((t) => [t.title.split(" ")[0] as string, (t.blockedBy ?? []).map((k) => (map[k] as SeedTask).title.split(" ")[0] as string)]));
}
const lines = (...l: string[]): string => `${l.join("\n")}\n`;

describe("seed granularity (7.27 #E14)", () => {
  it.each([
    [47, "box"],
    [48, "box"],
  ] as const)("%i unticked boxes in 9 sections: one task per checkbox plus Review (≤ 50 in total)", (n, mode) => {
    const a = analyze(wideTasks(n, 9));
    expect(a.mode).toBe(mode);
    expect(a.units).toBe(n);
    expect(a.plan.tasks).toHaveLength(n + 1);
    expect(a.plan.tasks.at(-1)?.key).toBe(REVIEW_KEY);
    expect(a.plan.tasks[0]?.title.startsWith("1.1 ")).toBe(true);
  });

  it("49 boxes in 9 sections: one task per section plus Review", () => {
    const a = analyze(wideTasks(49, 9));
    expect(a.mode).toBe("section");
    expect(a.units).toBe(9);
    expect(a.plan.tasks.map((t) => t.title)).toEqual([...Array.from({ length: 9 }, (_, i) => `Section ${i + 1}: Section ${i + 1}`), "Review"]);
  });

  it("48 boxes in 48 sections stay per-checkbox; 49 boxes in 49 sections are too_many_tasks and nothing is created", async () => {
    expect(analyze(wideTasks(48, 48)).mode).toBe("box");
    const wide = analyze(wideTasks(49, 49));
    expect(wide.mode).toBe("section");
    expect(wide.units).toBe(49);
    const e = await createApplyEnv({ tasksMd: wideTasks(49, 49) });
    expect(await e.start({ template: APPLY, goal: "x" })).toMatchObject({ ok: false, error: "too_many_tasks" });
    expect(e.rt.store.list()).toEqual([]);
    expect(e.api.sidecar.ids()).toEqual([]);
  });

  it("the cap follows maxTasks (maxTasks 10: 8 boxes per checkbox, 9 per section)", () => {
    expect(analyze(wideTasks(8, 2), 10).mode).toBe("box");
    expect(analyze(wideTasks(9, 3), 10).mode).toBe("section");
  });
});

describe("ticked boxes and empty changes (7.28 #E15)", () => {
  it("a ticked box is skipped and counts as a satisfied blocker (even in an otherwise open section)", () => {
    const md = lines("## 1. A", "- [x] 1.1 done", "- [ ] 1.2 open", "", "## 2. B", "- [ ] 2.1 next <!-- after: 1.1, 1.2 -->");
    const a = analyze(md);
    expect(a.unticked).toBe(2);
    expect(deps(md)).toEqual({ "1.2": [], "2.1": ["1.2"] });
  });

  it("one unticked box ⇒ 1 task + Review; the Review task is blocked by every unit", () => {
    const a = analyze(lines("## 1. A", "- [ ] 1.1 only"));
    expect(a.plan.tasks.map((t) => t.key)).toEqual(["b2", REVIEW_KEY]);
    expect(a.plan.tasks[1]?.blockedBy).toEqual(["b2"]);
  });

  it.each([
    ["all ticked", lines("## 1. A", "- [x] 1.1 a", "- [x] 1.2 b")],
    ["no checkbox at all", lines("## 1. A", "just prose")],
  ])("%s ⇒ nothing_to_do before anything is created", async (_n, md) => {
    const e = await createApplyEnv({ tasksMd: md });
    expect(await e.start({ template: APPLY, goal: "x" })).toMatchObject({ ok: false, error: "nothing_to_do" });
    expect(e.rt.store.list()).toEqual([]);
  });
});

describe("section tasks fit the caps (7.29 #E16)", () => {
  const box = (id: string, text: string): SourceTask => ({ id, text, done: false, line: 1, group: "" });
  const descr = (n: number, textLen: number) => sectionDescription(Array.from({ length: n }, (_, i) => box(`1.${i + 1}`, "x".repeat(textLen))), 1);

  it("15 boxes × 250 chars: ≤ 2000 characters, each line = id + 80 chars, ends with the pointer, refs keep all 15 ids", () => {
    const md = lines("## 1. Wide", ...Array.from({ length: 15 }, (_, i) => `- [ ] 1.${i + 1} ${"y".repeat(250)}`), "", "## 2. Filler", ...Array.from({ length: 40 }, (_, i) => `- [ ] 2.${i + 1} filler`));
    const a = analyze(md);
    expect(a.mode).toBe("section");
    const sec = a.plan.tasks[0] as SeedTask;
    expect(codePointLength(sec.description as string)).toBeLessThanOrEqual(SECTION_DESCRIPTION_MAX);
    expect(sec.description?.endsWith("full list: tasks.md section 1")).toBe(true);
    const listed = (sec.description as string).split("\n").slice(0, -1);
    expect(listed.every((l) => /^1\.\d+ y{80}$/.test(l))).toBe(true);
    expect((sec.ref as { boxes: unknown[] }).boxes).toHaveLength(15);
    expect((sec.ref as { boxes: Array<{ id: string }> }).boxes.map((b) => b.id)).toEqual(Array.from({ length: 15 }, (_, i) => `1.${i + 1}`));
  });

  it("boundary: a listing of exactly 1999/2000 characters is kept whole; 2001 is cut with the pointer, never above 2000", () => {
    // 1 line of `1.1 ` + 80 chars = 84; n lines joined with \n. Pad the last line via text length (≤ 80) to hit the totals.
    const fit = (total: number): string => {
      const boxes: SourceTask[] = [];
      let used = 0;
      for (let i = 1; used < total; i++) {
        const id = `1.${i}`;
        const room = total - used - (used > 0 ? 1 : 0) - id.length - 1;
        const len = Math.min(80, room);
        boxes.push(box(id, "x".repeat(len)));
        used += (used > 0 ? 1 : 0) + id.length + 1 + len;
      }
      return sectionDescription(boxes, 4);
    };
    for (const total of [1999, 2000]) {
      const d = fit(total);
      expect(codePointLength(d), String(total)).toBe(total);
      expect(d.includes("full list")).toBe(false);
    }
    const cut = fit(2001);
    expect(codePointLength(cut)).toBeLessThanOrEqual(2000);
    expect(cut.endsWith("full list: tasks.md section 4")).toBe(true);
  });

  it("box text of 79/80/81 characters: the listing keeps at most the first 80", () => {
    expect(descr(1, 79)).toBe(`1.1 ${"x".repeat(79)}`);
    expect(descr(1, 80)).toBe(`1.1 ${"x".repeat(80)}`);
    expect(descr(1, 81)).toBe(`1.1 ${"x".repeat(80)}\nfull list: tasks.md section 1`); // shortened ⇒ pointer to the full text
  });

  it("multibyte text: the 80 cut never splits a code point and lengths are counted in code points", () => {
    const emoji = "😀".repeat(100);
    const line = sectionDescription([box("1.1", emoji)], 1);
    expect(line).toBe(`1.1 ${"😀".repeat(80)}\nfull list: tasks.md section 1`);
    expect([...line].every((c) => c !== "\ufffd")).toBe(true);
    const many = sectionDescription(Array.from({ length: 40 }, (_, i) => box(`1.${i + 1}`, "😀".repeat(80))), 3);
    expect(codePointLength(many)).toBeLessThanOrEqual(2000);
    expect(many.endsWith("full list: tasks.md section 3")).toBe(true);
  });
});

describe("default barrier and hint overrides (7.30 #E20)", () => {
  const md = lines("## 1. Done", "- [x] 1.1 a", "- [x] 1.2 b", "", "## 2. First", "- [ ] 2.1 c", "- [ ] 2.2 d", "", "## 3. Second", "- [ ] 3.1 e", "- [ ] 3.2 f <!-- after: 2.2 -->", "", "## 4. Docs", "<!-- after: -->", "- [ ] 4.1 g", "- [ ] 4.2 h");

  it("§1 fully ticked is skipped; §2 has no blockers; §3 waits for all of §2; 3.2 only for 2.2; §4 none; one section is parallel", () => {
    expect(deps(md)).toEqual({ "2.1": [], "2.2": [], "3.1": ["2.1", "2.2"], "3.2": ["2.2"], "4.1": [], "4.2": [] });
  });

  it("an empty section is skipped by the barrier: the nearest previous section with an unticked box counts", () => {
    const m2 = lines("## 1. A", "- [ ] 1.1 a", "", "## 2. Empty", "", "## 3. C", "- [ ] 3.1 c");
    expect(deps(m2)).toEqual({ "1.1": [], "3.1": ["1.1"] });
  });

  it("section granularity maps box hints and barriers onto section tasks", () => {
    const wide = lines("## 1. A", ...Array.from({ length: 30 }, (_, i) => `- [ ] 1.${i + 1} a`), "", "## 2. B", ...Array.from({ length: 30 }, (_, i) => `- [ ] 2.${i + 1} b`), "", "## 3. C", "<!-- after: -->", ...Array.from({ length: 3 }, (_, i) => `- [ ] 3.${i + 1} c`));
    const a = analyze(wide);
    expect(a.mode).toBe("section");
    const map = byKey(a.plan.tasks);
    expect(a.plan.tasks.filter((t) => t.key !== REVIEW_KEY).map((t) => (t.blockedBy ?? []).map((k) => (map[k] as SeedTask).title))).toEqual([[], ["Section 1: A"], []]);
  });

  it("tasks of one section carry refs with id and text hash; Review carries a review ref", () => {
    const a = analyze(lines("## 1. A", "- [ ] 1.1 first <!-- after: -->", "- [ ] Id-less"));
    const t0 = a.plan.tasks[0] as SeedTask;
    expect(t0.title).toBe("1.1 first");
    expect(t0.ref).toEqual({ boxes: [{ id: "1.1", textHash: textHash("first") }] });
    expect(textHash("first <!-- after: 1.1 -->")).toBe(textHash("  first  ")); // hint and whitespace do not change the hash
    expect((a.plan.tasks[1] as SeedTask).ref).toEqual({ boxes: [{ id: "L3", textHash: textHash("Id-less") }] });
    expect((a.plan.tasks.at(-1) as SeedTask).ref).toEqual({ review: true });
  });

  it("hint reports reach the plan notes (ids/codes only) and a hint-only problem never makes the seed incomplete", async () => {
    const m = lines("## 1. A", "- [ ] 1.1 a <!-- after: 1.2, 9.9 -->", "- [ ] 1.2 b <!-- after: 1.1 -->");
    expect(analyze(m).plan.notes?.join("\n")).toMatch(/forward entry 1\.2.*\n.*unknown entry 9\.9/);
    const e = await createApplyEnv({ tasksMd: m });
    const res = await e.start({ template: APPLY, goal: "x" });
    expect(res.ok).toBe(true);
    await e.flush();
    const team = e.rt.store.list()[0] as Team;
    expect(team.tasks.map((t) => t.title)).toEqual(["1.1 a", "1.2 b", "Review"]);
    expect(e.api.teamState(team)).toBe("active");
    expect(e.api.sidecar.get(team.id)?.seedIncomplete).toBeUndefined();
  });
});

describe("a real apply start (seed through core)", () => {
  it("creates one task per checkbox + Review through the real seed; one GET, ≤ 3 sidecar writes; refs and ids line up", async () => {
    const md = lines("## 1. A", "- [ ] 1.1 first", "- [ ] 1.2 second", "", "## 2. B", "- [ ] 2.1 third");
    const e = await createApplyEnv({ tasksMd: md });
    const writes0 = e.api.sidecar.writes;
    expect((await e.start({ template: APPLY, goal: "x" })).ok).toBe(true);
    await e.flush();
    const team = e.rt.store.list()[0] as Team;
    expect(team.tasks.map((t) => [t.id, t.title, t.blockedBy])).toEqual([
      ["1", "1.1 first", []],
      ["2", "1.2 second", []],
      ["3", "2.1 third", ["1", "2"]],
      ["4", "Review", ["1", "2", "3"]],
    ]);
    expect(e.calls.filter((c) => c.method === "GET")).toHaveLength(1);
    expect(e.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(e.api.sidecar.writes - writes0).toBeLessThanOrEqual(3);
    const d = e.api.sidecar.get(team.id);
    expect(d?.kind).toBe("apply");
    expect(d?.goal).toBe("x");
    expect(Object.keys(d?.refs ?? {})).toEqual(["1", "2", "3", "4"]);
    expect(d?.refs["4"]).toEqual({ review: true });
  });

  it("works from inside .worktrees/os-<change> (the apply profile has no repo-root rule)", async () => {
    const e = await createApplyEnv({ tasksMd: lines("## 1. A", "- [ ] 1.1 a") });
    const wt = path.join(e.cwd, ".worktrees", "os-x");
    fs.mkdirSync(path.join(wt, "openspec", "changes", "x"), { recursive: true });
    fs.writeFileSync(path.join(wt, "openspec", "changes", "x", "tasks.md"), lines("## 1. A", "- [ ] 1.1 a"));
    e.known.push(wt);
    expect((await e.start({ template: APPLY, goal: "x" }, e.newSession(wt))).ok).toBe(true);
  });
});

describe("apply start codes leave nothing behind, on both start paths (7.5 #X1, 7.3 #E3 apply half)", () => {
  type Setup = (e: Awaited<ReturnType<typeof createApplyEnv>>) => void;
  const OPEN = lines("## 1. A", "- [ ] 1.1 a");
  const cases: Array<[code: string, goal: string, opts: Parameters<typeof createApplyEnv>[0], setup?: Setup]> = [
    ["invalid_args", "../../etc", { tasksMd: OPEN }],
    ["project_untrusted", "x", { tasksMd: OPEN, trusted: false }],
    ["invalid_config", "x", { tasksMd: OPEN, config: { openspecReviewSkill: "Bad Skill" } }],
    ["change_unknown", "nope", { tasksMd: OPEN }],
    ["tasks_unreadable", "x", { tasksMd: undefined }],
    ["tasks_unreadable", "x", { tasksMd: OPEN }, (e) => e.faults.push((req) => (req.method === "GET" ? { statusCode: 503, body: { success: false } } : undefined))],
    ["review_skill_missing", "x", { tasksMd: OPEN, skills: [] }],
    ["too_many_tasks", "x", { tasksMd: wideTasks(60, 60) }],
    ["nothing_to_do", "x", { tasksMd: lines("## 1. A", "- [x] 1.1 a") }],
  ];

  it.each(cases.map((c, i) => [`${c[0]} #${i}`, ...c] as const))("%s: stable code, no team, sidecar, spawn, worktree or write call", async (_n, code, goal, opts, setup) => {
    const e = await createApplyEnv({ ...opts });
    setup?.(e);
    const cmd = await e.start({ template: APPLY, goal });
    const rest = await e.restStart({ template: APPLY, goal, cwd: e.cwd });
    expect(cmd, "command path").toMatchObject({ ok: false, error: code });
    expect(rest.body, "rest path").toMatchObject({ ok: false, error: code });
    expect(e.rt.store.list()).toEqual([]);
    expect(e.api.sidecar.ids()).toEqual([]);
    expect(fs.existsSync(path.join(e.dataDir, "openspec"))).toBe(false);
    expect(e.fake.base.spawns).toEqual([]);
    expect(fs.existsSync(path.join(e.cwd, ".worktrees"))).toBe(false);
    expect(e.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("change_in_use: a second team for a change an active apply team already drives", async () => {
    const e = await createApplyEnv({ tasksMd: OPEN });
    expect((await e.start({ template: APPLY, goal: "x" })).ok).toBe(true);
    await e.flush();
    expect(await e.start({ template: APPLY, goal: "x" })).toMatchObject({ ok: false, error: "change_in_use" });
    expect(e.rt.store.list()).toHaveLength(1);
  });

  /** The env options and goal of one subset of failing conditions (index = position in `PRECEDENCE`). */
  const optionsFor = (on: (i: number) => boolean) => {
    const md = on(3) ? undefined : on(5) ? wideTasks(60, 60) : on(6) ? lines("## 1. A", "- [x] 1.1 a") : OPEN;
    return { tasksMd: md, trusted: !on(0), skills: on(4) ? [] : ["review-code"], ...(on(1) ? { config: { openspecReviewSkill: "Bad Skill" } } : {}) };
  };
  const PRECEDENCE = ["project_untrusted", "invalid_config", "change_unknown", "tasks_unreadable", "review_skill_missing", "too_many_tasks", "nothing_to_do"];

  it("the first failing check wins for every subset of {untrusted, bad config, unknown change, tasks unreadable, skill missing, too many, nothing to do}", async () => {
    for (let mask = 0; mask < 1 << PRECEDENCE.length; mask++) {
      const on = (i: number): boolean => (mask & (1 << i)) !== 0;
      const e = await createApplyEnv(optionsFor(on));
      const res = await runPreflight(e.api, "apply", on(2) ? "nope" : "x", e.cwd);
      const expected = PRECEDENCE.find((_, i) => on(i));
      expect(res.ok, `mask ${mask}`).toBe(expected === undefined);
      if (expected !== undefined) expect(res, `mask ${mask}`).toMatchObject({ error: expected });
    }
  }, 60_000);
});

describe("review skill resolution (7.7 #X3, apply half)", () => {
  const OPEN = lines("## 1. A", "- [ ] 1.1 a");
  it.each(["project", "user", "package"])("the review skill found as a %s skill passes", async () => {
    const e = await createApplyEnv({ tasksMd: OPEN, skills: ["review-code"] });
    expect(await runPreflight(e.api, "apply", "x", e.cwd)).toMatchObject({ ok: true });
  });

  it("missing ⇒ review_skill_missing naming the skill; a resolver that throws fails closed with resolver_unavailable", async () => {
    const missing = await createApplyEnv({ tasksMd: OPEN, skills: [] });
    expect(await runPreflight(missing.api, "apply", "x", missing.cwd)).toMatchObject({ ok: false, error: "review_skill_missing", details: { skill: "review-code" } });
    const throwing = await createApplyEnv({
      tasksMd: OPEN,
      openspec: {
        resolveSkill: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(await runPreflight(throwing.api, "apply", "x", throwing.cwd)).toMatchObject({ ok: false, error: "review_skill_missing", details: { detail: "resolver_unavailable" } });
    expect(missing.rt.store.list()).toEqual([]);
  });

  it("the configured skill name is the one resolved", async () => {
    const e = await createApplyEnv({ tasksMd: OPEN, skills: ["my-review"], config: { openspecReviewSkill: "my-review" } });
    expect(await runPreflight(e.api, "apply", "x", e.cwd)).toMatchObject({ ok: true });
  });
});

describe("tasks route faults during preflight (X13)", () => {
  it.each([
    ["5xx", { statusCode: 500, body: {} }],
    ["503", { statusCode: 503, body: {} }],
    ["404", { statusCode: 404, body: {} }],
    ["invalid JSON shape", ok({ nope: true })],
    ["403", { statusCode: 403, body: {} }],
  ])("GET answering %s ⇒ tasks_unreadable without blocking", async (_n, answer) => {
    const e = await createApplyEnv({ tasksMd: lines("## 1. A", "- [ ] 1.1 a") });
    e.faults.push((req) => (req.method === "GET" ? answer : undefined));
    expect(await runPreflight(e.api, "apply", "x", e.cwd)).toMatchObject({ ok: false, error: "tasks_unreadable" });
  });

  it("a GET that never answers is cut by the 10 s bound (fake clock)", async () => {
    const e = await createApplyEnv({ tasksMd: lines("## 1. A", "- [ ] 1.1 a") });
    e.faults.push((req) => (req.method === "GET" ? new Promise(() => undefined) : undefined));
    const pending = runPreflight(e.api, "apply", "x", e.cwd);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    e.clock.advance(10_000);
    expect(await pending).toMatchObject({ ok: false, error: "tasks_unreadable" });
  });
});
