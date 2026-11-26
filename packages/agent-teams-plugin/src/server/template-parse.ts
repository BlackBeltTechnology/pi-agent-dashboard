/**
 * Template text → validated, config-independent core: frontmatter schema, member roster expansion
 * (`count`), hook shape. Limits that depend on live config (roster cap, playbook cap, hook default
 * timeout, mode registry) are applied by `templates.ts` AFTER the cache, so a config change needs no restart.
 * See change: add-agent-teams-templates-hooks.
 */
import { MAX_TEAMMATES_RANGE, MEMBER_NAME_REGEXP, RESERVED_MEMBER_NAMES } from "../shared/constants.js";
import type { TemplateIssue } from "../shared/protocol.js";
import type { PlanApprovalPolicy, TeamHooks, TemplateMember } from "../shared/types.js";
import { AGENT_NAME_RE } from "./agents.js";
import { splitFrontmatter } from "./template-yaml.js";

const TEMPLATE_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
const HOOK_EVENT_NAMES = ["TeammateIdle", "TaskCreated", "TaskCompleted"] as const;
const MAX_HOOKS_PER_EVENT = 3;
const MAX_HOOK_COMMAND_CHARS = 2000;
const NOTIFY_COALESCE_MAX_MS = 10_000;

/** Parse result before any live-config check. */
export interface TemplateCore {
  name: string;
  description?: string;
  /** `mode` as declared (validated against the registry later). */
  declaredMode?: string;
  lead?: { model?: string };
  /** Template `maxTeammates` as declared. */
  maxTeammates?: number;
  autoDispatch?: boolean;
  notifyCoalesceMs?: number;
  spawn: "eager" | "lead";
  requirePlanApproval?: PlanApprovalPolicy;
  defaultModel?: string;
  defaultTools?: string[];
  defaultSkills?: string[];
  /** Post-`count`-expansion; `prompt` still holds the raw text (variables unsubstituted). */
  members: TemplateMember[];
  /** Hooks as declared (`timeoutMs` only where the template gave one). */
  hooks?: TeamHooks;
  body: string;
}

export interface ParseOutcome {
  core?: TemplateCore;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const has = (o: Obj, k: string): boolean => Object.hasOwn(o, k);

/** Collects issues and offers the typed field readers; every reader reports `field_invalid` with its path. */
class Reader {
  readonly errors: TemplateIssue[] = [];
  readonly warnings: TemplateIssue[] = [];
  err(code: string, path: string | undefined, message: string): void {
    this.errors.push({ code, ...(path !== undefined ? { path } : {}), message });
  }
  bad(path: string, message: string): void {
    this.err("field_invalid", path, message);
  }
  warnUnknown(o: Obj, known: readonly string[], prefix: string): void {
    for (const k of Object.keys(o)) {
      if (!known.includes(k)) this.warnings.push({ code: "unknown_key", path: prefix + k, message: `unknown key ${prefix}${k} ignored` });
    }
  }
  str(o: Obj, k: string, path: string): string | undefined {
    if (!has(o, k)) return undefined;
    const v = o[k];
    if (typeof v === "string") return v;
    this.bad(path, "must be a string");
    return undefined;
  }
  strList(o: Obj, k: string, path: string): string[] | undefined {
    if (!has(o, k)) return undefined;
    const v = o[k];
    if (!Array.isArray(v) || v.some((e) => typeof e !== "string" || e === "")) {
      this.bad(path, "must be an array of non-empty strings");
      return undefined;
    }
    return v as string[];
  }
  int(o: Obj, k: string, path: string, min: number): number | undefined {
    if (!has(o, k)) return undefined;
    if (isInt(o[k], min)) return o[k] as number;
    this.bad(path, `must be an integer of at least ${min}`);
    return undefined;
  }
  bool(o: Obj, k: string, path: string): boolean | undefined {
    if (!has(o, k)) return undefined;
    if (typeof o[k] === "boolean") return o[k] as boolean;
    this.bad(path, "must be a boolean");
    return undefined;
  }
  policy(o: Obj, k: string, path: string): PlanApprovalPolicy | undefined {
    if (!has(o, k)) return undefined;
    const v = o[k];
    if (v === true || v === false || v === "user") return v;
    this.bad(path, 'must be false, true or "user"');
    return undefined;
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

const MEMBER_KEYS = ["name", "agent", "role", "model", "count", "tools", "skills", "cwd", "requirePlanApproval", "prompt"] as const;

interface DeclaredMember {
  base: string;
  count: number;
  common: Omit<TemplateMember, "name">;
}

/** One `members[i]` entry before expansion; `undefined` when it has no usable name (errors already recorded). */
function readMember(r: Reader, entry: unknown, i: number): DeclaredMember | undefined {
  const p = `members[${i}]`;
  if (!isObj(entry)) return void r.bad(p, "must be a mapping");
  r.warnUnknown(entry, MEMBER_KEYS, `${p}.`);
  const base = r.str(entry, "name", `${p}.name`);
  if (!has(entry, "name")) r.bad(`${p}.name`, "is required");
  const agent = r.str(entry, "agent", `${p}.agent`);
  if (agent !== undefined && !AGENT_NAME_RE.test(agent)) r.bad(`${p}.agent`, "is not a valid agent name");
  const common: Omit<TemplateMember, "name"> = {
    ...optional("agent", agent),
    ...optional("role", r.str(entry, "role", `${p}.role`)),
    ...optional("model", r.str(entry, "model", `${p}.model`)),
    ...optional("tools", r.strList(entry, "tools", `${p}.tools`)),
    ...optional("skills", r.strList(entry, "skills", `${p}.skills`)),
    ...optional("cwd", r.str(entry, "cwd", `${p}.cwd`)),
    ...optional("requirePlanApproval", r.policy(entry, "requirePlanApproval", `${p}.requirePlanApproval`)),
    ...optional("prompt", r.str(entry, "prompt", `${p}.prompt`)),
  };
  const count = r.int(entry, "count", `${p}.count`, 1) ?? 1;
  return base === undefined ? undefined : { base, count, common };
}

/** `count` expansion: `name` for 1, `name-1…-n` for n > 1; each expanded name must pass the core rule and stay unique. */
function expandMember(r: Reader, m: DeclaredMember, i: number, seen: Set<string>, out: TemplateMember[]): void {
  const p = `members[${i}].name`;
  for (let n = 1; n <= m.count; n++) {
    const name = m.count === 1 ? m.base : `${m.base}-${n}`;
    if (!MEMBER_NAME_REGEXP.test(name)) return r.err("roster_name_invalid", p, `expanded member name "${name}" is not a valid member name (${MEMBER_NAME_REGEXP.source})`);
    if (seen.has(name)) return r.err("duplicate_member", p, `member name "${name}" appears more than once after expansion`);
    seen.add(name);
    out.push({ name, ...m.common });
  }
}

function parseMembers(r: Reader, raw: unknown): TemplateMember[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    r.bad("members", "must be an array");
    return [];
  }
  const out: TemplateMember[] = [];
  const seen = new Set<string>();
  const declared = raw.map((entry, i) => readMember(r, entry, i));
  let total = 0;
  declared.forEach((m, i) => {
    if (m === undefined) return;
    if (RESERVED_MEMBER_NAMES.includes(m.base)) return r.err("name_reserved", `members[${i}].name`, `member name "${m.base}" is reserved`);
    total += m.count;
    if (total > MAX_TEAMMATES_RANGE.max) return; // reported once below; never expand an oversized roster
    expandMember(r, m, i, seen, out);
  });
  if (total > MAX_TEAMMATES_RANGE.max) r.err("roster_exceeds_max", "members", `the roster expands beyond ${MAX_TEAMMATES_RANGE.max} teammates`);
  return out;
}

function readHookCommand(r: Reader, h: unknown, hp: string): { command: string; timeoutMs?: number } | undefined {
  if (!isObj(h)) return void r.bad(hp, "must be a mapping");
  r.warnUnknown(h, ["command", "timeoutMs"], `${hp}.`);
  const command = r.str(h, "command", `${hp}.command`);
  if (!has(h, "command")) r.bad(`${hp}.command`, "is required");
  if (command !== undefined && command.trim() === "") r.bad(`${hp}.command`, "must not be empty");
  else if (command !== undefined && [...command].length > MAX_HOOK_COMMAND_CHARS) r.err("hook_command_too_long", `${hp}.command`, `command is longer than ${MAX_HOOK_COMMAND_CHARS} characters`);
  const timeoutMs = r.int(h, "timeoutMs", `${hp}.timeoutMs`, 1);
  return command === undefined ? undefined : { command, ...optional("timeoutMs", timeoutMs) };
}

function parseHooks(r: Reader, raw: unknown): TeamHooks | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) return void r.bad("hooks", "must be a mapping of event to command list");
  const hooks: TeamHooks = {};
  for (const [event, list] of Object.entries(raw)) {
    const p = `hooks.${event}`;
    if (!(HOOK_EVENT_NAMES as readonly string[]).includes(event)) {
      r.warnings.push({ code: "unknown_hook_event", path: p, message: `unknown hook event ${event} ignored` });
      continue;
    }
    if (!Array.isArray(list)) {
      r.bad(p, "must be an array of {command, timeoutMs?}");
      continue;
    }
    if (list.length > MAX_HOOKS_PER_EVENT) {
      r.err("too_many_hooks", p, `at most ${MAX_HOOKS_PER_EVENT} commands per event`);
      continue;
    }
    const cmds = list.map((h, i) => readHookCommand(r, h, `${p}[${i}]`)).filter((c) => c !== undefined);
    if (cmds.length > 0) hooks[event as keyof TeamHooks] = cmds;
  }
  return Object.keys(hooks).length > 0 ? hooks : undefined;
}

function readName(r: Reader, declared: unknown, stem: string): void {
  if (typeof declared !== "string" || !TEMPLATE_NAME_RE.test(declared)) r.err("name_invalid", "name", `name must match ${TEMPLATE_NAME_RE.source}`);
  else if (declared !== stem) r.err("name_mismatch", "name", `name "${declared}" must equal the file name "${stem}"`);
}

function readLead(r: Reader, fm: Obj): { model?: string } | undefined {
  if (!has(fm, "lead")) return undefined;
  if (!isObj(fm.lead)) return void r.bad("lead", "must be a mapping");
  r.warnUnknown(fm.lead, ["model"], "lead.");
  return optional("model", r.str(fm.lead, "model", "lead.model"));
}

function readNotify(r: Reader, fm: Obj): number | undefined {
  if (!has(fm, "notify")) return undefined;
  if (!isObj(fm.notify)) return void r.bad("notify", "must be a mapping");
  r.warnUnknown(fm.notify, ["coalesceMs"], "notify.");
  if (!has(fm.notify, "coalesceMs")) return undefined;
  const v = fm.notify.coalesceMs;
  if (typeof v !== "number" || !Number.isInteger(v)) return void r.bad("notify.coalesceMs", "must be an integer");
  if (v < 0 || v > NOTIFY_COALESCE_MAX_MS) return void r.err("notify_out_of_range", "notify.coalesceMs", `must be within 0-${NOTIFY_COALESCE_MAX_MS}`);
  return v;
}

function readSpawn(r: Reader, fm: Obj): "eager" | "lead" {
  if (!has(fm, "spawn")) return "eager";
  if (fm.spawn === "eager" || fm.spawn === "lead") return fm.spawn;
  r.bad("spawn", 'must be "eager" or "lead"');
  return "eager";
}

const TOP_KEYS = ["name", "description", "mode", "lead", "maxTeammates", "autoDispatch", "spawn", "requirePlanApproval", "defaultModel", "defaultTools", "defaultSkills", "notify", "members", "hooks"] as const;

/** Parse one template file. `stem` is the filename without `.md`; it must equal the frontmatter `name`. */
export function parseTemplate(text: string, stem: string): ParseOutcome {
  const r = new Reader();
  const split = splitFrontmatter(text, { required: true });
  if (!split.ok) {
    r.err("frontmatter_invalid", undefined, split.message);
    return { errors: r.errors, warnings: r.warnings };
  }
  const fm = split.data;
  r.warnUnknown(fm, TOP_KEYS, "");
  readName(r, fm.name, stem);
  const declaredMode = r.str(fm, "mode", "mode");
  if (declaredMode !== undefined && declaredMode.trim() === "") r.bad("mode", "must not be empty");
  const members = parseMembers(r, fm.members);
  const core: TemplateCore = {
    name: typeof fm.name === "string" ? fm.name : stem,
    spawn: readSpawn(r, fm),
    members,
    body: split.body,
    ...optional("description", r.str(fm, "description", "description")),
    ...optional("declaredMode", declaredMode),
    ...optional("lead", readLead(r, fm)),
    ...optional("maxTeammates", r.int(fm, "maxTeammates", "maxTeammates", 1)),
    ...optional("autoDispatch", r.bool(fm, "autoDispatch", "autoDispatch")),
    ...optional("notifyCoalesceMs", readNotify(r, fm)),
    ...optional("requirePlanApproval", r.policy(fm, "requirePlanApproval", "requirePlanApproval")),
    ...optional("defaultModel", r.str(fm, "defaultModel", "defaultModel")),
    ...optional("defaultTools", r.strList(fm, "defaultTools", "defaultTools")),
    ...optional("defaultSkills", r.strList(fm, "defaultSkills", "defaultSkills")),
    ...optional("hooks", parseHooks(r, fm.hooks)),
  };
  return { core, errors: r.errors, warnings: r.warnings };
}
