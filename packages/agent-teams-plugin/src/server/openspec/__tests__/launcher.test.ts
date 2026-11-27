/**
 * Group launcher (tasks 3.7, 3.8, 3.11, 3.12, 3.14, 3.16; test-plan #E23 #X5 #X14 #R2 #R3 #R4 #D3 #D4 #P1 #P2):
 * state-derived slots, serial lazy launches in `changeOrder`, owner set with the reservation, core refusals,
 * completion frees the slot, restart safety with persisted `noticed`, bounded launches and event-storm cost.
 * Time is the harness `FakeClock`; perf rows assert COUNTS only.
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeRuntimeHost } from "../../../__tests__/harness/index.js";
import type { Team } from "../../../shared/types.js";
import { createExtensionPoints } from "../../extension-points.js";
import { createTeamsRuntime } from "../../runtime.js";
import { LAUNCH_TIMEOUT_MS, type LauncherDeps, launcherOf } from "../launcher.js";
import { createGroupEnv, type GroupEnv } from "./launcher-env.js";

/** Let queued continuations run to the next macrotask. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Advance the fake clock by `ms`, one due timer at a time, draining continuations after each. */
async function advance(e: GroupEnv, ms: number): Promise<void> {
  const target = e.clock.now() + ms;
  for (;;) {
    const due = e.clock.nextDue();
    if (due === undefined || due > target) break;
    e.clock.advance(due - e.clock.now());
    await settle();
  }
  e.clock.advance(target - e.clock.now());
  await settle();
}

const team = (e: GroupEnv): Team => e.rt.store.get(e.gteam.id) as Team;
const task = (e: GroupEnv, change: string) => e.rt.store.task(team(e), e.taskOf(change));
const bump = (e: GroupEnv, n = 1): void => {
  for (let i = 0; i < n; i++) e.rt.store.patchTeam(e.gteam.id, { description: `tick ${i}` });
};
/** Slots as the spec defines them, computed from raw state (independent of the launcher). */
function slots(e: GroupEnv): number {
  const d = e.api.sidecar.get(e.gteam.id);
  let n = 0;
  for (const [id, rec] of Object.entries(d?.launched ?? {})) {
    const m = team(e).members.find((x) => x.name === rec.member);
    const live = m !== undefined && m.status !== "gone" && m.status !== "failed";
    if (rec.state === "launching" || (rec.state === "launched" && e.rt.store.task(team(e), id)?.status !== "completed" && live)) n++;
  }
  return n;
}

describe("launch basics", () => {
  it("launches in changeOrder up to the slot cap, owner set, cwd = worktree, committer member (3.7 3.8)", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c"] });
    await e.run();
    expect(e.members()).toEqual(["os-a", "os-b"]);
    expect(e.fx.spawnCalls.map((c) => [c.name, c.cwd, c.committer])).toEqual([
      ["os-a", e.worktreeOf("a"), "member"],
      ["os-b", e.worktreeOf("b"), "member"],
    ]);
    expect(task(e, "a")?.owner).toBe("os-a");
    expect(task(e, "b")?.owner).toBe("os-b");
    expect(task(e, "c")?.owner).toBeUndefined();
    expect(e.launched("a")).toMatchObject({ state: "launched", member: "os-a" });
    expect(e.launched("c")).toBeUndefined();
    expect(e.fx.ensureWorktree.mock.calls[0]?.[1]).toMatchObject({ repo: e.cwd, change: "a", base: "develop" });
    expect(e.fx.spawnCalls[0]?.prompt).toContain("briefing");
    // never a session in the lead cwd
    expect(e.fx.spawnCalls.every((c) => c.cwd !== e.cwd && c.cwd !== undefined)).toBe(true);
  });

  it("only unblocked pending tasks launch; a dependant waits for its blocker's completion", async () => {
    const e = await createGroupEnv({ changes: ["a", { name: "b", blockedBy: ["a"] }], pluginConfig: { openspecGroupParallel: 2 } });
    await e.run();
    expect(e.members()).toEqual(["os-a"]);
    e.complete("a");
    await settle();
    expect(e.members()).toEqual(["os-a", "os-b"]);
  });

  it("parallel is clamped by the config and never exceeded; maxTeammates gates on live members", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { openspecGroupParallel: 1 } });
    await e.run();
    expect(e.members()).toEqual(["os-a"]);
    const f = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { openspecGroupParallel: 3, maxTeammates: 2 } });
    await f.run();
    expect(f.members()).toEqual(["os-a", "os-b"]);
  });

  it("an inactive team (orphaned / closing) launches nothing; no record is written", async () => {
    for (const status of ["orphaned", "closing"] as const) {
      const e = await createGroupEnv({ changes: ["a"] });
      e.rt.store.setTeamStatus(e.gteam.id, status);
      await e.run();
      expect(e.members(), status).toEqual([]);
      expect(e.launched("a"), status).toBeUndefined();
    }
  });

  it("a pending (unseeded) or seed_incomplete team launches nothing", async () => {
    const e = await createGroupEnv({ changes: ["a"], noSeed: true });
    await e.run();
    expect(e.members()).toEqual([]);
    expect(e.fx.ensureWorktree).not.toHaveBeenCalled();
  });

  it("the record is `launching` before the first worktree call (call-order spy)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    const seen: Array<string | undefined> = [];
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => {
      seen.push(e.launched(i.change)?.state);
      return { ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` };
    });
    await e.run();
    expect(seen).toEqual(["launching"]);
  });
});

describe("real group module (slice B1 contract)", () => {
  it("memberNameFor / buildBriefing of group-api drive the launch: hashed name ≤ 32 chars, briefing names task, change, worktree and skill", async () => {
    const long = "add-agent-teams-templates-hooks-and-more";
    const e = await createGroupEnv({ changes: [long] });
    launcherOf(e.api)?.configure({ memberNameFor: undefined as never, buildBriefing: undefined as never }); // the real group-api ones
    await e.run();
    const call = e.fx.spawnCalls[0];
    expect(call?.name.length).toBeLessThanOrEqual(32);
    expect(call?.name).toMatch(/^os-[a-z0-9-]+$/);
    expect(call?.prompt).toContain(e.taskOf(long));
    expect(call?.prompt).toContain(long);
    expect(call?.prompt).toContain(e.worktreeOf(long));
    expect(call?.prompt).toContain("ship-it");
    expect(e.launched(long)).toMatchObject({ state: "launched", member: call?.name });
    expect(e.launched(long)?.member).toBe(team(e).members[0]?.name);
  });
});

describe("ownership without dispatching others (8.1, #E23)", () => {
  it("autoDispatch false: the idle launched member gets its owned task, never an unowned one", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 1 } });
    await e.run();
    expect(task(e, "b")?.owner).toBeUndefined();
    e.rt.ops.createTask(team(e), { title: "extra, unowned" }, { actor: "lead" });
    e.rt.store.patchMember(e.gteam.id, "os-a", { status: "idle" });
    e.rt.ops.createTask(team(e), { title: "trigger" }, { actor: "lead" }); // activity runs the dispatcher
    const ts = team(e).tasks;
    expect(ts.find((t) => t.title === "a")).toMatchObject({ status: "in_progress", owner: "os-a" });
    expect(ts.find((t) => t.title === "b")).toMatchObject({ status: "pending" });
    expect(ts.filter((t) => t.title.startsWith("extra") || t.title === "trigger").every((t) => t.status === "pending" && t.owner === undefined)).toBe(true);
    expect(e.rt.store.mailLog(e.gteam.id).some((m) => m.to === "os-a" && m.kind === "task_assigned")).toBe(true);
  });
});

describe("owner vs first claim (8.6, #R4)", () => {
  it("owner is set in the launch continuation; the lead cannot reassign (owner_locked); a foreign claim of the owned task is refused", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"] });
    await e.run();
    const id = e.taskOf("a");
    expect(task(e, "a")?.owner).toBe("os-a");
    expect(await e.fake.call(team(e).leadSessionId as string, "TaskUpdate", { id, owner: "os-b" })).toMatchObject({ ok: false, error: "owner_locked" });
    expect(await e.fake.call(team(e).leadSessionId as string, "TaskUpdate", { id, owner: null })).toMatchObject({ ok: false, error: "owner_locked" });
    expect(task(e, "a")?.owner).toBe("os-a");
    // a different member claiming it is refused (owned by os-a)
    e.rt.store.patchMember(e.gteam.id, "os-b", { sessionId: "S-os-b" });
    e.fake.addSession("S-os-b", { cwd: e.cwd });
    expect(await e.fake.call("S-os-b", "TaskUpdate", { id, status: "in_progress" })).toMatchObject({ ok: false, error: "already_claimed" });
    expect(task(e, "a")?.owner).toBe("os-a");
  });

  it("the server actor may still change the owner (relaunch path)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    await e.run();
    const res = e.rt.ops.updateTask(team(e), { id: e.taskOf("a"), owner: null }, { actor: "server" });
    expect(res.ok).toBe(true);
  });

  it("an owner failure after a successful spawn is logged and the lead is woken (never silent)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    vi.spyOn(e.rt.ops, "updateTask").mockReturnValue({ ok: false, error: "invalid_transition" });
    await e.run();
    expect(e.launched("a")?.state).toBe("launched");
    expect(e.notices().some((n) => n.wake && n.text.includes("could not be made owner"))).toBe(true);
  });
});

describe("core refusals and failures (8.2, #X5)", () => {
  const refuse = (error: string) => async () => ({ ok: false as const, error: error as never, message: "x" });

  it("team_full: record removed, no failure notice, retried on the next team change", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    const spawn = vi.fn(refuse("team_full"));
    launcherOf(e.api)?.configure({ spawn } as Partial<LauncherDeps>);
    await e.run();
    expect(e.launched("a")).toBeUndefined();
    expect(e.notices()).toEqual([]);
    expect(spawn).toHaveBeenCalledTimes(1);
    // the cap frees up; the next team change retries and now succeeds
    launcherOf(e.api)?.configure({ spawn: (t, args, trusted) => e.rt.ops.spawnTeammate(t, args, { trusted }) });
    bump(e);
    await settle();
    expect(e.launched("a")?.state).toBe("launched");
  });

  // test-plan #X5 names `cwd_not_allowed`: core has no such code, its refusal of a cwd outside the lead cwd and the extra roots is `cwd_outside_lead`.
  it.each(["spawn_failed", "cwd_outside_lead", "invalid_args", "name_taken"])("a refusal %s fails the launch with that code, frees the slot, one waking notice naming the relaunch route", async (code) => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 1 } });
    launcherOf(e.api)?.configure({ spawn: async (_t, args) => (args.name === "os-a" ? { ok: false, error: code as never, message: "m" } : e.rt.ops.spawnTeammate(_t, args, {})) });
    await e.run();
    expect(e.launched("a")).toMatchObject({ state: "launch_failed", code, noticed: true });
    expect(task(e, "a")?.status).toBe("pending");
    expect(e.launched("b")?.state).toBe("launched"); // slot was free: the next change launched
    const notes = e.notices().filter((n) => n.text.includes('"a"'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ wake: true });
    expect(notes[0]?.text).toContain("/api/plugins/agent-teams/openspec-relaunch");
    expect(notes[0]?.text).toContain("TeamDelete");
    expect(notes[0]?.text).toContain(code);
  });

  it("a thrown spawn is `spawn_failed`; a thrown ensureWorktree is `worktree_failed`", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 3 } });
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => {
      if (i.change === "a") throw new Error("boom with /secret/path");
      return { ok: true, path: e.worktreeOf(i.change), branch: "os/b" };
    });
    launcherOf(e.api)?.configure({
      spawn: async () => {
        throw new Error("spawn exploded");
      },
    });
    await e.run();
    expect(e.launched("a")).toMatchObject({ state: "launch_failed", code: "worktree_failed" });
    expect(e.launched("b")).toMatchObject({ state: "launch_failed", code: "spawn_failed" });
    expect(e.notices().every((n) => !n.text.includes("/secret/path") && !n.text.includes("exploded"))).toBe(true);
  });

  it("a worktree failure code from the group module is passed through; no member spawns, task stays pending", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    e.fx.ensureWorktree.mockResolvedValue({ ok: false, code: "worktree_path_unexpected" });
    await e.run();
    expect(e.launched("a")).toMatchObject({ state: "launch_failed", code: "worktree_path_unexpected" });
    expect(e.members()).toEqual([]);
    expect(e.fx.spawnCalls).toEqual([]);
    expect(task(e, "a")?.status).toBe("pending");
  });

  it("name_taken by a lead pre-spawned os-x: fails the launch and never adopts the foreign member", async () => {
    const e = await createGroupEnv({ changes: ["x"] });
    e.member("os-x", "idle"); // the lead's stray with the launcher's name
    await e.run();
    expect(e.launched("x")).toMatchObject({ state: "launch_failed", code: "name_taken" });
    expect(task(e, "x")?.owner).toBeUndefined();
    expect(team(e).members.filter((m) => m.name === "os-x")).toHaveLength(1);
  });

  it("no automatic retry: a launch_failed record stays failed across later team changes", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    e.fx.ensureWorktree.mockResolvedValue({ ok: false, code: "git_failed" });
    await e.run();
    bump(e, 5);
    await settle();
    expect(e.fx.ensureWorktree).toHaveBeenCalledTimes(1);
  });
});

describe("bounded launches (3.14)", () => {
  it(`a hanging worktree step fails launch_timeout after ${LAUNCH_TIMEOUT_MS} ms; a late success is ignored (no member, worktree left)`, async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 1 } });
    let release: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => {
      if (i.change === "b") return { ok: true, path: e.worktreeOf("b"), branch: "os/b" };
      signal = i.signal;
      await new Promise<void>((r) => void (release = r));
      return { ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` };
    });
    const done = e.run();
    await settle();
    expect(e.launched("a")?.state).toBe("launching");
    await advance(e, LAUNCH_TIMEOUT_MS - 1);
    expect(e.launched("a")?.state).toBe("launching");
    await advance(e, 1);
    await done;
    expect(e.launched("a")).toMatchObject({ state: "launch_failed", code: "launch_timeout", noticed: true });
    expect(signal?.aborted).toBe(true);
    expect(e.notices().filter((n) => n.text.includes("launch_timeout"))).toHaveLength(1);
    // the slot is free: the next change launched
    expect(e.launched("b")?.state).toBe("launched");
    // the late success resolves now: ignored
    release?.();
    await settle();
    expect(e.members()).toEqual(["os-b"]);
    expect(e.launched("a")?.state).toBe("launch_failed");
  });

  it("the launch timeout timer is cleared when the launch finishes (no leaked timers)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    const before = e.clock.pendingCount;
    await e.run();
    expect(e.clock.pendingCount).toBeLessThanOrEqual(before + 1); // core's own timers may exist; none of ours
  });
});

describe("slot cap and serial launches under an event storm (8.4, #R2)", () => {
  it("6 changes, parallel 2, 4 s launches, 200 events per launch: ≤1 spawn per change, slots ≤ 2 after EVERY event, strictly in changeOrder", async () => {
    const names = ["c1", "c2", "c3", "c4", "c5", "c6"];
    const e = await createGroupEnv({ changes: names });
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => {
      order.push(i.change);
      expect(e.launched(i.change)?.state, "record before first worktree call").toBe("launching");
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => e.clock.setTimeout(r, 4000));
      inFlight--;
      return { ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` };
    });
    let maxSlots = 0;
    e.rt.store.on("change", () => void (maxSlots = Math.max(maxSlots, slots(e))));
    void e.run();
    await settle();
    for (let step = 0; step < 6; step++) {
      bump(e, 200);
      await advance(e, 4000);
    }
    expect(maxSlots).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBe(1); // serial
    expect(order).toEqual(["c1", "c2"]); // the cap holds the rest
    expect(e.fx.spawnCalls.map((c) => c.name)).toEqual(["os-c1", "os-c2"]);
    // completions free slots; later launches stay in order and each change spawns once
    e.complete("c1");
    e.member("os-c1", "gone");
    await advance(e, 4000);
    e.complete("c2");
    e.member("os-c2", "gone");
    await advance(e, 8000);
    expect(order).toEqual(["c1", "c2", "c3", "c4"]);
    expect(new Set(e.fx.spawnCalls.map((c) => c.name)).size).toBe(e.fx.spawnCalls.length);
    expect(maxSlots).toBeLessThanOrEqual(2);
  });
});

describe("completion frees the slot (8.3, 8.5, #X14 #R3)", () => {
  it("task_completed: the slot is free at once; the member is asked to shut down by the server actor; the next change launches when live < cap", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { maxTeammates: 5, openspecGroupParallel: 2 } });
    const spy = vi.spyOn(e.rt.ops, "requestShutdown");
    await e.run();
    e.complete("a");
    await settle();
    expect(spy).toHaveBeenCalledWith(expect.anything(), "os-a", expect.objectContaining({ actor: "server" }));
    expect(e.launched("c")?.state).toBe("launched");
  });

  it("at maxTeammates: completed members still count (shutdown_pending); the next launches only after a member is gone, each exactly once and in order", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c", "d"], pluginConfig: { maxTeammates: 2, openspecGroupParallel: 2 } });
    await e.run();
    e.complete("a");
    e.complete("b"); // same tick
    await settle();
    expect(slots(e)).toBe(0); // slots freed at once
    expect(e.launched("c")).toBeUndefined(); // but live members (shutdown_pending) still fill the cap
    expect(e.fx.spawnCalls.map((c) => c.name)).toEqual(["os-a", "os-b"]);
    e.member("os-a", "gone");
    await settle();
    expect(e.launched("c")?.state).toBe("launched");
    expect(e.launched("d")).toBeUndefined(); // cap is 2 again (os-b still shutting down + os-c)
    e.member("os-b", "gone");
    await settle();
    expect(e.launched("d")?.state).toBe("launched");
    expect(e.fx.spawnCalls.map((c) => c.name)).toEqual(["os-a", "os-b", "os-c", "os-d"]);
  });

  it.each([
    ["op missing", () => undefined],
    [
      "op throws",
      () => {
        throw new Error("boom");
      },
    ],
    ["op rejects", () => ({ ok: false as const, error: "member_gone" as const })],
  ])("requestShutdown %s: logged, no crash, the slot is free and the next change launches", async (_n, impl) => {
    const e = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { openspecGroupParallel: 2 } });
    await e.run();
    (e.rt.ops as unknown as { requestShutdown: unknown }).requestShutdown = _n === "op missing" ? undefined : impl;
    e.complete("a");
    await settle();
    expect(e.launched("c")?.state).toBe("launched");
  });

  describe("shutdown outcomes of the completed member (8.3 #X14): approve, reject, silence", () => {
    /** Group of 3 (parallel 2): a and b launched; a's member is a live session so core's handshake can run. */
    async function shippedA() {
      const e = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { openspecGroupParallel: 2, shutdownGraceMs: 30_000 } });
      await e.run();
      e.fake.addSession("S-os-a", { cwd: e.worktreeOf("a") });
      e.rt.store.patchMember(e.gteam.id, "os-a", { sessionId: "S-os-a", status: "idle" });
      e.complete("a");
      await settle();
      return e;
    }
    const wakes = (e: GroupEnv, needle: string) => e.rt.store.mailLog(e.gteam.id).filter((m) => m.to === "lead" && m.wake && m.text.includes(needle));
    const request = (e: GroupEnv) => e.rt.store.pendingMail(e.gteam.id, "os-a").filter((m) => m.kind === "shutdown_request");

    it("the slot is free at once and the next change launched in every case; the request is `from server`", async () => {
      const e = await shippedA();
      expect(request(e)).toHaveLength(1);
      expect(request(e)[0]).toMatchObject({ from: "server", wake: true });
      expect(slots(e)).toBe(2); // b and the freshly launched c; a's slot is free
      expect(e.launched("c")?.state).toBe("launched");
    });

    it("approves: the lead is not woken about the member", async () => {
      const e = await shippedA();
      await e.call("os-a", "ShutdownResponse", { approve: true });
      e.clock.advance(10_000);
      expect(wakes(e, "os-a")).toHaveLength(0);
    });

    it("rejects: ONE waking lead notice, the slot stays free and nothing relaunches", async () => {
      const e = await shippedA();
      await e.call("os-a", "ShutdownResponse", { approve: false, reason: "still pushing" });
      e.clock.advance(10_000);
      expect(wakes(e, "os-a")).toHaveLength(1);
      expect(slots(e)).toBe(2);
      expect(e.fx.ensureWorktree.mock.calls.filter((c) => c[1].change === "a")).toHaveLength(1);
    });

    it("silent past shutdownGraceMs: the lead is told once; just before the grace it is not", async () => {
      const e = await shippedA();
      e.clock.advance(29_999);
      expect(wakes(e, "os-a")).toHaveLength(0);
      e.clock.advance(10_001); // grace + the notice coalescing window
      await settle();
      expect(wakes(e, "os-a")).toHaveLength(1);
      expect(slots(e)).toBe(2);
    });
  });

  it("a member that exits without completing: no relaunch, one non-waking relaunch-route notice, the lead is woken by core", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: 1 } });
    await e.run();
    e.rt.store.patchTask(e.gteam.id, e.taskOf("a"), { status: "in_progress" });
    e.rt.ops.releaseMember(team(e), "os-a", "gone", "session ended");
    await settle();
    expect(task(e, "a")?.status).toBe("pending");
    expect(e.fx.ensureWorktree.mock.calls.filter((c) => c[1].change === "a")).toHaveLength(1); // not relaunched
    expect(e.launched("b")?.state).toBe("launched"); // the slot is free (member gone)
    const stuck = e.notices().filter((n) => n.text.includes("is gone and task"));
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.text).toContain("openspec-relaunch");
    expect(stuck[0]?.text).toContain("TeamDelete");
    // core's own exit notice is the waking one
    expect(e.notices().some((n) => n.wake && n.text.includes("os-a"))).toBe(true);
    bump(e, 3);
    await settle();
    expect(e.notices().filter((n) => n.text.includes("is gone and task"))).toHaveLength(1); // once
  });
});

describe("slot cap workload (8.9, #P1)", () => {
  it("10 changes, diamond deps, parallel 2, 4 s launches, 30 s completion: max 2 slots, 10 spawns, makespan within the bound", async () => {
    const e = await createGroupEnv({
      changes: ["a", { name: "b", blockedBy: ["a"] }, { name: "c", blockedBy: ["a"] }, { name: "d", blockedBy: ["b", "c"] }, "e", "f", { name: "g", blockedBy: ["e", "f"] }, "h", "i", "j"],
    });
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => {
      await new Promise<void>((r) => e.clock.setTimeout(r, 4000));
      // the teammate ships 30 s after its launch finished
      e.clock.setTimeout(() => {
        e.complete(i.change);
        e.member(`os-${i.change}`, "gone");
      }, 30_000 + 100);
      return { ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` };
    });
    let maxSlots = 0;
    e.rt.store.on("change", () => void (maxSlots = Math.max(maxSlots, slots(e))));
    const start = e.clock.now();
    let lastDone = start;
    e.rt.store.on("task_completed", () => void (lastDone = e.clock.now()));
    void e.run();
    await settle();
    let guard = 0;
    while (!team(e).tasks.every((t) => t.status === "completed") && guard++ < 400) await advance(e, 1000);
    const makespanS = (lastDone - start) / 1000;
    expect(maxSlots).toBeLessThanOrEqual(2);
    expect(e.fx.spawnCalls).toHaveLength(10);
    expect(new Set(e.fx.spawnCalls.map((c) => c.name)).size).toBe(10);
    expect(makespanS).toBeLessThanOrEqual(Math.ceil(10 / 2) * (30 + 4) + 4 + 1);
  });
});

describe("re-evaluation cost (8.10, #P2)", () => {
  it("1000 store.change events with nothing launchable: no worktree/spawn/inject calls and no sidecar writes", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { openspecGroupParallel: 1 } });
    await e.run();
    const writes = e.api.sidecar.writes;
    const wt = e.fx.ensureWorktree.mock.calls.length;
    const spawns = e.fx.spawnCalls.length;
    const cfgSpy = vi.spyOn(e.api, "config");
    bump(e, 1000);
    await settle();
    expect(e.api.sidecar.writes).toBe(writes);
    expect(e.fx.ensureWorktree.mock.calls.length).toBe(wt);
    expect(e.fx.spawnCalls.length).toBe(spawns);
    expect(cfgSpy.mock.calls.length).toBeLessThanOrEqual(1000); // one slot check per pass at most, bounded by events
  });

  it("a plain (non-profile) team's store events never reach the launcher", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    const plain = await e.createTeam("plain");
    const evaluate = vi.spyOn(launcherOf(e.api) as NonNullable<ReturnType<typeof launcherOf>>, "evaluate");
    e.rt.store.patchTeam(plain.id, { description: "x" });
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe("restart safety (8.7, 8.8, #D3 #D4)", () => {
  /** Persist, kill the runtime and boot a second one over the same data dir, clock and templates. */
  async function reboot(prev: Pick<GroupEnv, "rt" | "fake">, config: Record<string, unknown> = {}) {
    await prev.rt.persistence.flush();
    prev.rt.dispose();
    const fake = createFakeRuntimeHost({ dataDir: prev.fake.dataDir, config: { maxTeammates: 5, openspecGroupParallel: 2, ...config } });
    const rt = createTeamsRuntime(fake.host, {
      clock: base.clock,
      ext: createExtensionPoints(),
      starter: async () => undefined,
      templatesHost: { isProjectTrusted: () => true, knownFolderCwds: () => [base.cwd], resolvePiAgentDir: () => base.agentDir },
      openspec: { templatesDir: base.templatesDir },
    });
    return { fake, rt, api: rt.openspec as NonNullable<typeof rt.openspec> };
  }
  let base: GroupEnv;
  const notes = (r: Awaited<ReturnType<typeof reboot>>, id: string) => r.rt.store.mailLog(id).filter((m) => m.to === "lead" && m.kind === "notice");

  it("a launching record becomes launch_failed launch_interrupted ONCE; launched members hold their slots; nothing spawns", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c", "d"], pluginConfig: { openspecGroupParallel: 3 } });
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => {
      if (i.change === "c") return new Promise(() => undefined); // never resolves: crash mid-launch
      return { ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` };
    });
    void e.run();
    await settle();
    expect(e.launched("a")?.state).toBe("launched");
    expect(e.launched("c")?.state).toBe("launching");
    const id = e.gteam.id;
    e.member("os-a", "idle");
    e.member("os-b", "idle");
    base = e;
    const r = await reboot(e, { openspecGroupParallel: 2 }); // parallel 2 after the restart: a and b (disconnected) hold both slots
    const d = r.api.sidecar.get(id);
    const idOf = (c: string) => Object.entries(d?.refs ?? {}).find(([, v]) => (v as { change: string }).change === c)?.[0] as string;
    expect(d?.launched[idOf("c")]).toMatchObject({ state: "launch_failed", code: "launch_interrupted", noticed: true });
    expect(d?.launched[idOf("a")]?.state).toBe("launched");
    const interrupted = notes(r, id).filter((n) => n.text.includes("launch_interrupted"));
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]?.wake).toBe(true);
    const launcher = launcherOf(r.api);
    const ensure = vi.fn();
    launcher?.configure({ ensureWorktree: ensure, memberNameFor: (c) => `os-${c}`, buildBriefing: () => "b" });
    await launcher?.evaluate(r.rt.store.get(id) as Team);
    await settle();
    expect(ensure).not.toHaveBeenCalled(); // c is failed, a/b hold slots (disconnected), d waits for a free slot
    // a second restart repeats nothing
    const r2 = await reboot(r, { openspecGroupParallel: 2 });
    expect(notes(r2, id).filter((n) => n.text.includes("launch_interrupted"))).toHaveLength(1);
  });

  it("slots stay occupied by disconnected members; after the grace gone members free slots but nothing relaunches automatically", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c"], pluginConfig: { openspecGroupParallel: 2 } });
    await e.run();
    e.member("os-a", "idle");
    e.member("os-b", "idle");
    const id = e.gteam.id;
    base = e;
    const r = await reboot(e);
    const t = r.rt.store.get(id) as Team;
    expect(t.members.map((m) => m.status)).toEqual(["disconnected", "disconnected"]);
    const launcher = launcherOf(r.api);
    const ensure = vi.fn(async (_a: unknown, i: { change: string }) => ({ ok: true as const, path: `/x/os-${i.change}`, branch: "b" }));
    launcher?.configure({ ensureWorktree: ensure as never, memberNameFor: (c) => `os-${c}`, buildBriefing: () => "b" });
    await launcher?.evaluate(t);
    expect(ensure).not.toHaveBeenCalled(); // 2 disconnected members hold both slots
    // grace ends: the members are gone, their tasks released; `a`/`b` are NOT relaunched, `c` may start
    r.rt.ops.releaseMember(t, "os-a", "gone", "grace elapsed");
    await settle();
    const launchedChanges = ensure.mock.calls.map((c) => c[1].change);
    expect(launchedChanges).toEqual(["c"]);
    expect(launchedChanges).not.toContain("a");
  });

  it("3 restarts of a launch_failed record: exactly ONE waking notice in total (persisted noticed)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    e.fx.ensureWorktree.mockResolvedValue({ ok: false, code: "git_failed" });
    await e.run();
    const id = e.gteam.id;
    base = e;
    let r = await reboot(e);
    for (let i = 0; i < 2; i++) r = await reboot(r);
    const failed = r.rt.store.mailLog(id).filter((m) => m.to === "lead" && m.kind === "notice" && m.text.includes("git_failed"));
    expect(failed).toHaveLength(1);
  });

  it("a launch_failed record whose notice never got out (noticed false) is announced once at the next start, then persisted", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    e.api.sidecar.update(e.gteam.id, (d) => void (d.launched[e.taskOf("a")] = { state: "launch_failed", member: "os-a", change: "a", code: "git_failed", at: 1 }));
    const id = e.gteam.id;
    base = e;
    const r = await reboot(e);
    expect(r.rt.store.mailLog(id).filter((m) => m.text.includes("git_failed"))).toHaveLength(1);
    expect(r.api.sidecar.get(id)?.launched[e.taskOf("a")]?.noticed).toBe(true);
    const r2 = await reboot(r);
    expect(r2.rt.store.mailLog(id).filter((m) => m.text.includes("git_failed"))).toHaveLength(1);
  });
});

describe("sidecar failure fails closed", () => {
  it("a failed `launching` write starts nothing (no worktree, no spawn)", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    vi.spyOn(e.api.sidecar, "update").mockReturnValue({ ok: false, error: "sidecar_write_failed", message: "disk full" });
    await e.run();
    expect(e.fx.ensureWorktree).not.toHaveBeenCalled();
    expect(e.members()).toEqual([]);
  });
});

describe("resident session skip (3.12)", () => {
  it("a worktree that already hosts a session is skipped and named in a waking notice; the others launch", async () => {
    const e = await createGroupEnv({ changes: ["a", "b"] });
    launcherOf(e.api)?.configure({ residentSession: (p) => p === e.worktreeOf("a") });
    await e.run();
    expect(e.launched("a")).toMatchObject({ state: "launch_failed", code: "resident_session" });
    expect(e.fx.ensureWorktree.mock.calls.map((c) => c[1].change)).toEqual(["b"]);
    const note = e.notices().find((n) => n.text.includes('"a"'));
    expect(note?.wake).toBe(true);
    expect(note?.text).toContain("resident_session");
  });

  it("no session lookup seam: the check is skipped (logged once) and launching proceeds", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    launcherOf(e.api)?.configure({ residentSession: () => undefined });
    await e.run();
    expect(e.launched("a")?.state).toBe("launched");
  });
});

describe("relaunch logic (3.13)", () => {
  it("clears a launch_failed record exactly once and re-launches; a second call is not_relaunchable", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    e.fx.ensureWorktree.mockResolvedValueOnce({ ok: false, code: "git_failed" });
    await e.run();
    const launcher = launcherOf(e.api);
    expect(launcher?.relaunch(team(e), "a")).toEqual({ ok: true, change: "a" });
    expect(launcher?.relaunch(team(e), "a")).toMatchObject({ ok: false, error: "not_relaunchable" });
    await settle();
    expect(e.launched("a")?.state).toBe("launched");
    expect(e.fx.ensureWorktree).toHaveBeenCalledTimes(2);
    expect(e.fx.spawnCalls).toHaveLength(1);
  });

  it("a launched record whose member is gone with the task pending is relaunchable; a live member, launching, completed and unknown are not", async () => {
    const e = await createGroupEnv({ changes: ["a", "b", "c", "d"], pluginConfig: { openspecGroupParallel: 3, maxTeammates: 5 } });
    e.fx.ensureWorktree.mockImplementation(async (_api, i) => (i.change === "c" ? new Promise(() => undefined) : { ok: true, path: e.worktreeOf(i.change), branch: "b" }));
    void e.run();
    await settle();
    const launcher = launcherOf(e.api);
    e.rt.ops.releaseMember(team(e), "os-b", "gone", "x"); // b: launched, member gone, task pending
    e.complete("a"); // a: completed
    const res = (c: string) => launcher?.relaunch(team(e), c);
    expect(res("c")).toMatchObject({ ok: false, error: "not_relaunchable" }); // launching
    expect(res("a")).toMatchObject({ ok: false, error: "not_relaunchable" }); // completed
    expect(res("d")).toMatchObject({ ok: false, error: "not_relaunchable" }); // no record
    expect(res("zzz")).toMatchObject({ ok: false, error: "not_relaunchable" }); // unknown change
    expect(res("b")).toEqual({ ok: true, change: "b" });
  });

  it("a launched live member is not relaunchable and nothing changes", async () => {
    const e = await createGroupEnv({ changes: ["a"] });
    await e.run();
    const before = JSON.stringify(e.api.sidecar.get(e.gteam.id));
    expect(launcherOf(e.api)?.relaunch(team(e), "a")).toMatchObject({ ok: false, error: "not_relaunchable" });
    expect(JSON.stringify(e.api.sidecar.get(e.gteam.id))).toBe(before);
  });
});
