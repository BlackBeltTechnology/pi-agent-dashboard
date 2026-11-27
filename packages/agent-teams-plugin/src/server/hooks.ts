/**
 * TeammateIdle / TaskCreated / TaskCompleted hooks as core op gates (design D7): `TaskCreate`,
 * `TaskUpdate` (core only gates the completing update) and the idle gate. Hooks come ONLY from the
 * team record (`team.hooks`, frozen at start); nothing agent-supplied can add or change one. A gate
 * of a team without hooks returns at once. Exit 2 vetoes with code `hook_blocked`; a hook that could
 * not start before the deadline vetoes a task op with feedback `hook_busy` (retryable) and lets an
 * idle through; a concurrent completion of the same task gets `hook_pending`.
 * See change: add-agent-teams-templates-hooks.
 */
import { MAIL_KIND_HOOK_FEEDBACK, registerApprovalMailKinds } from "../shared/approval-mail.js";
import type { HookFeedbackCode } from "../shared/protocol.js";
import type { HookCommand, HookEvent, Member, Task, Team } from "../shared/types.js";
import { IDLE_GATE_OP, type OpGateBlock, type OpGateInput } from "./extension-points.js";
import { createHookEngine, type HookEngine, type HookVerdict } from "./hook-engine.js";
import type { HookEventContext, HookTaskView } from "./hook-payload.js";
import { defaultHookIo, type HookIo } from "./hook-run.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

let ioOverride: Partial<HookIo> | undefined;

/** Test seam: replace spawn / tree-kill / env source for runtimes registered while it is set (pass `undefined` to reset). */
export function setHookIoOverride(io: Partial<HookIo> | undefined): void {
  ioOverride = io;
}

function feedbackToken(code: HookFeedbackCode, text: string): string {
  return `${code}: ${text}`;
}

const veto = (feedback: string, afterBlock?: () => void): OpGateBlock => ({ block: true, feedback, code: "hook_blocked", ...(afterBlock ? { afterBlock } : {}) });

const commandsOf = (team: Team, event: HookEvent): readonly HookCommand[] => team.hooks?.[event] ?? [];

function taskView(task: Task, over: Partial<HookTaskView> = {}): HookTaskView {
  return { id: task.id, title: task.title, description: task.description, status: task.status, owner: task.owner, blockedBy: [...task.blockedBy], result: task.result, ...over };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

type AsyncGate = (input: OpGateInput) => Promise<OpGateBlock | undefined>;

export interface HookGates {
  taskCreated: AsyncGate;
  taskCompleted: AsyncGate;
  idle: AsyncGate;
  /** Drop the per-team retry / in-flight state (team closed). */
  forgetTeam(teamId: string): void;
}

export function createHookGates(deps: TemplatesHooksDeps, engine: HookEngine): HookGates {
  /** `team:member` → consecutive idle blocks. */
  const idleBlocks = new Map<string, number>();
  /** `team:taskId` of completions whose hook is running. */
  const inFlight = new Set<string>();

  const member = (team: Team, name: string): Member | undefined => (name === "lead" ? undefined : deps.store.member(team, name));
  const memberView = (m: Member | undefined) => (m ? { name: m.name, cwd: m.cwd } : undefined);

  const asVeto = (verdict: HookVerdict): OpGateBlock | undefined => {
    if (verdict.kind === "block") return veto(verdict.feedback);
    if (verdict.kind === "busy") return veto(feedbackToken("hook_busy", "the hook could not start before the deadline (the team is running too many hooks); nothing changed, retry"));
    return undefined;
  };

  const taskCreated: AsyncGate = async (input: OpGateInput) => {
    const commands = commandsOf(input.team, "TaskCreated");
    if (commands.length === 0) return undefined;
    const args = (input.args ?? {}) as Record<string, unknown>;
    const caller = member(input.team, input.callerName);
    const planned: HookTaskView = {
      id: String(input.team.nextTaskId),
      title: str(args.title) ?? "",
      description: str(args.description) ?? "",
      status: "pending",
      owner: str(args.owner),
      blockedBy: Array.isArray(args.blockedBy) ? args.blockedBy.filter((b): b is string => typeof b === "string") : [],
    };
    const ctx: HookEventContext = { event: "TaskCreated", team: input.team, member: memberView(caller), task: planned };
    return asVeto(await engine.run(ctx, commands));
  };

  const taskCompleted: AsyncGate = async (input: OpGateInput) => {
    const commands = commandsOf(input.team, "TaskCompleted");
    if (commands.length === 0) return undefined;
    const args = (input.args ?? {}) as Record<string, unknown>;
    if (args.status !== "completed") return undefined;
    const task = input.team.tasks.find((t) => t.id === String(args.id));
    if (!task || task.status === "completed") return undefined; // core fails or no-ops it
    const key = `${input.team.id}:${task.id}`;
    if (inFlight.has(key)) return veto(feedbackToken("hook_pending", `a completion of task ${task.id} is already running its hook; wait for it`));
    inFlight.add(key);
    try {
      const owner = task.owner ? member(input.team, task.owner) : member(input.team, input.callerName);
      // The hook sees the completion being proposed: target status and the result about to be stored.
      const view = taskView(task, { status: "completed", result: str(args.result) ?? task.result });
      return asVeto(await engine.run({ event: "TaskCompleted", team: input.team, member: memberView(owner), task: view }, commands));
    } finally {
      inFlight.delete(key);
    }
  };

  /** The idle gate's reaction to a block: cap reached → accept + tell the lead; else veto with a feedback mail after core keeps the member busy. */
  const blockIdle = (input: OpGateInput, m: Member, verdict: Extract<HookVerdict, { kind: "block" }>, cap: number): OpGateBlock | undefined => {
    const key = `${input.team.id}:${m.name}`;
    const blocks = idleBlocks.get(key) ?? 0;
    if (blocks >= cap) {
      idleBlocks.delete(key);
      const team = deps.store.get(input.team.id);
      if (team && team.status !== "closed") {
        deps.ops.enqueueLeadNotice(team, { text: `TeammateIdle hook blocked ${m.name} ${cap} times in a row; its idle was accepted (hook: ${verdict.command.slice(0, 80)})`, wake: false });
      }
      return undefined;
    }
    return veto(verdict.feedback, () => {
      idleBlocks.set(key, blocks + 1);
      const team = deps.store.get(input.team.id);
      if (!team) return;
      const sent = deps.ops.sendServerMail(team, m.name, {
        kind: MAIL_KIND_HOOK_FEEDBACK,
        text: `Quality gate from the team configuration (TeammateIdle hook): do not stop yet.\n${verdict.feedback}`,
        wake: true,
      });
      if (!sent.ok) deps.logger.warn(`agent-teams: hook_feedback mail to ${m.name} failed: ${sent.error}`);
    });
  };

  const idle: AsyncGate = async (input: OpGateInput) => {
    const idleInfo = input.idle;
    const commands = commandsOf(input.team, "TeammateIdle");
    if (!idleInfo || commands.length === 0) return undefined;
    const m = member(input.team, input.callerName);
    if (!m || m.status === "shutdown_pending" || idleInfo.error !== undefined || m.planApproval === "pending") return undefined;
    const cap = deps.config().hookMaxRetries;
    if (cap === 0) return undefined; // idle hooks never block
    const verdict = await engine.run({ event: "TeammateIdle", team: input.team, member: memberView(m), idle: idleInfo }, commands);
    if (input.wakeSeq && input.wakeSeq.read() !== input.wakeSeq.at) return undefined; // superseded: core drops the idle
    if (verdict.kind === "busy") return undefined; // counted by the engine; the idle goes through
    if (verdict.kind === "allow") {
      idleBlocks.delete(`${input.team.id}:${m.name}`);
      return undefined;
    }
    return blockIdle(input, m, verdict, cap);
  };

  return {
    taskCreated,
    taskCompleted,
    idle,
    forgetTeam(teamId) {
      for (const key of [...idleBlocks.keys()]) if (key.startsWith(`${teamId}:`)) idleBlocks.delete(key);
      for (const key of [...inFlight]) if (key.startsWith(`${teamId}:`)) inFlight.delete(key);
    },
  };
}

export function registerHooks(deps: TemplatesHooksDeps): void {
  registerApprovalMailKinds(); // idempotent; `hook_feedback` must be a registered kind before the first gate runs
  const engine = createHookEngine(deps, { ...defaultHookIo, ...ioOverride });
  const gates = createHookGates(deps, engine);
  deps.ext.registerOpGate("TaskCreate", gates.taskCreated);
  deps.ext.registerOpGate("TaskUpdate", gates.taskCompleted);
  deps.ext.registerOpGate(IDLE_GATE_OP, gates.idle);
  deps.host.onShutdown(() => engine.shutdown());
  deps.onDispose(() => engine.shutdown());
  deps.store.on("team_closed", ({ team }) => {
    engine.forgetTeam(team.id);
    gates.forgetTeam(team.id);
  });
}
