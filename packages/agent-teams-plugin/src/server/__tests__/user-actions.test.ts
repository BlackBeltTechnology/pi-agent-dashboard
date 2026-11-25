/**
 * Stop member / Shut down team over the real routes (test-plan S23, S25, S40,
 * S42, plus tiers S27 and the write limiter): outcome tables, check-and-set
 * repeats, and the host tier gate as it classifies the real route patterns.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv, type UiEnvOptions } from "../../__tests__/harness/ui-env.js";
import { REST_WRITE_RATE } from "../../shared/constants.js";
import type { MemberStatus, Team } from "../../shared/types.js";

/** The `details.items` of a coalesced notice mail (empty when absent). */
const itemsOf = (m: { details?: Record<string, unknown> } | undefined): Array<{ text: string }> => ((m?.details as { items?: Array<{ text: string }> } | undefined)?.items ?? []);

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});
async function mk(over: UiEnvOptions = {}): Promise<UiEnv> {
  const e = await createUiEnv(over);
  envs.push(e);
  return e;
}
const NOT_FOUND = { error: "not_found" };

/** Count `teamDelete` calls without changing what it does. */
function spyTeamDelete(e: UiEnv): { calls: () => number } {
  let n = 0;
  const real = e.rt.ops.teamDelete;
  e.rt.ops.teamDelete = ((...a: Parameters<typeof real>) => {
    n++;
    return real(...a);
  }) as typeof real;
  return { calls: () => n };
}

describe("stop route decision table (S23)", () => {
  it("busy + connected → 200 {aborted:true}; abort dispatched once", async () => {
    const e = await mk();
    const team = await e.createTeam();
    const sid = e.addMember(team, "alice", "busy");
    const res = await e.post(`/teams/${team.id}/members/alice/stop`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aborted: true });
    expect(e.fake.base.aborts).toEqual([sid]);
  });

  it("busy without a live connection → 409 not_connected, no lead notice", async () => {
    const e = await mk();
    const team = await e.createTeam();
    const sid = e.addMember(team, "alice", "busy");
    e.fake.base.sessions.delete(sid); // the host has no socket for it
    const res = await e.post(`/teams/${team.id}/members/alice/stop`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "not_connected" });
    e.flushNotices();
    expect(e.mailsTo(team, "lead")).toEqual([]);
  });

  it.each<[MemberStatus, number, string]>([
    ["idle", 409, "not_busy"],
    ["spawning", 409, "not_busy"],
    ["shutdown_pending", 409, "not_busy"],
    ["gone", 409, "not_busy"],
    ["failed", 409, "not_busy"],
    ["disconnected", 409, "not_connected"],
  ])("member %s → %i %s, nothing aborted, no notice", async (status, code, error) => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", status);
    const res = await e.post(`/teams/${team.id}/members/alice/stop`);
    expect(res.status).toBe(code);
    expect(res.body).toEqual({ error });
    expect(e.fake.base.aborts).toEqual([]);
    e.flushNotices();
    expect(e.mailsTo(team, "lead")).toEqual([]);
  });

  it("unknown member → 404 with the body of an unknown team", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    const res = await e.post(`/teams/${team.id}/members/nobody/stop`);
    const unknownTeam = await e.post("/teams/t_unknown/members/alice/stop");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(res.raw).toBe(unknownTeam.raw);
    expect(e.fake.base.aborts).toEqual([]);
  });

  it.each(["closing", "closed"] as const)("team %s → 409 team_closed, nothing aborted", async (status) => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    e.rt.store.setTeamStatus(team.id, status);
    const res = await e.post(`/teams/${team.id}/members/alice/stop`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "team_closed" });
    expect(e.fake.base.aborts).toEqual([]);
  });

  it("an unknown team id → 404", async () => {
    const e = await mk();
    const res = await e.post("/teams/t_nope/members/alice/stop");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });
});

describe("shutdown route decision table (S25)", () => {
  async function teamWithLiveMember(e: UiEnv, kind: "starting" | "active" | "orphaned"): Promise<Team> {
    if (kind === "starting") {
      const t = e.rt.store.createTeam({ name: "beta", leadCwd: "/work", mode: "session", maxTeammates: 4, starting: true });
      e.addMember(t, "alice", "idle");
      return t;
    }
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    if (kind === "orphaned") e.rt.ops.orphanTeam(team);
    return team;
  }

  it.each(["starting", "active", "orphaned"] as const)("%s → 202 {closing:true}, team closing, one teamDelete", async (kind) => {
    const e = await mk();
    const team = await teamWithLiveMember(e, kind);
    expect(team.status).toBe(kind);
    const spy = spyTeamDelete(e);
    const res = await e.post(`/teams/${team.id}/shutdown`);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ closing: true });
    expect(team.status).toBe("closing");
    expect(spy.calls()).toBe(1);
  });

  it("closing → 202 again and teamDelete is not called a second time", async () => {
    const e = await mk();
    const team = await teamWithLiveMember(e, "active");
    const spy = spyTeamDelete(e);
    expect((await e.post(`/teams/${team.id}/shutdown`)).status).toBe(202);
    const again = await e.post(`/teams/${team.id}/shutdown`);
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ closing: true });
    expect(spy.calls()).toBe(1);
    // Core re-posts member mails on a second teamDelete: it must not have happened.
    expect(e.mailsTo(team, "alice").filter((m) => m.kind === "shutdown_request")).toHaveLength(1);
  });

  it("closed → 409 team_closed", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.rt.ops.teamDelete(team, { actor: "lead" });
    expect(team.status).toBe("closed");
    const res = await e.post(`/teams/${team.id}/shutdown`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "team_closed" });
  });

  it("unknown id → 404 identical to GET of the unknown id", async () => {
    const e = await mk();
    const get = await e.get("/teams/t_unknown");
    const post = await e.post("/teams/t_unknown/shutdown");
    expect(post.status).toBe(404);
    expect(post.raw).toBe(get.raw);
  });
});

describe("shutdown repeat is check-and-set (S40)", () => {
  it("two callers in the same tick: both 202, teamDelete once, one team_closed", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    const spy = spyTeamDelete(e);
    let closed = 0;
    e.rt.store.on("team_closed", () => closed++);
    const [a, b] = await Promise.all([e.post(`/teams/${team.id}/shutdown`, { "x-principal": "local" }), e.post(`/teams/${team.id}/shutdown`, { "x-principal": "local" })]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect([a.body, b.body]).toEqual([{ closing: true }, { closing: true }]);
    expect(spy.calls()).toBe(1);
    e.clock.advance(10_000);
    await e.settle();
    await e.settle();
    expect(team.status).toBe("closed");
    expect(closed).toBe(1);
  });
});

describe("stop repeat (S42)", () => {
  it("a second stop 50 ms later answers 200, dispatches no second abort and queues one notice", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    const first = await e.post(`/teams/${team.id}/members/alice/stop`);
    e.clock.advance(50);
    const second = await e.post(`/teams/${team.id}/members/alice/stop`);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect([first.body, second.body]).toEqual([{ aborted: true }, { aborted: true }]);
    expect(e.fake.base.aborts).toHaveLength(1);
    e.flushNotices();
    const sent = e.mailsTo(team, "lead").filter((m) => m.kind === "notice");
    expect(sent).toHaveLength(1);
    expect(itemsOf(sent[0])).toHaveLength(1);
  });

  it("after the member settled and became busy again a new stop aborts again", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    await e.post(`/teams/${team.id}/members/alice/stop`);
    e.rt.store.patchMember(team.id, "alice", { status: "idle" });
    e.rt.store.patchMember(team.id, "alice", { status: "busy" });
    expect((await e.post(`/teams/${team.id}/members/alice/stop`)).status).toBe(200);
    expect(e.fake.base.aborts).toHaveLength(2);
  });
});

describe("mutating routes sit under core's rate-limited prefix", () => {
  it(`writes are limited per route to burst ${REST_WRITE_RATE.burst} (core's constants), reads keep their own bucket`, async () => {
    const e = await mk({ rateLimits: null });
    const codes: number[] = [];
    for (let i = 0; i < REST_WRITE_RATE.burst + 2; i++) codes.push((await e.post("/teams/t_x/shutdown")).status);
    expect(codes).toEqual([...Array(REST_WRITE_RATE.burst).fill(404), 429, 429]);
    const limited = await e.post("/teams/t_x/shutdown");
    expect(limited.body).toEqual({ error: "rate_limited" });
    expect((await e.get("/teams")).status).toBe(200); // reads are not charged against the write bucket
  });
});
