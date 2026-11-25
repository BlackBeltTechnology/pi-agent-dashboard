/**
 * Owner filtering and the 404 contract (test-plan S28, S29, S55, S65–S67, S119):
 * the owner rule as a decision table over the real routes, exact (iss, sub)
 * equality, fail-closed ownerless teams after a restart, hostile path params,
 * no existence oracle, forged control, and a failing visibility hook.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv, type UiEnvOptions } from "../../__tests__/harness/ui-env.js";
import type { TeamListResponse, TeamSnapshot } from "../../shared/snapshot.js";
import type { Team } from "../../shared/types.js";
import { createAccess, LOCAL_OPERATOR_ISSUER, ownerKeyOf } from "../access.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});
async function mk(over: UiEnvOptions = {}): Promise<UiEnv> {
  const e = await createUiEnv(over);
  envs.push(e);
  return e;
}

const ALICE = { iss: "idp", sub: "alice" };
const req = (principal: string | undefined) => ({ headers: principal === undefined ? {} : { "x-principal": principal } });

describe("owner filtering decision table (S28)", () => {
  const callers = [
    ["local operator", "local"],
    ["owner principal", "idp|alice"],
    ["other principal", "idp|bob"],
    ["no principal", undefined],
  ] as const;
  const rows = [false, true].flatMap((enforced) => callers.flatMap(([label, header]) => [true, false].map((ownerSet) => ({ enforced, label, header, ownerSet }))));

  it("has 16 rows", () => expect(rows).toHaveLength(16));

  it.each(rows)("enforced=$enforced caller=$label owner set=$ownerSet", async ({ enforced, label, header, ownerSet }) => {
    const e = await mk({ enforced });
    const team = await e.createTeam();
    if (ownerSet) team.owner = ownerKeyOf(ALICE);
    else delete team.owner;
    e.addMember(team, "alice", "busy");
    const h: Record<string, string> = header === undefined ? {} : { "x-principal": header };
    // "owner principal" of an ownerless team cannot exist: asserted as an "other" principal (impossible combination).
    const visible = !enforced || label === "local operator" || (ownerSet && label === "owner principal");

    const list = await e.get<TeamListResponse>("/teams", h);
    expect(list.status).toBe(200);
    expect(list.body.teams.map((t) => t.id)).toEqual(visible ? [team.id] : []);

    const snap = await e.get<TeamSnapshot & { viewerCanControl: boolean }>(`/teams/${team.id}`, h);
    expect(snap.status).toBe(visible ? 200 : 404);
    if (visible) expect(snap.body.viewerCanControl).toBe(true);

    const stop = await e.post(`/teams/${team.id}/members/alice/stop`, h);
    expect(stop.status === 404, "stop refused as not found").toBe(!visible);
    const shutdown = await e.post(`/teams/${team.id}/shutdown`, h);
    expect(shutdown.status === 404, "shutdown refused as not found").toBe(!visible);
    if (!visible) expect(e.fake.base.aborts).toEqual([]);
  });
});

describe("owner equality is exact (S29)", () => {
  const nfc = "\u00e9";
  const nfd = "e\u0301";
  it.each([
    ["same iss and sub", ALICE, true],
    ["same iss, other sub", { iss: "idp", sub: "bob" }, false],
    ["other iss, same sub", { iss: "other", sub: "alice" }, false],
    ["case-changed sub", { iss: "idp", sub: "Alice" }, false],
    ["trailing space", { iss: "idp", sub: "alice " }, false],
    ["leading space", { iss: " idp", sub: "alice" }, false],
    ["delimiter smuggling", { iss: 'idp","alice', sub: "" }, false],
  ] as const)("%s", (_label, principal, allowed) => {
    const access = createAccess({ isEnforced: () => true, principalOf: () => principal });
    const team = { owner: ownerKeyOf(ALICE) } as Team;
    expect(access.canViewTeam(team, req("x"))).toBe(allowed);
    expect(access.canControlTeam(team, req("x"))).toBe(allowed);
  });

  it("a Unicode-normalised variant of the sub is another principal", () => {
    const owner = { iss: "idp", sub: nfc };
    const access = createAccess({ isEnforced: () => true, principalOf: () => ({ iss: "idp", sub: nfd }) });
    expect(access.canViewTeam({ owner: ownerKeyOf(owner) } as Team, req("x"))).toBe(false);
  });

  it("the reserved local-operator issuer is allowed only through its issuer", () => {
    const access = createAccess({ isEnforced: () => true, principalOf: () => ({ iss: LOCAL_OPERATOR_ISSUER, sub: "anything" }) });
    expect(access.canViewTeam({} as Team, req("x"))).toBe(true);
  });

  it("identity absent or not enforced: everything is visible and controllable", () => {
    for (const a of [createAccess(undefined), createAccess({ isEnforced: () => false, principalOf: () => null })]) {
      expect(a.canViewTeam({} as Team, req(undefined))).toBe(true);
      expect(a.canControlTeam({} as Team, req(undefined))).toBe(true);
    }
  });
});

describe("fail-closed ownerless team across identity switch and restart (S55)", () => {
  it("a team persisted without an owner is operator-only once identity is enforced; non-operators never see control", async () => {
    const first = await mk();
    const team = await first.createTeam();
    delete team.owner;
    first.rt.store.patchTeam(team.id, { description: "persist me" }); // commit so the owner-less record is written
    first.fake.runShutdownHooks();
    await first.close();
    envs.pop();

    const e = await mk({ dataDir: first.fake.dataDir });
    expect(e.rt.store.get(team.id)?.owner).toBeUndefined();
    // Not enforced yet: everybody sees it (today's behaviour).
    expect((await e.get<TeamListResponse>("/teams")).body.teams.map((t) => t.id)).toEqual([team.id]);
    e.identity.enforced = true; // identity switched on
    const other = await e.get<TeamListResponse>("/teams", { "x-principal": "idp|bob" });
    expect(other.body.teams).toEqual([]);
    expect((await e.get(`/teams/${team.id}`, { "x-principal": "idp|bob" })).status).toBe(404);
    const op = await e.get<TeamSnapshot & { viewerCanControl: boolean }>(`/teams/${team.id}`, { "x-principal": "local" });
    expect(op.status).toBe(200);
    // Same predicate for view and control: only the operator can ever see (and control) it.
    expect(op.body.viewerCanControl).toBe(true);
    expect(e.access.canControlTeam(e.rt.store.get(team.id) as Team, req("idp|bob"))).toBe(false);
  });
});

describe("hostile path params (S65)", () => {
  const NOT_FOUND = { error: "not_found" };
  it.each([
    ["encoded slash", "bob%2Fx"],
    ["NUL", "%00"],
    ["100-char name", "n".repeat(100)],
    ["empty segment", ""],
    ["Unicode", "%C3%A9%F0%9F%98%80"],
    ["uppercase / grammar violation", "Bob"],
  ])("stop with member name: %s → 404, nothing aborted", async (_label, name) => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "bob", "busy");
    const res = await e.post(`/teams/${team.id}/members/${name}/stop`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(e.fake.base.aborts).toEqual([]);
  });

  it("a param over the router's maxParamLength (100) is refused by the router itself — no 5xx, nothing aborted", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "bob", "busy");
    for (const url of [`/teams/${team.id}/members/${"n".repeat(300)}/stop`, `/teams/${"t".repeat(300)}/shutdown`]) {
      const res = await e.post(url);
      expect([404, 414]).toContain(res.status);
    }
    expect(e.fake.base.aborts).toEqual([]);
    expect(e.fake.base.shutdowns).toEqual([]);
  });

  it("a `..` segment is normalised away by the router before any handler: 404, never another route, nothing aborted", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "bob", "busy");
    const res = await e.post(`/teams/${team.id}/members/../stop`);
    expect(res.status).toBe(404);
    expect(e.fake.base.aborts).toEqual([]);
    expect(e.rt.store.get(team.id)?.status).toBe("active");
  });

  it.each([["NUL", "%00"], ["100 chars", "t".repeat(100)], ["empty", ""], ["encoded traversal", "..%2F..%2Fetc"], ["Unicode", "%C3%A9"]])("garbage team id (%s) answers the unknown-team 404 on both routes", async (_label, id) => {
    const e = await mk();
    const stop = await e.post(`/teams/${id}/members/bob/stop`);
    const shutdown = await e.post(`/teams/${id}/shutdown`);
    for (const r of [stop, shutdown]) {
      expect(r.status).toBe(404);
    }
    expect(stop.body).toEqual(NOT_FOUND);
    expect(shutdown.body).toEqual(NOT_FOUND);
    expect(e.fake.base.aborts).toEqual([]);
    expect(e.fake.base.shutdowns).toEqual([]);
  });
});

/** Everything but the date and per-client limiter counters, which are not about the team. */
function comparable(r: { status: number; raw: string; headers: Record<string, unknown> }) {
  const headers = Object.fromEntries(Object.entries(r.headers).filter(([k]) => k !== "date" && !k.startsWith("x-ratelimit") && k !== "retry-after"));
  return { status: r.status, raw: r.raw, headers };
}

describe("no existence oracle (S66)", () => {
  it("an invisible team answers byte-identically to an unknown id; a lookup of A's lead session by B is a no-team lookup", async () => {
    const e = await mk({ enforced: true });
    const team = await e.createTeam();
    team.owner = ownerKeyOf(ALICE);
    e.addMember(team, "bob", "busy");
    const B = { "x-principal": "idp|bob" };
    const pairs: Array<[string, "get" | "post", string, string]> = [
      ["snapshot", "get", `/teams/${team.id}`, "/teams/t_unknown"],
      ["stop", "post", `/teams/${team.id}/members/bob/stop`, "/teams/t_unknown/members/bob/stop"],
      ["shutdown", "post", `/teams/${team.id}/shutdown`, "/teams/t_unknown/shutdown"],
    ];
    for (const [label, verb, hidden, unknown] of pairs) {
      const a = comparable(await e[verb](hidden, B));
      const b = comparable(await e[verb](unknown, B));
      expect(a, label).toEqual(b);
      expect(a.status).toBe(404);
    }
    const bySession = comparable(await e.get(`/teams?sessionId=${encodeURIComponent(e.lead)}`, B));
    const noTeam = comparable(await e.get("/teams?sessionId=S-nobody", B));
    expect(bySession).toEqual(noTeam);
    expect(JSON.parse(bySession.raw).teams).toEqual([]);
    expect(e.fake.base.aborts).toEqual([]);
  });
});

describe("forged control (S67)", () => {
  it("the server re-checks control on every call: 404 like an invisible team, no abort, no teamDelete, no lead notice", async () => {
    const e = await mk();
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    // Visible to the caller, but the caller may not control it.
    e.access.canControlTeam = () => false;
    let teamDeletes = 0;
    const real = e.rt.ops.teamDelete;
    e.rt.ops.teamDelete = ((...a: Parameters<typeof real>) => {
      teamDeletes++;
      return real(...a);
    }) as typeof real;
    const snap = await e.get<TeamSnapshot & { viewerCanControl: boolean }>(`/teams/${team.id}`);
    expect(snap.status).toBe(200);
    expect(snap.body.viewerCanControl).toBe(false);
    const unknown = comparable(await e.post("/teams/t_unknown/members/alice/stop"));
    const stop = comparable(await e.post(`/teams/${team.id}/members/alice/stop`));
    expect(stop).toEqual(unknown);
    const unknownShutdown = comparable(await e.post("/teams/t_unknown/shutdown"));
    expect(comparable(await e.post(`/teams/${team.id}/shutdown`))).toEqual(unknownShutdown);
    expect(e.fake.base.aborts).toEqual([]);
    expect(teamDeletes).toBe(0);
    e.flushNotices();
    expect(e.mailsTo(team, "lead")).toEqual([]);
    expect(e.rt.store.get(team.id)?.status).toBe("active");
  });
});

describe("route visibility hook failure (S119)", () => {
  it.each([
    ["throws", { hook: (() => { throw new Error("hook boom SECRET-7f3a"); }) as never }, {}],
    ["never settles", { hook: (() => new Promise<boolean>(() => {})) as never }, { visibilityTimeoutMs: 30 }],
  ])("a hook that %s fails closed for list, id and stop; the error is logged once per request with the team id", async (_label, hookOpt, extra) => {
    const e = await mk({ ...hookOpt, ...extra });
    const team = await e.createTeam();
    e.addMember(team, "alice", "busy");
    const failures = () => e.fake.logs.error.filter((l) => l.includes("failed closed") && l.includes(team.id));
    expect((await e.get<TeamListResponse>("/teams")).body.teams).toEqual([]);
    expect(failures()).toHaveLength(1);
    const unknown = await e.get("/teams/t_unknown");
    const byId = await e.get(`/teams/${team.id}`);
    expect(byId.status).toBe(404);
    expect(byId.body).toEqual(unknown.body);
    expect(failures()).toHaveLength(2);
    const stop = await e.post(`/teams/${team.id}/members/alice/stop`);
    expect(stop.status).toBe(404);
    expect(stop.body).toEqual(unknown.body);
    expect(failures()).toHaveLength(3);
    expect(e.fake.base.aborts).toEqual([]);
    // Ids only: no agent text in any plugin log line ("hook boom" is core's own error string, never team content).
    expect(e.fake.logs.info.join("\n")).not.toContain("SECRET");
  });
});
