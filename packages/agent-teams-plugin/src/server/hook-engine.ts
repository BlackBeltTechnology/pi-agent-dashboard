/**
 * Hook engine: runs the (≤ 3) commands of one event sequentially under ONE deadline (the core op-gate
 * budget, queue wait included), interprets exit codes (CC semantics: 0 allow, 2 block + stderr,
 * anything else fail-open), counts and logs every run (never stdin/stdout content) and sends the
 * lead the first-occurrence notices. Concurrency 2/team, 4/server via `HookLimiter`.
 * See change: add-agent-teams-templates-hooks.
 */
import { sanitizeText } from "../shared/text.js";
import type { HookCommand } from "../shared/types.js";
import { effectiveHookTimeoutMs } from "./config.js";
import { HookLimiter } from "./hook-limiter.js";
import { buildHookEventVars, buildHookPayload, type HookEventContext } from "./hook-payload.js";
import { buildHookEnv, firstChars, type HookIo, type HookRunHandle, type HookRunResult, startHook } from "./hook-run.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

/** Feedback of a block is cut to this many characters. */
const HOOK_FEEDBACK_MAX_CHARS = 2000;
/** Feedback when a hook exits 2 without any stderr. */
const HOOK_NO_OUTPUT_FEEDBACK = "hook blocked (no output)";
/**
 * The gate must answer BEFORE core's own race timer (same budget, started one tick earlier) fires,
 * otherwise a hook that uses the whole budget would be reported as `op_blocked`/fail-open instead
 * of its own verdict. Our event deadline is therefore the budget minus this margin.
 */
export const HOOK_DEADLINE_MARGIN_MS = 50;
/** Consecutive non-blocking errors of one event that produce one lead notice. */
const HOOK_ERROR_STREAK_NOTICE = 3;
/** Commands per event (validated at template load; defended here too). */
const MAX_COMMANDS_PER_EVENT = 3;

export type HookVerdict = { kind: "allow" } | { kind: "block"; feedback: string; command: string } | { kind: "busy" };

/** Thrown to a waiting gate when the server shuts down (the awaiting tool call fails). */
export class HookShutdownError extends Error {
  constructor() {
    super("hook runner shut down");
    this.name = "HookShutdownError";
  }
}

export type HookEngineDeps = Pick<TemplatesHooksDeps, "ops" | "store" | "config" | "logger" | "clock" | "counters">;

export interface HookEngine {
  /** Run `commands` for `ctx`; rejects with `HookShutdownError` when the server shuts down meanwhile. */
  run(ctx: HookEventContext, commands: readonly HookCommand[]): Promise<HookVerdict>;
  /** Kill every running tree, drop queued runs (they never spawn), refuse new ones. */
  shutdown(): void;
  /** Forget the per-team notice/streak state (team closed). */
  forgetTeam(teamId: string): void;
  readonly limiter: HookLimiter;
}

/** Control characters stripped, trimmed, at most 2000 characters; empty → the no-output feedback. */
function hookFeedback(stderr: string): string {
  const text = firstChars(sanitizeText(stderr, { keepNewlines: true }).trim(), HOOK_FEEDBACK_MAX_CHARS).trim();
  return text === "" ? HOOK_NO_OUTPUT_FEEDBACK : text;
}

export function createHookEngine(deps: HookEngineDeps, io: HookIo): HookEngine {
  const { clock, counters, logger } = deps;
  const limiter = new HookLimiter(clock);
  const running = new Set<HookRunHandle>();
  /** `team:event` → consecutive non-blocking errors. */
  const streaks = new Map<string, number>();
  const timeoutNoticed = new Set<string>();
  const spawnErrorNoticed = new Set<string>();
  let closed = false;

  const notice = (teamId: string, text: string): void => {
    const team = deps.store.get(teamId);
    if (team && team.status !== "closed") deps.ops.enqueueLeadNotice(team, { text, wake: false });
  };

  function logRun(ctx: HookEventContext, index: number, res: HookRunResult): void {
    const parts = [
      `event=${ctx.event}`,
      `team=${ctx.team.id}`,
      ...(ctx.member ? [`member=${ctx.member.name}`] : []),
      `cmd=${index}`,
      `outcome=${res.outcome}`,
      ...(res.outcome === "exit" ? [`code=${res.code === null ? "signal" : res.code}`] : []),
      ...(res.error ? [`error=${res.error}`] : []),
      `ms=${res.durationMs}`,
      `stdout=${res.stdoutBytes}`,
      `stderr=${res.stderrBytes}`,
      ...(res.overflow ? ["overflow=true"] : []),
    ];
    logger.info(`agent-teams: hook ${parts.join(" ")}`);
  }

  /** Timeout / spawn error: both allow; each has its own first-occurrence lead notice. */
  function interpretFailure(ctx: HookEventContext, res: HookRunResult, key: string): HookVerdict {
    const teamId = ctx.team.id;
    if (res.outcome === "timeout") {
      counters.inc("hook_timeouts", teamId);
      if (!timeoutNoticed.has(key)) {
        timeoutNoticed.add(key);
        notice(teamId, `${ctx.event} hook timed out (it was killed and the event proceeded); check the hook command`);
      }
      return { kind: "allow" };
    }
    counters.inc("hook_errors", teamId);
    if (!spawnErrorNoticed.has(teamId)) {
      spawnErrorNoticed.add(teamId);
      notice(teamId, `${ctx.event} hook spawn_error (${res.error ?? "unknown"}): the hook could not start and the event proceeded; is bash available?`);
    }
    streak(ctx, key);
    return { kind: "allow" };
  }

  /** Count + log + notices for one finished run; returns a block verdict for exit 2. */
  function interpret(ctx: HookEventContext, command: string, index: number, res: HookRunResult): HookVerdict {
    const teamId = ctx.team.id;
    const key = `${teamId}:${ctx.event}`;
    counters.inc("hook_runs", teamId);
    logRun(ctx, index, res);
    if (res.overflow) counters.inc("hook_overflow", teamId);
    if (res.outcome !== "exit") return interpretFailure(ctx, res, key);
    if (res.code === 0) {
      streaks.delete(key);
      return { kind: "allow" };
    }
    if (res.code === 2) {
      streaks.delete(key);
      counters.inc("hook_blocks", teamId);
      return { kind: "block", feedback: hookFeedback(res.stderr), command };
    }
    counters.inc("hook_errors", teamId);
    streak(ctx, key);
    return { kind: "allow" };
  }

  function streak(ctx: HookEventContext, key: string): void {
    const n = (streaks.get(key) ?? 0) + 1;
    streaks.set(key, n);
    if (n === HOOK_ERROR_STREAK_NOTICE) {
      notice(ctx.team.id, `${ctx.event} hook failed ${n} times in a row without blocking (non-blocking errors); check the hook command`);
    }
  }

  /** Acquire a slot inside the deadline, run one command, release the slot when its tree is reaped. */
  async function runCommand(ctx: HookEventContext, cmd: HookCommand, index: number, run: { deadline: number; defaultTimeout: number; stdin: string; env: Record<string, string> }): Promise<HookVerdict | "never_started"> {
    const slot = await limiter.acquire(ctx.team.id, run.deadline);
    if (slot.kind === "shutdown") throw new HookShutdownError();
    if (slot.kind === "timeout") return "never_started";
    const remaining = run.deadline - clock.now();
    if (remaining <= 0) {
      // Deadline already spent while queued: never spawn a child only to kill it.
      slot.release();
      return "never_started";
    }
    const timeoutMs = Math.min(cmd.timeoutMs ?? run.defaultTimeout, remaining);
    const handle = startHook({ command: cmd.command, cwd: ctx.team.leadCwd, env: run.env, stdin: run.stdin, timeoutMs }, io, clock);
    running.add(handle);
    void handle.reaped.then(() => {
      running.delete(handle);
      slot.release();
    });
    const res = await handle.result;
    if (res.outcome === "aborted") throw new HookShutdownError();
    return interpret(ctx, cmd.command, index, res);
  }

  async function run(ctx: HookEventContext, commands: readonly HookCommand[]): Promise<HookVerdict> {
    if (closed || commands.length === 0) return { kind: "allow" };
    const cfg = deps.config();
    const spec = {
      deadline: clock.now() + Math.max(0, cfg.opGateBudgetMs - HOOK_DEADLINE_MARGIN_MS),
      defaultTimeout: effectiveHookTimeoutMs(cfg),
      stdin: buildHookPayload(ctx),
      env: buildHookEnv(io.env(), buildHookEventVars(ctx)),
    };
    let index = 0;
    for (const cmd of commands.slice(0, MAX_COMMANDS_PER_EVENT)) {
      const verdict = await runCommand(ctx, cmd, index++, spec);
      if (verdict === "never_started") {
        counters.inc("hook_busy", ctx.team.id);
        logger.info(`agent-teams: hook event=${ctx.event} team=${ctx.team.id} outcome=busy`);
        return { kind: "busy" }; // never started: not a silent pass
      }
      if (verdict.kind === "block") return verdict;
      if (clock.now() >= spec.deadline) break; // the budget is spent by a hook that did run
    }
    return { kind: "allow" };
  }

  return {
    run,
    limiter,
    shutdown() {
      closed = true;
      limiter.cancelAll();
      for (const handle of [...running]) handle.abort();
    },
    forgetTeam(teamId) {
      for (const key of [...streaks.keys()]) if (key.startsWith(`${teamId}:`)) streaks.delete(key);
      for (const key of [...timeoutNoticed]) if (key.startsWith(`${teamId}:`)) timeoutNoticed.delete(key);
      spawnErrorNoticed.delete(teamId);
    },
  };
}
