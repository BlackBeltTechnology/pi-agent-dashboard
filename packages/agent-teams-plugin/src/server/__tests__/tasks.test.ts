/**
 * Task list and dispatcher over the real request-lane handlers (test-plan
 * S21–S33 create/cap/dependencies/claim/transitions/assignment/completion/
 * listing/dispatch/release, S59–S62 same-tick races, S138 owner lock). Members
 * that must NOT be auto-dispatched are `busy`; the store seeds states that have
 * no lane path.
 * See change: add-agent-teams-core.
 */
import { describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import { TRUNCATION_MARKER } from "../../shared/constants.js";
import type { Team } from "../../shared/types.js";
import { createExtensionPoints } from "../extension-points.js";

async function setup(config?: Record<string, unknown>) {
  const e = createTeamsEnv(config ? { config } : {});
  const team = await e.createTeam();
  return { e, team };
}

const add = (e: TeamsEnv, team: Team, title: string, extra: Record<string, unknown> = {}) =>
  e.rt.store.addTask(team.id, { title, description: `${title} body`, createdBy: "lead", ...extra }) as NonNullable<ReturnType<TeamsEnv["rt"]["store"]["addTask"]>>;
const tasksOf = (team: Team, status?: string) => team.tasks.filter((t) => status === undefined || t.status === status).map((t) => t.id);
const assigned = (e: TeamsEnv, team: Team, to: string) => e.mailsTo(team, to).filter((m) => m.kind === "task_assigned");

describe("create limits (S21)", () => {
  it("title 200/201, description 2000/2001 and TeamCreate name 40/41 are accepted at the cap and refused one over without a record", async () => {
    const { e, team } = await setup();
    const create = (args: object) => e.call("lead", "TaskCreate", args);
    expect((await create({ title: "t".repeat(200), description: "d".repeat(2000) })).ok).toBe(true);
    const before = team.tasks.length;
    expect(await create({ title: "t".repeat(201), description: "d" })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await create({ title: "t", description: "d".repeat(2001) })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(team.tasks).toHaveLength(before);
    expect(await create({ title: "", description: "d" })).toMatchObject({ error: "invalid_args" });
    expect(await create({ title: 7 })).toMatchObject({ error: "invalid_args" });
    const e2 = createTeamsEnv();
    e2.fake.addSession("S-x", { cwd: "/work" });
    expect((await e2.fake.call("S-x", "TeamCreate", { name: "n".repeat(40) })).ok).toBe(true);
    const e3 = createTeamsEnv();
    expect(await e3.fake.call(e3.lead, "TeamCreate", { name: "n".repeat(41) })).toMatchObject({ error: "invalid_args" });
    expect(e3.rt.store.list()).toHaveLength(0);
  });

  it("a result of 4000 chars is stored whole, 4001 truncated with the marker, and TaskList still succeeds", async () => {
    const { e, team } = await setup();
    e.addMember(team, "bob", "busy");
    for (const [n, len] of [[1, 4000], [2, 4001]] as const) {
      await e.call("lead", "TaskCreate", { title: `t${n}`, description: "d" });
      await e.call("bob", "TaskUpdate", { id: String(n), status: "in_progress" });
      const done = await e.call("bob", "TaskUpdate", { id: String(n), status: "completed", result: "r".repeat(len) });
      expect(done.ok).toBe(true);
    }
    expect(team.tasks[0]?.result).toBe("r".repeat(4000));
    expect(team.tasks[1]?.result).toBe(`${"r".repeat(4000)}${TRUNCATION_MARKER}`);
    expect((await e.call("lead", "TaskList", { includeCompleted: true })).ok).toBe(true);
  });
});

describe("task cap (S22)", () => {
  it("counts NON-completed tasks: 49 → ok, 50 open → task_cap_reached, 50 completed + 0 open → ok, completing one reopens a slot", async () => {
    const { e, team } = await setup();
    for (let i = 0; i < 49; i++) add(e, team, `t${i}`);
    expect((await e.call("lead", "TaskCreate", { title: "50th" })).ok).toBe(true);
    expect(await e.call("lead", "TaskCreate", { title: "51st" })).toMatchObject({ ok: false, error: "task_cap_reached" });
    for (const t of team.tasks) e.rt.store.patchTask(team.id, t.id, { status: "completed" });
    expect((await e.call("lead", "TaskCreate", { title: "after-completed" })).ok).toBe(true);

    const small = await setup({ maxTasks: 2 });
    small.e.addMember(small.team, "bob", "busy");
    await small.e.call("lead", "TaskCreate", { title: "a" });
    await small.e.call("lead", "TaskCreate", { title: "b" });
    expect(await small.e.call("lead", "TaskCreate", { title: "c" })).toMatchObject({ error: "task_cap_reached" });
    await small.e.call("bob", "TaskUpdate", { id: "1", status: "in_progress" });
    await small.e.call("bob", "TaskUpdate", { id: "1", status: "completed" });
    expect((await small.e.call("lead", "TaskCreate", { title: "c" })).ok).toBe(true);
  });
});

describe("dependencies (S23)", () => {
  it("derives blocked, rejects unknown/self/cyclic deps with no state change, dedupes, never stores blocked", async () => {
    const { e, team } = await setup();
    const t1 = add(e, team, "one");
    const done = add(e, team, "done");
    e.rt.store.patchTask(team.id, done.id, { status: "completed" });
    const blockedBy = await e.call("lead", "TaskCreate", { title: "dep", blockedBy: [t1.id, t1.id] });
    expect(blockedBy).toMatchObject({ ok: true });
    expect(blockedBy.data.task).toMatchObject({ blockedBy: [t1.id], blocked: true, claimable: false });
    expect((await e.call("lead", "TaskCreate", { title: "dep-done", blockedBy: [done.id] })).data.task).toMatchObject({ blocked: false });
    expect(await e.call("lead", "TaskCreate", { title: "x", blockedBy: ["99"] })).toMatchObject({ error: "unknown_dependency" });
    expect(await e.call("lead", "TaskCreate", { title: "x", blockedBy: Array.from({ length: 51 }, (_, i) => String(i + 1)) })).toMatchObject({ error: "invalid_args" });
    const count = team.tasks.length;

    const a = add(e, team, "A");
    const b = add(e, team, "B", { blockedBy: [a.id] });
    const c = add(e, team, "C", { blockedBy: [b.id] });
    const snapshot = JSON.stringify(team.tasks);
    expect(await e.call("lead", "TaskUpdate", { id: a.id, addBlockedBy: [a.id] })).toMatchObject({ error: "dependency_cycle" });
    expect(await e.call("lead", "TaskUpdate", { id: a.id, addBlockedBy: [b.id] })).toMatchObject({ error: "dependency_cycle" });
    expect(await e.call("lead", "TaskUpdate", { id: a.id, addBlockedBy: [c.id] })).toMatchObject({ error: "dependency_cycle" });
    expect(await e.call("lead", "TaskUpdate", { id: a.id, addBlockedBy: ["404"] })).toMatchObject({ error: "unknown_dependency" });
    expect(JSON.stringify(team.tasks)).toBe(snapshot);
    expect(team.tasks.length).toBeGreaterThan(count);
    expect(JSON.stringify(team.tasks)).not.toContain('"blocked"');
  });
});

describe("unblock (S24)", () => {
  it("task 3 blockedBy [1,2] stays blocked after #1 and becomes claimable with unblocked:[3] after #2", async () => {
    const { e, team } = await setup();
    e.addMember(team, "bob", "busy");
    add(e, team, "one");
    add(e, team, "two");
    add(e, team, "three", { blockedBy: ["1", "2"] });
    for (const id of ["1", "2"]) await e.call("bob", "TaskUpdate", { id, status: "in_progress" });
    const first = await e.call("bob", "TaskUpdate", { id: "1", status: "completed", result: "r1" });
    expect(first.data.unblocked).toEqual([]);
    expect((await e.call("bob", "TaskGet", { id: "3" })).data.task).toMatchObject({ blocked: true, claimable: false });
    const second = await e.call("bob", "TaskUpdate", { id: "2", status: "completed" });
    expect(second.data.unblocked).toEqual(["3"]);
    expect((await e.call("bob", "TaskGet", { id: "3" })).data.task).toMatchObject({ blocked: false, claimable: true });
  });
});

describe("claim (S25)", () => {
  it("covers every task state: free, blocked, owned by other, owned by me, in_progress, completed, unknown", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "busy");
    const dep = add(e, team, "dep", { description: "DEP-FULL" });
    e.rt.store.patchTask(team.id, dep.id, { status: "completed", result: "R-DEP" });
    const free = add(e, team, "free", { description: "FULL DESCRIPTION", blockedBy: [dep.id] });
    const waiting = add(e, team, "waiting");
    const blocked = add(e, team, "blocked", { blockedBy: [waiting.id] });
    const other = add(e, team, "other", { owner: "alice" });
    const mine = add(e, team, "mine", { owner: "bob" });
    const running = add(e, team, "running");
    e.rt.store.patchTask(team.id, running.id, { status: "in_progress", owner: "alice" });
    const finished = add(e, team, "finished");
    e.rt.store.patchTask(team.id, finished.id, { status: "completed" });
    const claim = (id: string) => e.call("bob", "TaskUpdate", { id, status: "in_progress" });

    const ok = await claim(free.id);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.data.task).toMatchObject({ status: "in_progress", owner: "bob", description: "FULL DESCRIPTION" });
    expect(ok.data.dependencies).toEqual([{ id: dep.id, title: "dep", status: "completed", result: "R-DEP" }]);
    expect(await claim(blocked.id)).toMatchObject({ error: "blocked" });
    expect(await claim(other.id)).toMatchObject({ error: "already_claimed" });
    expect((await claim(mine.id)).ok).toBe(true);
    expect(await claim(running.id)).toMatchObject({ error: "already_claimed" });
    expect(await claim(finished.id)).toMatchObject({ error: "invalid_transition" });
    expect(await claim("404")).toMatchObject({ error: "unknown_task" });
    expect(team.tasks.find((t) => t.id === other.id)).toMatchObject({ status: "pending", owner: "alice" });
  });
});

describe("transition matrix (S26)", () => {
  it("only claim, complete (owner|lead) and lead assign/unassign of pending are legal; every other edge is invalid_transition", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "busy");
    const seed = (status: "pending" | "in_progress" | "completed") => {
      const t = add(e, team, `${status}-${team.tasks.length}`);
      e.rt.store.patchTask(team.id, t.id, { status, owner: "alice" });
      return t.id;
    };
    const upd = (who: string, id: string, status: string) => e.call(who, "TaskUpdate", { id, status });
    for (const who of ["alice", "lead", "bob"]) {
      for (const to of ["pending", "in_progress", "completed"]) expect(await upd(who, seed("completed"), to), `${who} completed→${to}`).toMatchObject({ error: "invalid_transition" });
    }
    for (const who of ["alice", "lead"]) {
      expect(await upd(who, seed("pending"), "completed"), `${who} pending→completed`).toMatchObject({ error: "invalid_transition" });
      expect(await upd(who, seed("in_progress"), "pending"), `${who} in_progress→pending`).toMatchObject({ error: "invalid_transition" });
    }
    expect(await upd("bob", seed("pending"), "completed")).toMatchObject({ error: "not_owner" });
    expect(await upd("bob", seed("in_progress"), "completed")).toMatchObject({ error: "not_owner" });
    expect(await upd("lead", seed("pending"), "in_progress")).toMatchObject({ error: "invalid_transition" });
    expect(await upd("alice", seed("in_progress"), "in_progress")).toMatchObject({ error: "already_claimed" });
    expect(await upd("bob", seed("pending"), "in_progress")).toMatchObject({ error: "already_claimed" });
    expect((await upd("alice", seed("pending"), "in_progress")).ok).toBe(true);
    const free = add(e, team, "free");
    expect((await upd("bob", free.id, "in_progress")).ok).toBe(true);
    expect((await upd("alice", seed("in_progress"), "completed")).ok).toBe(true);
    expect((await upd("lead", seed("in_progress"), "completed")).ok).toBe(true);
  });
});

describe("owner assignment (S27)", () => {
  it("lead assigns: idle member is dispatched at once with the full task, spawning is stored only, gone/unknown → unknown_owner", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "idle");
    e.rt.store.reserveMember(team.id, { name: "carol", spawnToken: "t", cwd: "/w", status: "spawning", guardActive: false, noMcp: true, noContextFiles: true, lastSettleId: 0 });
    e.addMember(team, "dan", "gone");
    const t1 = add(e, team, "one", { description: "ONE FULL" });
    const t2 = add(e, team, "two");
    expect((await e.call("lead", "TaskUpdate", { id: t1.id, owner: "alice" })).ok).toBe(true);
    expect(team.tasks.find((t) => t.id === t1.id)).toMatchObject({ owner: "alice", status: "in_progress" });
    expect(assigned(e, team, "alice")).toHaveLength(1);
    expect(assigned(e, team, "alice")[0]).toMatchObject({ wake: true, from: "server" });
    expect(assigned(e, team, "alice")[0]?.text).toContain("ONE FULL");

    expect((await e.call("lead", "TaskUpdate", { id: t2.id, owner: "carol" })).ok).toBe(true);
    expect(team.tasks.find((t) => t.id === t2.id)).toMatchObject({ owner: "carol", status: "pending" });
    expect(assigned(e, team, "carol")).toHaveLength(0);
    expect(await e.call("lead", "TaskUpdate", { id: t2.id, owner: "dan" })).toMatchObject({ error: "unknown_owner" });
    expect(await e.call("lead", "TaskUpdate", { id: t2.id, owner: "nobody" })).toMatchObject({ error: "unknown_owner" });
    expect((await e.call("lead", "TaskUpdate", { id: t2.id, owner: null })).ok).toBe(true);
    expect(team.tasks.find((t) => t.id === t2.id)?.owner).toBeUndefined();
  });

  it("refusals: teammate sets another owner → owner_not_lead, in_progress of another / completed → invalid_transition, shutdown_pending member → invalid_transition, TaskCreate owner is lead-only", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "shutdown_pending");
    const running = add(e, team, "running");
    e.rt.store.patchTask(team.id, running.id, { status: "in_progress", owner: "alice" });
    const done = add(e, team, "done");
    e.rt.store.patchTask(team.id, done.id, { status: "completed" });
    const open = add(e, team, "open");
    expect(await e.call("alice", "TaskUpdate", { id: open.id, owner: "bob" })).toMatchObject({ error: "owner_not_lead" });
    expect(await e.call("alice", "TaskCreate", { title: "x", owner: "alice" })).toMatchObject({ error: "owner_not_lead" });
    expect(await e.call("lead", "TaskUpdate", { id: running.id, owner: "bob" })).toMatchObject({ error: "invalid_transition" });
    expect(await e.call("lead", "TaskUpdate", { id: done.id, owner: "alice" })).toMatchObject({ error: "invalid_transition" });
    expect(await e.call("lead", "TaskUpdate", { id: open.id, owner: "bob" })).toMatchObject({ error: "invalid_transition" });
    expect((await e.call("lead", "TaskCreate", { title: "x", owner: "alice" })).data.task).toMatchObject({ owner: "alice", status: "pending" });
  });

  it("assigning to a BUSY member stores the owner only; the task is delivered at the member's next idle (no mid-task push)", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    const t = add(e, team, "later", { description: "LATER FULL" });
    expect((await e.call("lead", "TaskUpdate", { id: t.id, owner: "alice" })).ok).toBe(true);
    expect(team.tasks.find((x) => x.id === t.id)).toMatchObject({ owner: "alice", status: "pending" });
    expect(assigned(e, team, "alice")).toHaveLength(0);
    await e.idle("alice", { settleId: 1, finalText: "done" });
    expect(team.tasks.find((x) => x.id === t.id)).toMatchObject({ owner: "alice", status: "in_progress" });
    expect(assigned(e, team, "alice")[0]?.text).toContain("LATER FULL");
  });
});

describe("completion (S28)", () => {
  it("owner and lead complete with a result; non-owner and a member that lost ownership get not_owner; a pending task is invalid_transition; dependents re-evaluated; task_completed fires after commit", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "busy");
    const seen: string[] = [];
    e.rt.store.on("task_completed", ({ task }) => seen.push(`${task.id}:${task.status}:${task.result}`));
    const mk = (title: string, extra: Record<string, unknown> = {}) => {
      const t = add(e, team, title, extra);
      e.rt.store.patchTask(team.id, t.id, { status: "in_progress", owner: "alice" });
      return t.id;
    };
    const ownerDone = mk("a");
    const leadDone = mk("b");
    const stranger = mk("c");
    const lost = mk("d");
    e.rt.ops.releaseMember(team, "alice", "gone", "x"); // releases them all: owner lost
    e.addMember(team, "alice", "busy");
    for (const id of [ownerDone, leadDone, stranger, lost]) e.rt.store.patchTask(team.id, id, { status: "in_progress", owner: "alice" });
    e.rt.store.patchTask(team.id, lost, { status: "pending", clearOwner: true });
    const dependent = add(e, team, "dependent", { blockedBy: [ownerDone] });

    expect(await e.call("bob", "TaskUpdate", { id: stranger, status: "completed" })).toMatchObject({ error: "not_owner" });
    expect(await e.call("alice", "TaskUpdate", { id: lost, status: "completed" })).toMatchObject({ error: "not_owner" });
    expect(await e.call("lead", "TaskUpdate", { id: lost, status: "completed" })).toMatchObject({ error: "invalid_transition" });
    const res = await e.call("alice", "TaskUpdate", { id: ownerDone, status: "completed", result: "RES" });
    expect(res.data).toMatchObject({ task: { status: "completed", result: "RES" }, unblocked: [dependent.id] });
    expect((await e.call("lead", "TaskUpdate", { id: leadDone, status: "completed", result: "L" })).ok).toBe(true);
    expect(seen).toEqual([`${ownerDone}:completed:RES`, `${leadDone}:completed:L`]);
  });
});

describe("listing (S29)", () => {
  it("hides completed by default, flags blocked/claimable, filters, caps completed at the last 50, TaskGet carries result and dependency results", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    const p1 = add(e, team, "p1");
    add(e, team, "p2", { owner: "alice" });
    add(e, team, "blocked", { blockedBy: [p1.id] });
    for (let i = 0; i < 60; i++) e.rt.store.patchTask(team.id, add(e, team, `c${i}`, { description: "x".repeat(300) }).id, { status: "completed", result: "r".repeat(500) });
    const list = await e.call("alice", "TaskList");
    expect(list.data.tasks.map((t: { title: string }) => t.title)).toEqual(["p1", "p2", "blocked"]);
    expect(list.data.tasks.map((t: { blocked: boolean; claimable: boolean }) => [t.blocked, t.claimable])).toEqual([[false, true], [false, true], [true, false]]);
    const bob = await e.call("lead", "TaskList", { owner: "alice" });
    expect(bob.data.tasks.map((t: { title: string }) => t.title)).toEqual(["p2"]);
    expect((await e.call("alice", "TaskList", { status: "pending" })).data.tasks).toHaveLength(3);
    const all = await e.call("alice", "TaskList", { includeCompleted: true });
    const completed = all.data.tasks.filter((t: { status: string }) => t.status === "completed");
    expect(completed).toHaveLength(50);
    expect(completed[0].title).toBe("c10");
    expect(completed[0].result.length).toBeLessThanOrEqual(200 + TRUNCATION_MARKER.length);
    const finished = (await e.call("alice", "TaskGet", { id: completed[0].id })).data;
    expect(finished.task.result).toBe("r".repeat(500));
    expect((await e.call("alice", "TaskGet", { id: "3" })).data.dependencies).toEqual([{ id: p1.id, title: "p1", status: "pending" }]);
    expect(await e.call("alice", "TaskGet", { id: "999" })).toMatchObject({ error: "unknown_task" });
  });
});

describe("dispatcher (S30)", () => {
  it("claims the lowest-id unowned unblocked task; owned-by-others and blocked tasks leave the member idle with no mail", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "idle");
    e.addMember(team, "bob", "busy");
    await e.call("lead", "TaskCreate", { title: "bobs", owner: "bob" });
    await e.call("lead", "TaskCreate", { title: "blocked", blockedBy: ["1"] });
    expect(assigned(e, team, "alice")).toHaveLength(0);
    expect(e.member(team, "alice").status).toBe("idle");
    expect(tasksOf(team, "in_progress")).toEqual([]);
    await e.call("lead", "TaskCreate", { title: "free-a" });
    expect(team.tasks.find((t) => t.owner === "alice")).toMatchObject({ title: "free-a", status: "in_progress" });

    const second = await setup();
    second.e.addMember(second.team, "carol", "busy");
    add(second.e, second.team, "u1");
    add(second.e, second.team, "u2");
    await second.e.idle("carol", { settleId: 1, finalText: "" });
    expect(second.team.tasks.find((t) => t.owner === "carol")?.title).toBe("u1");
  });

  it("an owned task wins over a lower-id unowned one; a member with an in_progress task is never dispatched", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    add(e, team, "low-unowned");
    add(e, team, "high-owned", { owner: "alice" });
    await e.idle("alice", { settleId: 1, finalText: "ok" });
    expect(team.tasks.find((t) => t.owner === "alice" && t.status === "in_progress")?.title).toBe("high-owned");
    expect(assigned(e, team, "alice")).toHaveLength(1);
    // alice (now provisionally busy) goes idle again while owning in_progress: not dispatched again
    await e.idle("alice", { settleId: 2, finalText: "still working" });
    expect(team.tasks.filter((t) => t.status === "in_progress")).toHaveLength(1);
    expect(assigned(e, team, "alice")).toHaveLength(1);
  });

  it("autoDispatch=false (config or team override) disables the unowned branch only", async () => {
    for (const mode of ["config", "override"] as const) {
      const { e, team } = await setup(mode === "config" ? { autoDispatch: false } : undefined);
      if (mode === "override") e.rt.store.patchTeam(team.id, { overrides: { autoDispatch: false } });
      e.addMember(team, "alice", "idle");
      add(e, team, "unowned");
      await e.call("lead", "TaskCreate", { title: "poke" });
      expect(tasksOf(team, "in_progress"), mode).toEqual([]);
      await e.call("lead", "TaskCreate", { title: "mine", owner: "alice" });
      expect(tasksOf(team, "in_progress"), mode).toEqual(["3"]);
    }
  });

  it("dispatches on settle, on TaskCreate, on unblock and on assignment, pushing the FULL task", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "busy");
    await e.call("lead", "TaskCreate", { title: "one", description: "FULL ONE" });
    await e.call("lead", "TaskCreate", { title: "two", description: "FULL TWO", blockedBy: ["1"] });
    await e.call("alice", "TaskUpdate", { id: "1", status: "in_progress" });
    await e.call("bob", "TaskUpdate", { id: "1", status: "in_progress" }).catch(() => undefined);
    await e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "done-1" });
    expect(tasksOf(team, "in_progress")).toEqual([]);
    await e.idle("bob", { settleId: 1, finalText: "x" }); // bob idle: unblocked #2 goes to bob
    expect(team.tasks.find((t) => t.id === "2")).toMatchObject({ status: "in_progress", owner: "bob" });
    const mail = assigned(e, team, "bob")[0];
    expect(mail?.text).toContain("FULL TWO");
    expect(mail?.text).toContain("done-1");
    expect(mail).toMatchObject({ wake: true });
  });
});

describe("dispatcher skip set (S31)", () => {
  it("skips shutdown_pending, degraded, busy, disconnected members, orphaned/starting teams and eligibility vetoes; resumes when the state clears", async () => {
    const ext = createExtensionPoints();
    const e = createTeamsEnv({ ext });
    ext.registerDispatchEligibility((_t, m) => m.name !== "erin"); // registries seal at the first lane request
    const team = await e.createTeam();
    const statuses = { alice: "shutdown_pending", bob: "idle", carol: "busy", dave: "disconnected", erin: "idle" } as const;
    for (const [name, status] of Object.entries(statuses)) e.addMember(team, name, status);
    e.rt.store.patchMember(team.id, "bob", { degraded: "guard_unavailable" });
    await e.call("lead", "TaskCreate", { title: "one" });
    expect(tasksOf(team, "in_progress")).toEqual([]);

    e.rt.store.patchMember(team.id, "bob", { status: "idle" });
    e.rt.store.setTeamStatus(team.id, "orphaned");
    await e.call("lead", "TaskCreate", { title: "two" });
    expect(tasksOf(team, "in_progress")).toEqual([]);

    const helloReply = await e.hello("lead");
    expect(helloReply).toMatchObject({ ok: true });
    expect(team.status).toBe("active");
    expect(tasksOf(team, "in_progress")).toEqual([]); // bob is still degraded
    e.rt.store.patchMember(team.id, "bob", { degraded: undefined });
    await e.hello("dave", { isIdle: true });
    expect(e.member(team, "dave").status).not.toBe("disconnected");
    // bob (degraded cleared) and dave (re-resolved idle) take the two open tasks; alice, carol and the vetoed erin never do.
    expect(team.tasks.filter((t) => t.status === "in_progress").map((t) => t.owner)).toEqual(["bob", "dave"]);
  });

  it("a starting team (no lead yet) does not dispatch until bindLead", async () => {
    const e = createTeamsEnv();
    const created = e.rt.ops.createTeam({ name: "srv", leadCwd: "/repo", starting: true });
    if (!created.ok) throw new Error("create");
    const team = created.data;
    e.addMember(team, "alice", "idle");
    e.rt.ops.createTask(team, { title: "one", description: "d" }, { actor: "server" });
    expect(tasksOf(team, "in_progress")).toEqual([]);
    e.fake.addSession("S-srvlead", { cwd: "/repo" });
    e.rt.ops.bindLead(team.id, "S-srvlead");
    expect(tasksOf(team, "in_progress")).toEqual(["1"]);
  });
});

describe("error settle (S32)", () => {
  it("an API-error settle never auto-claims and the lead notice carries the error text and wakes", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    add(e, team, "available");
    await e.idle("alice", { settleId: 1, error: "rate limit exceeded (429)" });
    expect(tasksOf(team, "in_progress")).toEqual([]);
    expect(e.member(team, "alice").status).toBe("idle");
    e.flushNotices();
    const notice = e.mailsTo(team, "lead").find((m) => m.kind === "notice");
    expect(notice).toMatchObject({ wake: true });
    expect(notice?.text).toContain("rate limit exceeded (429)");
  });
});

describe("release on exit (S33)", () => {
  for (const reason of ["session ended", "failed spawn", "approved shutdown"] as const) {
    it(`${reason}: in_progress → pending unowned with a note, pending-owned loses its owner, the lead notice names both, a respawned name owns nothing`, async () => {
      const { e, team } = await setup();
      e.addMember(team, "alice", "busy");
      const a = add(e, team, "a");
      e.rt.store.patchTask(team.id, a.id, { status: "in_progress", owner: "alice" });
      const b = add(e, team, "b", { owner: "alice" });
      if (reason === "session ended") e.fake.endSession("S-alice");
      else if (reason === "failed spawn") e.rt.ops.releaseMember(team, "alice", "failed", "spawn failed: boom");
      else {
        await e.call("lead", "ShutdownRequest", { to: "alice" });
        await e.call("alice", "ShutdownResponse", { approve: true });
      }
      expect(team.tasks.find((t) => t.id === a.id)).toMatchObject({ status: "pending" });
      expect(team.tasks.find((t) => t.id === a.id)?.owner).toBeUndefined();
      expect(team.tasks.find((t) => t.id === a.id)?.note).toEqual(expect.stringContaining("alice"));
      expect(team.tasks.find((t) => t.id === b.id)?.owner).toBeUndefined();
      if (reason === "approved shutdown") {
        e.flushNotices(10_000); // shutdownGraceMs: the session is ended
        await e.settle();
      }
      e.flushNotices(2000);
      const text = e.mailsTo(team, "lead").filter((m) => m.kind === "notice").map((m) => m.text).join("\n");
      expect(text).toContain(`released to pending: ${a.id}`);
      expect(text).toContain(`unowned: ${b.id}`);
      e.rt.store.reserveMember(team.id, { name: "alice", spawnToken: "n", cwd: "/w", status: "spawning", guardActive: false, noMcp: true, noContextFiles: true, lastSettleId: 0 });
      expect(team.tasks.filter((t) => t.owner === "alice")).toEqual([]);
    });
  }
});

describe("owner lock (S138)", () => {
  it("a launcher-owned task keeps its owner against lead/teammate changes; the server actor may change it, even for a spawning name", async () => {
    const { e, team } = await setup();
    e.rt.store.reserveMember(team.id, { name: "wip", spawnToken: "w", cwd: "/w", status: "spawning", guardActive: false, noMcp: true, noContextFiles: true, lastSettleId: 0 });
    e.addMember(team, "alice", "busy");
    const made = e.rt.ops.createTask(team, { title: "seed", description: "d", owner: "wip", ownerLocked: true }, { actor: "server" });
    expect(made).toMatchObject({ ok: true, data: { task: { owner: "wip", ownerLocked: true, status: "pending" } } });
    const id = (made as { data: { task: { id: string } } }).data.task.id;
    expect(await e.call("lead", "TaskUpdate", { id, owner: "alice" })).toMatchObject({ error: "owner_locked" });
    expect(await e.call("lead", "TaskUpdate", { id, owner: null })).toMatchObject({ error: "owner_locked" });
    expect(await e.call("alice", "TaskUpdate", { id, owner: "alice" })).toMatchObject({ error: "owner_locked" });
    expect(team.tasks.find((t) => t.id === id)?.owner).toBe("wip");
    expect(e.rt.ops.updateTask(team, { id, owner: "alice" }, { actor: "server" })).toMatchObject({ ok: true });
    expect(team.tasks.find((t) => t.id === id)?.owner).toBe("alice");
  });
});

describe("same-tick races (S59–S62)", () => {
  it("S59: two simultaneous claims → exactly one wins, the other already_claimed, one owner", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "busy");
    add(e, team, "contested");
    const [a, b] = await Promise.all([e.call("alice", "TaskUpdate", { id: "1", status: "in_progress" }), e.call("bob", "TaskUpdate", { id: "1", status: "in_progress" })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ error: "already_claimed" });
    expect(team.tasks.filter((t) => t.owner !== undefined)).toHaveLength(1);
  });

  it("S60: 60 tasks, 8 members, claim→complete loops: each completed once, no duplicate claims, no dependency violations, rev monotonic (3 runs)", async () => {
    for (let run = 0; run < 3; run++) {
      const { e, team } = await setup({ maxTasks: 100, autoDispatch: false });
      const names = Array.from({ length: 8 }, (_, i) => `m${i}`);
      for (const n of names) e.addMember(team, n, "busy");
      for (let i = 1; i <= 60; i++) add(e, team, `t${i}`, i % 3 === 0 ? { blockedBy: [String(i - 1)] } : {});
      const claimed = new Map<string, string>();
      const revs: number[] = [];
      e.rt.store.on("change", ({ rev }) => revs.push(rev));
      const worker = async (name: string) => {
        for (let guard = 0; guard < 400 && team.tasks.some((t) => t.status !== "completed"); guard++) {
          const list = await e.call(name, "TaskList");
          const next = (list.data.tasks as Array<{ id: string; claimable: boolean }>).find((t) => t.claimable);
          if (!next) {
            await Promise.resolve();
            continue;
          }
          const res = await e.call(name, "TaskUpdate", { id: next.id, status: "in_progress" });
          if (!res.ok) continue;
          expect(claimed.has(next.id)).toBe(false);
          claimed.set(next.id, name);
          const task = team.tasks.find((t) => t.id === next.id);
          for (const dep of task?.blockedBy ?? []) expect(team.tasks.find((t) => t.id === dep)?.status).toBe("completed");
          expect((await e.call(name, "TaskUpdate", { id: next.id, status: "completed", result: name })).ok).toBe(true);
        }
      };
      await Promise.all(names.map(worker));
      expect(team.tasks.every((t) => t.status === "completed")).toBe(true);
      expect(claimed.size).toBe(60);
      expect(revs).toEqual([...revs].sort((x, y) => x - y));
    }
  });

  it("S61: lead assigns bob in the same tick the dispatcher would hand the task to alice → alice never ends with it", async () => {
    const { e, team } = await setup();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "idle");
    add(e, team, "two");
    const [assign, idle] = await Promise.all([e.call("lead", "TaskUpdate", { id: "1", owner: "bob" }), e.idle("alice", { settleId: 1, finalText: "x" })]);
    expect(assign.ok).toBe(true);
    expect(idle.ok).toBe(true);
    expect(team.tasks[0]).toMatchObject({ owner: "bob", status: "in_progress" });
    expect(assigned(e, team, "bob")).toHaveLength(1);
    expect(assigned(e, team, "alice")).toHaveLength(0);
  });

  it("S62: claim and reassign of one task in the same tick never leave two owners", async () => {
    for (const order of ["claim-first", "assign-first"] as const) {
      const { e, team } = await setup();
      e.addMember(team, "alice", "busy");
      e.addMember(team, "bob", "busy");
      add(e, team, "t");
      const claim = () => e.call("bob", "TaskUpdate", { id: "1", status: "in_progress" });
      const assign = () => e.call("lead", "TaskUpdate", { id: "1", owner: "alice" });
      const [first, second] = await Promise.all(order === "claim-first" ? [claim(), assign()] : [assign(), claim()]);
      expect(first.ok).toBe(true);
      if (order === "claim-first") expect(second).toMatchObject({ ok: false, error: "invalid_transition" });
      else expect(second.ok).toBe(false);
      expect(team.tasks[0]?.owner).toBe(order === "claim-first" ? "bob" : "alice");
    }
  });
});
