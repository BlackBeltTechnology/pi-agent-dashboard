/**
 * Review task and reviewer (task 7.31 #E22, 5.7): the dispatch eligibility rule keeps the reviewer off every
 * task it does not own, in every cell of the state grid and for a task created after Review unblocked; the
 * Review task gets its owner the moment `reviewer` joins the roster (core accepts an owner only once the
 * member exists, and the roster spawns after the seed).
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it } from "vitest";
import { memberFixture } from "../../../__tests__/harness/index.js";
import type { Member, MemberStatus, Team } from "../../../shared/types.js";
import { reviewerEligible } from "../apply.js";
import { createApplyEnv } from "./apply-env.js";
import { APPLY } from "./env.js";

const OPEN = "## 1. A\n- [ ] 1.1 first\n- [ ] 1.2 second\n";

async function setup(reviewerStatus: MemberStatus, kind: "apply" | "plain" = "apply") {
  const e = await createApplyEnv({ tasksMd: OPEN });
  const team: Team = kind === "apply" ? e.team("apply") : (e.rt.ops.createTeam({ name: "plain", leadCwd: e.cwd, leadSessionId: e.fake.addSession("S-plain-lead", { cwd: e.cwd }) }) as { data: Team }).data;
  const add = (name: string, status: MemberStatus): void => void e.rt.store.reserveMember(team.id, memberFixture(name, { status, sessionId: e.fake.addSession(`S-${name}`, { cwd: e.cwd }) }) as Member);
  add("dev-1", "busy"); // busy: never claims, keeps the grid about the reviewer
  add("reviewer", reviewerStatus);
  const create = (title: string, extra: { blockedBy?: string[]; owner?: string } = {}) => {
    const res = e.rt.ops.createTask(team, { title, ...extra }, { actor: "server" });
    if (!res.ok) throw new Error(res.error);
    return res.data.task.id;
  };
  const complete = (id: string): void => {
    e.rt.store.patchTask(team.id, id, { status: "in_progress", owner: "dev-1" });
    const res = e.rt.ops.updateTask(team, { id, status: "completed" }, { actor: "lead" });
    if (!res.ok) throw new Error(res.error);
  };
  const tasks = () => (e.rt.store.get(team.id) as Team).tasks;
  return { e, team, create, complete, tasks };
}

describe("reviewer dispatch eligibility (7.31 #E22)", () => {
  const cells = (["blocked", "unblocked"] as const).flatMap((r) => (["none", "open"] as const).flatMap((t) => (["idle", "busy"] as const).map((v) => [r, t, v] as const)));
  it.each(cells)("Review %s × unowned implementation task %s × reviewer %s: never an implementation task; Review only when unblocked and idle", async (reviewState, implTask, reviewer) => {
    const s = await setup(reviewer);
    const t1 = s.create("1.1 first");
    if (implTask === "open") s.create("1.2 second");
    const review = s.create("Review", { blockedBy: [t1] });
    expect(s.e.rt.ops.updateTask(s.team, { id: review, owner: "reviewer" }, { actor: "server" }).ok).toBe(true);
    if (reviewState === "unblocked") s.complete(t1);
    expect(s.tasks().filter((t) => t.owner === "reviewer").map((t) => t.id)).toEqual([review]);
    expect(s.tasks().find((t) => t.id === review)?.status).toBe(reviewState === "unblocked" && reviewer === "idle" ? "in_progress" : "pending");
    expect(s.tasks().filter((x) => x.title !== "Review").map((t) => t.owner)).not.toContain("reviewer");
  });

  it("a task created AFTER Review unblocked is not assigned to an idle reviewer (it already finished Review)", async () => {
    const s = await setup("idle");
    const t1 = s.create("1.1 first");
    const review = s.create("Review", { blockedBy: [t1] });
    s.e.rt.ops.updateTask(s.team, { id: review, owner: "reviewer" }, { actor: "server" });
    s.complete(t1);
    expect(s.tasks().find((t) => t.id === review)?.status).toBe("in_progress"); // the reviewer took Review
    s.e.rt.store.patchTask(s.team.id, review, { status: "completed" });
    s.e.rt.store.patchMember(s.team.id, "reviewer", { status: "idle" });
    const late = s.create("late work");
    const lateTask = s.tasks().find((t) => t.id === late);
    expect(lateTask?.status).toBe("pending");
    expect(lateTask?.owner).toBeUndefined();
    s.create("later still");
    expect(s.tasks().filter((t) => t.owner === "reviewer")).toHaveLength(1);
  });

  it("an idle reviewer with no owned task stays idle although unowned tasks are open", async () => {
    const s = await setup("idle");
    s.create("1.1 first");
    s.create("1.2 second");
    expect(s.tasks().map((t) => t.owner)).toEqual([undefined, undefined]);
  });

  it("the rule is the pure predicate `owner === reviewer`; other members and non-apply teams are unaffected", async () => {
    const s = await setup("idle", "plain");
    s.create("1.1 first"); // a plain team: the reviewer is an ordinary idle member and takes the unowned task
    expect(s.tasks()[0]).toMatchObject({ owner: "reviewer", status: "in_progress" });
    const a = await setup("idle");
    const dev = a.e.rt.store.member(a.team, "dev-1") as Member;
    expect(reviewerEligible(a.e.rt.store, a.team, dev, true)).toBe(true);
    const rev = a.e.rt.store.member(a.team, "reviewer") as Member;
    expect(reviewerEligible(a.e.rt.store, a.team, rev, true)).toBe(false);
    expect(reviewerEligible(a.e.rt.store, a.team, rev, false)).toBe(true);
  });
});

describe("the Review owner follows the roster", () => {
  it("a real start with the shipped template: Review ends up owned by reviewer once it is spawned; implementers claim, the reviewer does not", async () => {
    const e = await createApplyEnv({ tasksMd: OPEN, realTemplates: true });
    expect((await e.start({ template: APPLY, goal: "x" })).ok).toBe(true);
    await e.flush();
    const team = e.rt.store.list()[0] as Team;
    expect(team.members.map((m) => m.name).sort()).toEqual(["dev-1", "dev-2", "reviewer"]);
    const review = team.tasks.find((t) => t.title === "Review") as Team["tasks"][number];
    expect(review.owner).toBe("reviewer");
    expect(team.tasks.filter((t) => t.title !== "Review").every((t) => t.owner !== "reviewer")).toBe(true);
  });
});
