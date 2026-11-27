/**
 * An agent can never add or change a hook (design D7 "frozen at start"): extra `hooks` / `trustHooks` /
 * `command` arguments on every team tool are rejected or ignored, `team.hooks` stays byte-identical, no
 * tool is named like start/trust, and `team.start` is refused for a lead / teammate.
 * See change: add-agent-teams-templates-hooks (test-plan #S3).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTeamsEnv } from "../../__tests__/harness/index.js";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import type { TeamHooks } from "../../shared/types.js";
import { setHookIoOverride } from "../hooks.js";

afterEach(() => setHookIoOverride(undefined));

const FROZEN: TeamHooks = { TaskCompleted: [{ command: "true", timeoutMs: 5000 }] };
const INJECTED = { hooks: { TaskCreated: [{ command: "touch /tmp/pwned" }] }, trustHooks: "deadbeef", command: "touch /tmp/pwned" };

describe("hook injection by an agent (12.27, #S3)", () => {
  it("extra hooks/trustHooks/command args on every team tool leave team.hooks byte-identical", async () => {
    // A hook child that would run must never spawn here: fail the spawn loudly.
    setHookIoOverride({
      spawn: () => {
        throw new Error("no hook may spawn");
      },
    });
    const env = createTeamsEnv();
    const team = await env.createTeam();
    env.rt.store.patchTeam(team.id, { hooks: FROZEN });
    env.addMember(team, "bob", "busy");
    const before = JSON.stringify(env.rt.store.get(team.id)?.hooks);
    const created = await env.call("lead", "TaskCreate", { title: "t", description: "d", ...INJECTED });
    const calls = [
      await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go", ...INJECTED }),
      created,
      await env.call("lead", "TaskUpdate", { id: "1", title: "renamed", ...INJECTED }),
      await env.call("lead", "SendMessage", { to: "bob", text: "hi", ...INJECTED }),
      await env.call("lead", "PlanDecision", { member: "bob", planId: "p1", approve: true, ...INJECTED }),
      await env.call("bob", "TaskCreate", { title: "u", description: "d", ...INJECTED }),
    ];
    for (const res of calls) expect(res).toEqual(expect.objectContaining({ ok: expect.any(Boolean) })); // answered, no throw
    const after = env.rt.store.get(team.id) as NonNullable<ReturnType<typeof env.rt.store.get>>;
    expect(JSON.stringify(after.hooks)).toBe(before);
    expect(after.template).toBeUndefined();
    for (const m of after.members) expect(Object.keys(m)).not.toEqual(expect.arrayContaining(["hooks"]));
    for (const t of after.tasks) expect(JSON.stringify(t)).not.toContain("pwned");
  });

  it("TeamCreate with a hooks argument creates a team without hooks", async () => {
    const env = createTeamsEnv();
    const plain = env.fake.addSession("S-plain", { cwd: "/work" });
    const res = await env.fake.call(plain, "TeamCreate", { name: "beta", ...INJECTED });
    if (res.ok) expect(env.rt.store.get(res.data.teamId)?.hooks).toBeUndefined();
    else expect(res.error).toBe("invalid_args"); // rejected by the schema is equally fine
    expect(env.rt.store.list().every((t) => t.hooks === undefined)).toBe(true);
  });

  it("no tool of any role is a start / trust / hook entry point", () => {
    const all = Object.values(TEAM_TOOLS_BY_ROLE).flat() as string[];
    expect(all.filter((name) => /start|trust|hook|template/i.test(name))).toEqual([]);
    expect(all).not.toContain("team.start");
    expect(all).not.toContain("team.templates");
  });

  it("team.start from a lead or teammate is refused before any handler runs (already_in_team / nested_team_forbidden)", async () => {
    const env = createTeamsEnv();
    try {
      env.rt.ops.registerStartOp("team.start", () => ({ ok: true, data: { started: true } }));
    } catch {
      // the real start module is already registered on this runtime
    }
    const team = await env.createTeam();
    env.addMember(team, "alice");
    expect(await env.call("lead", "team.start", { template: "t", goal: "g", trustHooks: "x" })).toMatchObject({ ok: false, error: "already_in_team" });
    expect(await env.call("alice", "team.start", { template: "t", goal: "g", trustHooks: "x" })).toMatchObject({ ok: false, error: "nested_team_forbidden" });
  });
});
