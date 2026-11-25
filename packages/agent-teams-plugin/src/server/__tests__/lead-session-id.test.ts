/**
 * `leadSessionId` in the summary and the snapshot (additive): the feeder needs the
 * lead's session id to subscribe to `agent-teams:changed` frames from a teammate's
 * view. Served only through the visibility filter; absent when the team has none.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";
import type { TeamListResponse } from "../../shared/snapshot.js";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});

describe("leadSessionId on the wire", () => {
  it("snapshot, list and session-lookup summary carry the lead session id", async () => {
    const e = await createUiEnv();
    envs.push(e);
    const team = await e.createTeam();
    const alice = e.addMember(team, "alice", "idle");
    const snap = (await e.get<TeamUiSnapshot>(`/teams/${team.id}`)).body;
    expect(snap.leadSessionId).toBe(e.lead);
    const list = (await e.get<TeamListResponse>("/teams")).body;
    expect(list.teams[0]?.leadSessionId).toBe(e.lead);
    const byMember = (await e.get<TeamListResponse>(`/teams?sessionId=${encodeURIComponent(alice)}`)).body;
    expect(byMember.teams[0]?.leadSessionId).toBe(e.lead);
  });

  it("is omitted (not null) when the team has no lead session", async () => {
    const e = await createUiEnv();
    envs.push(e);
    const team = await e.createTeam();
    delete team.leadSessionId;
    const snap = (await e.get<TeamUiSnapshot>(`/teams/${team.id}`)).body;
    expect("leadSessionId" in snap).toBe(false);
  });
});
