/**
 * REST routes of the templates-hooks change (tasks 3.1, 3.7, 5.5, 6.8, 8.1, 8.2): template listing, start
 * admission, hook confirmation, plan reads/decisions with the owner 404 parity, and the counters in the
 * snapshot `stats`. Test-plan #X16 #X17 #X18 #S14 (route half) #X19 (start half).
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { Team } from "../../shared/types.js";
import { mountTeamsRoutes } from "../routes.js";
import { createStartEnv, type RestAnswer, type StartEnv } from "./start-env.js";
import { md } from "./template-env.js";

const TPL = "review";
const teams = (e: StartEnv): Team[] => e.rt.store.list();
const userTpl = (e: StartEnv, extra: Record<string, unknown> = {}): void => void e.tpl("user", TPL, md({ name: TPL, spawn: "lead", ...extra }));
const hooked = (e: StartEnv, command = "true"): void => void e.tpl("project", "gated", md({ name: "gated", spawn: "lead", hooks: { TaskCompleted: [{ command }] } }));

describe("GET templates (3.1)", () => {
  it("requires an admitted cwd and lists the folder's templates", async () => {
    const e = await createStartEnv();
    userTpl(e);
    e.tpl("project", "mine", md({ name: "mine", spawn: "lead" }));
    expect(await e.rest("GET", "/templates")).toMatchObject({ status: 400, body: { error: "cwd_required" } });
    expect(await e.rest("GET", `/templates?cwd=${encodeURIComponent(e.root)}`)).toMatchObject({ status: 403 });
    expect(await e.rest("GET", `/templates?cwd=${encodeURIComponent(e.cwd)}&cwd=/x`)).toMatchObject({ status: 400, body: { error: "invalid_cwd" } });
    const ok = await e.rest("GET", `/templates?cwd=${encodeURIComponent(e.cwd)}`);
    expect(ok.status).toBe(200);
    expect((ok.body.templates as Array<{ name: string; source: string }>).map((t) => `${t.name}:${t.source}`).sort()).toEqual(["mine:project", `${TPL}:user`]);
  });

  it("an untrusted project lists its stems as trusted:false and never reads them", async () => {
    const e = await createStartEnv({ trusted: false });
    e.tpl("project", "evil", "not even yaml: [");
    const ok = await e.rest("GET", `/templates?cwd=${encodeURIComponent(e.cwd)}`);
    expect(ok.body.templates).toEqual([expect.objectContaining({ name: "evil", trusted: false, valid: false })]);
  });
});

describe("POST teams/start admission (11.32, #X16)", () => {
  it("cwd_required (400), the standard refusal (403) for an unknown cwd, a known cwd and a symlink to it start; nothing is created on any failure", async () => {
    const e = await createStartEnv();
    userTpl(e);
    const link = path.join(e.root, "link");
    fs.symlinkSync(e.cwd, link);
    const post = (body: Record<string, unknown>) => e.restStart(body);
    const failures: Array<[Record<string, unknown>, number, string]> = [
      [{ template: TPL, goal: "g" }, 400, "cwd_required"],
      [{ template: TPL, goal: "g", cwd: 7 }, 400, "invalid_cwd"],
      [{ template: TPL, goal: "g", cwd: e.root }, 403, "not-allowed"],
      [{ template: "nope", goal: "g", cwd: e.cwd }, 404, "template_not_found"],
      [{ template: TPL, goal: "", cwd: e.cwd }, 400, "invalid_args"],
      [{ goal: "g", cwd: e.cwd }, 400, "invalid_args"],
    ];
    e.tpl("user", "broken", "---\nname: broken\nmembers: 5\n---\nbody\n");
    failures.push([{ template: "broken", goal: "g", cwd: e.cwd }, 422, "template_invalid"]);
    for (const [body, status, error] of failures) {
      const res = await post(body);
      expect([res.status, res.body.error], JSON.stringify(body)).toEqual([status, error]);
    }
    expect(teams(e)).toHaveLength(0);
    expect(e.fake.base.spawns).toHaveLength(0);

    expect(await post({ template: TPL, goal: "g", cwd: e.cwd })).toMatchObject({ status: 200, body: { role: "lead" } });
    expect(await post({ template: TPL, goal: "g", cwd: link })).toMatchObject({ status: 200 });
    expect(teams(e)).toHaveLength(2);
    expect(teams(e).every((t) => t.leadCwd === e.cwd || t.leadCwd === link)).toBe(true);
  });

  it("an untrusted project template answers project_untrusted (403) and a non-JSON body is a 400", async () => {
    const e = await createStartEnv({ trusted: false });
    e.tpl("project", "only", md({ name: "only", spawn: "lead" }));
    expect(await e.restStart({ template: "only", goal: "g", cwd: e.cwd })).toMatchObject({ status: 403, body: { ok: false, error: "project_untrusted" } });
    const bad = await e.app.inject({ method: "POST", url: "/api/plugins/agent-teams/teams/start", headers: { "content-type": "application/json" }, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
  });

  it("hooks_untrusted answers 409 with the hash and the exact commands; the retry with that hash starts the team", async () => {
    const e = await createStartEnv();
    hooked(e, "npm test --silent");
    const first = await e.restStart({ template: "gated", goal: "g", cwd: e.cwd });
    expect(first).toMatchObject({ status: 409, body: { ok: false, error: "hooks_untrusted", details: { commands: [{ event: "TaskCompleted", command: "npm test --silent", timeoutMs: 10_000 }] } } });
    expect(teams(e)).toHaveLength(0);
    const hash = first.body.details.hash as string;
    expect(await e.restStart({ template: "gated", goal: "g", cwd: e.cwd, trustHooks: "0".repeat(64) })).toMatchObject({ status: 409, body: { error: "hash_mismatch" } });
    expect(teams(e)).toHaveLength(0);
    expect(await e.restStart({ template: "gated", goal: "g", cwd: e.cwd, trustHooks: hash })).toMatchObject({ status: 200 });
    expect(await e.restStart({ template: "gated", goal: "g2", cwd: e.cwd })).toMatchObject({ status: 200 }); // the confirmation persists
  });
});

describe("hook-trust routes (5.5)", () => {
  const hashOf = async (e: StartEnv): Promise<string> => (await e.restStart({ template: "gated", goal: "g", cwd: e.cwd })).body.details.hash as string;
  const trustFile = (e: StartEnv): string => path.join(e.fake.dataDir, "hook-trust.json");

  it("POST records only the hash the server currently computes for a trusted project template of that cwd", async () => {
    const e = await createStartEnv();
    hooked(e);
    const hash = await hashOf(e);
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash: "f".repeat(64) })).toMatchObject({ status: 409, body: { ok: false, error: "hash_mismatch" } });
    expect(fs.existsSync(trustFile(e))).toBe(false); // nothing recorded
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd })).toMatchObject({ status: 400, body: { error: "invalid_args" } });
    expect(await e.rest("POST", "/hook-trust", { hash })).toMatchObject({ status: 400, body: { error: "cwd_required" } });
    expect(await e.rest("POST", "/hook-trust", { cwd: e.root, hash })).toMatchObject({ status: 403 });
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash })).toMatchObject({ status: 200, body: { ok: true } });
    expect(await e.restStart({ template: "gated", goal: "g", cwd: e.cwd })).toMatchObject({ status: 200 });
  });

  it("a stale hash (the file changed after the dialog) is refused", async () => {
    const e = await createStartEnv();
    hooked(e, "true");
    const stale = await hashOf(e);
    hooked(e, "false"); // edited
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash: stale })).toMatchObject({ status: 409, body: { error: "hash_mismatch" } });
    expect(await e.restStart({ template: "gated", goal: "g", cwd: e.cwd })).toMatchObject({ status: 409, body: { error: "hooks_untrusted" } });
  });

  it("an untrusted project or a user template can never be confirmed through the route", async () => {
    const e = await createStartEnv();
    e.tpl("user", "uh", md({ name: "uh", spawn: "lead", hooks: { TaskCompleted: [{ command: "true" }] } }));
    // a hash that is only the USER template's hook set is not a project hash
    const { hashHooks } = await import("../hook-hash.js");
    const userHash = hashHooks({ TaskCompleted: [{ command: "true", timeoutMs: 10_000 }] }, 10_000);
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash: userHash })).toMatchObject({ status: 409, body: { error: "hash_mismatch" } });
    hooked(e);
    const hash = await hashOf(e);
    e.setTrusted(false);
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash })).toMatchObject({ status: 409, body: { error: "hash_mismatch" } });
  });

  it("DELETE (query string) revokes one hash or, without a hash, every confirmation of the cwd; the next start asks again", async () => {
    const e = await createStartEnv();
    hooked(e, "a");
    const h1 = await hashOf(e);
    expect((await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash: h1 })).status).toBe(200);
    hooked(e, "b");
    const h2 = await hashOf(e);
    expect((await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash: h2 })).status).toBe(200);
    const q = (extra = ""): string => `/hook-trust?cwd=${encodeURIComponent(e.cwd)}${extra}`;
    expect(await e.rest("DELETE", q(`&hash=${h2}`))).toMatchObject({ status: 200, body: { removed: 1 } });
    expect(await e.restStart({ template: "gated", goal: "g", cwd: e.cwd })).toMatchObject({ status: 409, body: { error: "hooks_untrusted" } });
    expect(await e.rest("DELETE", q())).toMatchObject({ status: 200, body: { removed: 1 } }); // h1: all that is left for the cwd
    expect(await e.rest("DELETE", q())).toMatchObject({ status: 200, body: { removed: 0 } });
    expect(await e.rest("DELETE", "/hook-trust")).toMatchObject({ status: 400, body: { error: "cwd_required" } });
    expect(await e.rest("DELETE", `/hook-trust?cwd=${encodeURIComponent(e.root)}`)).toMatchObject({ status: 403 });
    expect(await e.rest("DELETE", q("&hash=a&hash=b"))).toMatchObject({ status: 400 });
  });
});

describe("plan routes: owner 404 parity (11.33, #X17) and the no-identity caller (11.34, #X18)", () => {
  /** A team owned by principal A with a plan-mode member whose plan p1 is pending. */
  async function planTeam(e: StartEnv, policy: boolean | "user" = true): Promise<Team> {
    userTpl(e);
    const res = await e.restStart({ template: TPL, goal: "g", cwd: e.cwd }, e.identity.enforced ? { "x-principal": "idp|A" } : {});
    expect(res.status).toBe(200);
    const team = teams(e)[0] as Team;
    e.addMember(team, "alice", "busy", { requirePlanApproval: policy, planApproval: "planning", hold: "plan" });
    expect(await e.call("alice", "PlanSubmit", { plan: "my plan" })).toMatchObject({ ok: true, data: { planId: "p1" } });
    return team;
  }
  const A = { "x-principal": "idp|A" };
  const B = { "x-principal": "idp|B" };
  const stable = (r: RestAnswer) => ({ status: r.status, raw: r.raw, type: r.headers["content-type"], length: r.headers["content-length"] });
  const decide = (e: StartEnv, id: string, body: unknown, headers?: Record<string, string>) => e.rest("POST", `/teams/${id}/members/alice/plan-decision`, body, headers);

  it("a foreign principal, no principal and an unknown team all get the byte-identical 404; the owner reads and decides; the plan stays pending after a foreign attempt", async () => {
    const e = await createStartEnv({ enforced: true });
    const team = await planTeam(e);
    const reads = [e.rest("GET", `/teams/${team.id}/plans`, undefined, B), e.rest("GET", `/teams/${team.id}/plans`), e.rest("GET", "/teams/t_unknown/plans", undefined, A)];
    const answers = (await Promise.all(reads)).map(stable);
    expect(answers[0]).toMatchObject({ status: 404, raw: '{"error":"not_found"}' });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    const writes = (await Promise.all([decide(e, team.id, { planId: "p1", approve: true }, B), decide(e, team.id, { planId: "p1", approve: true }), decide(e, "t_unknown", { planId: "p1", approve: true }, A)])).map(stable);
    expect(writes[0]).toMatchObject({ status: 404, raw: '{"error":"not_found"}' });
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[2]).toEqual(writes[0]);
    expect(e.rt.store.get(team.id)?.plans?.[0]?.status).toBe("pending");
    expect(e.rt.store.member(e.rt.store.get(team.id) as Team, "alice")?.planApproval).toBe("pending");

    const plans = await e.rest("GET", `/teams/${team.id}/plans`, undefined, A);
    expect(plans).toMatchObject({ status: 200, body: { plans: [{ id: "p1", member: "alice", status: "pending", plan: "my plan" }] } });
    expect(await decide(e, team.id, { planId: "p1", approve: true }, A)).toMatchObject({ status: 200, body: { planId: "p1", member: "alice", status: "approved" } });
    expect(e.rt.store.get(team.id)?.plans?.[0]).toMatchObject({ status: "approved", decidedBy: `user:${e.ownerKey({ iss: "idp", sub: "A" })}` });
  });

  it("decision errors: already_decided (409), unknown_plan (404), an over-long feedback (400, nothing recorded) and a reject with feedback", async () => {
    const e = await createStartEnv();
    const team = await planTeam(e);
    expect(await decide(e, team.id, { planId: "p9", approve: true })).toMatchObject({ status: 404, body: { ok: false, error: "unknown_plan" } });
    expect(await decide(e, team.id, { planId: "p1", approve: "yes" })).toMatchObject({ status: 400, body: { error: "invalid_args" } });
    expect(await decide(e, team.id, { planId: "p1", approve: false, feedback: "x".repeat(6001) })).toMatchObject({ status: 400, body: { error: "message_too_long" } });
    expect(e.rt.store.get(team.id)?.plans?.[0]?.status).toBe("pending");
    expect(await decide(e, team.id, { planId: "p1", approve: false, feedback: "add tests" })).toMatchObject({ status: 200, body: { status: "rejected" } });
    expect(await decide(e, team.id, { planId: "p1", approve: true })).toMatchObject({ status: 409, body: { error: "already_decided" } });
    expect(e.rt.store.get(team.id)?.plans?.[0]).toMatchObject({ status: "rejected", feedback: "add tests", decidedBy: "user" });
  });

  it("without enforced identity a local-token caller decides a \"user\"-policy plan and confirms hooks; it is recorded as decidedBy \"user\" (honest limit, D8)", async () => {
    const e = await createStartEnv();
    const team = await planTeam(e, "user");
    // the lead tool may not decide a "user" plan …
    const leadSid = e.newSession();
    expect(e.rt.ops.call("PlanDecision", { member: "alice", planId: "p1", approve: true }, { sessionId: leadSid, role: "lead", team, name: "lead" })).toMatchObject({ ok: false, error: "user_decision_required" });
    // … but the REST caller holding the local token can.
    expect(await decide(e, team.id, { planId: "p1", approve: true })).toMatchObject({ status: 200, body: { status: "approved" } });
    expect(e.rt.store.get(team.id)?.plans?.[0]?.decidedBy).toBe("user");
    hooked(e);
    const hash = (await e.restStart({ template: "gated", goal: "g", cwd: e.cwd })).body.details.hash as string;
    expect(await e.rest("POST", "/hook-trust", { cwd: e.cwd, hash })).toMatchObject({ status: 200 });
  });
});

describe("start logging and the counters in the snapshot stats (8.1, 8.2, #X19 start half)", () => {
  const withStats = async (e: StartEnv) => {
    const app = Fastify();
    await mountTeamsRoutes(app, {
      store: e.rt.store,
      telemetry: e.rt.telemetry,
      ext: e.rt.ext,
      logger: e.fake.host.logger,
      epoch: "E",
      extraStats: (id) => e.rt.counters.forTeam(id),
      rateLimits: { read: { perSecond: 1e5, burst: 1e5 }, write: { perSecond: 1e5, burst: 1e5 } },
    });
    await app.ready();
    return async (id: string) => (JSON.parse((await app.inject({ method: "GET", url: `/api/plugins/agent-teams/teams/${id}` })).body) as { stats: Record<string, number> }).stats;
  };

  it("template starts, hook runs and plan transitions reach the snapshot stats; a core-only team keeps its seven keys", async () => {
    const e = await createStartEnv();
    e.tpl("user", TPL, md({ name: TPL, spawn: "lead", hooks: { TaskCompleted: [{ command: "true" }] } }));
    const stats = await withStats(e);
    const lead = e.newSession();
    await e.start({ template: TPL, goal: "the secret goal" }, lead);
    const team = teams(e)[0] as Team;
    e.addMember(team, "alice", "busy", { requirePlanApproval: true, planApproval: "planning", hold: "plan" });
    await e.call("alice", "PlanSubmit", { plan: "p" });
    await e.rest("POST", `/teams/${team.id}/members/alice/plan-decision`, { planId: "p1", approve: true });
    e.rt.ops.createTask(team, { title: "t", description: "d", owner: "alice" }, { actor: "lead" });
    e.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    expect(await e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "ok" })).toMatchObject({ ok: true });
    expect(await stats(team.id)).toMatchObject({ templateStarts: 1, plansSubmitted: 1, plansApproved: 1, hook_runs: 1 });

    const plain = await e.fake.call(e.newSession(), "TeamCreate", { name: "plain" });
    expect(Object.keys(await stats(plain.data.teamId)).sort()).toEqual(["claimConflicts", "claims", "deliveries", "queued", "rateLimited", "spawns", "urgentAborts"]);
  });

  it("the start log names ids, the template and sizes — never the goal; refused starts log nothing about the goal either", async () => {
    const e = await createStartEnv();
    userTpl(e);
    await e.start({ template: TPL, goal: "TOP-SECRET-GOAL" });
    await e.restStart({ template: TPL, goal: "TOP-SECRET-GOAL", cwd: e.cwd });
    const lines = e.fake.logs.info.filter((l) => l.includes("start path="));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/agent-teams: start path=command team=\S+ template=review source=user members=0 hooks=0/);
    expect(lines[1]).toContain("path=rest");
    expect([...e.fake.logs.info, ...e.fake.logs.warn, ...e.fake.logs.error].join("\n")).not.toContain("TOP-SECRET-GOAL");
    expect(e.fake.logs.info.some((l) => l.includes("templates listed"))).toBe(false);
    await e.templates();
    expect(e.fake.logs.info.some((l) => /templates listed count=1 invalid=0 untrusted=0/.test(l))).toBe(true);
  });
});

afterEach(() => undefined);
