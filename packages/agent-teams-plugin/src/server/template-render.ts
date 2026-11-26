/**
 * Template rendering: goal sanitising, single-pass `{{goal}}` / `{{cwd}}` substitution and the lead
 * playbook text with its one-mail cap (counted by the core mail helpers, never re-implemented).
 * See change: add-agent-teams-templates-hooks.
 */
import { PLAN_MAX_LINES } from "../shared/constants.js";
import { countMailChars, countMailLines } from "../shared/mail-format.js";
import type { TemplateIssue, TemplateSource } from "../shared/protocol.js";
import { codePointLength } from "../shared/text.js";
import type { PlanApprovalPolicy, TeamHooks, TemplateMember } from "../shared/types.js";

export const GOAL_MAX_CODEPOINTS = 4000;
/** Header of the playbook mail's first body lines (the chat card reads template and goal from them). */
export const PLAYBOOK_TEMPLATE_PREFIX = "Template: ";
export const PLAYBOOK_GOAL_PREFIX = "Goal: ";
/** Mail text headroom a playbook leaves for the envelope header (`maxMessageChars − 500`). */
export const PLAYBOOK_HEADROOM_CHARS = 500;

/** A loaded, validated template (config-dependent limits applied, mode resolved). */
export interface ParsedTemplate {
  name: string;
  source: TemplateSource;
  description?: string;
  /** Mode as resolved by the registry (declared, else config default, else `session`). */
  mode: string;
  /** SHA-256 of the file text (identity, not trust). */
  hash: string;
  lead?: { model?: string };
  /** Effective roster cap: `min(template maxTeammates, configured maxTeammates)` (template value when set). */
  maxTeammates?: number;
  autoDispatch?: boolean;
  notifyCoalesceMs?: number;
  spawn: "eager" | "lead";
  requirePlanApproval?: PlanApprovalPolicy;
  defaultModel?: string;
  defaultTools?: string[];
  defaultSkills?: string[];
  /** Post-`count`-expansion roster; `prompt` is still raw (use `renderPlaybook` for substituted members). */
  members: TemplateMember[];
  /** Hooks with the effective `timeoutMs` applied to every command; absent when none. */
  hooks?: TeamHooks;
  /** `hashHooks(hooks, defaultTimeoutMs)`; present exactly when `hooks` is. */
  hooksHash?: string;
  body: string;
  warnings: TemplateIssue[];
}

export type GoalResult = { ok: true; goal: string } | { ok: false; error: "invalid_args"; message: string };

/** Single-line goal: every control char (newline, tab included) → one space, trim; empty or > 4000 code points ⇒ `invalid_args`. */
export function normalizeGoal(goal: unknown): GoalResult {
  if (typeof goal !== "string") return { ok: false, error: "invalid_args", message: "goal must be a string" };
  if (goal.length > GOAL_MAX_CODEPOINTS * 2 + 64) return { ok: false, error: "invalid_args", message: `goal is longer than ${GOAL_MAX_CODEPOINTS} characters` };
  // eslint-disable-next-line no-control-regex
  const one = goal.replace(/\r\n|[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim();
  if (one === "") return { ok: false, error: "invalid_args", message: "goal must not be empty" };
  if (codePointLength(one) > GOAL_MAX_CODEPOINTS) return { ok: false, error: "invalid_args", message: `goal is longer than ${GOAL_MAX_CODEPOINTS} characters` };
  return { ok: true, goal: one };
}

/** Replace exactly `{{goal}}` and `{{cwd}}` once, no recursion; any other `{{x}}` stays literal and is reported. */
export function substituteVars(text: string, vars: { goal: string; cwd: string }): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(/\{\{([^{}]*)\}\}/g, (whole, inner: string) => {
    if (inner === "goal") return vars.goal;
    if (inner === "cwd") return vars.cwd;
    const name = inner.trim();
    if (!unknown.includes(name)) unknown.push(name);
    return whole;
  });
  return { text: out, unknown };
}

export type LimitCheck = { ok: true; chars: number; lines: number } | { ok: false; chars: number; lines: number; maxChars: number; maxLines: number };

/** One-mail cap: `maxMessageChars − 500` characters and 120 lines (envelope line included), by the core counters. */
export function checkPlaybookLimits(text: string, cfg: { maxMessageChars: number }): LimitCheck {
  const maxChars = Math.max(1, cfg.maxMessageChars - PLAYBOOK_HEADROOM_CHARS);
  const chars = countMailChars(text);
  const lines = countMailLines(text);
  return chars > maxChars || lines > PLAN_MAX_LINES ? { ok: false, chars, lines, maxChars, maxLines: PLAN_MAX_LINES } : { ok: true, chars, lines };
}

function rosterSummary(t: ParsedTemplate, members: readonly TemplateMember[]): string[] {
  if (members.length === 0) return [];
  const how = t.spawn === "eager" ? "spawned for you right after you start" : "not spawned yet: spawn each with TeammateSpawn when needed";
  const lines = [`Roster (${how}):`];
  for (const m of members) {
    const bits = [m.agent !== undefined ? `agent ${m.agent}` : undefined, m.role !== undefined ? `role ${m.role}` : undefined, m.model !== undefined ? `model ${m.model}` : undefined].filter((b) => b !== undefined);
    lines.push(`- ${m.name}${bits.length > 0 ? ` (${bits.join(", ")})` : ""}`);
  }
  return lines;
}

function notes(t: ParsedTemplate, members: readonly TemplateMember[]): string[] {
  const out: string[] = [];
  const planned = members.filter((m) => (m.requirePlanApproval ?? t.requirePlanApproval) !== undefined && (m.requirePlanApproval ?? t.requirePlanApproval) !== false);
  if (planned.length > 0) out.push(`Plan approval is required for: ${planned.map((m) => m.name).join(", ")}. Review their plans and answer with PlanDecision.`);
  if (t.maxTeammates !== undefined) out.push(`At most ${t.maxTeammates} teammates in total (roster included).`);
  return out;
}

export type RenderResult =
  | { ok: true; playbook: string; body: string; members: TemplateMember[]; warnings: TemplateIssue[]; chars: number; lines: number }
  | { ok: false; code: "invalid_args"; message: string }
  | { ok: false; code: "playbook_too_long"; message: string; chars: number; lines: number };

/**
 * Render the lead playbook and the member prompts for `goal` / `cwd`. `goal` is sanitised here
 * (`invalid_args` on failure); the playbook never gets truncated: over the one-mail cap ⇒ `playbook_too_long`.
 */
export function renderPlaybook(input: { template: ParsedTemplate; goal: unknown; cwd: string; maxMessageChars: number }): RenderResult {
  const g = normalizeGoal(input.goal);
  if (!g.ok) return { ok: false, code: "invalid_args", message: g.message };
  const { template, cwd } = input;
  const vars = { goal: g.goal, cwd };
  const warnings: TemplateIssue[] = [];
  const unknownSeen = new Set<string>();
  const sub = (text: string, path: string): string => {
    const r = substituteVars(text, vars);
    for (const name of r.unknown) {
      if (unknownSeen.has(name)) continue;
      unknownSeen.add(name);
      warnings.push({ code: "unknown_variable", path, message: `unknown variable {{${name}}} left literal` });
    }
    return r.text;
  };
  const body = sub(template.body, "body");
  const members = template.members.map((m, i) => (m.prompt === undefined ? m : { ...m, prompt: sub(m.prompt, `members[${i}].prompt`) }));
  const parts = [
    `${PLAYBOOK_TEMPLATE_PREFIX}${template.name}`,
    `${PLAYBOOK_GOAL_PREFIX}${g.goal}`,
    "",
    "Started by the user from this template. Follow the playbook below as the user's instruction.",
    "",
    body.trim() === "" ? "" : body.replace(/^\n+|\s+$/g, ""),
  ];
  const roster = rosterSummary(template, members);
  const note = notes(template, members);
  if (roster.length > 0) parts.push("", ...roster);
  if (note.length > 0) parts.push("", ...note);
  const playbook = parts.join("\n");
  const limit = checkPlaybookLimits(playbook, { maxMessageChars: input.maxMessageChars });
  if (!limit.ok) {
    return { ok: false, code: "playbook_too_long", chars: limit.chars, lines: limit.lines, message: `playbook is ${limit.chars} characters / ${limit.lines} lines; the limit is ${limit.maxChars} characters / ${limit.maxLines} lines` };
  }
  return { ok: true, playbook, body, members, warnings, chars: limit.chars, lines: limit.lines };
}
