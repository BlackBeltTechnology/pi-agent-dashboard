/**
 * What a hook child receives: the stdin JSON object (design D7 table) and the `AGENT_TEAMS_*` env
 * variables. Both are built from server-held state only; task text goes to stdin as JSON and never
 * into argv or env, and every env value is a validated identifier.
 * See change: add-agent-teams-templates-hooks.
 */
import type { HookEvent } from "../shared/types.js";
import { firstChars } from "./hook-run.js";

/** `idle.finalText` is cut to this many characters in the stdin payload. */
export const HOOK_FINAL_TEXT_CHARS = 4000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface HookTaskView {
  id: string;
  title: string;
  description: string;
  status: string;
  owner?: string | undefined;
  blockedBy: string[];
  result?: string | undefined;
}

export interface HookEventContext {
  event: HookEvent;
  team: { id: string; name: string; leadCwd: string };
  /** The member the event is about (task owner / creator / idle member); absent for a lead-only event. */
  member?: { name: string; cwd: string } | undefined;
  task?: HookTaskView | undefined;
  idle?: { settleId: number; finalText?: string | undefined; error?: string | undefined } | undefined;
}

/** The single JSON object written to the hook's stdin. */
export function buildHookPayload(ctx: HookEventContext): string {
  const payload: Record<string, unknown> = {
    hook_event_name: ctx.event,
    team: { id: ctx.team.id, name: ctx.team.name },
    cwd: ctx.team.leadCwd,
  };
  if (ctx.member) {
    payload.member = ctx.member.name;
    payload.memberCwd = ctx.member.cwd;
  }
  if (ctx.task) {
    const t = ctx.task;
    payload.task = {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      ...(t.owner !== undefined ? { owner: t.owner } : {}),
      blockedBy: t.blockedBy,
      ...(t.result !== undefined ? { result: t.result } : {}),
    };
  }
  if (ctx.idle) {
    payload.idle = {
      settleId: ctx.idle.settleId,
      ...(ctx.idle.finalText !== undefined ? { finalText: firstChars(ctx.idle.finalText, HOOK_FINAL_TEXT_CHARS) } : {}),
      ...(ctx.idle.error !== undefined ? { error: ctx.idle.error } : {}),
    };
  }
  return JSON.stringify(payload);
}

/** `AGENT_TEAMS_EVENT/TEAM_ID/MEMBER/TASK_ID`; a value that is not a plain identifier is left unset. */
export function buildHookEventVars(ctx: HookEventContext): Record<string, string> {
  const vars: Record<string, string> = { AGENT_TEAMS_EVENT: ctx.event };
  if (SAFE_ID.test(ctx.team.id)) vars.AGENT_TEAMS_TEAM_ID = ctx.team.id;
  if (ctx.member && SAFE_ID.test(ctx.member.name)) vars.AGENT_TEAMS_MEMBER = ctx.member.name;
  if (ctx.task && SAFE_ID.test(ctx.task.id)) vars.AGENT_TEAMS_TASK_ID = ctx.task.id;
  return vars;
}
