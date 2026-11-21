import { describe, expect, it } from "vitest";
import { classify, teardownPlan, type WorktreeFacts } from "../outcome.ts";

describe("#E15 outcome classification", () => {
  const run = async (opts: { change: string; plan?: string[]; fetches: (string[] | null)[]; blocked?: boolean }) => {
    const queue = [...opts.fetches];
    const sleeps: number[] = [];
    const r = await classify({
      change: opts.change,
      planArchive: opts.plan ?? [],
      fetchArchive: async () => (queue.length > 1 ? (queue.shift() as string[] | null) : (queue[0] ?? null)),
      blockedFileExists: () => opts.blocked ?? false,
      sleep: async (ms) => void sleeps.push(ms),
    });
    return { ...r, sleeps };
  };

  it("(a) a new dated archive dir for the change -> shipped", async () => {
    expect((await run({ change: "c", fetches: [["2026-11-21-c"]] })).outcome).toBe("shipped");
  });
  it("(a') an archive dir that already existed at plan time does not count", async () => {
    const r = await run({ change: "c", plan: ["2026-01-01-c"], fetches: [["2026-01-01-c"]] });
    expect(r.outcome).toBe("incomplete");
  });
  it("(b) a similarly named archive is not a match", async () => {
    expect((await run({ change: "auth", fetches: [["2026-01-01-fix-auth"]] })).outcome).toBe("incomplete");
  });
  it("(c) absent on first fetch, present on re-fetch after 30 s -> shipped with exactly 2 fetches", async () => {
    const r = await run({ change: "c", fetches: [[], ["2026-11-21-c"]] });
    expect(r).toMatchObject({ outcome: "shipped", fetches: 2 });
    expect(r.sleeps).toEqual([30_000]);
  });
  it("(d) absent + SHIP_IT_BLOCKED.md -> blocked", async () => {
    expect((await run({ change: "c", fetches: [[]], blocked: true })).outcome).toBe("blocked");
  });
  it("(e) absent, no file -> incomplete", async () => {
    expect((await run({ change: "c", fetches: [[]] })).outcome).toBe("incomplete");
  });
  it("(f) 3 fetch failures -> unknown", async () => {
    const r = await run({ change: "c", fetches: [null] });
    expect(r).toMatchObject({ outcome: "unknown", fetches: 3 });
  });
});

describe("#E17 teardown plan per outcome", () => {
  const facts = (o: Partial<WorktreeFacts> = {}): WorktreeFacts => ({
    registered: true,
    dirt: [],
    aheadOfDevelop: 0,
    midOperation: false,
    branchExists: true,
    ...o,
  });
  const ops = (p: ReturnType<typeof teardownPlan>) => p.steps.map((s) => s.op);

  it("shipped + worktree gone -> prune, branch -D if present", () => {
    expect(ops(teardownPlan("shipped", facts({ registered: false })))).toEqual(["prune", "branch-delete"]);
    expect(ops(teardownPlan("shipped", facts({ registered: false, branchExists: false })))).toEqual(["prune"]);
  });
  it("shipped + only .pi/settings.json dirt -> remove force, branch -D", () => {
    const p = teardownPlan("shipped", facts({ dirt: [".pi/settings.json"] }));
    expect(ops(p)).toEqual(["remove", "branch-delete"]);
    expect(p.steps[0]).toEqual({ op: "remove", force: true, deleteBranch: false });
    expect(p.result).toBe("shipped");
  });
  it("shipped + other dirt -> kept", () => {
    const p = teardownPlan("shipped", facts({ dirt: ["src/a.ts"] }));
    expect(p).toMatchObject({ result: "kept", steps: [] });
  });
  it("blocked -> wip-commit + push, worktree kept", () => {
    const p = teardownPlan("blocked", facts({ dirt: ["a.ts"] }));
    expect(ops(p)).toEqual(["wip-commit", "push"]);
    expect(p.result).toBe("kept");
  });
  it("incomplete/failed + clean + 0 ahead -> remove, branch -D", () => {
    for (const o of ["incomplete", "failed"] as const) {
      const p = teardownPlan(o, facts());
      expect(ops(p)).toEqual(["remove", "branch-delete"]);
      expect(p.result).toBe(o);
    }
  });
  it("incomplete + work -> wip-commit, push, remove; branch kept", () => {
    const p = teardownPlan("incomplete", facts({ dirt: ["a.ts", ".pi/settings.json"] }));
    expect(ops(p)).toEqual(["wip-commit", "push", "remove"]);
    expect(p.result).toBe("incomplete");
  });
  it("incomplete + commits ahead but clean -> push, remove; branch kept", () => {
    expect(ops(teardownPlan("incomplete", facts({ aheadOfDevelop: 2 })))).toEqual(["push", "remove"]);
  });
  it("mid-merge / rebase / detached -> kept, no steps", () => {
    for (const o of ["incomplete", "failed", "blocked"] as const) {
      expect(teardownPlan(o, facts({ midOperation: true, dirt: ["a"] }))).toMatchObject({ result: "kept", steps: [] });
    }
  });
  it("unknown -> kept, no git action", () => {
    expect(teardownPlan("unknown", facts({ dirt: ["a"] }))).toMatchObject({ result: "kept", steps: [] });
  });
});
