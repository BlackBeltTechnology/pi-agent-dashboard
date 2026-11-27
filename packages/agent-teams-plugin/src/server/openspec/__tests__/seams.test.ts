/**
 * Core seam verification (tasks 2.1–2.4; no core edits): the seams the OpenSpec profiles consume behave as
 * the design assumes. 2.1 (listener isolation) is covered in `profiles.test.ts` next to the module helper;
 * here: 2.1 ordering (gates → commit → event), 2.2 a second op gate and the dispatch-eligibility skip,
 * 2.3 per-member committer, 2.4 the server-actor shutdown request.
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../../__tests__/harness/index.js";
import { createExtensionPoints, type OpGate } from "../../extension-points.js";

/** An env whose registries are still open after the runtime wired (so a test can register before the first lane call). */
const open = (): TeamsEnv => createTeamsEnv({ ext: createExtensionPoints(), runtime: { openspec: false } });

async function oneTask(env: TeamsEnv, owner?: string) {
  const team = await env.createTeam();
  env.addMember(team, "alice", "idle");
  const created = (await env.call("lead", "TaskCreate", { title: "t", ...(owner ? { owner } : {}) })) as { data: { task: { id: string } } };
  return { team, id: created.data.task.id };
}

describe("2.1 task_completed fires after the op gates and the commit", () => {
  it("a vetoed completion emits nothing; the allowed one emits once, after the gate ran and with the task already committed", async () => {
    const env = open();
    const order: string[] = [];
    let allow = false;
    env.rt.ext.registerOpGate("TaskUpdate", (input) => {
      if ((input.args as { status?: string }).status !== "completed") return undefined;
      order.push("gate");
      return allow ? undefined : { block: true, feedback: "not yet" };
    });
    env.rt.store.on("task_completed", ({ task }) => void order.push(`event:${task.status}`));
    const { team, id } = await oneTask(env);
    await env.call("alice", "TaskUpdate", { id, status: "in_progress" });
    expect(await env.call("alice", "TaskUpdate", { id, status: "completed", result: "r" })).toMatchObject({ ok: false, error: "op_blocked" });
    expect(team.tasks[0]?.status).toBe("in_progress");
    allow = true;
    expect((await env.call("alice", "TaskUpdate", { id, status: "completed", result: "r" })).ok).toBe(true);
    expect(order).toEqual(["gate", "gate", "event:completed"]);
  });

  it("a throwing core listener never breaks the commit (core's own isolation)", async () => {
    const env = open();
    env.rt.store.on("task_completed", () => {
      throw new Error("boom");
    });
    const { team, id } = await oneTask(env);
    await env.call("alice", "TaskUpdate", { id, status: "in_progress" });
    expect((await env.call("alice", "TaskUpdate", { id, status: "completed", result: "r" })).ok).toBe(true);
    expect(team.tasks[0]?.status).toBe("completed");
    expect(env.fake.logs.error.some((l) => l.includes("store listener for task_completed threw"))).toBe(true);
  });
});

describe("2.2 a second op gate next to the existing ones; eligibility skips even an owned task", () => {
  it("both gates run in registration order under one budget; the later veto wins with its own code and feedback", async () => {
    const env = createTeamsEnv({ ext: createExtensionPoints(), runtime: { openspec: false } });
    const ran: string[] = [];
    const baseline = env.rt.ext.gatesFor("TaskUpdate").length; // the templates-hooks gate is already there
    const first: OpGate = () => void ran.push("first");
    const second: OpGate = () => (ran.push("second"), { block: true, feedback: "not_shipped: archive missing", code: "op_blocked" });
    env.rt.ext.registerOpGate("TaskUpdate", first);
    env.rt.ext.registerOpGate("TaskUpdate", second);
    expect(env.rt.ext.gatesFor("TaskUpdate")).toHaveLength(baseline + 2);
    const { id } = await oneTask(env);
    await env.call("alice", "TaskUpdate", { id, status: "in_progress" });
    const res = await env.call("alice", "TaskUpdate", { id, status: "completed", result: "r" });
    expect(res).toMatchObject({ ok: false, error: "op_blocked", message: "not_shipped: archive missing" });
    expect(ran).toEqual(["first", "second"]);
  });

  it("a gate registered for TaskUpdate is not consulted for an in_progress update", async () => {
    const env = open();
    let calls = 0;
    env.rt.ext.registerOpGate("TaskUpdate", () => void calls++);
    const { id } = await oneTask(env);
    await env.call("alice", "TaskUpdate", { id, status: "in_progress" });
    expect(calls).toBe(0); // core runs TaskUpdate gates only for completion
  });

  it("registerDispatchEligibility → false skips the member even for a task it owns; without it the owned task is delivered", async () => {
    const run = async (eligible: boolean) => {
      const env = open();
      if (!eligible) env.rt.ext.registerDispatchEligibility((_team, member) => member.name !== "alice");
      const { team, id } = await oneTask(env, undefined);
      // assign to alice while she is idle
      await env.call("lead", "TaskUpdate", { id, owner: "alice" });
      await env.settle();
      return { task: team.tasks.find((t) => t.id === id), assigned: env.mailsTo(team, "alice").filter((m) => m.kind === "task_assigned") };
    };
    const without = await run(true);
    expect(without.task?.status).toBe("in_progress");
    expect(without.assigned).toHaveLength(1);
    const skipped = await run(false);
    expect(skipped.task).toMatchObject({ status: "pending", owner: "alice" });
    expect(skipped.assigned).toHaveLength(0);
  });
});

describe("2.3 per-member committer", () => {
  it("committer:member switches the policy and the protocol prompt for THAT member only; Team.committer stays lead", async () => {
    const env = open();
    const team = await env.createTeam();
    expect(env.rt.ops.spawnMember(team, { name: "wt", prompt: "go" }, { committer: "member", cwd: "/work/.worktrees/wt" }).ok).toBe(true);
    expect(env.rt.ops.spawnMember(team, { name: "plain", prompt: "go" }).ok).toBe(true);
    await env.settle();
    const [wt, plain] = env.fake.base.spawns as Array<{ cwd?: string; scope?: { extensionConfig: Record<string, Record<string, string>> } }>;
    const wtExt = wt?.scope?.extensionConfig["agent-teams"] as Record<string, string>;
    const plainExt = plain?.scope?.extensionConfig["agent-teams"] as Record<string, string>;
    expect(wtExt.committer).toBe("member");
    expect(plainExt.committer).toBe("lead");
    expect(JSON.parse(wtExt.policy as string).committer).toBe("member");
    expect(JSON.parse(plainExt.policy as string).committer).toBe("lead");
    expect(JSON.stringify(wt)).toContain("teammate-member-commit.md");
    expect(JSON.stringify(plain)).not.toContain("teammate-member-commit.md");
    expect(team.committer).toBe("lead");
    expect(env.rt.store.member(team, "wt")).toMatchObject({ committer: "member", cwd: "/work/.worktrees/wt" });
    expect(env.rt.store.member(team, "plain")?.committer).toBeUndefined();
  });

  it("no lead-callable argument selects the committer or the cwd (TrustedSpawnOptions is server-only)", async () => {
    const env = open();
    const team = await env.createTeam();
    await env.call("lead", "TeammateSpawn", { name: "x", prompt: "go", committer: "member", cwd: "/etc" });
    await env.settle();
    expect(env.rt.store.member(team, "x")?.committer).toBeUndefined();
  });
});

describe("2.4 requestShutdown(team, name, {actor:'server'})", () => {
  it("the request is `from server`; approval wakes the lead nothing, rejection wakes it", async () => {
    const env = open();
    const team = await env.createTeam();
    env.addMember(team, "alice", "idle");
    env.addMember(team, "bob", "idle");
    expect(env.rt.ops.requestShutdown(team, "alice", { actor: "server" }).ok).toBe(true);
    expect(env.rt.ops.requestShutdown(team, "bob", { actor: "server" }).ok).toBe(true);
    for (const n of ["alice", "bob"]) expect(env.rt.store.pendingMail(team.id, n)[0]).toMatchObject({ from: "server", kind: "shutdown_request", wake: true });
    const wakingLeadMail = () => env.mailsTo(team, "lead").filter((m) => m.wake);
    await env.call("alice", "ShutdownResponse", { approve: true });
    env.flushNotices(10_000);
    expect(wakingLeadMail()).toHaveLength(0);
    await env.call("bob", "ShutdownResponse", { approve: false, reason: "still working" });
    env.flushNotices(10_000);
    expect(wakingLeadMail().length).toBeGreaterThan(0);
  });

  it("an unknown or gone member is refused without side effects", async () => {
    const env = open();
    const team = await env.createTeam();
    expect(env.rt.ops.requestShutdown(team, "ghost", { actor: "server" })).toMatchObject({ ok: false, error: "unknown_recipient" });
    expect(env.mailsTo(team, "ghost")).toEqual([]);
  });
});
