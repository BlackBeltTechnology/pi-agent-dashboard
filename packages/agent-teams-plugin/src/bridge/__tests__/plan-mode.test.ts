/**
 * Plan mode, bridge side, against the REAL server handlers (tasks 13.7, 13.9, 13.13, 13.16, 13.19, 13.20, 13.23;
 * test-plan #E34 #X11 #R9 #D6 #S6 #S7 #I1): narrowing at `session_start` from `getAllTools ∩ planModeTools ∪ team tools ∪
 * PlanSubmit`, the `tool_call` backstop, the hello-driven restore, reload re-derivation, batched mail and the env fail-safe.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTeamsEnv, fauxPiAvailable, flushAsync, linkBridge, startRealPiLink, TEAMMATE_ACK, type TeamsEnv } from "../../__tests__/harness/index.js";
import { createConfigReader, PLAN_MODE_ALLOWED_TOOLS } from "../../server/config.js";
import { decidePlan, type PlansDeps } from "../../server/plans.js";
import { systemClock } from "../../shared/clock.js";
import { ENV_PLAN_MODE_TOOLS, PLAN_HOLD, PLAN_READONLY_TOOLS, PLAN_SUBMIT_TOOL, serializePlanTools } from "../../shared/plan-mode.js";
import { ENV_COMMITTER, ENV_MEMBER, ENV_PLAN_MODE, ENV_POLICY, ENV_TEAM_ID } from "../../shared/policy.js";
import { TEAM_TOOLS_BY_ROLE } from "../../shared/protocol.js";
import type { Team } from "../../shared/types.js";
import type { BridgeContext } from "../context.js";
import { computePlanTools, planAllowedTools, registerPlanMode } from "../plan-mode.js";

const MEMBER = TEAM_TOOLS_BY_ROLE.member as readonly string[];
const BUILTIN = ["read", "bash", "edit", "write", "grep", "find", "ls"];
/** Ten registered tools besides the team tools: the built-ins plus MCP/extension ones. */
const ALL_NON_TEAM = [...BUILTIN, "mcp__x__search", "mcp__x__delete", "custom_ext"];
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

type Env = Record<string, string | undefined>;

/** The env a spawned plan member gets: the spawn `extensionConfig` projected like the host does + the plan hint. */
function memberEnv(env: TeamsEnv, plan: { hint?: string; tools?: string } = {}): Env {
  const scope = env.fake.base.spawns.at(-1)?.scope as { extensionConfig: Record<string, Record<string, string>> };
  const ext = scope.extensionConfig["agent-teams"] as Record<string, string>;
  return {
    [ENV_TEAM_ID]: ext.teamId,
    [ENV_MEMBER]: ext.member,
    [ENV_POLICY]: ext.policy,
    [ENV_COMMITTER]: ext.committer,
    ...(plan.hint !== undefined ? { [ENV_PLAN_MODE]: plan.hint } : {}),
    ...(plan.tools !== undefined ? { [ENV_PLAN_MODE_TOOLS]: plan.tools } : {}),
  };
}

interface Opts {
  hint?: string;
  tools?: string;
  /** Server-side state of alice (default `planning`); `none` = not a plan member. */
  state?: "planning" | "pending" | "approved" | "none";
  serverTools?: string[];
}

/** Spawn alice (core path), put her in plan mode on the server and link her real bridge. */
async function planMemberBridge(over: Opts = {}) {
  const env = createTeamsEnv();
  const team = await env.createTeam();
  expect(await env.call("lead", "TeammateSpawn", { name: "alice", prompt: "go" })).toMatchObject({ ok: true });
  env.fake.addSession("S-alice", { cwd: "/work", sessionFile: "/sessions/alice.jsonl" });
  env.fake.resolveSession("S-alice", { "agent-teams": { teamId: team.id, member: "alice", role: "member" } });
  const state = over.state ?? "planning";
  if (state !== "none") {
    env.rt.store.patchMember(team.id, "alice", {
      requirePlanApproval: true,
      planApproval: state,
      ...(state === "approved" ? {} : { hold: PLAN_HOLD }),
      tools: over.serverTools ?? [...BUILTIN, "mcp__x__search", ...MEMBER],
    });
  }
  const link = (hintEnv: Env) => {
    const b = linkBridge(env, "alice", { env: hintEnv });
    b.pi.builtinTools = [...ALL_NON_TEAM];
    return b;
  };
  const hintEnv = memberEnv(env, { ...(over.hint !== undefined ? { hint: over.hint } : state !== "none" ? { hint: "1" } : {}), ...(over.tools !== undefined ? { tools: over.tools } : {}) });
  const b = link(hintEnv);
  return { env, team, hintEnv, link, ...b };
}

type Pi = ReturnType<typeof linkBridge>["pi"];
/** Run pi's `tool_call` handlers: a `{block:true}` from any is a refusal. */
async function toolCall(pi: Pi, toolName: string, input: unknown = {}): Promise<{ blocked: boolean; reason?: string }> {
  const results = await pi.fire("tool_call", { toolName, input });
  const hit = results.find((r) => (r as { block?: boolean } | undefined)?.block === true) as { reason?: string } | undefined;
  return { blocked: hit !== undefined, ...(hit?.reason ? { reason: hit.reason } : {}) };
}

const helloCount = (requests: Array<{ type: string }>): number => requests.filter((r) => r.type === "agent-teams/hello").length;
const planDeps = (env: TeamsEnv): PlansDeps => {
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  return { ops: env.rt.ops, store: env.rt.store, config: createConfigReader(() => env.fake.host.getPluginConfig<Record<string, unknown>>(), logger), logger, clock: env.clock, counters: env.rt.counters };
};
const approve = (env: TeamsEnv, team: Team, planId: string, ok = true, feedback?: string) =>
  decidePlan(planDeps(env), { team, member: "alice", planId, approve: ok, ...(feedback ? { feedback } : {}), actor: { kind: "lead" } });

describe("pure helpers", () => {
  it("computePlanTools: (all ∩ planModeTools) ∪ team tools ∪ PlanSubmit; without getAllTools the config list is used", () => {
    expect(computePlanTools(ALL_NON_TEAM, ["read", "grep"], ["TaskList"])).toEqual(["read", "grep", "TaskList", PLAN_SUBMIT_TOOL]);
    expect(computePlanTools(["read"], ["read", "grep"], [])).toEqual(["read", PLAN_SUBMIT_TOOL]);
    expect(computePlanTools(undefined, ["read", "ls"], ["TaskList"])).toEqual(["read", "ls", "TaskList", PLAN_SUBMIT_TOOL]);
  });

  it("planAllowedTools is exact-name, holds no lead-only tool and mirrors the server read-only list", () => {
    const allowed = planAllowedTools(["read"]);
    for (const t of ["read", "PlanSubmit", "TaskList", "SendMessage"]) expect(allowed.has(t)).toBe(true);
    for (const t of ["Read", "READ", "write", "PlanDecision", "TeammateSpawn", "ShutdownRequest", "TeamDelete"]) expect(allowed.has(t)).toBe(false);
    expect([...PLAN_READONLY_TOOLS]).toEqual([...PLAN_MODE_ALLOWED_TOOLS]);
  });

  it("an env list with bash/write/edit/unknown names is sanitised and the dropped names are logged", () => {
    const logs: string[] = [];
    const handlers = new Map<string, unknown>();
    const ctx = {
      pi: { on: (n: string, h: unknown) => void handlers.set(n, h) },
      env: { [ENV_PLAN_MODE]: "1", [ENV_PLAN_MODE_TOOLS]: '["read","bash","write","edit","nope"]' },
      log: (m: string) => void logs.push(m),
      hello: { addPayload: () => undefined, onReply: () => undefined, send: async () => undefined },
      onMail: () => undefined,
      tools: { registered: () => [], activate: () => undefined, deactivate: () => undefined },
    } as unknown as BridgeContext;
    registerPlanMode(ctx);
    expect(logs.join("\n")).toMatch(/bash, write, edit, nope/);
  });
});

describe("planModeTools config domain at session_start (13.7, #E34)", () => {
  const cases: Array<{ name: string; tools: string | undefined; expectReadOnly: string[]; blocked: string[]; allowed: string[] }> = [
    { name: "(read, grep)", tools: '["read","grep"]', expectReadOnly: ["read", "grep"], blocked: ["find", "ls"], allowed: ["read", "grep"] },
    { name: "()", tools: "[]", expectReadOnly: [], blocked: ["read", "grep", "find", "ls"], allowed: [] },
    { name: "(read, bash)", tools: '["read","bash"]', expectReadOnly: ["read"], blocked: ["bash", "grep"], allowed: ["read"] },
    { name: "(read, write, edit)", tools: '["read","write","edit"]', expectReadOnly: ["read"], blocked: ["write", "edit"], allowed: ["read"] },
    { name: '("nope")', tools: '["nope"]', expectReadOnly: [], blocked: ["nope", "read"], allowed: [] },
    { name: "default", tools: undefined, expectReadOnly: ["read", "grep", "find", "ls"], blocked: ["bash", "edit", "write"], allowed: ["read", "grep", "find", "ls"] },
    { name: "malformed JSON falls back to the default", tools: "read,grep", expectReadOnly: ["read", "grep", "find", "ls"], blocked: ["bash"], allowed: ["read"] },
  ];
  for (const c of cases) {
    it(`${c.name}: active = (getAllTools ∩ planModeTools) ∪ team tools ∪ PlanSubmit among 10 registered tools, the backstop agrees`, async () => {
      const b = await planMemberBridge({ ...(c.tools !== undefined ? { tools: c.tools } : {}) });
      await b.pi.fire("session_start", { reason: "startup" });
      expect(sorted(b.pi.active)).toEqual(sorted([...c.expectReadOnly, ...MEMBER]));
      expect(b.pi.active).not.toContain("mcp__x__search");
      for (const t of c.blocked) expect(await toolCall(b.pi, t)).toMatchObject({ blocked: true });
      for (const t of c.allowed) expect(await toolCall(b.pi, t)).toMatchObject({ blocked: false });
      await flushAsync();
      expect(b.env.member(b.team, "alice").degraded).toBeUndefined();
    });
  }
});

describe("narrowing unavailable / PlanSubmit missing (13.9, #X11)", () => {
  it("setActiveTools undefined: write is still refused, alice is degraded plan_tools_unavailable and the lead is told; nothing crashes", async () => {
    const b = await planMemberBridge();
    (b.pi as unknown as { setActiveTools?: unknown }).setActiveTools = undefined;
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(b.pi.active).toContain("write"); // not narrowed
    expect(await toolCall(b.pi, "write", { path: "/x", content: "y" })).toMatchObject({ blocked: true, reason: expect.stringContaining("plan_mode") });
    expect(b.env.member(b.team, "alice").degraded).toBe("plan_tools_unavailable");
    b.env.flushNotices();
    expect(b.env.mailsTo(b.team, "lead").map((m) => m.text).join("\n")).toContain("plan_tools_unavailable");
  });

  it("setActiveTools throws: same outcome", async () => {
    const b = await planMemberBridge();
    b.pi.setActiveTools = () => {
      throw new Error("boom");
    };
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: true });
    expect(b.env.member(b.team, "alice").degraded).toBe("plan_tools_unavailable");
  });

  it("PlanSubmit removed by host policy at hello: degraded plan_tools_unavailable (not the generic team_tools_unavailable), lead notified, write refused", async () => {
    const b = await planMemberBridge();
    const real = b.pi.setActiveTools.bind(b.pi);
    b.pi.setActiveTools = (names: string[]) => real(names.filter((n) => n !== PLAN_SUBMIT_TOOL));
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(b.pi.active).not.toContain(PLAN_SUBMIT_TOOL);
    expect(b.env.member(b.team, "alice").degraded).toBe("plan_tools_unavailable");
    b.env.flushNotices();
    expect(b.env.mailsTo(b.team, "lead").map((m) => m.text).join("\n")).toContain("plan_tools_unavailable");
    expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: true });
  });

  it("a healthy plan member is not degraded and reports planToolsActive:true", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(b.env.member(b.team, "alice").degraded).toBeUndefined();
    const hello = b.requests.find((r) => r.type === "agent-teams/hello")?.payload as { planToolsActive?: boolean };
    expect(hello.planToolsActive).toBe(true);
  });
});

describe("approve, reject and the hello-driven restore (6.4)", () => {
  it("approved: the bridge re-sends hello on the plan_decision mail and restores the SERVER restoreTools ∪ team tools; the member can write again", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(await b.env.call("alice", "PlanSubmit", { plan: "do x" })).toMatchObject({ ok: true });
    const hellos = helloCount(b.requests);
    expect(approve(b.env, b.team, "p1")).toMatchObject({ ok: true });
    await flushAsync();
    expect(helloCount(b.requests)).toBe(hellos + 1);
    expect(sorted(b.pi.active)).toEqual(sorted([...BUILTIN, "mcp__x__search", ...MEMBER]));
    expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: false });
    expect(await toolCall(b.pi, "TaskList")).toMatchObject({ blocked: false });
    expect(b.pi.sent.at(-1)?.message.customType).toBe("agent-teams-approval");
    expect(b.pi.sent.at(-1)?.options).toMatchObject({ deliverAs: "steer", triggerTurn: true });
  });

  it("rejected: the feedback is delivered and write stays refused (still narrowed)", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    await b.env.call("alice", "PlanSubmit", { plan: "do x" });
    expect(approve(b.env, b.team, "p1", false, "split it")).toMatchObject({ ok: true });
    await flushAsync();
    expect(b.pi.sent.some((s) => s.message.content.includes("split it"))).toBe(true);
    expect(sorted(b.pi.active)).toEqual(sorted([...PLAN_READONLY_TOOLS, ...MEMBER]));
    expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: true });
  });
});

describe("batched mails in one turn (13.13, #R9)", () => {
  it("reject p1 + approve p2 + hook_feedback in one batch: one hello, final active:false, tools = restoreTools ∪ team tools, no flap back to read-only", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    // hold the live deliveries so the decisions reach the bridge as ONE batch
    const held: Array<{ id: number; kind: string }> = [];
    const live = b.pi.events.emit;
    b.pi.events.emit = (name: string, payload: unknown) => {
      if (name !== "agent-teams:mail") return live(name, payload);
      held.push(...(payload as { mails: Array<{ id: number; kind: string }> }).mails);
    };
    await b.env.call("alice", "PlanSubmit", { plan: "one" });
    approve(b.env, b.team, "p1", false, "no");
    await b.env.call("alice", "PlanSubmit", { plan: "two" });
    approve(b.env, b.team, "p2");
    const decisions = held.filter((m) => m.kind === "plan_decision");
    expect(decisions).toHaveLength(2);
    expect(sorted(b.pi.active)).toEqual(sorted([...PLAN_READONLY_TOOLS, ...MEMBER])); // nothing delivered yet
    const calls: string[][] = [];
    const real = b.pi.setActiveTools.bind(b.pi);
    b.pi.setActiveTools = (names: string[]) => {
      calls.push([...names]);
      real(names);
    };
    const before = helloCount(b.requests);
    const feedback = { id: 9003, from: "server", kind: "hook_feedback", text: "fix lint", wake: true, priority: "normal" };
    await b.bridge.handleMail({ mails: [feedback, ...[...decisions].reverse()] }); // shuffled: delivery order is by mail id
    await flushAsync();
    expect(helloCount(b.requests) - before).toBe(1);
    expect(sorted(b.pi.active)).toEqual(sorted([...BUILTIN, "mcp__x__search", ...MEMBER]));
    expect(calls).toHaveLength(1); // one restore, never a narrowing after it
    expect(await toolCall(b.pi, "edit")).toMatchObject({ blocked: false });
    expect(b.pi.sent.slice(-3).map((x) => x.message.details?.mailId)).toEqual([...decisions.map((m) => m.id), 9003]);
  });

  it("a hook_feedback mail alone triggers no extra hello", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    const before = helloCount(b.requests);
    await b.bridge.handleMail({ mails: [{ id: 9100, from: "server", kind: "hook_feedback", text: "x", wake: true, priority: "normal" }] });
    await flushAsync();
    expect(helloCount(b.requests)).toBe(before);
  });
});

describe("reload mid plan mode / after approve (13.16, #D6)", () => {
  it("planning: the reloaded bridge narrows BEFORE its first hello reply, and the reply keeps it narrowed; after approve + another reload it is not narrowed", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();

    // reload while planning
    const r1 = b.link(b.hintEnv);
    await r1.pi.fire("session_start", { reason: "reload" });
    expect(sorted(r1.pi.active)).toEqual(sorted([...PLAN_READONLY_TOOLS, ...MEMBER])); // before any lane round trip
    await flushAsync();
    expect(b.env.rt.ops.hello).toBeDefined();
    expect(r1.requests.find((r) => r.type === "agent-teams/hello")).toBeDefined();
    expect(sorted(r1.pi.active)).toEqual(sorted([...PLAN_READONLY_TOOLS, ...MEMBER]));
    expect(await toolCall(r1.pi, "write")).toMatchObject({ blocked: true });

    // approve, then reload again: env hint still says plan mode, the reply says active:false → restored from the server list
    await b.env.call("alice", "PlanSubmit", { plan: "p" });
    approve(b.env, b.team, "p1");
    await flushAsync();
    const r2 = b.link(b.hintEnv);
    await r2.pi.fire("session_start", { reason: "reload" });
    await flushAsync();
    expect(sorted(r2.pi.active)).toEqual(sorted([...BUILTIN, "mcp__x__search", ...MEMBER]));
    expect(await toolCall(r2.pi, "write")).toMatchObject({ blocked: false });
  });
});

describe("tool_call backstop bypass attempts (13.19, #S6)", () => {
  it("write/edit/bash (incl. `echo >`), an MCP tool, a tool registered AFTER narrowing, case variants and lead-only tools are refused; no file changes", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "plan-mode-")), "victim.txt");
    fs.writeFileSync(file, "original");
    const before = fs.statSync(file).mtimeMs;
    // a tool registered after narrowing: pi activates it at once, the backstop must still refuse it
    b.pi.registerTool({ name: "late_tool", label: "late", description: "late", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) } as never);
    expect(b.pi.active).toContain("late_tool");
    const attempts: Array<[string, unknown]> = [
      ["write", { path: file, content: "pwned" }],
      ["edit", { path: file }],
      ["bash", { command: "rm -rf /tmp/x" }],
      ["bash", { command: `echo pwned > ${file}` }],
      ["mcp__x__delete", {}],
      ["late_tool", {}],
      ["Read", { path: file }],
      ["READ", { path: file }],
      ["PlanDecision", { member: "alice", planId: "p1", approve: true }],
      ["TeammateSpawn", {}],
      ["ShutdownRequest", {}],
    ];
    for (const [name, input] of attempts) {
      const res = await toolCall(b.pi, name, input);
      expect(res, name).toMatchObject({ blocked: true });
      if (!res.blocked) fs.writeFileSync(file, "pwned"); // a pi that executed it
    }
    expect(fs.readFileSync(file, "utf8")).toBe("original");
    expect(fs.statSync(file).mtimeMs).toBe(before);
    expect((await toolCall(b.pi, "write")).reason).toContain("plan_mode");
    for (const ok of ["read", "grep", "find", "ls", "PlanSubmit", "TaskList", "TaskUpdate", "SendMessage", "TeamStatus"]) expect(await toolCall(b.pi, ok), ok).toMatchObject({ blocked: false });
  });
});

describe("env fail-safe (13.20, #S7)", () => {
  const readOnlyActive = [...PLAN_READONLY_TOOLS, ...MEMBER];
  const full = [...BUILTIN, "mcp__x__search", ...MEMBER];

  it("env unset/0 but the server says planning: the hello reply narrows; env 1 or garbage narrows at once", async () => {
    for (const hint of [undefined, "0", "false", ""]) {
      const b = await planMemberBridge({ ...(hint !== undefined ? { hint } : {}), state: "planning" });
      await b.pi.fire("session_start", { reason: "startup" });
      await flushAsync();
      expect(sorted(b.pi.active), `hint ${String(hint)}`).toEqual(sorted(readOnlyActive));
      expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: true });
    }
    for (const hint of ["1", "banana", "yes"]) {
      const b = await planMemberBridge({ hint, state: "planning" });
      await b.pi.fire("session_start", { reason: "startup" });
      expect(sorted(b.pi.active), `hint ${hint}`).toEqual(sorted(readOnlyActive));
    }
  });

  it("env 0/unset and the server has no plan for the member: never narrowed, backstop inert", async () => {
    for (const hint of [undefined, "0"]) {
      const b = await planMemberBridge({ ...(hint !== undefined ? { hint } : {}), state: "none" });
      await b.pi.fire("session_start", { reason: "startup" });
      await flushAsync();
      expect(b.pi.active).toContain("write");
      expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: false });
      expect(b.requests.find((r) => r.type === "agent-teams/hello")?.payload).not.toHaveProperty("planToolsActive");
    }
  });

  it("env says plan mode but the server reply carries no planMode: the member stays narrowed (fail-safe); the server saying approved restores", async () => {
    const none = await planMemberBridge({ hint: "1", state: "none" });
    await none.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(sorted(none.pi.active)).toEqual(sorted(readOnlyActive));
    const done = await planMemberBridge({ hint: "1", state: "approved" });
    await done.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    expect(sorted(done.pi.active)).toEqual(sorted(full));
  });

  it("tampering with the env after start cannot re-widen: still narrowed and refused after another hello", async () => {
    const b = await planMemberBridge();
    await b.pi.fire("session_start", { reason: "startup" });
    await flushAsync();
    b.hintEnv[ENV_PLAN_MODE] = "0";
    delete b.hintEnv[ENV_PLAN_MODE_TOOLS];
    await b.bridge.sendHello();
    expect(sorted(b.pi.active)).toEqual(sorted(readOnlyActive));
    expect(await toolCall(b.pi, "write")).toMatchObject({ blocked: true });
    expect(serializePlanTools(PLAN_READONLY_TOOLS)).toBe('["read","grep","find","ls"]');
  });
});

describe.skipIf(!fauxPiAvailable())("pi 1.6.0: setActiveTools narrows and restores (13.23, tasks 10.1, #I1)", () => {
  it("real pi --mode rpc: plan member's active tools are read,grep,find,ls + team tools; after approval restoreTools ∪ team tools incl. edit/write", async () => {
    const e = createTeamsEnv({ runtime: { clock: systemClock } });
    const link = await startRealPiLink(e);
    try {
      const team = await e.createTeam();
      const { planSpawnContribution } = await import("../../server/plans.js");
      const c = planSpawnContribution(team, "alice", { requirePlanApproval: true, tools: ["read", "bash", "edit", "write"] }, { planModeTools: ["read", "grep", "find", "ls"] }, MEMBER);
      if (!c) throw new Error("no plan contribution");
      const spawned = e.rt.ops.spawnMember(team, { name: "alice", prompt: "[[faux:plain-text]] stand by", tools: c.tools }, undefined, undefined, { member: c.member });
      expect(spawned).toMatchObject({ ok: true });
      const [alice] = await link.started();
      if (!alice) throw new Error("no teammate process was started");
      const sessionId = await link.untilSession(alice);
      await vi.waitFor(() => expect(e.member(team, "alice")).toMatchObject({ status: "idle", guardActive: true }), { timeout: 30_000 });
      expect(e.member(team, "alice").degraded).toBeUndefined();

      const probe = async (): Promise<string[]> => {
        const n = alice.probes.length;
        alice.proc.prompt("/at-probe");
        await vi.waitFor(() => expect(alice.probes.length).toBeGreaterThan(n), { timeout: 10_000 });
        return (alice.probes[alice.probes.length - 1] as { activeTools: string[] }).activeTools;
      };
      expect(sorted(await probe())).toEqual(sorted([...PLAN_READONLY_TOOLS, ...MEMBER]));

      // a bash call while planning never reaches a shell (not active; the tool_call backstop covers re-activation)
      const from = alice.proc.records.length;
      alice.proc.prompt("[[faux:agent-teams-guard-probe]] try a git commit");
      const end = await alice.proc.waitFor((r) => alice.proc.records.indexOf(r) >= from && r.type === "tool_execution_end" && r.toolName === "bash", 30_000);
      await alice.proc.waitFor((r) => alice.proc.records.indexOf(r) >= from && r.type === "agent_settled", 30_000);
      expect(JSON.stringify(end.result)).not.toMatch(/not a git repository|nothing to commit|guard-probe/);
      expect(end.isError).toBe(true);

      // submit (server side) and approve: the bridge re-sends hello and restores the server list
      expect(await e.fake.call(sessionId, "PlanSubmit", { plan: "read the code, then edit it" })).toMatchObject({ ok: true });
      expect(decidePlan(planDeps(e), { team, member: "alice", planId: "p1", approve: true, actor: { kind: "lead" } })).toMatchObject({ ok: true });
      await vi.waitFor(async () => {
        const tools = await probe();
        for (const t of ["edit", "write", "bash", ...MEMBER]) expect(tools).toContain(t);
      }, { timeout: 20_000 });
      expect(TEAMMATE_ACK).toBeDefined();
    } finally {
      await link.close();
    }
  }, 120_000);
});
