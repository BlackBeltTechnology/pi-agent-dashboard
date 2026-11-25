/**
 * Route tiers (test-plan S27): both POST rows exist in `ROUTE_TIERS` at `control`
 * and match the patterns the router really reports for the concrete URLs; a
 * credential below the tier is refused (403) by the gate, which decides on the
 * matched route PATTERN with these same two primitives (`routeTier`, `rank`).
 * See change: add-agent-teams-ui.
 */
import { hasRouteTier, ROUTE_TIERS, routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";

const STOP = "/api/plugins/agent-teams/teams/:id/members/:name/stop";
const SHUTDOWN = "/api/plugins/agent-teams/teams/:id/shutdown";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});

describe("ROUTE_TIERS rows (S27)", () => {
  it("both POST routes are tier control; the GETs stay observe", () => {
    for (const p of [STOP, SHUTDOWN]) {
      expect(hasRouteTier("POST", p), p).toBe(true);
      expect(routeTier("POST", p), p).toBe("control");
    }
    for (const p of ["/api/plugins/agent-teams/teams", "/api/plugins/agent-teams/teams/:id"]) expect(routeTier("GET", p)).toBe("observe");
  });

  it("every agent-teams row is a route the plugin really registers (no stale rows, param name :name)", async () => {
    const seen: string[] = [];
    const e = await createUiEnv({ onRequest: async (req) => void seen.push(`${req.method} ${req.routeOptions?.url}`) });
    envs.push(e);
    const team = await e.createTeam();
    e.addMember(team, "alice", "idle");
    await e.get("/teams");
    await e.get(`/teams/${team.id}`);
    await e.post(`/teams/${team.id}/members/alice/stop`);
    await e.post(`/teams/${team.id}/shutdown`);
    const rows = ROUTE_TIERS.filter((r) => r.path.startsWith("/api/plugins/agent-teams/")).map((r) => `${r.method} ${r.path}`);
    expect(rows.sort()).toEqual([...new Set(seen)].sort());
  });
});

describe("tier gate", () => {
  it.each<[Tier, number, number]>([
    ["observe", 403, 200],
    ["control", 200, 200],
    ["operate", 200, 200],
  ])("credential tier %s: stop/shutdown → %i, GET → %i", async (tier, postStatus, getStatus) => {
    const e = await createUiEnv({
      onRequest: async (req, reply) => {
        const route = req.routeOptions?.url ?? "";
        if (!route.startsWith("/api/")) return;
        if (rank(routeTier(req.method, route)) > rank(tier)) await reply.code(403).send({ error: "insufficient_scope" });
      },
    });
    envs.push(e);
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    expect((await e.post(`/teams/${team.id}/members/alice/stop`)).status).toBe(postStatus);
    expect((await e.get("/teams")).status).toBe(getStatus);
    expect((await e.get(`/teams/${team.id}`)).status).toBe(getStatus);
    expect((await e.post(`/teams/${team.id}/shutdown`)).status).toBe(postStatus === 403 ? 403 : 202);
    if (postStatus === 403) expect(e.fake.base.aborts).toEqual([]);
  });
});
