/**
 * Seed engine (tasks 7.19–7.26; test-plan #E8 #E17 #X13 #R1 #D1 #D2 #S2 #P3): topological creation through
 * core ops, text caps and sanitisation in code points, crash-safe once-only seeding with the
 * `seeding`/`seeded` markers, and the call budget.
 * See change: add-agent-teams-openspec.
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { capturingLogger } from "../../../__tests__/harness/store-env.js";
import { TASK_DESCRIPTION_MAX_CHARS, TASK_TITLE_MAX_CHARS } from "../../../shared/constants.js";
import { codePointLength } from "../../../shared/text.js";
import type { Team } from "../../../shared/types.js";
import { getStartProfile } from "../../start-profiles.js";
import { createOpenspecLog } from "../log.js";
import { orderTasks, type SeedCoreDeps, type SeedPlan, seedCore, seedDescription, seedTitle } from "../seed-core.js";
import { createSidecarStore } from "../sidecar.js";
import { APPLY, createOpenspecEnv, tasksOf, tmp } from "./env.js";

const team = { id: "t_1", status: "active" } as unknown as Team;
const init = { teamId: "t_1", kind: "apply" as const, goal: "x", repo: "/repo" };

/** A core stand-in that, like core, REJECTS a `blockedBy` naming a task that does not exist yet. */
function fakeCore(opts: { refuseAt?: number; throwAt?: number } = {}) {
  const created: Array<{ id: string; title: string; description?: string; blockedBy?: string[] }> = [];
  const notices: Array<{ text: string; wake: boolean }> = [];
  const createTask = vi.fn((_t: Team, input: { title: string; description?: string; blockedBy?: string[] }, _o: { actor: string }) => {
    const n = created.length + 1;
    if (opts.throwAt === n) throw new Error("boom with SECRET");
    if (opts.refuseAt === n) return { ok: false as const, error: "task_cap_reached" };
    for (const dep of input.blockedBy ?? []) if (!created.some((c) => c.id === dep)) return { ok: false as const, error: "unknown_dependency" };
    created.push({ id: String(n), ...input });
    return { ok: true as const, data: { task: { id: String(n) } } };
  });
  const enqueueLeadNotice = vi.fn((_t: Team, n: { text: string; wake: boolean }) => void notices.push(n));
  return { created, notices, createTask, enqueueLeadNotice };
}

function deps(core: ReturnType<typeof fakeCore>, dir = tmp()): SeedCoreDeps & { sidecar: ReturnType<typeof createSidecarStore> } {
  const { logger } = capturingLogger();
  const sidecar = createSidecarStore({ dir, logger });
  return { ops: core as unknown as SeedCoreDeps["ops"], sidecar, log: createOpenspecLog({ logger }), clock: { now: () => 1000 } };
}

describe("topological order (7.19 #E8)", () => {
  it("creates in dependency order even when the list order is not; no call names a missing id", () => {
    const core = fakeCore();
    const plan: SeedPlan = { tasks: tasksOf([["a", ["b"]], ["b"], ["c"], ["d", ["b", "c"]]]) };
    const out = seedCore(deps(core), team, init, plan);
    expect(out.status).toBe("seeded");
    expect(core.created.map((c) => c.title)).toEqual(["Task b", "Task a", "Task c", "Task d"]);
    expect(core.created.find((c) => c.title === "Task a")?.blockedBy).toEqual(["1"]);
    expect(core.created.find((c) => c.title === "Task d")?.blockedBy).toEqual(["1", "3"]);
    expect(core.createTask.mock.calls.every((c) => c[2].actor === "server")).toBe(true);
  });

  it("a diamond is created base-first; a 3-cycle is skipped and named while the innocent task is created", () => {
    const core = fakeCore();
    const plan: SeedPlan = { tasks: tasksOf([["d", ["b", "c"]], ["b", ["a"]], ["c", ["a"]], ["a"], ["x", ["z"]], ["y", ["x"]], ["z", ["y"]], ["w"], ["afterx", ["x"]]]) };
    const out = seedCore(deps(core), team, init, plan);
    expect(out.status).toBe("seeded");
    expect(core.created.map((c) => c.title)).toEqual(["Task a", "Task b", "Task c", "Task d", "Task w"]);
    const notice = core.notices.map((n) => n.text).join("\n");
    for (const key of ["x", "y", "z"]) expect(notice).toContain(`skipped ${key}: cycle`);
    expect(notice).toContain("skipped afterx: depends_on_skipped");
    expect(core.notices.every((n) => n.wake === false)).toBe(true);
  });

  it("the same input twice gives the identical order", () => {
    const tasks = tasksOf([["c", ["a"]], ["b"], ["a"], ["d", ["c", "b"]]]);
    const run = () => {
      const core = fakeCore();
      seedCore(deps(core), team, init, { tasks });
      return core.created.map((c) => c.title);
    };
    expect(run()).toEqual(run());
    expect(orderTasks(tasks).order.map((t) => t.key)).toEqual(["b", "a", "c", "d"]); // lowest list index among the ready ones, every time
  });

  it("drops self edges, unknown keys and duplicate keys, and reports them", () => {
    const o = orderTasks([{ key: "a", title: "A", blockedBy: ["a", "nope"] }, { key: "a", title: "dup" }, { key: "b", title: "B", blockedBy: ["a", "a"] }]);
    expect(o.order.map((t) => t.key)).toEqual(["a", "b"]);
    expect(o.skipped).toEqual([{ key: "a", reason: "duplicate_key" }]);
    expect(o.droppedEdges).toEqual([{ key: "a", dep: "a" }, { key: "a", dep: "nope" }]);
  });

  it("stores refs under the core ids and writes the plan's sidecar extras with the seeded marker", () => {
    const core = fakeCore();
    const d = deps(core);
    seedCore(d, team, init, { tasks: [{ key: "a", title: "A", ref: { change: "a" } }, { key: "b", title: "B" }], sidecar: { names: { "os-a": "a" }, ext: { note: 1 } } });
    expect(d.sidecar.get("t_1")).toMatchObject({ seeded: true, refs: { "1": { change: "a" }, "2": "b" }, names: { "os-a": "a" }, ext: { note: 1 } });
  });
});

describe("caps in code points (7.20 #E17)", () => {
  const cp = codePointLength;
  /** No lone surrogate anywhere in the string. */
  const wellFormed = (t: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t);
  it.each([199, 200, 201, 5000])("a %s-character title ends ≤ %s code points, cut with core's marker", (n) => {
    const t = seedTitle("a".repeat(n));
    expect(cp(t)).toBe(Math.min(n, TASK_TITLE_MAX_CHARS));
    expect(t.endsWith("[…truncated]")).toBe(n > TASK_TITLE_MAX_CHARS);
  });

  it.each([1999, 2000, 2001])("a %s-character description stays within 2000 code points", (n) => {
    const d = seedDescription("b".repeat(n));
    expect(cp(d)).toBe(Math.min(n, TASK_DESCRIPTION_MAX_CHARS));
  });

  it("never ends inside a surrogate pair, whichever side of the cut the emoji falls", () => {
    for (let pad = 180; pad < 200; pad++) {
      const t = seedTitle(`${"a".repeat(pad)}${"😀".repeat(40)}`);
      expect(wellFormed(t), `pad ${pad}`).toBe(true);
      expect(cp(t)).toBeLessThanOrEqual(TASK_TITLE_MAX_CHARS);
    }
  });

  it("counts code points, not UTF-16 units: 200 emoji fit, 201 do not", () => {
    expect(cp(seedTitle("😀".repeat(200)))).toBe(200);
    expect(seedTitle("😀".repeat(200))).toBe("😀".repeat(200));
    expect(seedTitle("😀".repeat(201)).endsWith("[…truncated]")).toBe(true);
  });

  it("cuts a ZWJ sequence and a combining mark on a code-point boundary and deterministically", () => {
    const zwj = `${"a".repeat(180)}${"👨‍👩‍👧‍👦".repeat(10)}`;
    const comb = `${"a".repeat(186)}e\u0301e\u0301e\u0301e\u0301`;
    for (const s of [zwj, comb]) {
      expect(seedTitle(s)).toBe(seedTitle(s));
      expect(cp(seedTitle(s))).toBeLessThanOrEqual(200);
      expect(wellFormed(seedTitle(s))).toBe(true);
    }
  });

  it("an empty title after sanitising falls back to a placeholder", () => {
    expect(seedTitle("\u0000\u001b[31m\u202e")).toBe("(untitled)");
  });
});

describe("sanitisation (7.25 #S2)", () => {
  it("strips C0/C1, NUL, ANSI and bidi characters silently", () => {
    expect(seedTitle("a\u0000b\u0007c\u009fd\u001b[31mred\u001b[0m\u202eE\u2066F\u2069G")).toBe("abcdredEFG");
  });

  it("collapses newlines (and line separators) in titles to ONE space; keeps them in descriptions", () => {
    expect(seedTitle("one\n\ntwo\r\nthree\u2028four")).toBe("one two three four");
    expect(seedDescription("l1\nl2\r\nl3")).toBe("l1\nl2\nl3");
  });

  it("drops lone surrogates, keeps zero-width characters other than bidi formatting, is deterministic", () => {
    const raw = "a\ud800b\udc00c\u200bd";
    expect(seedTitle(raw)).toBe("abc\u200bd");
    expect(seedTitle(raw)).toBe(seedTitle(raw));
  });

  it("a 200 KB title is capped, not rejected", () => {
    const t = seedTitle("x".repeat(200_000));
    expect(codePointLength(t)).toBe(200);
  });

  it("is applied to every created task (title and description) and to lead-notice notes", () => {
    const core = fakeCore();
    seedCore(deps(core), team, init, { tasks: [{ key: "a", title: "Do\u202e it\nnow", description: "x\u0000y" }], notes: ["note\u001b[31m red\nline"] });
    expect(core.created[0]).toMatchObject({ title: "Do it now", description: "xy" });
    expect(core.notices[0]?.text).toContain("note red line");
    expect(core.notices[0]?.text).not.toContain("\u001b");
  });
});

describe("core refusal and crash safety (7.21 #X13, 7.24 #D2)", () => {
  const N = 6;
  it.each([1, 3, N])("core refuses task %s of %s: seed_incomplete, ONE waking notice, no retry, no re-seed", (k) => {
    const core = fakeCore({ refuseAt: k });
    const d = deps(core);
    const out = seedCore(d, team, init, { tasks: tasksOf(Array.from({ length: N }, (_, i) => [`t${i}`] as [string])) });
    expect(out).toMatchObject({ status: "seed_incomplete", code: "task_cap_reached", created: k - 1 });
    expect(d.sidecar.get("t_1")).toMatchObject({ seeding: { startedAt: 1000 }, seedIncomplete: { code: "task_cap_reached" } });
    expect(d.sidecar.get("t_1")?.seeded).toBeUndefined();
    expect(core.notices.filter((n) => n.wake)).toHaveLength(1);
    expect(core.notices[0]?.text).toContain("task_cap_reached");
    const calls = core.createTask.mock.calls.length;
    expect(seedCore(d, team, init, { tasks: tasksOf([["z"]]) })).toMatchObject({ status: "seed_incomplete" });
    expect(core.createTask.mock.calls.length).toBe(calls);
    expect(core.notices).toHaveLength(1);
  });

  it("a throwing core op is seed_incomplete too, and the error text never reaches the notice", () => {
    const core = fakeCore({ throwAt: 2 });
    const out = seedCore(deps(core), team, init, { tasks: tasksOf([["a"], ["b"]]) });
    expect(out).toMatchObject({ status: "seed_incomplete", code: "create_threw" });
    expect(JSON.stringify(core.notices)).not.toContain("SECRET");
  });

  it("a failed FIRST sidecar write creates nothing and answers refused", () => {
    const core = fakeCore();
    const { logger } = capturingLogger();
    const sidecar = createSidecarStore({ dir: tmp(), logger, fs: { mkdir() {}, readFile: () => "", readdir: () => [], rename() {}, unlink() {}, writeFile() { throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }); } } });
    expect(seedCore({ ops: core as never, sidecar, log: createOpenspecLog({ logger }), clock: { now: () => 1 } }, team, init, { tasks: tasksOf([["a"]]) })).toEqual({ status: "refused", error: "sidecar_write_failed" });
    expect(core.createTask).not.toHaveBeenCalled();
  });

  it("a failed `seeded` write after the last task is reported incomplete (never silently half-sealed)", () => {
    const core = fakeCore();
    const { logger } = capturingLogger();
    let writes = 0;
    const inner = tmp();
    const sidecar = createSidecarStore({
      dir: inner,
      logger,
      fs: { mkdir: () => {}, readFile: () => "", readdir: () => [], rename: () => {}, unlink: () => {}, writeFile: () => { if (++writes >= 2) throw new Error("EROFS"); } },
    });
    const out = seedCore({ ops: core as never, sidecar, log: createOpenspecLog({ logger }), clock: { now: () => 1 } }, team, init, { tasks: tasksOf([["a"]]) });
    expect(out).toMatchObject({ status: "seed_incomplete", code: "sidecar_write_failed" });
    expect(core.notices.filter((n) => n.wake)).toHaveLength(1);
  });
});

describe("seed once, through the real start flow (7.22 #R1)", () => {
  async function started(e: Awaited<ReturnType<typeof createOpenspecEnv>>, n = 3) {
    e.kind("apply", { plan: () => ({ tasks: tasksOf(Array.from({ length: n }, (_, i) => [`t${i}`, i > 0 ? [`t${i - 1}`] : undefined] as [string, string[] | undefined])) }) });
    const res = await e.restStart({ template: APPLY, goal: "x", cwd: e.cwd });
    expect(res.status).toBe(200);
    return e.rt.store.list()[0] as Team;
  }

  it("lead_bound twice (rebind, reconnect, racing paths): exactly N TaskCreate calls and one seeding→seeded pair", async () => {
    const e = await createOpenspecEnv();
    const spy = vi.spyOn(e.rt.ops, "createTask");
    const t = await started(e);
    await e.bindLead(t, "S-lead-a");
    e.rt.store.bindLead(t.id, "S-lead-b"); // second bind within the same tick
    e.rt.store.bindLead(t.id, "S-lead-a"); // and a rebind
    await e.flush();
    await new Promise((r) => setTimeout(r, 1000)); // 1 s apart
    e.rt.store.bindLead(t.id, "S-lead-b");
    await e.flush();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(t.tasks).toHaveLength(3);
    expect(e.api.sidecar.get(t.id)).toMatchObject({ seeded: true });
    expect(e.api.sidecar.writes).toBe(2);
  });

  it("the profile seed called again (even by a second path) creates nothing", async () => {
    const e = await createOpenspecEnv();
    const t = await started(e);
    await e.bindLead(t);
    await e.flush();
    const spy = vi.spyOn(e.rt.ops, "createTask");
    await getStartProfile(APPLY)?.seed(t);
    expect(spy).not.toHaveBeenCalled();
    expect(t.tasks).toHaveLength(3);
  });

  it("regression: a second seed call on an already-seeded team is a no-op — it never marks the team seed_incomplete plan_missing", async () => {
    const e = await createOpenspecEnv();
    const t = await started(e);
    await e.bindLead(t);
    await e.flush();
    const before = e.api.sidecar.writes;
    const wakes = () => e.rt.store.mailLog(t.id).filter((m) => m.to === "lead" && m.kind === "notice" && m.wake).length;
    const wakesBefore = wakes();
    await getStartProfile(APPLY)?.seed(t); // the snapshot plan was consumed by the first seed
    expect(e.api.sidecar.get(t.id)).toMatchObject({ seeded: true });
    expect(e.api.sidecar.get(t.id)?.seedIncomplete).toBeUndefined();
    expect(e.api.sidecar.get(t.id)?.noticed.seed_incomplete).toBeUndefined();
    expect(e.api.teamState(t)).toBe("active");
    expect(e.api.sidecar.writes).toBe(before);
    expect(wakes()).toBe(wakesBefore);
  });
});

describe("restart (7.23 #D1, 7.24 #D2)", () => {
  /** Persist the team store and rebuild the whole runtime over the same data dir (what a restart leaves on disk). */
  async function restart(e: Awaited<ReturnType<typeof createOpenspecEnv>>) {
    e.rt.persistence.flushSync();
    await new Promise((r) => setTimeout(r, 60)); // the mail log is appended asynchronously: let the writes land
    return createOpenspecEnv({ dataDir: e.dataDir });
  }
  const notices = (e: Awaited<ReturnType<typeof createOpenspecEnv>>, t: Team) => e.rt.store.mailLog(t.id).filter((m) => m.to === "lead" && m.kind === "notice");

  it("seeded:true survives a restart: no TaskCreate, refs reloaded, the team is active", async () => {
    const e = await createOpenspecEnv();
    const t = e.team("apply", "x", { seeded: true });
    const out = seedCore({ ops: e.rt.ops, sidecar: e.api.sidecar, log: e.api.log, clock: e.clock }, t, { teamId: t.id, kind: "apply", goal: "x", repo: e.cwd }, { tasks: tasksOf([["a"], ["b", ["a"]]]) });
    expect(out.status).toBe("seeded");
    const e2 = await restart(e);
    const spy = vi.spyOn(e2.rt.ops, "createTask");
    const t2 = e2.rt.store.get(t.id) as Team;
    expect(t2.tasks).toHaveLength(2);
    expect(e2.api.sidecar.get(t.id)?.refs).toEqual({ "1": "a", "2": "b" });
    expect(e2.api.teamState(t2)).toBe("active");
    expect(seedCore({ ops: e2.rt.ops, sidecar: e2.api.sidecar, log: e2.api.log, clock: e2.clock }, t2, { teamId: t.id, kind: "apply", goal: "x", repo: e.cwd }, { tasks: tasksOf([["z"]]) })).toEqual({ status: "already_seeded" });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2, 3])("killed after the marker and %s of 3 tasks: seed_incomplete, no re-seed, ONE waking notice across 3 restarts", async (k) => {
    const e = await createOpenspecEnv();
    const t = e.team("apply", "x", { seeded: true }); // core marks `seeded` BEFORE the profile seed runs
    e.api.sidecar.create({ teamId: t.id, kind: "apply", goal: "x", repo: e.cwd }, (d) => void (d.seeding = { startedAt: 1 }));
    for (let i = 0; i < k; i++) e.rt.ops.createTask(t, { title: `T${i}` }, { actor: "server" });
    let cur = await restart(e); // kill -9 here: the marker is on disk, `seeded` is not
    for (let round = 0; round < 3; round++) {
      const tr = cur.rt.store.get(t.id) as Team;
      expect(tr.tasks).toHaveLength(k);
      expect(cur.api.teamState(tr)).toBe("seed_incomplete");
      expect(notices(cur, tr).filter((m) => m.wake)).toHaveLength(1);
      const spy = vi.spyOn(cur.rt.ops, "createTask");
      expect(seedCore({ ops: cur.rt.ops, sidecar: cur.api.sidecar, log: cur.api.log, clock: cur.clock }, tr, { teamId: t.id, kind: "apply", goal: "x", repo: e.cwd }, { tasks: tasksOf([["z"]]) }).status).toBe("seed_incomplete");
      expect(spy).not.toHaveBeenCalled();
      cur = await restart(cur);
    }
  });

  it("a sealed seed (all tasks + seeded:true on disk) restarts as normal with no notice", async () => {
    const e = await createOpenspecEnv();
    const t = e.team("apply", "x", { seeded: true });
    e.rt.ops.createTask(t, { title: "T0" }, { actor: "server" });
    e.api.sidecar.create({ teamId: t.id, kind: "apply", goal: "x", repo: e.cwd }, (d) => void ((d.seeding = { startedAt: 1 }), (d.seeded = true)));
    const e2 = await restart(e);
    const t2 = e2.rt.store.get(t.id) as Team;
    expect(e2.api.teamState(t2)).toBe("active");
    expect(notices(e2, t2)).toHaveLength(0);
  });
});

describe("call budget (7.26 #P3, seed-core part)", () => {
  it("48 tasks + Review: 49 TaskCreate calls and at most 3 sidecar writes", () => {
    const core = fakeCore();
    const d = deps(core);
    const tasks = [...Array.from({ length: 48 }, (_, i) => ({ key: `t${i}`, title: `T${i}` })), { key: "review", title: "Review", blockedBy: Array.from({ length: 48 }, (_, i) => `t${i}`) }];
    expect(seedCore(d, team, init, { tasks }).status).toBe("seeded");
    expect(core.createTask).toHaveBeenCalledTimes(49);
    expect(d.sidecar.writes).toBeLessThanOrEqual(3);
    expect(path.basename(d.sidecar.dir)).toBeTruthy();
  });
});
