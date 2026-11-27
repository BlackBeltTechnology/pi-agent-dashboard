/**
 * Starting a team from a template (tasks 3.1–3.8, 3.12, 5.6, 8.1/8.2): the `team.templates` / `team.start`
 * lane ops, the REST start, the server-started lead and its bind deadline, the post-bind eager roster, start
 * profiles and the bundled source. Test-plan #E9 #E11 #E37 #E38 #E39 #E41 #X6 #X7 #X8 #X15 #R8 #R10 #I3.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { flushAsync, linkBridge } from "../../__tests__/harness/fake-pi.js";
import { PLAN_MAX_LINES } from "../../shared/constants.js";
import { countMailChars, countMailLines, customTypeForKind, formatMail } from "../../shared/mail-format.js";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import type { Team } from "../../shared/types.js";
import { registerStartProfile } from "../start.js";
import { registerBundledTemplate, renderPlaybook } from "../templates.js";
import { createStartEnv, type StartEnv } from "./start-env.js";
import { md } from "./template-env.js";

const TPL = "review";
const teams = (e: StartEnv): Team[] => e.rt.store.list();
const only = (e: StartEnv): Team => {
  expect(teams(e)).toHaveLength(1);
  return teams(e)[0] as Team;
};
/** A `spawn: lead` template: the roster stays out of the way unless a test wants it. */
const lead = (e: StartEnv, name = TPL, extra: Record<string, unknown> = {}, body?: string): void => void e.tpl("user", name, md({ name, spawn: "lead", ...extra }, body));

describe("team.templates / team.start on the command path (3.1, 3.2, 3.8, 5.6)", () => {
  it("lists templates for a plain session and for a lead, never for a teammate", async () => {
    const e = await createStartEnv();
    lead(e);
    const plain = e.newSession();
    const listed = await e.templates(plain);
    expect(listed).toMatchObject({ ok: true, data: { templates: [expect.objectContaining({ name: TPL, source: "user", valid: true })] } });
    await e.start({ template: TPL, goal: "g" }, plain);
    expect((await e.templates(plain)).ok).toBe(true); // now a lead
    const team = only(e);
    e.addMember(team, "alice", "idle");
    expect(await e.call("alice", "team.templates", {})).toMatchObject({ ok: false, error: "nested_team_forbidden" });
  });

  it("makes the calling session the lead at the SESSION cwd (a payload cwd is ignored) and stores the snapshot, overrides, defaults and frozen hooks", async () => {
    const e = await createStartEnv();
    e.tpl(
      "user",
      TPL,
      md({
        name: TPL,
        spawn: "lead",
        maxTeammates: 3,
        autoDispatch: false,
        notify: { coalesceMs: 500 },
        defaultModel: "@coding",
        defaultTools: ["read", "grep"],
        defaultSkills: [],
        requirePlanApproval: true,
        lead: { model: "@review" },
        members: [{ name: "alice", agent: "Audit", count: 2, tools: ["read"], prompt: "Focus on {{goal}}." }],
        hooks: { TaskCompleted: [{ command: "echo ok", timeoutMs: 5000 }] },
      }),
    );
    const sid = e.newSession();
    const res = await e.start({ template: TPL, goal: "PR 123", cwd: "/etc", trustHooks: undefined }, sid);
    expect(res).toMatchObject({ ok: true, data: { role: "lead", name: TPL, leadModelIgnored: "@review", limits: { maxTeammates: 3 } } });
    const team = only(e);
    expect(team).toMatchObject({
      leadSessionId: sid,
      leadCwd: e.cwd,
      status: "active",
      owner: "owner-p",
      maxTeammates: 3,
      overrides: { autoDispatch: false, notifyCoalesceMs: 500 },
      defaultTools: ["read", "grep"],
      defaultSkills: [],
      hooks: { TaskCompleted: [{ command: "echo ok", timeoutMs: 5000 }] },
      template: {
        name: TPL,
        source: "user",
        goal: "PR 123",
        spawn: "lead",
        defaultModel: "@coding",
        requirePlanApproval: true,
        lead: { model: "@review" },
        maxTeammates: 3,
        members: [
          { name: "alice-1", agent: "Audit", tools: ["read"], prompt: "Focus on PR 123." },
          { name: "alice-2", agent: "Audit", tools: ["read"], prompt: "Focus on PR 123." },
        ],
      },
    });
    expect(team.template?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(team.template?.playbook).toContain("Goal: PR 123");
    expect((res as { data: { playbook: string } }).data.playbook).toBe(team.template?.playbook);
    expect(e.rt.counters.get("templateStarts", team.id)).toBe(1);
  });

  it("freezes the hooks: a later edit or deletion of the file never reaches the running team (5.6, #D1 start half)", async () => {
    const e = await createStartEnv();
    const file = e.tpl("user", TPL, md({ name: TPL, spawn: "lead", hooks: { TaskCompleted: [{ command: "true" }] } }));
    await e.start({ template: TPL, goal: "g" });
    const team = only(e);
    const frozen = JSON.stringify(team.hooks);
    expect(frozen).toContain("true");
    fs.writeFileSync(file, md({ name: TPL, spawn: "lead", hooks: { TaskCompleted: [{ command: "evil" }] } }));
    fs.rmSync(file);
    expect(JSON.stringify(only(e).hooks)).toBe(frozen);
    expect(only(e).template?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a template without hooks leaves `hooks` absent; templates never create tasks", async () => {
    const e = await createStartEnv();
    lead(e);
    await e.start({ template: TPL, goal: "g" });
    expect(only(e).hooks).toBeUndefined();
    expect(only(e).tasks).toEqual([]);
  });

  it("refuses an unknown template and an invalid one without creating anything", async () => {
    const e = await createStartEnv();
    e.tpl("user", "broken", "---\nname: broken\nmembers: 5\n---\nbody\n");
    const spy = vi.spyOn(e.rt.ops, "createTeam");
    expect(await e.start({ template: "nope", goal: "g" })).toMatchObject({ ok: false, error: "template_not_found" });
    expect(await e.start({ template: "broken", goal: "g" })).toMatchObject({ ok: false, error: "template_invalid" });
    expect(await e.start({ template: 5, goal: "g" })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await e.start("nope" as never)).toMatchObject({ ok: false, error: "invalid_args" });
    expect(spy).not.toHaveBeenCalled();
    expect(teams(e)).toHaveLength(0);
  });

  it("start is not an agent tool: no op, no tool name and no tool argument reaches it (3.2, #S3 start half)", async () => {
    const e = await createStartEnv();
    lead(e);
    const lane = await e.fake.call(e.newSession(), "TeamCreate", { name: "x", hooks: { TaskCompleted: [{ command: "evil" }] }, trustHooks: "h", template: TPL });
    expect(lane.ok).toBe(true);
    const team = only(e);
    expect(team.hooks).toBeUndefined();
    expect(team.template).toBeUndefined();
    const { TEAM_OPS, TEAM_TOOLS_BY_ROLE } = await import("../../shared/protocol.js");
    for (const op of ["team.start", "team.templates"]) expect(TEAM_OPS as readonly string[]).not.toContain(op);
    for (const role of Object.values(TEAM_TOOLS_BY_ROLE)) expect(role.some((t) => /start|trust/i.test(t))).toBe(false);
  });
});

describe("goal domain (11.8, #E9)", () => {
  it.each([
    ["empty", ""],
    ["one space", " "],
    ["tab and newline", "\t\n"],
    ["4001 characters", "x".repeat(4001)],
  ])("%s → invalid_args and no team", async (_n, goal) => {
    const e = await createStartEnv();
    lead(e);
    const spy = vi.spyOn(e.rt.ops, "createTeam");
    expect(await e.start({ template: TPL, goal })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(spy).not.toHaveBeenCalled();
    expect(teams(e)).toHaveLength(0);
  });

  it.each([
    ["1 character", "x", "x"],
    ["4000 characters", "y".repeat(4000), "y".repeat(4000)],
    ["NUL becomes a space", "a\u0000b", "a b"],
    ["newline becomes a space", "line1\nline2", "line1 line2"],
    ["tab becomes a space", "a\tb", "a b"],
  ])("%s is accepted and stored single-line", async (_n, goal, stored) => {
    const e = await createStartEnv();
    lead(e);
    expect(await e.start({ template: TPL, goal })).toMatchObject({ ok: true });
    expect(only(e).template?.goal).toBe(stored);
  });

  it("{{cwd}} / {{goal}} inside the goal stay literal (single pass)", async () => {
    const e = await createStartEnv();
    lead(e, TPL, {}, "Do {{goal}} in {{cwd}}.");
    await e.start({ template: TPL, goal: "fix {{cwd}} {{goal}}" });
    expect(only(e).template?.playbook).toContain(`Do fix {{cwd}} {{goal}} in ${e.cwd}.`);
  });
});

describe("playbook cap (11.10, #E11)", () => {
  const base = { name: "t", source: "user" as const, mode: "session", hash: "h", spawn: "lead" as const, members: [], warnings: [] };
  const sized = (body: string) => renderPlaybook({ template: { ...base, body }, goal: "g", cwd: "/p", maxMessageChars: 100_000 });
  const overhead = (() => {
    const r = sized("x");
    if (!r.ok) throw new Error("probe failed");
    return { chars: countMailChars(r.playbook) - 1, lines: countMailLines(r.playbook) - 1 };
  })();
  const CAP = 8000 - 500;

  it.each([
    [CAP - 1, true],
    [CAP, true],
    [CAP + 1, false],
  ])("a rendered playbook of %i characters (the cap is 7500) → ok:%s", async (chars, ok) => {
    const e = await createStartEnv();
    lead(e, "t", {}, "x".repeat(chars - overhead.chars));
    const spy = vi.spyOn(e.rt.ops, "createTeam");
    const res = await e.fake.call(e.newSession(), "team.start", { template: "t", goal: "g" });
    if (ok) expect(res.ok).toBe(true);
    else {
      expect(res).toMatchObject({ ok: false, error: "playbook_too_long" });
      expect(spy).not.toHaveBeenCalled();
      expect(teams(e)).toHaveLength(0);
    }
  });

  it.each([
    [PLAN_MAX_LINES - 1, true],
    [PLAN_MAX_LINES, true],
    [PLAN_MAX_LINES + 1, false],
  ])("a rendered playbook of %i lines (the cap is 120) → ok:%s, never truncated", async (lines, ok) => {
    const e = await createStartEnv();
    lead(e, "t", {}, Array.from({ length: lines - overhead.lines }, (_, i) => `line ${i}`).join("\n"));
    const res = await e.fake.call(e.newSession(), "team.start", { template: "t", goal: "g" });
    expect(res.ok).toBe(ok);
    if (ok) expect((res.data.playbook as string).split("\n").length).toBeGreaterThanOrEqual(lines - 1);
    else expect(res.error).toBe("playbook_too_long");
  });

  it("a body that alone exceeds the cap is listed invalid and cannot be started", async () => {
    const e = await createStartEnv();
    lead(e, "t", {}, "x".repeat(CAP + 1));
    const listed = await e.templates();
    expect(listed.data.templates[0]).toMatchObject({ name: "t", valid: false, errors: [expect.objectContaining({ code: "playbook_too_long" })] });
    expect(await e.start({ template: "t", goal: "g" })).toMatchObject({ ok: false, error: "template_invalid" });
  });
});

describe("start profiles and the bundled source (11.21, #E37)", () => {
  it("a failing preflight returns its code and creates no team, lead or member", async () => {
    const e = await createStartEnv();
    lead(e, "p");
    const off = registerStartProfile("p", { preflight: () => ({ ok: false, error: "x_fail", message: "nope" }), seed: vi.fn() });
    const spy = vi.spyOn(e.rt.ops, "createTeam");
    try {
      expect(await e.start({ template: "p", goal: "g" })).toMatchObject({ ok: false, error: "x_fail", message: "nope" });
      expect((await e.restStart({ template: "p", goal: "g", cwd: e.cwd })).body).toMatchObject({ ok: false, error: "x_fail" });
    } finally {
      off();
    }
    expect(spy).not.toHaveBeenCalled();
    expect(teams(e)).toHaveLength(0);
    expect(e.fake.base.spawns).toHaveLength(0);
  });

  it("a throwing preflight is a refusal, not a crash", async () => {
    const e = await createStartEnv();
    lead(e, "p");
    const off = registerStartProfile("p", {
      preflight: () => {
        throw new Error("boom");
      },
      seed: vi.fn(),
    });
    try {
      expect(await e.start({ template: "p", goal: "g" })).toMatchObject({ ok: false, error: "invalid_args" });
    } finally {
      off();
    }
    expect(teams(e)).toHaveLength(0);
  });

  it("seed runs exactly once after lead_bound, strictly before the first eager spawn", async () => {
    const e = await createStartEnv();
    e.tpl("user", "p", md({ name: "p", members: [{ name: "a" }, { name: "b" }] }));
    const order: string[] = [];
    const seed = vi.fn(async (team: Team) => {
      order.push(`seed:${team.status}`);
      await Promise.resolve();
    });
    const off = registerStartProfile("p", { preflight: () => ({ ok: true }), seed });
    const realSpawn = e.rt.ops.spawnTeammate.bind(e.rt.ops);
    vi.spyOn(e.rt.ops, "spawnTeammate").mockImplementation((team, args, opts) => {
      order.push(`spawn:${args.name}`);
      return realSpawn(team, args, opts);
    });
    try {
      const res = await e.restStart({ template: "p", goal: "g", cwd: e.cwd });
      expect(res.status).toBe(200);
      await e.flush();
      expect(order).toEqual([]); // nothing before the lead binds
      await e.bindLead(only(e));
      await e.flush();
      expect(order).toEqual(["seed:active", "spawn:a", "spawn:b"]);
      // A lead re-bind (hello after an orphan, restart…) never seeds twice.
      e.rt.store.bindLead(only(e).id, "S-other");
      await e.flush();
      expect(seed).toHaveBeenCalledTimes(1);
      expect(only(e).template?.seeded).toBe(true);
    } finally {
      off();
    }
  });

  it("seed on the command path runs once too; its server-actor tasks run no hooks", async () => {
    const e = await createStartEnv();
    const marker = path.join(e.root, "hook-ran");
    const offBundle = registerBundledTemplate("bund", md({ name: "bund", spawn: "lead", hooks: { TaskCreated: [{ command: `touch ${marker}` }] } }));
    const off = registerStartProfile("bund", {
      preflight: () => ({ ok: true }),
      seed: (team) => void e.rt.ops.createTask(team, { title: "seeded", description: "d" }, { actor: "server" }),
    });
    try {
      const listed = await e.templates();
      expect(listed.data.templates).toContainEqual(expect.objectContaining({ name: "bund", source: "bundled", valid: true }));
      const res = await e.start({ template: "bund", goal: "g" });
      expect(res).toMatchObject({ ok: true }); // a bundled source never asks for hook confirmation
      await e.flush();
      expect(only(e).tasks.map((t) => t.title)).toEqual(["seeded"]);
      expect(fs.existsSync(marker)).toBe(false); // seed tasks skip the TaskCreated gate
      expect(only(e).template?.source).toBe("bundled");
    } finally {
      off();
      offBundle();
    }
  });
});

describe("playbook on both paths and the server-started lead (11.22, #E38)", () => {
  it("sends the identical playbook through the command reply and the REST lead's mail; the REST lead spawn has no initialPrompt, role lead and lead.model; the command path ignores lead.model", async () => {
    const e = await createStartEnv();
    lead(e, TPL, { lead: { model: "@review" } }, "Review {{goal}}.");
    const command = await e.start({ template: TPL, goal: "PR 123" });
    expect(command).toMatchObject({ ok: true, data: { leadModelIgnored: "@review" } });
    expect(e.fake.base.spawns).toHaveLength(0); // the command path spawns no lead: the caller IS the lead
    const commandPlaybook = command.data.playbook as string;
    expect(commandPlaybook.split("\n").slice(0, 2)).toEqual([`Template: ${TPL}`, "Goal: PR 123"]);
    expect(commandPlaybook.split("\n")[3]).toMatch(/^Started by the user/);

    const res = await e.restStart({ template: TPL, goal: "PR 123", cwd: e.cwd });
    expect(res.status).toBe(200);
    const team = teams(e).find((t) => t.status === "starting") as Team;
    expect(res.body).toMatchObject({ teamId: team.id, role: "lead" });
    expect(e.fake.base.spawns).toHaveLength(1);
    const spawn = e.fake.base.spawns[0] as unknown as Record<string, any>;
    expect(spawn.initialPrompt).toBeUndefined();
    expect(spawn.model).toBe("@review");
    expect(spawn.pluginRef["agent-teams"]).toMatchObject({ teamId: team.id, role: "lead" });
    expect(spawn.spawnToken).toBe(team.leadSpawnToken);
    expect(team.leadBindDeadline).toBe(e.clock.now() + 30_000);
    expect(team.owner).toBeUndefined(); // no request principal on this call

    const sid = await e.bindLead(team);
    await e.flush();
    const playbooks = e.rt.store.mailLog(team.id).filter((m) => m.kind === "playbook");
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0]).toMatchObject({ from: "server", to: "lead", wake: true, text: commandPlaybook });
    expect(customTypeForKind("playbook")).toBe("agent-teams-playbook");
    const delivered = e.fake.base.emits.filter((m) => m.sessionId === sid && m.eventType === "agent-teams:mail").flatMap((m) => (m.data as { mails: Array<{ kind: string }> }).mails);
    expect(delivered.filter((m) => m.kind === "playbook")).toHaveLength(1);
    expect(only2(e, team).status).toBe("active");
  });

  it("records the request principal as Team.owner and stamps the lead spawn with it", async () => {
    const e = await createStartEnv({ enforced: true });
    lead(e);
    const res = await e.restStart({ template: TPL, goal: "g", cwd: e.cwd }, { "x-principal": "idp|u1" });
    expect(res.status).toBe(200);
    const team = teams(e)[0] as Team;
    expect(team.owner).toBe(e.ownerKey({ iss: "idp", sub: "u1" }));
    expect((e.fake.base.spawns[0] as unknown as Record<string, any>).pluginRef.principalOwner).toEqual({ iss: "idp", sub: "u1" });
  });
});

const only2 = (e: StartEnv, t: Team): Team => e.rt.store.get(t.id) as Team;

describe("server-started lead: its bridge takes the role from the hello reply (3.11)", () => {
  it("registers the lead tool set and receives the playbook as an agent-teams-playbook steer message that triggers its turn", async () => {
    const e = await createStartEnv();
    lead(e, TPL, {}, "Review {{goal}}.");
    await e.restStart({ template: TPL, goal: "PR 9", cwd: e.cwd });
    const team = only(e);
    const sid = e.fake.addSession("S-restlead", { cwd: e.cwd, principalOwner: "owner-p" });
    const { pi, bridge } = linkBridge(e, "restlead");
    expect(bridge.role).toBe("plain"); // no env hint: a freshly spawned lead session starts as a plain one
    e.fake.resolveSession(sid, { "agent-teams": { teamId: team.id, role: "lead" } });
    await pi.fire("session_start");
    await flushAsync();
    expect(bridge.role).toBe("lead");
    expect(pi.activeTeamTools.sort()).toEqual([...new Set([...TEAM_TOOLS_BY_ROLE.plain, ...TEAM_TOOLS_BY_ROLE.lead])].sort());
    const playbook = pi.sent.filter((m) => m.message.customType === "agent-teams-playbook");
    expect(playbook).toHaveLength(1);
    expect(playbook[0]?.options).toEqual({ deliverAs: "steer", triggerTurn: true });
    expect(playbook[0]?.message.content).toBe(formatMail({ kind: "playbook", sender: "server", text: team.template?.playbook as string }));
  });
});

describe("per-team overrides (11.23, #E39)", () => {
  const withIdleMember = async (e: StartEnv, over: Record<string, unknown>) => {
    lead(e, TPL, over);
    await e.start({ template: TPL, goal: "g" });
    const team = only(e);
    e.addMember(team, "alice", "idle");
    return team;
  };

  it.each([
    ["autoDispatch false", { autoDispatch: false }, false],
    ["autoDispatch true", { autoDispatch: true }, true],
    ["autoDispatch absent", {}, true],
  ])("%s: the dispatcher %s hands an unowned task to an idle member; an explicit claim always works", async (_n, over, dispatched) => {
    const e = await createStartEnv();
    const team = await withIdleMember(e, over);
    e.rt.ops.createTask(team, { title: "t1", description: "d" }, { actor: "lead" });
    expect(e.rt.store.task(team, "1")?.owner).toBe(dispatched ? "alice" : undefined);
    if (!dispatched) {
      expect(await e.call("alice", "TaskUpdate", { id: "1", status: "in_progress" })).toMatchObject({ ok: true });
      expect(e.rt.store.task(team, "1")?.owner).toBe("alice");
    }
  });

  it("notify.coalesceMs 500 flushes lead notices at 500 ms, the default window at 2000", async () => {
    const fast = await createStartEnv();
    const t1 = await withIdleMember(fast, { notify: { coalesceMs: 500 } });
    await fast.idle("alice", { settleId: 1, error: "boom" });
    fast.clock.advance(499);
    expect(fast.mailsTo(t1, "lead").filter((m) => m.kind === "notice")).toHaveLength(0);
    fast.clock.advance(1);
    expect(fast.mailsTo(t1, "lead").filter((m) => m.kind === "notice")).toHaveLength(1);

    const slow = await createStartEnv();
    const t2 = await withIdleMember(slow, {});
    await slow.idle("alice", { settleId: 1, error: "boom" });
    slow.clock.advance(500);
    expect(slow.mailsTo(t2, "lead").filter((m) => m.kind === "notice")).toHaveLength(0);
    slow.clock.advance(1500);
    expect(slow.mailsTo(t2, "lead").filter((m) => m.kind === "notice")).toHaveLength(1);
  });

  it("errors, deaths and direct messages still wake the lead under a long notify window", async () => {
    const e = await createStartEnv();
    const team = await withIdleMember(e, { notify: { coalesceMs: 10_000 } });
    e.addMember(team, "bob", "busy");
    await e.idle("alice", { settleId: 1, error: "boom" });
    e.fake.endSession(e.sid("bob")); // death
    expect(await e.call("alice", "SendMessage", { to: "lead", message: "hello lead" })).toMatchObject({ ok: true });
    const direct = e.mailsTo(team, "lead").filter((m) => m.kind === "message");
    expect(direct).toHaveLength(1);
    expect(direct[0]?.wake).toBe(true); // immediate, not held for the window
    e.clock.advance(10_000);
    const notices = e.mailsTo(team, "lead").filter((m) => m.kind === "notice");
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices.every((m) => m.wake)).toBe(true);
    expect(notices.map((m) => m.text).join("\n")).toMatch(/alice.*error/s);
    expect(notices.map((m) => m.text).join("\n")).toMatch(/bob is gone/);
  });
});

describe("spawn modes and the manifest (11.25, #E41)", () => {
  const roster = [{ name: "alice" }, { name: "bob", count: 2 }];
  const spawned = (e: StartEnv): string[] => e.fake.base.spawns.map((s) => (s.name as string).split("/")[1] as string);

  it("spawn omitted = eager: the roster spawns after the lead binds (REST) and at once on the command path", async () => {
    const e = await createStartEnv();
    e.tpl("user", "eager", md({ name: "eager", members: roster }));
    expect(await e.restStart({ template: "eager", goal: "g", cwd: e.cwd })).toMatchObject({ status: 200 });
    await e.flush();
    expect(spawned(e)).toEqual(["lead"]); // only the lead until it binds
    await e.bindLead(only(e));
    await e.flush();
    expect(spawned(e).sort()).toEqual(["alice", "bob-1", "bob-2", "lead"]);

    const e2 = await createStartEnv();
    e2.tpl("user", "eager", md({ name: "eager", members: roster }));
    await e2.start({ template: "eager", goal: "g" });
    await e2.flush();
    expect(spawned(e2).sort()).toEqual(["alice", "bob-1", "bob-2"]);
  });

  it("spawn: lead spawns none and lists the roster in the playbook", async () => {
    const e = await createStartEnv();
    lead(e, "manual", { members: roster });
    const res = await e.start({ template: "manual", goal: "g" });
    await e.flush();
    expect(e.fake.base.spawns).toHaveLength(0);
    expect(res.data.playbook).toMatch(/not spawned yet: spawn each with TeammateSpawn/);
    for (const name of ["alice", "bob-1", "bob-2"]) expect(res.data.playbook).toContain(`- ${name}`);
  });

  it("spawn: bogus is listed invalid with field_invalid and cannot be started", async () => {
    const e = await createStartEnv();
    e.tpl("user", "bogus", md({ name: "bogus", spawn: "bogus" }));
    const listed = await e.templates();
    expect(listed.data.templates[0]).toMatchObject({ valid: false, errors: [expect.objectContaining({ code: "field_invalid" })] });
    expect(await e.start({ template: "bogus", goal: "g" })).toMatchObject({ ok: false, error: "template_invalid" });
  });

  it("the plugin manifest claims no automation editor and no start action (automation deferred, A11)", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"))["pi-dashboard-plugin"] as { claims?: Array<{ slot: string }> };
    expect((manifest.claims ?? []).map((c) => c.slot)).not.toContain("automation-action-editor");
    expect(JSON.stringify(manifest)).not.toContain("agent-teams.start");
  });
});

describe("eager spawn failures (11.27 #X6, 11.28 #X7)", () => {
  /** Host spawn that fails for the listed member names; each answer lands in its own macrotask (like a real host). */
  const failing = (e: StartEnv, names: (member: string) => boolean): void => {
    let n = 0;
    e.fake.base.onSpawn(async (o) => {
      await new Promise((r) => setTimeout(r, 0));
      e.clock.advance(0); // a zero notify window flushes the previous failure before the next one lands
      return names((o.name as string).split("/")[1] as string) ? { success: false, message: "boom" } : { success: true, spawnToken: `m-${++n}` };
    });
  };
  const notices = (e: StartEnv, t: Team) => e.mailsTo(t, "lead").filter((m) => m.kind === "notice");

  it("a rejected spawn and a missing agent file fail only those members; the rest and the team stay up and the lead is woken", async () => {
    const e = await createStartEnv();
    e.tpl("user", "trio", md({ name: "trio", members: [{ name: "m1" }, { name: "m2" }, { name: "m3", agent: "Ghost" }] }));
    failing(e, (m) => m === "m2");
    expect(await e.start({ template: "trio", goal: "g" })).toMatchObject({ ok: true });
    await e.flush();
    e.clock.advance(2000);
    const team = only(e);
    expect(team.status).toBe("active");
    expect(e.rt.store.member(team, "m1")?.status).toBe("spawning");
    expect(e.rt.store.member(team, "m2")).toMatchObject({ status: "failed" });
    expect(e.rt.store.member(team, "m3")).toMatchObject({ status: "failed", goneReason: "spawn failed: agent_not_found" });
    const wake = notices(e, team).filter((m) => m.wake);
    expect(wake.length).toBeGreaterThanOrEqual(1);
    const text = wake.map((m) => m.text).join("\n");
    expect(text).toContain("m2");
    expect(text).toContain("m3 could not be started: agent_not_found");
  });

  const five = Array.from({ length: 5 }, (_, i) => ({ name: `f${i + 1}` }));
  it.each([
    [2000, 1],
    [0, 5],
  ])("five eager spawns failing at once with notify.coalesceMs %i give %i waking notice(s) (spike wake amplification)", async (coalesceMs, wakes) => {
    const e = await createStartEnv();
    e.tpl("user", "five", md({ name: "five", notify: { coalesceMs }, members: five }));
    failing(e, () => true);
    await e.start({ template: "five", goal: "g" });
    await e.flush();
    e.clock.advance(coalesceMs === 0 ? 0 : 2000);
    const team = only(e);
    const waking = notices(e, team).filter((m) => m.wake);
    expect(waking).toHaveLength(wakes);
    if (wakes === 1) for (const m of five) expect(waking[0]?.text).toContain(m.name);
    expect(five.every((m) => e.rt.store.member(team, m.name)?.status === "failed")).toBe(true);
  });
});

describe("the lead never binds (11.29 #X8, 11.35 #R8)", () => {
  const T = 30_000;
  const leadSpawn = (e: StartEnv) => e.fake.base.spawns[0] as unknown as { spawnToken: string };

  it("a lead that resolves after spawnTimeoutMs closes the team lead_spawn_failed, aborts the spawn by token, frees the slot and shows the reason", async () => {
    const e = await createStartEnv({ config: { maxActiveTeams: 1 } });
    lead(e);
    let release: (v: { success: true; spawnToken: string }) => void = () => {};
    e.fake.base.onSpawn(() => new Promise((resolve) => void (release = resolve)));
    expect((await e.restStart({ template: TPL, goal: "g", cwd: e.cwd })).status).toBe(200);
    const team = only(e);
    expect(team.status).toBe("starting");
    e.clock.advance(T - 1);
    expect(only(e).status).toBe("starting");
    e.clock.advance(1);
    expect(only(e)).toMatchObject({ status: "closed", closeReason: "lead_spawn_failed" });
    expect(e.fake.abortedRuns).toEqual([{ spawnToken: team.leadSpawnToken }]);
    release({ success: true, spawnToken: team.leadSpawnToken as string });
    await e.flush();
    expect(e.fake.abortedRuns).toHaveLength(1); // the late resolution does not abort twice
    expect((await e.get(`/teams/${team.id}`)).body).toMatchObject({ status: "closed", closeReason: "lead_spawn_failed" });
    expect((await e.restStart({ template: TPL, goal: "g2", cwd: e.cwd })).status).toBe(200); // cap 1: the slot is free again
  });

  it("a lead that binds one ms before the deadline keeps the team: playbook mail once, eager members once, nothing aborted", async () => {
    const e = await createStartEnv();
    e.tpl("user", "early", md({ name: "early", members: [{ name: "alice" }] }));
    await e.restStart({ template: "early", goal: "g", cwd: e.cwd });
    const team = only(e);
    e.clock.advance(T - 1);
    await e.bindLead(team);
    await e.flush();
    e.clock.advance(5);
    expect(only(e).status).toBe("active");
    expect(e.rt.store.mailLog(team.id).filter((m) => m.kind === "playbook")).toHaveLength(1);
    expect(e.fake.base.spawns.filter((s) => (s.name as string).endsWith("/alice"))).toHaveLength(1);
    expect(e.fake.abortedRuns).toHaveLength(0);
  });

  it("a failed lead spawn closes the team at once", async () => {
    const e = await createStartEnv();
    lead(e);
    e.fake.base.onSpawn(() => ({ success: false, message: "no pi" }));
    await e.restStart({ template: TPL, goal: "g", cwd: e.cwd });
    await e.flush();
    expect(only(e)).toMatchObject({ status: "closed", closeReason: "lead_spawn_failed" });
  });

  it("the user closing a lead-less team aborts its lead spawn", async () => {
    const e = await createStartEnv();
    lead(e);
    await e.restStart({ template: TPL, goal: "g", cwd: e.cwd });
    const team = only(e);
    expect((await e.rest("POST", `/teams/${team.id}/shutdown`)).status).toBeLessThan(300);
    expect(e.fake.abortedRuns).toEqual([{ spawnToken: team.leadSpawnToken }]);
  });

  /** Exactly one outcome whatever the order of bind and deadline (both happen "at" T). */
  const invariant = (e: StartEnv, team: Team, token: string, bound: boolean): void => {
    const t = e.rt.store.get(team.id) as Team;
    const playbooks = e.rt.store.mailLog(team.id).filter((m) => m.kind === "playbook").length;
    const members = e.fake.base.spawns.filter((s) => (s.name as string).endsWith("/alice")).length;
    if (bound) {
      expect(t).toMatchObject({ status: "active" });
      expect(t.leadSessionId).toBeDefined();
      expect([playbooks, members, e.fake.abortedRuns.length]).toEqual([1, 1, 0]);
    } else {
      expect(t).toMatchObject({ status: "closed", closeReason: "lead_spawn_failed" });
      expect(t.leadSessionId).toBeUndefined();
      expect([playbooks, members]).toEqual([0, 0]);
      expect(e.fake.abortedRuns).toEqual([{ spawnToken: token }]);
    }
  };
  it.each([
    ["T-1: the lead binds a millisecond before the deadline", T - 1, "before", true],
    ["T: the bind is queued BEFORE the deadline timer", T, "before", true],
    ["T: the bind is queued AFTER the deadline timer", T, "after", false],
    ["T+1: the bind arrives after the deadline", T + 1, "after", false],
  ] as const)("bind vs deadline tie — %s", async (_n, bindAt, queued, bound) => {
    const e = await createStartEnv();
    e.tpl("user", "tie", md({ name: "tie", members: [{ name: "alice" }] }));
    const sid = e.fake.addSession("S-late", { cwd: e.cwd });
    let teamId = "";
    const bind = (): void => e.fake.resolveSession(sid, { "agent-teams": { teamId, role: "lead" } });
    // Timers of equal due time fire in creation order: schedule the bind before or after the start arms its deadline.
    const schedule = (): void => void e.clock.setTimeout(bind, bindAt);
    if (queued === "before") schedule();
    await e.restStart({ template: "tie", goal: "g", cwd: e.cwd });
    if (queued === "after") schedule();
    const team = only(e);
    teamId = team.id;
    const token = leadSpawn(e).spawnToken;
    e.clock.advance(T + 5);
    await e.fake.lane(sid, "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false }).catch(() => undefined);
    await e.flush();
    invariant(e, team, token, bound);
  });
});

describe("confined / duplicate / nested starts (11.31 #X15, 11.36 #R10)", () => {
  it("only a plain, unconfined session under the team cap may start; every refusal creates nothing", async () => {
    const e = await createStartEnv({ config: { maxActiveTeams: 2 } });
    lead(e, TPL, { members: [{ name: "alice" }] });
    const created = vi.spyOn(e.rt.ops, "createTeam");
    const leadSession = e.newSession();
    expect(await e.fake.call(leadSession, "TeamCreate", { name: "mine" })).toMatchObject({ ok: true });
    const team = only(e);
    e.addMember(team, "tm", "idle");
    const confined = e.fake.addSession("S-confined", { cwd: e.cwd, pluginRefs: { "chat-gateway": { x: 1 } } });
    const calls = created.mock.calls.length;
    expect(await e.start({ template: TPL, goal: "g" }, leadSession)).toMatchObject({ ok: false, error: "already_in_team" });
    expect(await e.fake.call(e.sid("tm"), "team.start", { template: TPL, goal: "g" })).toMatchObject({ ok: false, error: "nested_team_forbidden" });
    expect(await e.start({ template: TPL, goal: "g" }, confined)).toMatchObject({ ok: false, error: "lead_confined" });
    expect(created.mock.calls.length).toBe(calls);
    expect(teams(e)).toHaveLength(1);
    expect(e.fake.base.spawns).toHaveLength(0);

    expect(await e.start({ template: TPL, goal: "g" })).toMatchObject({ ok: true }); // a plain session
    expect(teams(e)).toHaveLength(2);
    expect(await e.start({ template: TPL, goal: "g" })).toMatchObject({ ok: false, error: "team_cap_reached" });
    expect(teams(e)).toHaveLength(2);
  });

  it("two starts from one session in the same tick make one team and one already_in_team", async () => {
    const e = await createStartEnv();
    lead(e);
    const sid = e.newSession();
    const [a, b] = await Promise.all([e.start({ template: TPL, goal: "g" }, sid), e.start({ template: TPL, goal: "g" }, sid)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)?.error).toBe("already_in_team");
    expect(teams(e)).toHaveLength(1);
  });

  it("REST double submit is not deduplicated: two teams up to maxActiveTeams, the third is team_cap_reached", async () => {
    const e = await createStartEnv({ config: { maxActiveTeams: 2 } });
    lead(e);
    const body = { template: TPL, goal: "g", cwd: e.cwd };
    const [a, b] = await Promise.all([e.restStart(body), e.restStart(body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(teams(e)).toHaveLength(2);
    expect(await e.restStart(body)).toMatchObject({ status: 409, body: { ok: false, error: "team_cap_reached" } });
    expect(teams(e)).toHaveLength(2);
  });
});

describe("end to end: template + eager roster + plan approval + a blocking TaskCompleted hook (11.50, #I3)", () => {
  it("scripted lead / alice / bob run to completion: alice stays read-only until approved, TaskCompleted blocks once then passes, the lead sees every mail, the team closes with no leaked hook child", async () => {
    const e = await createStartEnv();
    const mark = path.join(e.root, "mark");
    const pids = path.join(e.root, "pids");
    e.tpl(
      "user",
      "squad",
      md({
        name: "squad",
        members: [{ name: "alice", requirePlanApproval: true }, { name: "bob" }],
        hooks: { TaskCompleted: [{ command: `echo $$ >> ${pids}; if [ -f ${mark} ]; then exit 0; fi; touch ${mark}; echo "tests failing" >&2; exit 2` }] },
      }),
    );
    const leadSid = e.newSession();
    expect(await e.start({ template: "squad", goal: "ship the feature" }, leadSid)).toMatchObject({ ok: true });
    await e.flush();
    const team = only(e);
    expect(e.fake.base.spawns.map((s) => (s.name as string).split("/")[1]).sort()).toEqual(["alice", "bob"]);
    expect(e.rt.store.member(team, "alice")).toMatchObject({ requirePlanApproval: true, planApproval: "planning" });
    expect(e.rt.store.member(team, "alice")?.hold).toBeDefined();
    expect(e.rt.store.member(team, "bob")?.planApproval).toBeUndefined();

    // The two spawned sessions register and say hello (a plan-mode member reports its narrowed tools).
    const hello = async (name: string, extra: Record<string, unknown> = {}) => {
      const sid = e.fake.addSession(e.sid(name), { cwd: e.cwd });
      e.fake.resolveSession(sid, { "agent-teams": { teamId: team.id, member: name, role: "member" } });
      const m = e.rt.store.member(only(e), name);
      return e.fake.lane(sid, "agent-teams/hello", { isIdle: false, toolsActive: true, guardActive: true, confined: false, ...(m?.policyHash ? { policyHash: m.policyHash } : {}), ...extra });
    };
    expect((await hello("alice", { planToolsActive: true })).data).toMatchObject({ role: "member", planMode: { active: true } });
    expect((await hello("bob")).data).toMatchObject({ role: "member" });
    expect(e.rt.store.member(only(e), "alice")?.degraded).toBeUndefined();

    // The lead plans the work; bob's task is assigned, alice (read-only) is never handed work.
    expect(await e.fake.call(leadSid, "TaskCreate", { title: "build", description: "build it", owner: "bob" })).toMatchObject({ ok: true });
    expect(await e.fake.call(leadSid, "TaskCreate", { title: "docs", description: "write docs" })).toMatchObject({ ok: true });
    await e.idle("bob", { settleId: 1 });
    expect(e.rt.store.task(only(e), "2")?.owner).toBeUndefined();
    await e.idle("alice", { settleId: 1 });
    expect(e.rt.store.task(only(e), "2")?.owner).toBeUndefined(); // alice is on hold while she plans

    // TaskCompleted: the hook blocks the first completion (task stays in progress), the retry passes.
    const done = () => e.call("bob", "TaskUpdate", { id: "1", status: "completed", result: "built" });
    expect(await done()).toMatchObject({ ok: false, error: "hook_blocked", message: expect.stringContaining("tests failing") });
    expect(e.rt.store.task(only(e), "1")?.status).toBe("in_progress");
    expect(await done()).toMatchObject({ ok: true });
    expect(e.rt.store.task(only(e), "1")?.status).toBe("completed");

    // alice submits a plan; until the lead approves she stays in plan mode, afterwards she is unrestricted and gets work.
    expect(await e.call("alice", "PlanSubmit", { plan: "I will write the docs" })).toMatchObject({ ok: true, data: { planId: "p1" } });
    expect((await e.fake.lane(e.sid("alice"), "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false, planToolsActive: true, policyHash: e.rt.store.member(only(e), "alice")?.policyHash })).data).toMatchObject({ planMode: { active: true } });
    expect(await e.fake.call(leadSid, "PlanDecision", { member: "alice", planId: "p1", approve: true })).toMatchObject({ ok: true, data: { status: "approved" } });
    expect((await e.fake.lane(e.sid("alice"), "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false, planToolsActive: true, policyHash: e.rt.store.member(only(e), "alice")?.policyHash })).data).toMatchObject({ planMode: { active: false } });
    await e.idle("alice", { settleId: 2 }); // the approved member finishes its turn: now the dispatcher may hand it work
    expect(e.rt.store.task(only(e), "2")?.owner).toBe("alice");
    expect(await e.call("alice", "TaskUpdate", { id: "2", status: "completed", result: "documented" })).toMatchObject({ ok: true });

    // The lead was told everything that happened, in mail-id order.
    e.clock.advance(2000);
    const toLead = e.rt.store.mailLog(team.id).filter((m) => m.to === "lead");
    expect(toLead.some((m) => m.kind === "plan_request" && m.text.includes("plan p1 · team"))).toBe(true);
    expect(toLead.map((m) => m.text).join("\n")).toMatch(/bob.*completed|completed.*bob|task 1/i);
    expect(toLead.map((m) => m.id)).toEqual([...toLead.map((m) => m.id)].sort((a, b) => a - b));
    expect(only(e).plans?.[0]).toMatchObject({ status: "approved", decidedBy: "lead" });

    // Close cleanly: every member is shut down and no hook child survives.
    expect(await e.fake.call(leadSid, "TeamDelete", { force: true })).toMatchObject({ ok: true });
    e.clock.advance(10_000);
    await e.flush();
    expect(only(e).status).toBe("closed");
    expect(e.fake.base.shutdowns.sort()).toEqual([e.sid("alice"), e.sid("bob")]);
    const alive = fs
      .readFileSync(pids, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(Number)
      .filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    expect(alive).toEqual([]);
    expect(e.rt.counters.get("plansApproved", team.id)).toBe(1);
    expect(e.rt.counters.get("hook_runs", team.id)).toBeGreaterThanOrEqual(3);
  });
});
