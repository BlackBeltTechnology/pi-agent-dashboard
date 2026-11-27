/**
 * Mode `in-process` registration, per-team selection, availability per caller, session-mode isolation and the
 * server-visible parity gaps (test-plan S1, S3, S9, S10, S70). The bridge host does not exist yet: a scripted fake
 * bridge (`linkInProcBridge`) answers the commands.
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/fake-clock.js";
import { linkInProcBridge } from "../../__tests__/harness/inproc-link.js";
import { createTeamsEnv } from "../../__tests__/harness/teams-env.js";
import { createTeamTools } from "../../bridge/tools.js";
import type { InProcDriver } from "../driver-inproc.js";
import { createInProcAvailability, registerInProcessMode } from "../modes-inproc.js";
import { snapshotOf } from "../snapshot.js";
import { listTemplates, templateCache } from "../templates.js";
import { createStartEnv } from "./start-env.js";
import { createTemplateEnv, md } from "./template-env.js";

const AVAILABLE = { available: true } as const;
const MISSING = { available: false, reason: "subagents_extension_missing" } as const;

async function inprocEnv(config: Record<string, unknown> = {}) {
  const env = createTeamsEnv({ config, runtime: { inProcess: true } });
  const link = linkInProcBridge(env);
  return { env, link };
}

type Mode = "session" | "in-process";
const ARGS: Array<Mode | undefined> = [undefined, "session", "in-process"];
const COMBOS = ARGS.flatMap((arg) => ARGS.flatMap((template) => ARGS.flatMap((config) => [true, false].map((avail) => ({ arg, template, config, avail })))));

describe("S1 mode resolved per team: arg ?? template ?? config ?? session (54 combinations)", () => {
  it("has 54 combinations", () => expect(COMBOS).toHaveLength(54));

  it.each(COMBOS.map((c) => [`arg=${c.arg ?? "-"} template=${c.template ?? "-"} config=${c.config ?? "-"} available=${c.avail}`, c] as const))("%s", async (_label, { arg, template, config, avail }) => {
    const expected: Mode = arg ?? template ?? config ?? "session";
    const mustFail = expected === "in-process" && !avail;
    const hello = avail ? AVAILABLE : MISSING;
    if (arg !== undefined || template === undefined) {
      // TeamCreate entry point: the argument, else the configured default.
      const { env, link } = await inprocEnv(config ? { teammateMode: config } : {});
      await link.hello(hello);
      const res = await env.fake.call(env.lead, "TeamCreate", { name: "t", ...(arg ? { mode: arg } : {}) });
      if (mustFail) {
        expect(res).toMatchObject({ ok: false, error: "mode_unavailable" });
        expect(res.message).toContain("subagents_extension_missing");
        expect(env.rt.store.list()).toHaveLength(0); // no team record written
      } else {
        expect(res.ok).toBe(true);
        expect(env.rt.store.get(res.data.teamId)?.mode).toBe(expected);
      }
      return;
    }
    // Templated entry point (no argument): the template's mode, else the configured default (never straight to `session`).
    const tenv = createTemplateEnv();
    const clock = new FakeClock(1);
    const availability = createInProcAvailability(clock);
    registerInProcessMode(tenv.deps.modes, { mode: "in-process" } as unknown as InProcDriver, availability, () => true);
    availability.note("S1", { op: "hello", incarnation: "i", commandSecret: "s", inProcess: avail ? { available: true, apiVersion: 1, features: ["spawn", "steer", "managed", "loader"], limits: { maxConcurrent: 4 } } : { available: false, reason: "subagents_extension_missing" } });
    if (config) tenv.setConfig({ teammateMode: config });
    tenv.tpl("user", "t", md({ name: "t", mode: template }));
    templateCache.invalidate();
    const listed = listTemplates({ cwd: tenv.cwd, deps: tenv.deps, caller: { sessionId: "S1" } }).templates[0];
    if (mustFail) {
      expect(listed).toMatchObject({ valid: false });
      expect(JSON.stringify(listed?.errors)).toContain("mode_unavailable");
    } else {
      expect(listed).toMatchObject({ valid: true, mode: expected });
    }
  });
});

describe("S2 TeamCreate {mode} accepts only exactly session or in-process", () => {
  it.each([
    ["inprocess", "inprocess"],
    ["IN-PROCESS", "IN-PROCESS"],
    ["x", "x"],
    ["closed-mode", "closed-mode"],
    ["empty string", ""],
    ["null", null],
    ["0", 0],
    ["array", ["in-process"]],
    ["object", {}],
    ["padded", " in-process "],
  ])("%s → invalid_args naming mode, no team, configured default not applied", async (_n, mode) => {
    const { env, link } = await inprocEnv({ teammateMode: "in-process" });
    await link.hello(AVAILABLE);
    const res = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode });
    expect(res).toMatchObject({ ok: false, error: "invalid_args" });
    expect(res.message).toContain("mode");
    expect(env.rt.store.list()).toHaveLength(0);
  });
});

describe("S3 the mode of a team is immutable", () => {
  it("a second TeamCreate with another mode and a TeammateSpawn carrying mode are invalid_args; the persisted mode never changes", async () => {
    const { env, link } = await inprocEnv();
    await link.hello(AVAILABLE);
    const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    const team = env.rt.store.get(created.data.teamId);
    expect(team?.mode).toBe("in-process");
    const again = await env.fake.call(env.lead, "TeamCreate", { name: "u", mode: "session" });
    expect(again).toMatchObject({ ok: false, error: "invalid_args" });
    expect(again.message).toContain("mode");
    expect(await env.fake.call(env.lead, "TeamCreate", { name: "u", mode: "in-process" })).toMatchObject({ ok: false, error: "already_in_team" });
    expect(await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "x", mode: "session" })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(env.rt.store.get(created.data.teamId)?.mode).toBe("in-process");
    expect(env.rt.store.get(created.data.teamId)?.members).toHaveLength(0);
    expect(link.emitted).toHaveLength(0); // no member was routed to any driver
  });
});

describe("S9 session mode unaffected by the in-process module", () => {
  async function scenario(inProcess: boolean) {
    const env = createTeamsEnv({ runtime: { inProcess } });
    if (inProcess) {
      const link = linkInProcBridge(env);
      await link.hello(AVAILABLE);
    }
    const team = await env.createTeam("alpha");
    env.addMember(team, "bob", "idle");
    await env.call("lead", "SendMessage", { to: "bob", text: "hello bob" });
    await env.call("lead", "TeammateSpawn", { name: "eve", prompt: "do it" });
    await env.settle();
    env.fake.resolveSession("S-eve", { "agent-teams": { teamId: team.id, member: "eve" } });
    env.flushNotices();
    const strip = (v: unknown): string => JSON.stringify(v);
    return {
      env,
      spawns: strip(env.fake.base.spawns),
      emits: strip(env.fake.base.emits.filter((e) => e.eventType !== "agent-teams:inproc")),
      inprocEmits: env.fake.base.emits.filter((e) => e.eventType === "agent-teams:inproc").length,
    };
  }

  it("a session team makes byte-identical spawnSession / emitEventToSession calls with and without the module, and emits no agent-teams:inproc", async () => {
    const without = await scenario(false);
    const withModule = await scenario(true);
    expect(JSON.parse(without.spawns)).not.toHaveLength(0);
    expect(withModule.spawns).toBe(without.spawns);
    expect(withModule.emits).toBe(without.emits);
    expect(withModule.inprocEmits).toBe(0);
  });

  it("with the subagents extension absent (probe unanswered) a session team is created and the mode is reported unavailable", async () => {
    const { env, link } = await inprocEnv();
    await link.hello(MISSING);
    expect((await env.fake.call(env.lead, "TeamCreate", { name: "s" })).ok).toBe(true);
    const other = env.fake.addSession("S-2", { cwd: "/work" });
    await link.lane({ op: "hello", incarnation: "i", commandSecret: "c", inProcess: MISSING }); // lead's own hello again: still missing
    expect(await env.fake.call(other, "TeamCreate", { name: "x", mode: "in-process" })).toMatchObject({ ok: false, error: "mode_unavailable" });
  });
});

describe("S10 templates resolved to in-process", () => {
  const TEMPLATE = md({ name: "p", mode: "in-process", members: [{ name: "a" }, { name: "b" }] });

  it("none available: listed with mode_unavailable and a reason, and not startable", async () => {
    const e = await createStartEnv({ runtime: { inProcess: true } });
    e.tpl("user", "p", TEMPLATE);
    const session = e.newSession();
    const listed = await e.templates(session);
    const t = (listed.data.templates as Array<{ name: string; valid: boolean; errors?: Array<{ code: string; message?: string }> }>).find((x) => x.name === "p");
    expect(t?.valid).toBe(false);
    expect(t?.errors?.map((x) => x.code)).toContain("mode_unavailable");
    expect(t?.errors?.map((x) => x.message).join(" ")).toMatch(/no_context|subagents_extension/);
    expect(await e.start({ template: "p", goal: "g" }, session)).toMatchObject({ ok: false, error: "mode_unavailable" });
    expect(e.rt.store.list()).toHaveLength(0);
  });

  it("available: the command-path start creates the in-process team and the eager members' spawn commands go out after the lead is bound", async () => {
    const e = await createStartEnv({ runtime: { inProcess: true } });
    e.tpl("user", "p", TEMPLATE);
    const session = e.newSession();
    const link = linkInProcBridge(e, { lead: session });
    await link.hello(AVAILABLE);
    const started = await e.start({ template: "p", goal: "g" }, session);
    expect(started.ok).toBe(true);
    await e.flush();
    expect(e.rt.store.list()[0]?.mode).toBe("in-process");
    expect(e.rt.store.list()[0]?.leadSessionId).toBe(session);
    expect(link.emitted.map((x) => (x.data as { cmd: string }).cmd)).toEqual(["spawn", "spawn"]);
    expect(e.fake.base.spawns).toHaveLength(0); // no host session is spawned for an in-process member
  });

  it("started with a late mismatch: the new lead's first hello reports unavailable → team closed mode_unavailable, 0 spawn commands", async () => {
    const e = await createStartEnv({ runtime: { inProcess: true } });
    e.tpl("user", "p", TEMPLATE);
    const other = e.newSession();
    await linkInProcBridge(e, { lead: other }).hello(AVAILABLE); // some connected session reports available → the template is startable
    const res = await e.restStart({ template: "p", goal: "g", cwd: e.cwd });
    expect(res.status).toBe(200);
    const team = e.rt.store.list()[0];
    expect(team?.mode).toBe("in-process");
    const leadSession = await e.bindLead(team as NonNullable<typeof team>);
    await e.flush();
    const leadLink = linkInProcBridge(e, { lead: leadSession });
    expect(leadLink.emitted).toHaveLength(0); // eager spawns wait for the new lead's availability
    await leadLink.hello(MISSING);
    await e.flush();
    const closed = e.rt.store.get((team as NonNullable<typeof team>).id);
    expect(closed?.status).toBe("closed");
    expect(closed?.closeReason).toBe("mode_unavailable");
    expect(leadLink.emitted).toHaveLength(0);
    expect(e.fake.base.emits.filter((x) => x.eventType === "agent-teams:inproc")).toHaveLength(0);
  });

  it("a first hello of no_context does not close the team (re-probed later)", async () => {
    const { env, link } = await inprocEnv();
    await link.hello(AVAILABLE);
    const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    // A fresh lead session whose FIRST hello is no_context.
    const fresh = env.fake.addSession("S-fresh", { cwd: "/work" });
    const freshLink = linkInProcBridge(env, { lead: fresh });
    await freshLink.hello({ available: false, reason: "no_context" });
    expect(env.rt.store.get(created.data.teamId)?.status).toBe("active");
  });
});

describe("S70 parity gaps are enforced and visible", () => {
  async function team() {
    const { env, link } = await inprocEnv();
    link.setOnCommand((cmd) => (cmd.cmd === "spawn" ? { ack: { cmdId: cmd.cmdId, ok: true, childId: `bg-${cmd.member}`, agentId: `agent-${cmd.member}`, status: "running" } } : undefined));
    await link.hello(AVAILABLE);
    const created = await env.fake.call(env.lead, "TeamCreate", { name: "t", mode: "in-process" });
    return { env, link, teamId: created.data.teamId as string };
  }

  it("resume:true is always resume_unsupported_in_process, for a never-existed, a gone and a live name", async () => {
    const { env, link, teamId } = await team();
    expect(await env.call("lead", "TeammateSpawn", { name: "ghost", prompt: "p", resume: true })).toMatchObject({ ok: false, error: "resume_unsupported_in_process" });
    expect((await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "first", resume: false })).ok).toBe(true);
    await env.settle();
    expect(await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p", resume: true })).toMatchObject({ error: "resume_unsupported_in_process" }); // live
    const t = env.rt.store.get(teamId) as NonNullable<ReturnType<typeof env.rt.store.get>>;
    env.rt.ops.releaseMember(t, "bob", "gone", "stopped");
    expect(await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p", resume: true })).toMatchObject({ error: "resume_unsupported_in_process" }); // gone
    // A respawn after gone starts a fresh context (its prompt only) with a NEW token.
    expect((await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "second task" })).ok).toBe(true);
    await env.settle();
    const spawns = link.commands.filter((c) => c.cmd === "spawn") as Array<{ prompt: string; proxyToken: string }>;
    expect(spawns).toHaveLength(2);
    expect(spawns[1]?.proxyToken).not.toBe(spawns[0]?.proxyToken);
    expect(spawns[1]?.prompt).toContain("second task");
    expect(spawns[1]?.prompt).not.toContain("first");
  });

  it("the TeammateSpawn tool description states the parity gaps (no direct chat, read-only subagent view, no MCP, no resume) so the lead does not over-promise", () => {
    const spawn = createTeamTools({ call: async () => ({ ok: true, data: {} }) } as never).find((t) => t.name === "TeammateSpawn");
    expect(spawn?.description).toMatch(/user cannot chat with it directly/);
    expect(spawn?.description).toMatch(/read-only subagent view/);
    expect(spawn?.description).toMatch(/no MCP tools/);
    expect(spawn?.description).toMatch(/cannot be resumed/);
  });

  it("the snapshot has no sessionId for an in-process member, has childAgentId, and never carries a token", async () => {
    const { env, teamId } = await team();
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    const t = env.rt.store.get(teamId) as NonNullable<ReturnType<typeof env.rt.store.get>>;
    const snap = snapshotOf(env.rt.store, env.rt.telemetry, t);
    const bob = snap.members.find((m) => m.name === "bob");
    expect(bob).toMatchObject({ childAgentId: "agent-bob" });
    expect(bob).not.toHaveProperty("sessionId");
    expect(JSON.stringify(snap)).not.toContain(t.members[0]?.proxyToken as string);
    expect(snap.mode).toBe("in-process");
  });

  it("the snapshot exposes the parallelism inputs (maxTeammates, maxConcurrent) for an in-process team only, and queuePosition while queued", async () => {
    const { env, teamId } = await team();
    await env.call("lead", "TeammateSpawn", { name: "bob", prompt: "p" });
    await env.settle();
    const t = env.rt.store.get(teamId) as NonNullable<ReturnType<typeof env.rt.store.get>>;
    const snap = snapshotOf(env.rt.store, env.rt.telemetry, t);
    expect(t.subagentsApi?.limits.maxConcurrent).toBeGreaterThan(0);
    expect(snap.maxConcurrent).toBe(t.subagentsApi?.limits.maxConcurrent);
    expect(snap.maxTeammates).toBe(t.maxTeammates);
    env.rt.store.patchMember(teamId, "bob", { status: "spawning", queuePosition: 2 });
    const queued = snapshotOf(env.rt.store, env.rt.telemetry, env.rt.store.get(teamId) as NonNullable<ReturnType<typeof env.rt.store.get>>);
    expect(queued.members.find((m) => m.name === "bob")).toMatchObject({ status: "spawning", queuePosition: 2 });
    // A session-mode team never carries the in-process bound.
    const session = { ...t, mode: "session", subagentsApi: undefined };
    const sessionSnap = snapshotOf(env.rt.store, env.rt.telemetry, session);
    expect(sessionSnap).not.toHaveProperty("maxConcurrent");
    expect(sessionSnap).not.toHaveProperty("maxTeammates");
  });
});
