/**
 * Hook budgets (design D7, regression gates not SLOs): the hot path with a real `true` hook, and the
 * concurrency saturation burst under the 2/team + 4/global limits on the fake clock.
 * See change: add-agent-teams-templates-hooks (test-plan #P1, #P2).
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/index.js";
import type { OpGateResult } from "../extension-points.js";
import { HOOK_DEADLINE_MARGIN_MS } from "../hook-engine.js";
import { defaultHookIo } from "../hook-run.js";
import { advance, createHarness, FakeProcs, task, tmpCwd } from "./hook-fakes.js";

const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;

describe("hook hot path overhead (12.30, #P1)", () => {
  it("200 sequential TaskCompleted gates with hook `true`: p95 ≤ 150 ms, p99 ≤ 400 ms", async () => {
    const h = createHarness({ io: defaultHookIo, cwd: tmpCwd() });
    const team = h.makeTeam({ hooks: { TaskCompleted: [{ command: "true" }] } });
    team.tasks = [task({ id: "3", owner: "alice" })];
    const ms: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const res = await h.gates.taskCompleted(h.input("TaskUpdate", team, "alice", { id: "3", status: "completed", result: "r" }));
      ms.push(performance.now() - t0);
      expect(res).toBeUndefined();
    }
    ms.sort((a, b) => a - b);
    expect(percentile(ms, 95)).toBeLessThanOrEqual(150);
    expect(percentile(ms, 99)).toBeLessThanOrEqual(400);
    expect(h.deps.counters.get("hook_runs")).toBe(200);
  }, 120_000);
});

describe("hook concurrency saturation (12.31, #P2)", () => {
  it("20 members complete at once, 200 ms hooks, limits 2/team 4/global: every call answers ≤ 12 000 ms, none is busy", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const procs = new FakeProcs(clock);
    procs.script([{ code: 0, afterMs: 200 }]);
    const h = createHarness({ clock, io: procs.io() });
    const t0 = clock.now();
    const answered: number[] = [];
    const calls: Array<Promise<OpGateResult>> = [];
    for (let t = 0; t < 5; t++) {
      const team = h.makeTeam({ id: `team-${t}`, hooks: { TaskCompleted: [{ command: "x" }] } });
      team.members = Array.from({ length: 4 }, (_, m) => ({ ...team.members[0]!, name: `m${m}` }));
      team.tasks = team.members.map((m, i) => task({ id: String(i + 1), owner: m.name }));
      for (const m of team.members) {
        const id = String(team.members.indexOf(m) + 1);
        calls.push(
          h.gates.taskCompleted(h.input("TaskUpdate", team, m.name, { id, status: "completed" })).then((r) => {
            answered.push(clock.now() - t0);
            return r;
          }),
        );
      }
    }
    for (let step = 0; step < 40 && answered.length < calls.length; step++) await advance(clock, 100);
    const results = await Promise.all(calls);
    expect(results.every((r) => r === undefined)).toBe(true);
    expect(answered).toHaveLength(20);
    expect(Math.max(...answered)).toBeLessThanOrEqual(12_000 - HOOK_DEADLINE_MARGIN_MS);
    expect(procs.peakAlive).toBeLessThanOrEqual(4);
    expect(h.deps.counters.get("hook_busy")).toBe(0);
  });
});
