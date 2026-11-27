/**
 * `POST /api/plugins/agent-teams/openspec-relaunch` (tasks 3.13, 3.16, 8.23–8.25; test-plan #X15 #R5 #S9):
 * clears a `launch_failed` / lost-`launched` record and re-evaluates the launcher; every other state is
 * `not_relaunchable`; owner rule + tier `operate`; idempotent under concurrency; registered in the shared
 * route-tier table (the network guard covers the whole `/api` namespace, the tier row is the per-route gate).
 * See change: add-agent-teams-openspec.
 */
import { hasRouteTier, routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { describe, expect, it } from "vitest";
import type { Team } from "../../../shared/types.js";
import { launcherOf } from "../launcher.js";
import { createGroupEnv, type GroupEnv } from "./launcher-env.js";

const ROUTE = "/openspec-relaunch";
const OWNER = { iss: "https://idp", sub: "owner" };
const OWNER_H = { "x-principal": `${OWNER.iss}|${OWNER.sub}` };
const OTHER_H = { "x-principal": "https://idp|other" };
const LOCAL_H = { "x-principal": "local" };
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const team = (e: GroupEnv): Team => e.rt.store.get(e.gteam.id) as Team;
const post = (e: GroupEnv, body: unknown, headers: Record<string, string> = OWNER_H) => e.rest("POST", ROUTE, body, headers);
const snapshot = (e: GroupEnv): string => JSON.stringify([e.api.sidecar.get(e.gteam.id), team(e).tasks, team(e).members]);

type State = "launch_failed" | "gone" | "launching" | "live" | "none" | "completed";

/** A group team whose change `a` is in the given state (`b` is a second change, no record unless noted). */
async function stateEnv(state: State, extra: Partial<Parameters<typeof createGroupEnv>[0]> = {}): Promise<GroupEnv> {
  const e = await createGroupEnv({ changes: ["a", "b"], pluginConfig: { openspecGroupParallel: state === "none" ? 1 : 2 }, owner: OWNER, enforced: true, ...extra });
  if (state === "none") {
    // `a` holds the only slot, so `b` has no record
    await e.run();
    return e;
  }
  if (state === "launch_failed") e.fx.ensureWorktree.mockImplementation(async (_a, i) => (i.change === "a" ? { ok: false, code: "git_failed" } : { ok: true, path: e.worktreeOf(i.change), branch: "b" }));
  if (state === "launching") e.fx.ensureWorktree.mockImplementation((_a, i) => (i.change === "a" ? new Promise(() => undefined) : Promise.resolve({ ok: true, path: e.worktreeOf(i.change), branch: "b" })));
  void e.run();
  await settle();
  if (state === "gone") e.rt.ops.releaseMember(team(e), "os-a", "gone", "died");
  if (state === "completed") e.complete("a");
  await settle();
  return e;
}

describe("relaunch route — states (8.23, #X15)", () => {
  it.each<[State, boolean]>([
    ["launch_failed", true],
    ["gone", true],
    ["launching", false],
    ["live", false],
    ["none", false],
    ["completed", false],
  ])("record state %s ⇒ clearable=%s", async (state, clearable) => {
    const e = await stateEnv(state);
    // `none` relaunches change b (no record); the others relaunch change a
    const change = state === "none" ? "b" : "a";
    const before = snapshot(e);
    const launches = e.fx.ensureWorktree.mock.calls.length;
    const res = await post(e, { teamId: e.gteam.id, change });
    if (clearable) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, change: "a" });
      await settle();
      // the launcher was re-evaluated: a second worktree call for the same change
      expect(e.fx.ensureWorktree.mock.calls.length).toBeGreaterThan(launches);
    } else {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ ok: false, error: "not_relaunchable" });
      expect(snapshot(e)).toBe(before); // nothing else mutated
    }
  });

  it("a cleared record that fails again is a NEW launch_failed record (one notice per record)", async () => {
    const e = await stateEnv("launch_failed");
    const notes = () => e.notices().filter((n) => n.text.includes("git_failed")).length;
    expect(notes()).toBe(1);
    expect((await post(e, { teamId: e.gteam.id, change: "a" })).status).toBe(200);
    await settle();
    expect(e.launched("a")).toMatchObject({ state: "launch_failed", code: "git_failed" });
    expect(notes()).toBe(2);
  });

  it("a relaunch that now succeeds launches exactly one member and one record", async () => {
    const e = await stateEnv("launch_failed");
    e.fx.ensureWorktree.mockImplementation(async (_a, i) => ({ ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` }));
    expect((await post(e, { teamId: e.gteam.id, change: "a" })).status).toBe(200);
    await settle();
    expect(e.launched("a")).toMatchObject({ state: "launched", member: "os-a" });
    expect(e.fx.spawnCalls.filter((c) => c.name === "os-a")).toHaveLength(1);
    expect(Object.keys(e.api.sidecar.get(e.gteam.id)?.launched ?? {}).filter((k) => k === e.taskOf("a"))).toHaveLength(1);
  });

  it("apply, plain and unknown teams: not_relaunchable / not_found", async () => {
    const e = await stateEnv("launch_failed");
    const apply = e.team("apply", "x", { seeded: true });
    const plain = await e.createTeam("plain");
    for (const t of [apply, plain]) {
      const res = await post(e, { teamId: t.id, change: "a" }, LOCAL_H);
      expect(res.status, t.id).toBe(409);
      expect(res.body).toMatchObject({ error: "not_relaunchable" });
    }
    const unknown = await post(e, { teamId: "t_nope", change: "a" });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "not_found" });
  });

  it.each([
    ["path traversal", "../x"],
    ["empty", ""],
    ["upper case", "Bad"],
    ["slash", "a/b"],
    ["the archive dir", "archive"],
    ["not a string", 7],
  ])("bad change (%s) ⇒ 400 invalid_args, nothing mutated", async (_n, change) => {
    const e = await stateEnv("launch_failed");
    const before = snapshot(e);
    const res = await post(e, { teamId: e.gteam.id, change });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: "invalid_args" });
    expect(snapshot(e)).toBe(before);
  });

  it("a well-formed change the team does not know is not_relaunchable (no leak, no mutation)", async () => {
    const e = await stateEnv("launch_failed");
    const before = snapshot(e);
    const res = await post(e, { teamId: e.gteam.id, change: "nope" });
    expect(res.status).toBe(409);
    expect(snapshot(e)).toBe(before);
  });

  it("missing / malformed body ⇒ 400", async () => {
    const e = await stateEnv("launch_failed");
    for (const body of [undefined, {}, { teamId: e.gteam.id }, { change: "a" }, { teamId: "../../x", change: "a" }, []]) {
      expect((await post(e, body)).status).toBe(400);
    }
  });
});

describe("relaunch route — idempotent (8.24, #R5)", () => {
  it("two simultaneous POSTs for the same launch_failed change: exactly one launch, the loser gets not_relaunchable", async () => {
    const e = await stateEnv("launch_failed");
    e.fx.ensureWorktree.mockImplementation(async (_a, i) => ({ ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` }));
    const [x, y] = await Promise.all([post(e, { teamId: e.gteam.id, change: "a" }), post(e, { teamId: e.gteam.id, change: "a" })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    await settle();
    expect(e.fx.spawnCalls.filter((c) => c.name === "os-a")).toHaveLength(1);
    expect(e.fx.ensureWorktree.mock.calls.filter((c) => c[1].change === "a")).toHaveLength(2); // the failed one + one relaunch
    expect(e.launched("a")?.state).toBe("launched");
  });

  it("a POST racing a launcher tick still yields one launch", async () => {
    const e = await stateEnv("launch_failed");
    e.fx.ensureWorktree.mockImplementation(async (_a, i) => ({ ok: true, path: e.worktreeOf(i.change), branch: `os/${i.change}` }));
    const res = post(e, { teamId: e.gteam.id, change: "a" });
    void launcherOf(e.api)?.evaluate(team(e)); // tick in the same turn
    e.rt.store.patchTeam(e.gteam.id, { description: "tick" });
    expect((await res).status).toBe(200);
    await settle();
    expect(e.fx.spawnCalls.filter((c) => c.name === "os-a")).toHaveLength(1);
  });
});

describe("relaunch route — authorisation (8.25, #S9)", () => {
  it("the shared route-tier table has the row at `operate`", () => {
    const route = "/api/plugins/agent-teams/openspec-relaunch";
    expect(hasRouteTier("POST", route)).toBe(true);
    expect(routeTier("POST", route)).toBe("operate");
  });

  it("owner and local operator relaunch; another user, no principal (device without proof) and a loopback call without credential are refused with the one not-found body", async () => {
    const owner = await stateEnv("launch_failed");
    expect((await post(owner, { teamId: owner.gteam.id, change: "a" }, OWNER_H)).status).toBe(200);
    const op = await stateEnv("launch_failed");
    expect((await post(op, { teamId: op.gteam.id, change: "a" }, LOCAL_H)).status).toBe(200);
    for (const [name, headers] of [["other user", OTHER_H], ["no principal", {}]] as const) {
      const e = await stateEnv("launch_failed");
      const before = snapshot(e);
      const res = await post(e, { teamId: e.gteam.id, change: "a" }, headers);
      expect(res.status, name).toBe(404);
      expect(res.body, name).toEqual({ error: "not_found" });
      expect(snapshot(e), name).toBe(before); // nothing mutated, nothing launched
    }
  });

  it("cross-team: the owner of team A cannot relaunch a change of team B", async () => {
    const a = await stateEnv("launch_failed");
    // team B: a second group team in the same runtime, owned by another principal
    const second = a.rt.ops.createTeam({
      name: "other group",
      leadCwd: a.cwd,
      leadSessionId: a.fake.addSession("S-lead-2", { cwd: a.cwd }),
      owner: a.ownerKey({ iss: "https://idp", sub: "someone-else" }),
      overrides: { autoDispatch: false },
      template: { name: "openspec-group", source: "bundled", hash: "h", goal: "g2", playbook: "p", members: [], spawn: "lead", seeded: true },
    });
    expect(second.ok).toBe(true);
    const before = snapshot(a);
    const res = await post(a, { teamId: (second.ok && second.data.id) as string, change: "a" }, OWNER_H);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(snapshot(a)).toBe(before);
  });

  it("the host tier gate refuses a credential below `operate` before the handler runs", async () => {
    for (const tier of ["observe", "control"] as Tier[]) {
      const e = await stateEnv("launch_failed", {
        onRequest: async (req, reply) => {
          const route = req.routeOptions?.url ?? "";
          if (route.startsWith("/api/") && rank(routeTier(req.method, route)) > rank(tier)) await reply.code(403).send({ error: "insufficient_scope" });
        },
      });
      const before = snapshot(e);
      const res = await post(e, { teamId: e.gteam.id, change: "a" });
      expect(res.status, tier).toBe(403);
      expect(snapshot(e), tier).toBe(before);
    }
    const ok = await stateEnv("launch_failed", {
      onRequest: async (req, reply) => {
        const route = req.routeOptions?.url ?? "";
        if (route.startsWith("/api/") && rank(routeTier(req.method, route)) > rank("operate")) await reply.code(403).send({});
      },
    });
    expect((await post(ok, { teamId: ok.gteam.id, change: "a" })).status).toBe(200);
  });
});
