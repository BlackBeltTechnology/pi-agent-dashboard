/**
 * Hook runner + gates (design D7): exit-code semantics, caps, deadline/budget, concurrency, env and
 * stdin contract, spawn errors/timeouts/notices, retry cap, shutdown. The gates run over minimal fakes
 * (`createHarness`); fake children + the fake clock make budget rows deterministic, real `bash` runs
 * the stdin/env/tree-kill rows. Lane-level rows (re-validation, supersession, loops) live in
 * `hooks.integration.test.ts`.
 * See change: add-agent-teams-templates-hooks (test-plan #E8, #E24–#E31, #X1–#X5, #S3, #S4, #S12, #R12).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/index.js";
import type { TeamHooks } from "../../shared/types.js";
import type { OpGateBlock, OpGateResult } from "../extension-points.js";
import { HOOK_DEADLINE_MARGIN_MS, HookShutdownError } from "../hook-engine.js";
import { defaultHookIo, HOOK_STREAM_CAP_BYTES } from "../hook-run.js";
import { parseTemplate } from "../template-parse.js";
import { advance, createHarness, FakeProcs, type Harness, task, tmpCwd, waitFor } from "./hook-fakes.js";

const BUDGET = 12_000;
const DEADLINE = BUDGET - HOOK_DEADLINE_MARGIN_MS;
const completion = (h: Harness, team: ReturnType<Harness["makeTeam"]>, who = "alice", id = "3", result = "done") => h.gates.taskCompleted(h.input("TaskUpdate", team, who, { id, status: "completed", result }));
const hooksOf = (cmds: Array<string | { command: string; timeoutMs?: number }>, event: keyof TeamHooks = "TaskCompleted"): TeamHooks => ({
  [event]: cmds.map((c) => (typeof c === "string" ? { command: c } : c)),
});
const block = (r: OpGateResult): OpGateBlock => {
  expect(r).toMatchObject({ block: true });
  return r as OpGateBlock;
};

function fakeSetup(config?: Record<string, unknown>) {
  const clock = new FakeClock(1_700_000_000_000);
  const procs = new FakeProcs(clock);
  const h = createHarness({ clock, io: procs.io(), ...(config ? { config } : {}) });
  return { clock, procs, h };
}

/** Real bash children, fake clock; `env` replaces the server env the allowlist filters. */
function realSetup(env: NodeJS.ProcessEnv = process.env, config?: Record<string, unknown>) {
  const cwd = tmpCwd();
  const h = createHarness({ io: { ...defaultHookIo, env: () => env }, cwd, ...(config ? { config } : {}) });
  return { cwd, h, out: (name: string) => path.join(cwd, name) };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

describe("hook definition limits at load (12.1, test-plan #E8)", () => {
  const template = (cmds: string[], event = "TaskCompleted") =>
    `---\nname: t\ndescription: d\nmembers:\n  - { name: alice }\nhooks:\n  ${event}:\n${cmds.map((c) => `    - { command: ${JSON.stringify(c)} }`).join("\n")}\n---\nbody\n`;
  const codes = (text: string) => ({ errors: parseTemplate(text, "t").errors.map((e) => e.code), warnings: parseTemplate(text, "t").warnings.map((w) => w.code) });

  it("3 commands are valid, 4 → too_many_hooks", () => {
    expect(codes(template(["a", "b", "c"])).errors).toEqual([]);
    expect(codes(template(["a", "b", "c", "d"])).errors).toContain("too_many_hooks");
  });

  it("a 2000-char command is valid, 2001 → hook_command_too_long", () => {
    expect(codes(template(["x".repeat(2000)])).errors).toEqual([]);
    expect(codes(template(["x".repeat(2001)])).errors).toContain("hook_command_too_long");
  });

  it("an unknown event key is a warning only", () => {
    const out = codes(template(["a"], "TaskDeleted"));
    expect(out.errors).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});

describe("exit-code interpretation (12.2, #E24)", () => {
  it.each([
    [0, "allow"],
    [1, "allow"],
    [2, "block"],
    [3, "allow"],
    [127, "allow"],
    [130, "allow"],
    [255, "allow"],
    [null, "allow"],
  ] as const)("exit %s → %s", async (code, verdict) => {
    const { procs, h } = fakeSetup();
    procs.script([{ code, stderr: "why" }]);
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    const res = await completion(h, team);
    if (verdict === "block") expect(block(res)).toMatchObject({ code: "hook_blocked", feedback: "why" });
    else expect(res).toBeUndefined();
    const errors = h.deps.counters.get("hook_errors", team.id);
    expect(errors).toBe(verdict === "allow" && code !== 0 ? 1 : 0);
  });

  it.each([
    [[1, 2], "block", 2],
    [[2, 0], "block", 1],
    [[0, 0, 2], "block", 3],
    [[1, 1, 1], "allow", 3],
  ] as const)("sequence %j: first exit 2 ends the sequence → %s after %i spawns", async (codes, verdict, spawned) => {
    const { procs, h } = fakeSetup();
    procs.script((i) => ({ code: codes[i] ?? 0, stderr: "nope" }));
    const team = h.makeTeam({ hooks: hooksOf(codes.map((_, i) => `c${i}`)) });
    const res = await completion(h, team);
    expect(procs.spawns).toHaveLength(spawned);
    expect(procs.spawns.map((s) => s.args[1])).toEqual(codes.slice(0, spawned).map((_, i) => `c${i}`));
    if (verdict === "block") expect(block(res)).toMatchObject({ code: "hook_blocked", feedback: "nope" });
    else expect(res).toBeUndefined();
  });

  it("a non-blocking exit is logged without the output", async () => {
    const { procs, h } = fakeSetup();
    procs.script([{ code: 1, stderr: "SECRET-IN-STDERR" }]);
    await completion(h, h.makeTeam({ hooks: hooksOf(["x"]) }));
    const line = h.logs.info.find((l) => l.includes("hook event=TaskCompleted"));
    expect(line).toMatch(/outcome=exit code=1 ms=\d+/);
    expect(h.logs.info.join("\n")).not.toContain("SECRET");
  });
});

describe("exit 2 degenerate output (12.3, #E25)", () => {
  const blockWith = async (stderr: string | Buffer, code = 2) => {
    const { procs, h } = fakeSetup();
    procs.script([{ code, stderr }]);
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    return { res: await completion(h, team), h, team };
  };

  it("empty stderr blocks with the default feedback", async () => {
    expect(block((await blockWith("")).res).feedback).toBe("hook blocked (no output)");
    expect(block((await blockWith("  \n ")).res).feedback).toBe("hook blocked (no output)");
  });

  it("control characters are stripped", async () => {
    const fb = block((await blockWith("\u001b(31mfail\u0007")).res).feedback;
    expect(fb).toContain("fail");
    expect(fb).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  });

  it("2000 characters are kept whole, 2001 are cut to 2000", async () => {
    expect(block((await blockWith("a".repeat(2000))).res).feedback).toHaveLength(2000);
    expect(block((await blockWith("a".repeat(2001))).res).feedback).toBe("a".repeat(2000));
  });

  it("65536 bytes of stderr with exit 2 block with no overflow; 65537 still block, first 2000 chars, overflow counted", async () => {
    const ok = await blockWith("b".repeat(HOOK_STREAM_CAP_BYTES));
    expect(block(ok.res).feedback).toBe("b".repeat(2000));
    expect(ok.h.deps.counters.get("hook_overflow", ok.team.id)).toBe(0);
    const over = await blockWith("b".repeat(HOOK_STREAM_CAP_BYTES + 1));
    expect(block(over.res).feedback).toBe("b".repeat(2000));
    expect(over.h.deps.counters.get("hook_overflow", over.team.id)).toBe(1);
    expect(over.h.deps.counters.get("hook_blocks", over.team.id)).toBe(1);
  });
});

describe("stream caps (12.4, #E26)", () => {
  it.each(["stdout", "stderr"] as const)("%s: 65536 bytes are fine, 65537 count one overflow, the event proceeds and the tree is reaped", async (stream) => {
    const at = async (bytes: number) => {
      const { procs, h } = fakeSetup();
      procs.script([{ code: 0, [stream]: "z".repeat(bytes) }]);
      const team = h.makeTeam({ hooks: hooksOf(["x"]) });
      const res = await completion(h, team);
      await Promise.resolve();
      return { res, overflow: h.deps.counters.get("hook_overflow", team.id), kills: procs.kills.length };
    };
    expect(await at(HOOK_STREAM_CAP_BYTES)).toEqual({ res: undefined, overflow: 0, kills: 0 });
    expect(await at(HOOK_STREAM_CAP_BYTES + 1)).toEqual({ res: undefined, overflow: 1, kills: 1 });
  });
});

describe("timeout vs the shared deadline (12.5, #E27)", () => {
  it.each([
    [1, 1],
    [9999, 9999],
    [10_000, 10_000],
    [12_000, DEADLINE],
    [60_000, DEADLINE],
  ])("timeoutMs %i kills the hook at %i fake ms and the gate answers inside the budget", async (timeoutMs, killAt) => {
    const { clock, procs, h } = fakeSetup();
    const team = h.makeTeam({ hooks: hooksOf([{ command: "sleepy", timeoutMs }]) });
    const t0 = clock.now();
    let answeredAt = -1;
    const gate = completion(h, team).then((r) => {
      answeredAt = clock.now() - t0;
      return r;
    });
    await advance(clock, Math.max(0, killAt - 1));
    expect(procs.kills).toHaveLength(0);
    await advance(clock, 1);
    expect(await gate).toBeUndefined(); // timeout allows
    expect(procs.kills).toHaveLength(1);
    expect(answeredAt).toBe(killAt);
    expect(answeredAt).toBeLessThanOrEqual(BUDGET);
    expect(answeredAt).toBeLessThan(15_000);
  });

  it("two commands of 10 s share one budget: the second is killed at the deadline, not 10 s after the first", async () => {
    const { clock, procs, h } = fakeSetup();
    procs.script((i) => (i === 0 ? { code: 0, afterMs: 9000 } : { code: 0, afterMs: 60_000 }));
    const team = h.makeTeam({ hooks: hooksOf([{ command: "a", timeoutMs: 10_000 }, { command: "b", timeoutMs: 10_000 }]) });
    const t0 = clock.now();
    let answeredAt = -1;
    const gate = completion(h, team).then((r) => {
      answeredAt = clock.now() - t0;
      return r;
    });
    await advance(clock, 9000);
    expect(procs.spawns).toHaveLength(2);
    expect(procs.spawns[1]?.at - t0).toBe(9000);
    await advance(clock, DEADLINE - 9000);
    expect(await gate).toBeUndefined();
    expect(answeredAt).toBe(DEADLINE);
    expect(procs.kills).toHaveLength(1);
  });

  it("the default per-command timeout is hookTimeoutMs capped by the budget", async () => {
    const { clock, procs, h } = fakeSetup({ hookTimeoutMs: 5000 });
    const team = h.makeTeam({ hooks: hooksOf(["sleepy"]) });
    const gate = completion(h, team);
    await advance(clock, 4999);
    expect(procs.kills).toHaveLength(0);
    await advance(clock, 1);
    await gate;
    expect(procs.kills).toHaveLength(1);
  });
});

describe("stdin payload contract (12.6, #E28)", () => {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;

  it("TaskCompleted: one JSON object from store state, unicode/quotes/newlines/U+2028 survive", async () => {
    const { h, cwd, out } = realSetup();
    const result = `ünï "quoted" \\ back\nnew\u2028line 😀`;
    const team = h.makeTeam({ leadCwd: cwd, name: "alpha", hooks: hooksOf([`cat > ${out("p.json")}`]) });
    team.tasks = [task({ id: "3", title: "T", description: "D", owner: "alice", blockedBy: ["1"] })];
    expect(await completion(h, team, "alice", "3", result)).toBeUndefined();
    const p = readJson(out("p.json"));
    expect(Object.keys(p).sort()).toEqual(["cwd", "hook_event_name", "member", "memberCwd", "task", "team"]);
    expect(p).toMatchObject({ hook_event_name: "TaskCompleted", team: { id: team.id, name: "alpha" }, cwd, member: "alice", memberCwd: "/work" });
    expect(p.task).toEqual({ id: "3", title: "T", description: "D", status: "completed", owner: "alice", blockedBy: ["1"], result });
  });

  it("TaskCreated: the planned task has no result and no agent-supplied hook input leaks in", async () => {
    const { h, cwd, out } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([`cat > ${out("p.json")}`], "TaskCreated") });
    expect(await h.gates.taskCreated(h.input("TaskCreate", team, "lead", { title: "New", description: "Body", hooks: { TaskCreated: [{ command: "evil" }] } }))).toBeUndefined();
    const p = readJson(out("p.json"));
    expect(p.hook_event_name).toBe("TaskCreated");
    expect(p.member).toBeUndefined(); // lead-created
    expect(p.task).toEqual({ id: "4", title: "New", description: "Body", status: "pending", blockedBy: [] });
    expect(JSON.stringify(p)).not.toContain("evil");
  });

  it.each([
    [4000, 4000],
    [4001, 4000],
  ])("TeammateIdle: finalText of %i chars is delivered as %i", async (len, expected) => {
    const { h, cwd, out } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([`cat > ${out("p.json")}`], "TeammateIdle") });
    expect(await h.gates.idle(h.idleInput(team, "alice", { settleId: 7, finalText: "f".repeat(len) }))).toBeUndefined();
    const p = readJson(out("p.json"));
    expect(p).toMatchObject({ hook_event_name: "TeammateIdle", member: "alice", memberCwd: "/work" });
    expect(p.idle.settleId).toBe(7);
    expect(p.idle.finalText).toHaveLength(expected);
    expect(p.task).toBeUndefined();
  });
});

describe("environment allowlist (12.7, #E29)", () => {
  const SERVER_ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/home/x", USER: "robson", LANG: "C", LC_ALL: "C", TMPDIR: "/tmp", SHELL: "/bin/zsh", ANTHROPIC_API_KEY: "sk-secret", PI_DASHBOARD_TOKEN: "tok", AWS_SECRET_ACCESS_KEY: "aws" };
  const ALLOWED = new Set(["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "SHELL", "AGENT_TEAMS_EVENT", "AGENT_TEAMS_TEAM_ID", "AGENT_TEAMS_MEMBER", "AGENT_TEAMS_TASK_ID"]);
  const BASH_OWN = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
  const envOf = (file: string) =>
    Object.fromEntries(
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );

  it("the child sees only the allowlist + event variables; secrets are absent", async () => {
    const { h, cwd, out } = realSetup(SERVER_ENV);
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([`env > ${out("env.txt")}`]) });
    await completion(h, team);
    const env = envOf(out("env.txt"));
    const unexpected = Object.keys(env).filter((k) => !ALLOWED.has(k) && !BASH_OWN.has(k));
    expect(unexpected).toEqual([]);
    expect(env).toMatchObject({ LC_ALL: "C", TMPDIR: "/tmp", AGENT_TEAMS_EVENT: "TaskCompleted", AGENT_TEAMS_TEAM_ID: team.id, AGENT_TEAMS_MEMBER: "alice", AGENT_TEAMS_TASK_ID: "3" });
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("AGENT_TEAMS_TASK_ID is unset for the idle hook", async () => {
    const { h, cwd, out } = realSetup(SERVER_ENV);
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([`env > ${out("env.txt")}`], "TeammateIdle") });
    await h.gates.idle(h.idleInput(team, "alice"));
    const env = envOf(out("env.txt"));
    expect(env.AGENT_TEAMS_EVENT).toBe("TeammateIdle");
    expect(env.AGENT_TEAMS_MEMBER).toBe("alice");
    expect(env.AGENT_TEAMS_TASK_ID).toBeUndefined();
  });
});

describe("idle retry cap (12.9, #E31)", () => {
  const idleSetup = (config?: Record<string, unknown>) => {
    const s = fakeSetup(config);
    s.procs.script([{ code: 2, stderr: "write the summary first" }]);
    const team = s.h.makeTeam({ hooks: hooksOf(["x"], "TeammateIdle") });
    /** One idle report: returns the veto (running its afterBlock like core does) or undefined when accepted. */
    const idle = async () => {
      const res = await s.h.gates.idle(s.h.idleInput(team, "alice"));
      if (res && (res as OpGateBlock).block) (res as OpGateBlock).afterBlock?.();
      return res as OpGateBlock | undefined;
    };
    return { ...s, team, idle };
  };

  it("cap 3: idles 1–3 are blocked with a waking hook_feedback mail each, the 4th is accepted and the lead is told", async () => {
    const { h, idle } = idleSetup({ hookMaxRetries: 3 });
    for (let i = 1; i <= 3; i++) expect(await idle()).toMatchObject({ block: true, code: "hook_blocked", feedback: "write the summary first" });
    expect(h.mails.filter((m) => m.kind === "hook_feedback")).toHaveLength(3);
    expect(h.mails[0]).toMatchObject({ to: "alice", wake: true });
    expect(h.mails[0]?.text).toContain("write the summary first");
    expect(await idle()).toBeUndefined();
    expect(h.mails).toHaveLength(3);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatchObject({ wake: false });
    expect(h.notices[0]?.text).toContain("TeammateIdle");
    expect(h.notices[0]?.text).toContain("alice");
  });

  it("an accepted idle resets the counter", async () => {
    const { procs, h, idle } = idleSetup({ hookMaxRetries: 3 });
    await idle();
    await idle();
    procs.script([{ code: 0 }]);
    expect(await idle()).toBeUndefined(); // exit 0 → accepted → counter 0
    procs.script([{ code: 2, stderr: "again" }]);
    for (let i = 0; i < 3; i++) expect(await idle()).toMatchObject({ block: true });
    expect(await idle()).toBeUndefined();
    expect(h.notices).toHaveLength(1);
  });

  it("cap 1 blocks once; cap 0 never blocks, spawns nothing and sends no hook_feedback", async () => {
    const one = idleSetup({ hookMaxRetries: 1 });
    expect(await one.idle()).toMatchObject({ block: true });
    expect(await one.idle()).toBeUndefined();
    const zero = idleSetup({ hookMaxRetries: 0 });
    expect(await zero.idle()).toBeUndefined();
    expect(zero.procs.spawns).toHaveLength(0);
    expect(zero.h.mails).toHaveLength(0);
  });

  it.each([-1, 1.5])("hookMaxRetries %s falls back to 3 with a startup warning naming the setting", async (bad) => {
    const { h, idle } = idleSetup({ hookMaxRetries: bad });
    for (let i = 0; i < 3; i++) expect(await idle()).toMatchObject({ block: true });
    expect(await idle()).toBeUndefined();
    expect(h.logs.warn.some((w) => w.includes("hookMaxRetries"))).toBe(true);
  });

  it("no hook runs for a shutdown_pending member, an errored idle or a pending-plan member", async () => {
    const { procs, h, team } = idleSetup();
    team.members = [{ ...team.members[0]!, status: "shutdown_pending" }, { ...team.members[1]!, planApproval: "pending" }, team.members[2]!];
    expect(await h.gates.idle(h.idleInput(team, "alice"))).toBeUndefined();
    expect(await h.gates.idle(h.idleInput(team, "bob"))).toBeUndefined();
    expect(await h.gates.idle(h.idleInput(team, "carol", { error: "boom" }))).toBeUndefined();
    expect(procs.spawns).toHaveLength(0);
  });
});

describe("spawn error (12.10, #X1)", () => {
  it("allows, notices the lead once per team (not at the 2nd occurrence) and counts errors", async () => {
    const { procs, h } = fakeSetup();
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    procs.throwNext = Object.assign(new Error("spawn bash ENOENT"), { code: "ENOENT" });
    expect(await completion(h, team)).toBeUndefined();
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]?.text).toContain("spawn_error");
    expect(h.notices[0]?.wake).toBe(false);
    procs.errorCode = "ENOENT"; // a deleted cwd: the child reports the error asynchronously
    expect(await completion(h, team)).toBeUndefined();
    expect(h.notices).toHaveLength(1);
    expect(h.deps.counters.get("hook_errors", team.id)).toBe(2);
  });
});

describe("timeout notice and tree kill (12.11, #X2)", () => {
  it("kills the hook AND its grandchild at the deadline, allows, notices once per event", async () => {
    const { h, cwd, out } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([{ command: `sleep 31 & echo $! > ${out("gc.pid")}; echo $$ > ${out("hook.pid")}; sleep 30`, timeoutMs: 10_000 }]) });
    const gate = completion(h, team);
    await waitFor(() => fs.existsSync(out("gc.pid")) && fs.existsSync(out("hook.pid")) && fs.readFileSync(out("hook.pid"), "utf8").trim() !== "");
    const pids = [out("hook.pid"), out("gc.pid")].map((f) => Number(fs.readFileSync(f, "utf8").trim()));
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(pids.every(alive)).toBe(true);
    await advance(h.clock, 10_000);
    expect(await gate).toBeUndefined();
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]?.text).toContain("TaskCompleted");
    await waitFor(() => pids.every((p) => !alive(p)), 4000); // SIGTERM, SIGKILL after 2 s at the latest
    // a second timeout of the same event: no new notice
    const second = completion(h, team);
    await waitFor(() => fs.existsSync(out("gc.pid")));
    await advance(h.clock, 10_000);
    await second;
    expect(h.notices).toHaveLength(1);
    expect(h.deps.counters.get("hook_timeouts", team.id)).toBe(2);
    await waitFor(() => !alive(Number(fs.readFileSync(out("gc.pid"), "utf8").trim())), 4000);
  }, 20_000);
});

describe("non-blocking errors ×3 (12.12, #X3)", () => {
  it("exactly one non-waking notice after the 3rd consecutive; exit 0 resets; two more errors stay silent", async () => {
    const { procs, h } = fakeSetup();
    const codes = [1, 1, 1, 0, 1, 1];
    procs.script((i) => ({ code: codes[i] ?? 0 }));
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    const seen: number[] = [];
    for (const _ of codes) {
      await completion(h, team);
      seen.push(h.notices.length);
    }
    expect(seen).toEqual([0, 0, 1, 1, 1, 1]);
    expect(h.notices[0]).toMatchObject({ wake: false });
    expect(h.notices[0]?.text).toContain("TaskCompleted");
    expect(h.deps.counters.get("hook_errors", team.id)).toBe(5);
  });
});

describe("hook cannot start before the deadline (12.13, #X4)", () => {
  /** 3 members complete at once; per-team limit 2; hooks outlast the budget so the third never starts. */
  it("the third TaskUpdate fails hook_blocked + hook_busy at the deadline, the task stays in_progress and a retry runs the hook", async () => {
    const { clock, procs, h } = fakeSetup();
    procs.script([{ code: 0, afterMs: BUDGET }]);
    const team = h.makeTeam({ hooks: hooksOf([{ command: "slow", timeoutMs: 60_000 }]) });
    team.tasks = [task({ id: "3", owner: "alice" }), task({ id: "4", owner: "bob" }), task({ id: "5", owner: "carol" })];
    const t0 = clock.now();
    const calls = [completion(h, team, "alice", "3"), completion(h, team, "bob", "4"), completion(h, team, "carol", "5")];
    let thirdAt = -1;
    const third = calls[2]?.then((r) => {
      thirdAt = clock.now() - t0;
      return r;
    });
    await advance(clock, DEADLINE);
    expect(procs.spawns).toHaveLength(2);
    expect(block(await third)).toMatchObject({ code: "hook_blocked" });
    expect(block(await third).feedback).toContain("hook_busy");
    expect(thirdAt).toBe(DEADLINE);
    expect(thirdAt).toBeLessThanOrEqual(BUDGET);
    expect(team.tasks[2]?.status).toBe("in_progress");
    expect(h.deps.counters.get("hook_busy", team.id)).toBe(1);
    await Promise.all(calls.slice(0, 2));
    // the retry now finds free slots and runs the hook
    procs.script([{ code: 0 }]);
    expect(await completion(h, team, "carol", "5")).toBeUndefined();
    expect(procs.spawns).toHaveLength(3);
  });

  it("the idle gate lets the idle through under the same starvation and counts busy", async () => {
    const { clock, procs, h } = fakeSetup();
    procs.script([{ code: 2, afterMs: BUDGET }]);
    const team = h.makeTeam({ hooks: hooksOf([{ command: "slow", timeoutMs: 60_000 }], "TeammateIdle") });
    const calls = ["alice", "bob", "carol"].map((m) => h.gates.idle(h.idleInput(team, m)));
    await advance(clock, DEADLINE);
    expect(await calls[2]).toBeUndefined();
    expect(h.deps.counters.get("hook_busy", team.id)).toBe(1);
    expect(h.mails).toHaveLength(0);
  });

  it("commands after a hook that spent the whole budget are skipped (that hook did run: allow, not busy)", async () => {
    const { clock, procs, h } = fakeSetup();
    const team = h.makeTeam({ hooks: hooksOf([{ command: "a", timeoutMs: 60_000 }, "b"]) });
    const gate = completion(h, team);
    await advance(clock, DEADLINE);
    expect(await gate).toBeUndefined();
    expect(procs.spawns).toHaveLength(1);
    expect(h.deps.counters.get("hook_busy", team.id)).toBe(0);
  });
});

describe("global limit across teams (12.14, #X5)", () => {
  it("at most 4 children alive at any instant; the 5th/6th start at t=5 s inside the deadline and succeed", async () => {
    const { clock, procs, h } = fakeSetup();
    procs.script([{ code: 0, afterMs: 5000 }]);
    const teams = [h.makeTeam({ id: "ta" }), h.makeTeam({ id: "tb" }), h.makeTeam({ id: "tc" })];
    const calls: Array<Promise<OpGateResult>> = [];
    for (const team of teams) {
      team.hooks = hooksOf(["x"]);
      team.tasks = [task({ id: "3", owner: "alice" }), task({ id: "4", owner: "bob" })];
      calls.push(completion(h, team, "alice", "3"), completion(h, team, "bob", "4"));
    }
    const t0 = clock.now();
    await advance(clock, 0);
    expect(procs.spawns).toHaveLength(4);
    await advance(clock, 5000);
    expect(procs.spawns).toHaveLength(6);
    await advance(clock, 5000);
    const results = await Promise.all(calls);
    expect(results.every((r) => r === undefined)).toBe(true);
    expect(procs.peakAlive).toBeLessThanOrEqual(4);
    expect(procs.spawns.slice(4).map((s) => s.at - t0)).toEqual([5000, 5000]);
    expect(h.deps.counters.get("hook_busy")).toBe(0);
  });
});

describe("observability (12.17, #X19)", () => {
  it("logs event/member/code/duration only; counters = runs 4, blocks 1, timeouts 1, overflow 1, errors 1", async () => {
    const { clock, procs, h } = fakeSetup();
    const plan = [
      { code: 2, stderr: "blocked-text" },
      { code: 0, afterMs: BUDGET },
      { code: 0, stdout: "x".repeat(HOOK_STREAM_CAP_BYTES + 1) },
      { code: 1, stdout: "SECRET-STDOUT", stderr: "SECRET-STDERR" },
    ];
    procs.script((i) => plan[i] as never);
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    team.tasks = [task({ id: "3", owner: "alice", description: "SECRET-STDIN" })];
    const pending = completion(h, team);
    await pending;
    const slow = completion(h, team);
    await advance(clock, DEADLINE);
    await slow;
    await completion(h, team);
    await completion(h, team);
    const c = (n: string) => h.deps.counters.get(n, team.id);
    expect([c("hook_runs"), c("hook_blocks"), c("hook_timeouts"), c("hook_overflow"), c("hook_errors")]).toEqual([4, 1, 1, 1, 1]);
    const logs = h.logs.info.join("\n");
    for (const secret of ["SECRET-STDOUT", "SECRET-STDERR", "SECRET-STDIN", "blocked-text"]) expect(logs).not.toContain(secret);
    expect(logs).toMatch(/hook event=TaskCompleted team=\S+ member=alice cmd=0 outcome=exit code=2 ms=\d+/);
  });
});

describe("shutdown with running and queued hooks (12.24, #R12)", () => {
  it("kills the running trees, queued hooks never spawn, awaiting gates fail, nothing commits", async () => {
    const { procs, h } = fakeSetup();
    const team = h.makeTeam({ hooks: hooksOf(["slow"]) });
    team.tasks = ["3", "4", "5", "6"].map((id) => task({ id, owner: "alice" }));
    const calls = ["3", "4", "5", "6"].map((id) => completion(h, team, "alice", id).then((r) => ({ r }), (e: unknown) => ({ e })));
    await Promise.resolve();
    await Promise.resolve();
    expect(procs.spawns).toHaveLength(2);
    expect(h.engine.limiter.queued).toBe(2);
    h.engine.shutdown();
    const out = await Promise.all(calls);
    expect(out.every((o) => "e" in o && o.e instanceof HookShutdownError)).toBe(true);
    expect(procs.spawns).toHaveLength(2);
    expect(procs.kills).toHaveLength(2);
    expect(team.tasks.every((t) => t.status === "in_progress")).toBe(true);
  });
});

describe("shell injection via task data (12.28, #S4)", () => {
  const evil = "$(touch PWNED) `touch PWNED` ; touch PWNED\n'\"";

  it("task/finalText content never reaches argv or env; the command text is exactly the template's", async () => {
    const { procs, h } = fakeSetup();
    procs.script([{ code: 0 }]);
    const team = h.makeTeam({ hooks: hooksOf(["cat >/dev/null"]) });
    team.tasks = [task({ id: "3", title: evil, description: evil, owner: "alice" })];
    await completion(h, team, "alice", "3", evil);
    const s = procs.spawns[0]!;
    expect(s.command).toBe("bash");
    expect(s.args).toEqual(["-c", "cat >/dev/null"]);
    expect(Object.values(s.env).join("\n")).not.toContain("touch");
    expect(JSON.parse(s.stdin()).task.title).toBe(evil);
  });

  it("a real hook that only reads stdin creates no file", async () => {
    const { h, cwd } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf(["cat >/dev/null"]) });
    team.tasks = [task({ id: "3", title: evil, description: evil, owner: "alice" })];
    await completion(h, team, "alice", "3", evil);
    expect(fs.existsSync(path.join(cwd, "PWNED"))).toBe(false);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it("an env value that is not a plain identifier is left unset (a member name is validated)", async () => {
    const { procs, h } = fakeSetup();
    procs.script([{ code: 0 }]);
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    team.members = [{ ...team.members[0]!, name: "bad name$(x)" }];
    team.tasks = [task({ id: "3", owner: "bad name$(x)" })];
    await completion(h, team, "bad name$(x)");
    expect(procs.spawns[0]?.env.AGENT_TEAMS_MEMBER).toBeUndefined();
  });
});

describe("hook process confinement — documented limits (12.29, #S12)", () => {
  it("a hook can signal its parent (probe only: kill -0) — no confinement, listed in the docs, not blocked", async () => {
    const { h, cwd, out } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([`kill -0 $PPID && echo can-signal-parent > ${out("ppid.txt")}`]) });
    expect(await completion(h, team)).toBeUndefined();
    expect(fs.readFileSync(out("ppid.txt"), "utf8").trim()).toBe("can-signal-parent");
  });

  it("the local dashboard token is readable by a hook (honest limit) but its content is never logged", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-home-"));
    fs.mkdirSync(path.join(home, ".pi/dashboard/local"), { recursive: true });
    fs.writeFileSync(path.join(home, ".pi/dashboard/local/token"), "TOKEN-VALUE-123");
    const { h, cwd, out } = realSetup({ PATH: process.env.PATH, HOME: home });
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([`cat ~/.pi/dashboard/local/token > ${out("t.txt")}; cat ~/.pi/dashboard/local/token`]) });
    await completion(h, team);
    expect(fs.readFileSync(out("t.txt"), "utf8")).toBe("TOKEN-VALUE-123");
    expect(h.logs.info.join("\n")).not.toContain("TOKEN-VALUE-123");
  });

  it("a fork-lite hook with 50 children: every child dies with the tree at the timeout", async () => {
    const { h, cwd, out } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([{ command: `for i in $(seq 50); do sleep 40 & echo $! >> ${out("kids.txt")}; done; wait`, timeoutMs: 5000 }]) });
    const gate = completion(h, team);
    await waitFor(() => fs.existsSync(out("kids.txt")) && fs.readFileSync(out("kids.txt"), "utf8").trim().split("\n").length === 50);
    const kids = fs.readFileSync(out("kids.txt"), "utf8").trim().split("\n").map(Number);
    await advance(h.clock, 5000);
    await gate;
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await waitFor(() => kids.every((p) => !alive(p)), 5000);
  }, 20_000);

  it.skipIf(!fs.existsSync("/usr/bin/setsid") && !fs.existsSync("/bin/setsid"))("a setsid daemon leaves the process group and survives the tree kill (documented limit)", async () => {
    const { h, cwd, out } = realSetup();
    const team = h.makeTeam({ leadCwd: cwd, hooks: hooksOf([{ command: `setsid sleep 40 & echo $! > ${out("daemon.pid")}; sleep 30`, timeoutMs: 3000 }]) });
    const gate = completion(h, team);
    await waitFor(() => fs.existsSync(out("daemon.pid")) && fs.readFileSync(out("daemon.pid"), "utf8").trim() !== "");
    await advance(h.clock, 3000);
    await gate;
    const pid = Number(fs.readFileSync(out("daemon.pid"), "utf8").trim());
    await new Promise((r) => setTimeout(r, 2500));
    let survived = true;
    try {
      process.kill(pid, 0);
    } catch {
      survived = false;
    }
    if (survived) process.kill(pid, "SIGKILL");
    expect(survived).toBe(true);
  }, 20_000);
});

describe("gates are inert without hooks", () => {
  it("a team without hooks (or for another event) returns at once and spawns nothing", async () => {
    const { procs, h } = fakeSetup();
    const none = h.makeTeam();
    const other = h.makeTeam({ hooks: hooksOf(["x"], "TaskCreated") });
    expect(await completion(h, none)).toBeUndefined();
    expect(await completion(h, other)).toBeUndefined();
    expect(await h.gates.idle(h.idleInput(none, "alice"))).toBeUndefined();
    expect(procs.spawns).toHaveLength(0);
  });

  it("completion of an unknown or already completed task runs no hook", async () => {
    const { procs, h } = fakeSetup();
    const team = h.makeTeam({ hooks: hooksOf(["x"]) });
    team.tasks = [task({ id: "3", status: "completed" })];
    expect(await completion(h, team, "alice", "3")).toBeUndefined();
    expect(await completion(h, team, "alice", "99")).toBeUndefined();
    expect(procs.spawns).toHaveLength(0);
  });
});
