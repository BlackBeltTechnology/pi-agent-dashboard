/**
 * Structured logs and counters of the two controls (test-plan S71): one line per
 * call that resolves a team, carrying ids and the outcome code only — never task,
 * mail or final-answer text — and counters as `counter=` lines aggregated every
 * 60 s (asserted through the captured logger, which is the logger spy).
 * The host tier gate's 403 never reaches the plugin, so it has no plugin log line.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});
async function mk(): Promise<UiEnv> {
  const e = await createUiEnv();
  envs.push(e);
  return e;
}
const SECRET = "SECRET-7f3a";
const lines = (e: UiEnv, event: string): string[] => e.fake.logs.info.filter((l) => l.startsWith(`agent-teams: ${event} `));
const all = (e: UiEnv): string => [...e.fake.logs.info, ...e.fake.logs.warn, ...e.fake.logs.error].join("\n");

describe("route outcome logging (S71)", () => {
  it("every stop outcome logs exactly one line with team id, member and outcome — no agent text", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    e.addMember(team, "bob", "idle");
    e.addMember(team, "dora", "disconnected");
    e.rt.store.addTask(team.id, { title: SECRET, description: SECRET, createdBy: "lead", owner: "alice" });
    e.rt.store.patchTask(team.id, "1", { status: "in_progress", result: SECRET });
    e.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text: SECRET, wake: false });
    const plan: Array<[string, number, string, string]> = [
      ["alice", 200, "ok", "alice"],
      ["alice", 200, "repeat", "alice"],
      ["bob", 409, "not_busy", "bob"],
      ["dora", 409, "not_connected", "dora"],
      ["nobody", 404, "not_found", "-"],
    ];
    for (const [name, status, outcome, member] of plan) {
      const before = lines(e, "user_stop").length;
      expect((await e.post(`/teams/${team.id}/members/${name}/stop`)).status).toBe(status);
      const added = lines(e, "user_stop").slice(before);
      expect(added, `${name} ${outcome}`).toEqual([`agent-teams: user_stop team=${team.id} member=${member} outcome=${outcome}`]);
    }
    e.rt.store.setTeamStatus(team.id, "closing");
    const before = lines(e, "user_stop").length;
    expect((await e.post(`/teams/${team.id}/members/alice/stop`)).status).toBe(409);
    expect(lines(e, "user_stop").slice(before)).toEqual([`agent-teams: user_stop team=${team.id} member=alice outcome=team_closed`]);
    expect(all(e)).not.toContain(SECRET);
  });

  it("shutdown outcomes: ok, repeat, team_closed; hostile names never reach a log line", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    e.rt.store.addTask(team.id, { title: SECRET, description: SECRET, createdBy: "lead" });
    await e.post(`/teams/${team.id}/shutdown`);
    await e.post(`/teams/${team.id}/shutdown`);
    e.clock.advance(10_000);
    await e.settle();
    await e.settle();
    await e.post(`/teams/${team.id}/shutdown`);
    expect(lines(e, "user_shutdown")).toEqual([
      `agent-teams: user_shutdown team=${team.id} outcome=ok`,
      `agent-teams: user_shutdown team=${team.id} outcome=repeat`,
      `agent-teams: user_shutdown team=${team.id} outcome=team_closed`,
    ]);
    await e.post("/teams/t_unknown%0Aforged/shutdown");
    await e.post(`/teams/${team.id}/members/%0Aevil/stop`);
    expect(all(e)).not.toContain("forged");
    expect(all(e)).not.toContain("evil");
    expect(all(e)).not.toContain(SECRET);
  });

  it("an owner-filtered 404 is counted but logs no team id", async () => {
    const e = await createUiEnv({ enforced: true });
    envs.push(e);
    const team = await e.createTeam();
    team.owner = e.ownerKey({ iss: "idp", sub: "alice" });
    await e.post(`/teams/${team.id}/shutdown`, { "x-principal": "idp|bob" });
    expect(all(e)).not.toContain(team.id);
    e.clock.advance(60_000);
    expect(e.fake.logs.info.filter((l) => l.includes("counter=owner_filtered_404"))).toEqual(["agent-teams: counter counter=owner_filtered_404 n=1 window_s=60"]);
  });
});

describe("counters (S71)", () => {
  it("are structured `counter=` lines aggregated every 60 s and re-armed only while counting", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    await e.post(`/teams/${team.id}/members/alice/stop`);
    await e.post(`/teams/${team.id}/members/alice/stop`);
    await e.get(`/teams/${team.id}`);
    await e.get(`/teams/${team.id}`, { "if-none-match": `"E:${e.rt.store.rev(team.id)}"` });
    const counters = () => e.fake.logs.info.filter((l) => l.startsWith("agent-teams: counter "));
    expect(counters()).toEqual([]);
    e.clock.advance(59_999);
    expect(counters()).toEqual([]);
    e.clock.advance(1);
    expect(counters().sort()).toEqual(
      [
        "agent-teams: counter counter=snapshot_304 n=1 window_s=60",
        "agent-teams: counter counter=snapshot_requests n=2 window_s=60",
        "agent-teams: counter counter=stop_ok n=1 window_s=60",
        "agent-teams: counter counter=stop_repeat n=1 window_s=60",
      ].sort(),
    );
    const n = counters().length;
    e.clock.advance(120_000);
    expect(counters()).toHaveLength(n); // nothing counted since: nothing logged, no timer left
  });
});
