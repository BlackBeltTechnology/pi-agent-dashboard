/**
 * `GET /teams?sessionId=` (test-plan S20, S21): at most one summary per session,
 * live over closed, most recently changed, ties by id, found by scanning teams
 * (not the in-memory index); invalid values answer 400 `bad_session_id` and
 * never fall back to the full list.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";
import type { TeamListResponse } from "../../shared/snapshot.js";
import type { Team } from "../../shared/types.js";
import { SESSION_ID_MAX_LENGTH } from "../../shared/ui-protocol.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});
async function mk(): Promise<UiEnv> {
  const e = await createUiEnv();
  envs.push(e);
  return e;
}
const ids = async (e: UiEnv, sid: string, headers: Record<string, string> = {}) => (await e.get<TeamListResponse>(`/teams?sessionId=${encodeURIComponent(sid)}`, headers)).body.teams.map((t) => t.id);

/** A live team the given session leads (the store allows several; the lane does not). */
function leadTeam(e: UiEnv, sid: string, name: string): Team {
  return e.rt.store.createTeam({ name, leadSessionId: sid, leadCwd: "/work", mode: "session", maxTeammates: 4 });
}

describe("session lookup (S20)", () => {
  it("lead session, member session and unknown session", async () => {
    const e = await mk();
    const team = await e.createTeam();
    const alice = e.addMember(team, "alice", "idle");
    expect(await ids(e, e.lead)).toEqual([team.id]);
    expect(await ids(e, alice)).toEqual([team.id]);
    expect(await ids(e, "S-unknown")).toEqual([]);
    const body = (await e.get<TeamListResponse>(`/teams?sessionId=${e.lead}`)).body;
    expect(body.teams).toHaveLength(1);
  });

  it("a session that led a closed team and now leads a live one gets the live one; the closed one is found by scanning, not the index", async () => {
    const e = await mk();
    const a = await e.createTeam("alpha");
    expect(e.rt.ops.teamDelete(a, { actor: "lead" }).ok).toBe(true);
    expect(a.status).toBe("closed");
    expect(e.rt.store.findBySession(e.lead)).toBeUndefined(); // the index entry is gone
    expect(await ids(e, e.lead)).toEqual([a.id]); // only the closed team exists: still found
    const b = await e.createTeam("beta");
    expect(await ids(e, e.lead)).toEqual([b.id]);
  });

  it("two live teams: the most recently changed wins; mail and task timestamps both count", async () => {
    const e = await mk();
    const t1 = leadTeam(e, "S-shared", "one");
    const t2 = leadTeam(e, "S-shared", "two");
    e.clock.advance(1000);
    e.rt.store.appendMail(t1.id, { from: "lead", to: "alice", kind: "message", text: "x", wake: false });
    expect(await ids(e, "S-shared")).toEqual([t1.id]);
    e.clock.advance(1000);
    e.rt.store.addTask(t2.id, { title: "t", description: "d", createdBy: "lead" });
    expect(await ids(e, "S-shared")).toEqual([t2.id]);
  });

  it("equal change time: the smaller id wins, deterministically across 100 calls", async () => {
    const e = await mk();
    const t1 = leadTeam(e, "S-shared", "one");
    const t2 = leadTeam(e, "S-shared", "two");
    const winner = [t1.id, t2.id].sort()[0] as string;
    for (let i = 0; i < 100; i++) expect(await ids(e, "S-shared")).toEqual([winner]);
  });

  it("a closed team never beats a live one even when it changed later", async () => {
    const e = await mk();
    const live = leadTeam(e, "S-shared", "live");
    const old = leadTeam(e, "S-shared", "old");
    e.clock.advance(5000);
    e.rt.store.appendMail(old.id, { from: "lead", to: "alice", kind: "message", text: "x", wake: false });
    e.rt.ops.teamDelete(old, { actor: "lead" });
    expect(old.status).toBe("closed");
    expect(await ids(e, "S-shared")).toEqual([live.id]);
  });

  it("owner filtering applies before the pick", async () => {
    const e = await createUiEnv({ enforced: true });
    envs.push(e);
    const team = await e.createTeam();
    team.owner = e.ownerKey({ iss: "idp", sub: "alice" });
    expect(await ids(e, e.lead, { "x-principal": "idp|bob" })).toEqual([]);
    expect(await ids(e, e.lead, { "x-principal": "idp|alice" })).toEqual([team.id]);
  });
});

describe("lookup parameter classes (S21)", () => {
  it.each([
    ["empty", "sessionId="],
    ["repeated", "sessionId=a&sessionId=b"],
    ["10 000 characters", `sessionId=${"x".repeat(10_000)}`],
    ["array form", "sessionId[]=x"],
    ["NUL", "sessionId=a%00b"],
    [`${SESSION_ID_MAX_LENGTH + 1} characters`, `sessionId=${"x".repeat(SESSION_ID_MAX_LENGTH + 1)}`],
  ])("%s → 400 bad_session_id and no list leak", async (_label, qs) => {
    const e = await mk();
    await e.createTeam();
    const res = await e.get<Record<string, unknown>>(`/teams?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_session_id" });
    expect(JSON.stringify(res.body)).not.toContain("teams");
  });

  it(`${SESSION_ID_MAX_LENGTH} characters is accepted`, async () => {
    const e = await mk();
    await e.createTeam();
    const res = await e.get<TeamListResponse>(`/teams?sessionId=${"x".repeat(SESSION_ID_MAX_LENGTH)}`);
    expect(res.status).toBe(200);
    expect(res.body.teams).toEqual([]);
  });

  it("without the parameter the plain list is unchanged", async () => {
    const e = await mk();
    const team = await e.createTeam();
    expect((await e.get<TeamListResponse>("/teams")).body.teams.map((t) => t.id)).toEqual([team.id]);
  });
});
