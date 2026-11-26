/**
 * Read-only REST surface (test-plan S100 exposure, S101 visibility, S137 mail
 * total, S100 tier/denylist, S83/S81 REST halves, S97 counters) over a real
 * Fastify instance (`inject`) and the full runtime on the fake host.
 * See change: add-agent-teams-core.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasRouteTier, routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import { SNAPSHOT_MAIL_LIMIT, SNAPSHOT_MAIL_TEXT_MAX } from "../../shared/constants.js";
import type { TeamListResponse, TeamSnapshot } from "../../shared/snapshot.js";
import type { Team } from "../../shared/types.js";
import { createExtensionPoints, type RouteVisibility } from "../extension-points.js";
import { API_PREFIX, mountTeamsRoutes, type RouteDeps } from "../routes.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** `hook` is registered before the first request (the registry seals at the first lane call). */
async function setup(over: Partial<RouteDeps> = {}, hook?: RouteVisibility) {
  const ext = createExtensionPoints();
  if (hook) ext.setRouteVisibility(hook);
  const e = createTeamsEnv({ ext });
  const app = Fastify();
  apps.push(app);
  await mountTeamsRoutes(app, { store: e.rt.store, telemetry: e.rt.telemetry, ext: e.rt.ext, logger: e.fake.host.logger, ...over });
  await app.ready();
  const team = await e.createTeam();
  const get = async <T>(url: string, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}${url}`, headers });
    return { status: res.statusCode, body: res.json() as T };
  };
  return { e, app, team, get };
}

/** A second team with no lead yet (one lead session cannot lead two teams). */
function startingTeam(e: TeamsEnv): Team {
  return e.rt.store.createTeam({ name: "beta", leadCwd: "/work", mode: "session", maxTeammates: 4, starting: true });
}

function addMail(e: TeamsEnv, team: Team, n: number, text = "hello"): void {
  for (let i = 0; i < n; i++) e.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text, wake: false });
}

describe("snapshot shape (S1 view)", () => {
  it("lists summaries and returns members, tasks with derived blocked, bounded mail — and no internals", async () => {
    const { e, team, get } = await setup();
    e.addMember(team, "alice", "idle");
    e.rt.store.addTask(team.id, { title: "first", description: "d", createdBy: "lead" });
    e.rt.store.addTask(team.id, { title: "second", description: "d", blockedBy: ["1"], createdBy: "lead" });
    const list = await get<TeamListResponse>("/teams");
    expect(list.status).toBe(200);
    expect(list.body.teams).toEqual([expect.objectContaining({ id: team.id, name: "alpha", status: "active", members: 1, tasks: 2 })]);
    expect(list.body.persist_degraded).toBe(false);
    expect(list.body.unavailable).toEqual([]);
    const snap = await get<TeamSnapshot>(`/teams/${team.id}`);
    expect(snap.status).toBe(200);
    expect(snap.body.members.map((m) => [m.name, m.status])).toEqual([["alice", "idle"]]);
    expect(snap.body.tasks.map((t) => [t.id, t.blocked])).toEqual([
      ["1", false],
      ["2", true],
    ]);
    const raw = JSON.stringify(snap.body);
    expect(raw).not.toContain("spawnToken");
    expect(raw).not.toContain("tok-");
    expect(raw).not.toContain("owner-1"); // principal owner stays server-side
    expect(raw).not.toContain("sessionFile");
  });
});

describe("snapshot mail total (S137)", () => {
  it.each([99, 100, 101, 250])("%i mail entries → at most 100 latest, mailTotal is the real count", async (n) => {
    const { e, team, get } = await setup();
    addMail(e, team, n);
    const total = e.rt.store.mailLog(team.id).length;
    const { body } = await get<TeamSnapshot>(`/teams/${team.id}`);
    expect(body.mailTotal).toBe(total);
    expect(total).toBeGreaterThanOrEqual(n);
    expect(body.mail).toHaveLength(Math.min(SNAPSHOT_MAIL_LIMIT, total));
    const ids = e.rt.store.mailLog(team.id).map((m) => m.id);
    expect(body.mail.map((m) => m.id)).toEqual(ids.slice(-SNAPSHOT_MAIL_LIMIT)); // the LATEST entries, in order
  });

  it.each([
    [1999, false],
    [2000, false],
    [2001, true],
    [5000, true],
  ])("a %i-char mail text is capped at 2000 (truncated=%s)", async (len, truncated) => {
    const { e, team, get } = await setup();
    addMail(e, team, 1, "x".repeat(len));
    const { body } = await get<TeamSnapshot>(`/teams/${team.id}`);
    const entry = body.mail.at(-1);
    expect(entry?.text.length).toBe(Math.min(len, SNAPSHOT_MAIL_TEXT_MAX));
    expect(entry?.truncated).toBe(truncated);
  });

  it("never splits a surrogate pair at the cap", async () => {
    const { e, team, get } = await setup();
    addMail(e, team, 1, `${"a".repeat(SNAPSHOT_MAIL_TEXT_MAX - 1)}😀tail`);
    const { body } = await get<TeamSnapshot>(`/teams/${team.id}`);
    const text = body.mail.at(-1)?.text ?? "";
    expect(text.endsWith("😀")).toBe(true);
    expect(body.mail.at(-1)?.truncated).toBe(true);
  });
});

describe("route exposure (S100)", () => {
  it("mutating verbs and unknown ids are not found; no handler exists besides the two GETs", async () => {
    const { app, team, get } = await setup();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
      for (const url of [`${API_PREFIX}/teams`, `${API_PREFIX}/teams/${team.id}`, `${API_PREFIX}/teams/${team.id}/tasks`]) {
        const res = await app.inject({ method, url, payload: {} });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    expect((await get("/teams/t_does_not_exist")).status).toBe(404);
  });

  it("both GETs are tiered observe", () => {
    for (const p of [`${API_PREFIX}/teams`, `${API_PREFIX}/teams/:id`]) {
      expect(hasRouteTier("GET", p), p).toBe(true);
      expect(routeTier("GET", p), p).toBe("observe");
    }
  });

  it("the whole prefix is on the MCP denylist and absent from the generated tool surface", () => {
    const mcp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../mcp-server-plugin/src/server");
    const denylist = fs.readFileSync(path.join(mcp, "tools.denylist.ts"), "utf8");
    expect(denylist).toContain(`pattern: "${API_PREFIX}/"`);
    for (const f of ["tools.manifest.ts", "tools.ts"]) {
      const file = path.join(mcp, f);
      if (fs.existsSync(file)) expect(fs.readFileSync(file, "utf8"), f).not.toContain(API_PREFIX);
    }
  });
});

describe("route visibility (S101)", () => {
  it("false per team: omitted from the list and 404 by id (never 403)", async () => {
    const { team, get } = await setup({}, (t) => t.name !== "alpha");
    expect((await get<TeamListResponse>("/teams")).body.teams).toEqual([]);
    const byId = await get<{ error: string }>(`/teams/${team.id}`);
    expect(byId.status).toBe(404);
    expect(byId.body).toEqual({ error: "not_found" });
  });

  it("decision table: the hook sees the team and the request; true shows, false hides — per team and per caller", async () => {
    const who = (req: unknown) => (req as { headers: Record<string, string> }).headers["x-who"];
    const { e, team, get } = await setup({}, (t, req) => who(req) === "alice" || t.name === "alpha");
    const other = startingTeam(e);
    const anon = await get<TeamListResponse>("/teams", { "x-who": "anon" });
    expect(anon.body.teams.map((t) => t.id)).toEqual([team.id]);
    const alice = await get<TeamListResponse>("/teams", { "x-who": "alice" });
    expect(alice.body.teams.map((t) => t.id).sort()).toEqual([other.id, team.id].sort());
    expect((await get(`/teams/${other.id}`, { "x-who": "anon" })).status).toBe(404);
    expect((await get(`/teams/${other.id}`, { "x-who": "alice" })).status).toBe(200);
  });

  it("a hook that throws fails closed: omitted, 404 by id, error logged; other teams are unaffected", async () => {
    const { e, team, get } = await setup({}, (t) => {
      if (t.name === "alpha") throw new Error("hook boom");
      return true;
    });
    const other = startingTeam(e);
    expect((await get<TeamListResponse>("/teams")).body.teams.map((t) => t.id)).toEqual([other.id]);
    expect((await get(`/teams/${team.id}`)).status).toBe(404);
    expect(e.fake.logs.error.some((l) => l.includes("hook boom") && l.includes(team.id))).toBe(true);
  });

  it("a hook that never answers times out and fails closed", async () => {
    const { team, get } = await setup({ visibilityTimeoutMs: 30 }, () => new Promise<boolean>(() => {}));
    const started = Date.now();
    expect((await get<TeamListResponse>("/teams")).body.teams).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await get(`/teams/${team.id}`)).status).toBe(404);
  });

  it("a hook that rejects fails closed", async () => {
    const { team, get } = await setup({}, () => Promise.reject(new Error("nope")));
    expect((await get(`/teams/${team.id}`)).status).toBe(404);
  });

  it("a hook that answers a non-boolean fails closed", async () => {
    const { team, get } = await setup({}, (() => "yes") as never);
    expect((await get(`/teams/${team.id}`)).status).toBe(404);
  });

  it("no hook registered: everything is visible", async () => {
    const { team, get } = await setup();
    expect((await get(`/teams/${team.id}`)).status).toBe(200);
  });
});

describe("rate limit and client key (S127)", () => {
  it("limits are per client key: the principal when the host resolved one, else the address", async () => {
    const principals: Record<string, { iss: string; sub: string }> = {
      "x-p": { iss: "idp", sub: "u1" },
      "x-q": { iss: "idp", sub: "u2" },
    };
    const { get, app } = await setup({
      principalOf: (req) => {
        const h = (req as { headers: Record<string, string> }).headers;
        return principals[Object.keys(principals).find((k) => h[k] !== undefined) ?? ""] ?? null;
      },
    });
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await app.inject({ method: "GET", url: `${API_PREFIX}/teams`, headers: { "x-p": "1" } })).statusCode);
    expect(codes).toContain(429);
    // A different principal on the SAME address is not throttled by the first one's burst.
    expect((await get("/teams", { "x-q": "1" })).status).toBe(200);
  });
});
