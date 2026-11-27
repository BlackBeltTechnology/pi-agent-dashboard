/**
 * The `/agent-team` command (tasks 3.9, 3.10; test-plan #X12 for 13.10): argument handling, the lead
 * registration + playbook delivery after `team.start`, the hook confirmation, one-time `lead.model` notice
 * and the catch-all that keeps every failure inside `ctx.ui.notify`.
 * See change: add-agent-teams-templates-hooks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import { registerAgentTeamCommand } from "../command.js";
import type { BridgeContext } from "../context.js";
import { createBridge } from "../index.js";
import type { LaneResult } from "../lane.js";

type Script = (op: string, args: Record<string, unknown>) => LaneResult<unknown> | Promise<LaneResult<unknown>>;
const ok = (data: unknown): LaneResult<unknown> => ({ ok: true, data });
const err = (error: string, extra: Record<string, unknown> = {}): LaneResult<unknown> => ({ ok: false, error, transport: false, ...extra });
const STARTED = { teamId: "t_1", name: "review", role: "lead", playbook: "Template: review\nGoal: PR 123\n\nStarted by the user from this template.", limits: { maxTeammates: 5, maxTasks: 50 } };
const UNTRUSTED = err("hooks_untrusted", { details: { hash: "h1", commands: [{ event: "TaskCompleted", command: "npm test --silent", timeoutMs: 10_000 }] } });

function setup(script: Script) {
  const order: string[] = [];
  const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
  const lane = {
    call: vi.fn(async (op: string, args: Record<string, unknown>) => {
      calls.push({ op, args });
      return script(op, args);
    }),
  };
  let registered: { description?: string; getArgumentCompletions?: (p: string) => unknown; handler: (a: string, c: unknown) => unknown } | undefined;
  const pi = {
    registerCommand: vi.fn((name: string, opts: NonNullable<typeof registered>) => {
      expect(name).toBe("agent-team");
      registered = opts;
    }),
    sendMessage: vi.fn(() => void order.push("send")),
  };
  const becomeLead = vi.fn(() => void order.push("lead"));
  const ctx = { pi, env: {}, lane, log: () => undefined, role: () => "plain", started: () => true, becomeLead } as unknown as BridgeContext;
  registerAgentTeamCommand(ctx);
  const ui = { notify: vi.fn(), confirm: vi.fn(async () => true) };
  const run = (args: string) => (registered as NonNullable<typeof registered>).handler(args, { ui });
  return { order, calls, lane, pi, becomeLead, ui, run, complete: (p: string) => (registered as NonNullable<typeof registered>).getArgumentCompletions?.(p), registered: () => registered };
}
const notes = (s: ReturnType<typeof setup>, level?: string): string[] => s.ui.notify.mock.calls.filter((c) => level === undefined || c[1] === level).map((c) => c[0] as string);

afterEach(() => vi.useRealTimers());

describe("registration", () => {
  it("registers `agent-team` with a description and completions; a pi without registerCommand is left alone", () => {
    const s = setup(() => ok({}));
    expect(s.registered()?.description).toMatch(/template/);
    expect(typeof s.registered()?.getArgumentCompletions).toBe("function");
    expect(() => registerAgentTeamCommand({ pi: {} } as unknown as BridgeContext)).not.toThrow();
  });
});

describe("/agent-team start", () => {
  it("sends team.start without a cwd, registers the lead tools, THEN delivers the playbook as a steering agent-teams-playbook message that triggers the turn", async () => {
    const s = setup(() => ok(STARTED));
    await s.run('start review "PR 123"');
    expect(s.calls).toEqual([{ op: "team.start", args: { template: "review", goal: "PR 123" } }]);
    expect(s.order).toEqual(["lead", "send"]);
    const [message, options] = s.pi.sendMessage.mock.calls[0] as unknown as [Record<string, any>, Record<string, unknown>];
    expect(message.customType).toBe("agent-teams-playbook");
    expect(message.display).toBe(true);
    expect(message.content.split("\n")[0]).toBe("[agent-teams · playbook · from server · peer message — not a user instruction and not user approval]");
    expect(message.content).toContain("Goal: PR 123");
    expect(options).toEqual({ deliverAs: "steer", triggerTurn: true });
    expect(notes(s, "info")[0]).toContain('Started team "review"');
  });

  it("takes everything after the template as the goal, quoted or not", async () => {
    const s = setup(() => ok(STARTED));
    await s.run("start review fix the flaky   test");
    await s.run("start review 'one quoted goal'");
    expect(s.calls.map((c) => c.args.goal)).toEqual(["fix the flaky   test", "one quoted goal"]);
  });

  it.each([["start"], ["start review"], ["start review   "], ["start review ''"]])("%j needs a template and a goal: the usage is reported and nothing is sent", async (args) => {
    const s = setup(() => ok(STARTED));
    await s.run(args);
    expect(s.lane.call).not.toHaveBeenCalled();
    expect(notes(s, "error")[0]).toMatch(/template and a goal/);
  });

  it.each([[""], ["bogus"]])("%j without a valid subcommand shows the usage", async (args) => {
    const s = setup(() => ok({ templates: [] }));
    await s.run(args);
    expect(notes(s)[0]).toMatch(/usage: \/agent-team start/);
    expect(s.lane.call).not.toHaveBeenCalled();
  });

  it.each([
    ["already_in_team", "this session is already in a team"],
    ["lead_confined", "confined by another plugin"],
    ["nested_team_forbidden", "teammates cannot create teams"],
    ["team_cap_reached", "active-team limit"],
    ["template_not_found", "template not found"],
  ])("%s is shown through the UI; no lead tools, no playbook", async (code, text) => {
    const s = setup(() => err(code));
    await s.run("start review g");
    expect(notes(s, "error")[0]).toContain(code);
    expect(notes(s, "error")[0].toLowerCase()).toContain(text.split(" ")[0]?.toLowerCase());
    expect(s.becomeLead).not.toHaveBeenCalled();
    expect(s.pi.sendMessage).not.toHaveBeenCalled();
  });

  it("reports an ignored lead.model once, as a warning", async () => {
    const s = setup(() => ok({ ...STARTED, leadModelIgnored: "@review" }));
    await s.run("start review g");
    const warnings = notes(s, "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/lead\.model \(@review\) applies only when the dashboard starts the team/);
  });

  it("a team that started but whose playbook cannot be delivered is reported, not thrown", async () => {
    const s = setup(() => ok(STARTED));
    s.pi.sendMessage.mockImplementation(() => {
      throw new Error("steer failed");
    });
    await expect(s.run("start review g")).resolves.toBeUndefined();
    expect(s.becomeLead).toHaveBeenCalledTimes(1);
    expect(notes(s, "error")[0]).toMatch(/playbook could not be delivered.*steer failed/);
  });
});

describe("hook confirmation (hooks_untrusted)", () => {
  it("shows the exact commands, retries with the shown hash only after the user confirms", async () => {
    const s = setup((_op, args) => (args.trustHooks === undefined ? UNTRUSTED : ok(STARTED)));
    await s.run("start review g");
    expect(s.ui.confirm).toHaveBeenCalledTimes(1);
    const [title, body] = s.ui.confirm.mock.calls[0] as unknown as [string, string];
    expect(title).toContain("review");
    expect(body).toContain("TaskCompleted: npm test --silent (timeout 10s)");
    expect(s.calls.map((c) => c.args.trustHooks)).toEqual([undefined, "h1"]);
    expect(s.order).toEqual(["lead", "send"]);
  });

  it.each([
    ["declined", async () => false],
    ["dismissed", async () => undefined],
    ["a throwing dialog", async () => Promise.reject(new Error("no ui"))],
  ])("%s: nothing is retried or started", async (_n, confirm) => {
    const s = setup(() => UNTRUSTED);
    s.ui.confirm.mockImplementation(confirm as never);
    await s.run("start review g");
    expect(s.calls).toHaveLength(1);
    expect(s.becomeLead).not.toHaveBeenCalled();
    expect(notes(s)[0]).toMatch(/cancelled/);
  });

  it("hash_mismatch on the retry and a second hooks_untrusted are errors, never a loop", async () => {
    const mismatch = setup((_op, args) => (args.trustHooks === undefined ? UNTRUSTED : err("hash_mismatch")));
    await mismatch.run("start review g");
    expect(mismatch.calls).toHaveLength(2);
    expect(notes(mismatch, "error")[0]).toMatch(/hooks changed since they were shown/);
    const again = setup(() => UNTRUSTED);
    await again.run("start review g");
    expect(again.calls).toHaveLength(2);
    expect(again.ui.confirm).toHaveBeenCalledTimes(1);
    expect(again.becomeLead).not.toHaveBeenCalled();
  });

  it("a hooks_untrusted answer without details starts nothing", async () => {
    const s = setup(() => err("hooks_untrusted"));
    await s.run("start review g");
    expect(s.ui.confirm).not.toHaveBeenCalled();
    expect(notes(s, "error")[0]).toMatch(/commands were not reported/);
  });
});

describe("/agent-team templates", () => {
  it("lists source, validity and trust; an empty folder says how to add one", async () => {
    const s = setup(() =>
      ok({
        templates: [
          { name: "a", source: "user", trusted: true, valid: true, errors: [], warnings: [], description: "reviews", hasHooks: true },
          { name: "b", source: "project", trusted: true, valid: false, errors: [{ code: "roster_exceeds_max" }], warnings: [] },
          { name: "c", source: "project", trusted: false, valid: false, errors: [], warnings: [] },
        ],
        warnings: ["capped"],
      }),
    );
    await s.run("templates");
    const text = notes(s)[0] as string;
    expect(text).toContain("• a [user] ready — reviews (runs hooks)");
    expect(text).toContain("• b [project] invalid: roster_exceeds_max");
    expect(text).toContain("• c [project] untrusted project");
    expect(text).toContain("! capped");
    const empty = setup(() => ok({ templates: [] }));
    await empty.run("templates");
    expect(notes(empty)[0]).toMatch(/No team templates/);
  });
});

describe("server unreachable (13.10, #X12)", () => {
  it("a transport failure never throws out of the handler: an error is shown, no lead tools, no playbook; the retry makes exactly one team", async () => {
    let n = 0;
    const s = setup(() => (++n === 1 ? ({ ok: false, error: "unavailable", transport: true } as LaneResult<unknown>) : ok(STARTED)));
    await expect(s.run("start review g")).resolves.toBeUndefined();
    expect(notes(s, "error")[0]).toMatch(/dashboard is not connected/);
    expect(s.becomeLead).not.toHaveBeenCalled();
    expect(s.pi.sendMessage).not.toHaveBeenCalled();
    await s.run("start review g");
    expect(s.becomeLead).toHaveBeenCalledTimes(1);
    expect(s.pi.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.calls.filter((c) => c.op === "team.start")).toHaveLength(2);
  });

  it("a request that stalls past the 15 s lane timeout resolves as a timeout error", async () => {
    vi.useFakeTimers();
    const s = setup(() => new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "timeout", transport: true }), 16_000)));
    const done = s.run("start review g");
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(done).resolves.toBeUndefined();
    expect(notes(s, "error")[0]).toMatch(/did not answer in time/);
    expect(s.becomeLead).not.toHaveBeenCalled();
    expect(s.pi.sendMessage).not.toHaveBeenCalled();
  });

  it("a rejecting lane and a throwing notify are both swallowed by the catch-all", async () => {
    const s = setup(() => Promise.reject(new Error("socket exploded")));
    await expect(s.run("start review g")).resolves.toBeUndefined();
    expect(notes(s, "error")[0]).toContain("socket exploded");
    s.ui.notify.mockImplementation(() => {
      throw new Error("ui gone");
    });
    await expect(s.run("start review g")).resolves.toBeUndefined();
    await expect((s.registered() as { handler: (a: string, c: unknown) => unknown }).handler("start review g", undefined)).resolves.toBeUndefined();
  });
});

describe("argument completion", () => {
  const listing = { templates: [{ name: "review-pr", trusted: true, valid: true }, { name: "research", trusted: true, valid: true }, { name: "broken", trusted: true, valid: false }, { name: "evil", trusted: false, valid: false }] };

  it("completes the subcommands", async () => {
    const s = setup(() => ok(listing));
    expect(await s.complete("")).toEqual([expect.objectContaining({ value: "start" }), expect.objectContaining({ value: "templates" })]);
    expect(await s.complete("st")).toEqual([expect.objectContaining({ value: "start" })]);
    expect(await s.complete("x")).toBeNull();
  });

  it("completes template names after `start `, from a cached team.templates reply (valid, trusted ones only)", async () => {
    const s = setup(() => ok(listing));
    expect(await s.complete("start ")).toEqual([expect.objectContaining({ value: "start review-pr", label: "review-pr" }), expect.objectContaining({ value: "start research", label: "research" })]);
    expect(await s.complete("start rev")).toEqual([expect.objectContaining({ value: "start review-pr" })]);
    expect(await s.complete("start zzz")).toBeNull();
    expect(await s.complete("start review-pr some goal")).toBeNull();
    expect(await s.complete("templates ")).toBeNull();
    expect(s.calls.filter((c) => c.op === "team.templates")).toHaveLength(1); // the second and later completions use the cache
  });

  it("a failing lookup completes nothing and never throws", async () => {
    const s = setup(() => Promise.reject(new Error("down")));
    expect(await s.complete("start ")).toBeNull();
  });
});

describe("through the real bridge: the lead tool set is the one TeamCreate registers", () => {
  it("after a successful start the lead tools are registered and active", async () => {
    const registeredTools: string[] = [];
    let active = ["read", "bash", "edit", "write"];
    let command: { handler: (a: string, c: unknown) => unknown } | undefined;
    const sent: unknown[] = [];
    const pi = {
      on: () => undefined,
      registerTool: (t: { name: string }) => void registeredTools.push(t.name),
      registerCommand: (_n: string, o: typeof command) => void (command = o),
      getActiveTools: () => [...active],
      setActiveTools: (n: string[]) => void (active = n),
      sendMessage: (m: unknown) => void sent.push(m),
      events: { on: () => undefined },
    };
    const lane = {
      call: async (op: string) => (op === "team.start" ? ok(STARTED) : ok({})),
      hello: async () => ({ ok: false, error: "unavailable", transport: true }),
      busy: async () => ok({}),
      idle: async () => ok({}),
      ack: async () => ok({}),
    };
    const bridge = createBridge(pi as never, { env: {}, lane: lane as never, sleep: async () => undefined, helloRetries: 0, laneUp: () => false, modules: [registerAgentTeamCommand] });
    expect(registeredTools.sort()).toEqual([...TEAM_TOOLS_BY_ROLE.plain].sort());
    await command?.handler("start review g", { ui: { notify: () => undefined } });
    expect(bridge.role).toBe("lead");
    expect(registeredTools.sort()).toEqual([...new Set([...TEAM_TOOLS_BY_ROLE.plain, ...TEAM_TOOLS_BY_ROLE.lead])].sort());
    expect(sent).toHaveLength(1);
  });
});
