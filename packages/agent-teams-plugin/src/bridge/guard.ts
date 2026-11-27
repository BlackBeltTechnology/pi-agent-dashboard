/**
 * Teammate guard layers (tasks 9.1–9.6; design D11). Copy-adapted from
 * `packages/team-plugin/src/extension/guard.ts` (cross-plugin imports are not
 * allowed for bundled plugins; extraction is a recorded follow-up). The policy is
 * the spawn-time projection in `PI_EXT_AGENT_TEAMS_POLICY`:
 *
 *  - tool name gate (backstop for `scope.tools`; team tools always allowed)
 *  - skill layer 2 `before_agent_start`: in-place `systemPromptOptions.skills` filter
 *  - skill layer 3 `input`: refuse ungranted `/skill:<name>` and out-of-root envelopes
 *  - skill layer 4 `tool_call`: `read` of a `SKILL.md` outside the granted roots
 *  - sleep-poll guard and git-write guard on `bash` (advisory: see `shell-guard.ts`)
 *
 * Layer 1 (spawn scope `noSkills` + resolved `skills`) is server side. With `bash`
 * allowed the skill allowlist is advisory: a shell can `cat` anything.
 * See change: add-agent-teams-core.
 */
import path from "node:path";
import { parseSkillBlock, parseSkillCommand } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import { canonicalizeTarget, isPathWithinRoots } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";
import { policyHash as hashPolicyString, type TeammatePolicy } from "../shared/policy.js";
import { TEAM_TOOLS_BY_ROLE } from "../shared/protocol.js";
import { openspecWriteBlock } from "./openspec-guard.js";
import { commandWritesGit, GIT_WRITE_REASON, isSleepPoll, SLEEP_REASON } from "./shell-guard.js";

export type Decision = { allow: true } | { allow: false; reason: string };

/** What the handlers consult; `enabled:false` (the session left its team) makes every handler inert. */
export interface GuardState {
  enabled: boolean;
  /** `null` ⇒ the env policy is missing or unparseable: fail closed (block every tool call). */
  policy: TeammatePolicy | null;
  /**
   * Member of an `openspec-apply` team (spawn env `PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE=apply`): `write`/`edit` of
   * `<cwd>/openspec/changes/*\/tasks.md` and `…/specs/**` are refused. `cwd` is the shared (lead) cwd.
   * See change: add-agent-teams-openspec.
   */
  openspecApply?: { cwd: string };
}

/** Optional extra layers of `decideToolCall` (absent ⇒ the core guard only). */
export interface DecideExtras {
  openspecApply?: { cwd: string };
}

const TEAM_TOOL_NAMES: ReadonlySet<string> = new Set(TEAM_TOOLS_BY_ROLE.member);

/** Hash of the exact env policy string — what the server expects in `hello`. */
export function hashOfEnvPolicy(raw: string | undefined): string | undefined {
  return typeof raw === "string" && raw !== "" ? hashPolicyString(raw) : undefined;
}

function canonicalize(p: string): string | null {
  try {
    return canonicalizeTarget(path.resolve(p));
  } catch {
    return null;
  }
}

/** Mirror pi's path normalisation (`@` prefix, unicode spaces); `~`, URLs and NULs cannot be confined lexically. */
function normalise(raw: string): string | null {
  if (raw.includes("\0")) return null;
  let p = raw.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (p.startsWith("~")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(p)) return null;
  return p;
}

function insideRoot(root: string, target: string): boolean {
  const r = canonicalize(root);
  return r !== null && isPathWithinRoots(target, [r]);
}

const isSkillFile = (p: string): boolean => path.basename(p).toLowerCase() === "skill.md";

/** Layer 4: may the model `read` this path? Only `SKILL.md` files are restricted, and only when a skill allowlist exists. */
function readsUngrantedSkill(input: unknown, policy: TeammatePolicy): boolean {
  if (!policy.skills) return false;
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const key of ["path", "file_path"]) {
    const v = args[key];
    if (typeof v !== "string") continue;
    const n = normalise(v);
    if (n === null) return path.basename(v).toLowerCase() === "skill.md"; // unconfinable path to a skill file: refuse
    if (!isSkillFile(n)) continue;
    const target = canonicalize(n);
    if (target === null) return true;
    if (!policy.skills.some((s) => insideRoot(s.root, target))) return true;
  }
  return false;
}

/** The sleep-poll and git-write guards of one `bash` command; `undefined` = allowed. */
function bashDecision(command: string, policy: TeammatePolicy): Decision | undefined {
  if (policy.blockSleepPolling && isSleepPoll(command)) return { allow: false, reason: SLEEP_REASON };
  if (policy.blockGitWrite && policy.committer === "lead" && commandWritesGit(command)) return { allow: false, reason: GIT_WRITE_REASON };
  return undefined;
}

/** Layers that only apply to some members (today: the apply-team sole-writer guard). */
function extraDecision(toolName: string, input: unknown, extras: DecideExtras): Decision {
  const reason = extras.openspecApply ? openspecWriteBlock(toolName, input, extras.openspecApply.cwd) : undefined;
  return reason ? { allow: false, reason } : { allow: true };
}

export function decideToolCall(toolName: unknown, input: unknown, policy: TeammatePolicy | null, extras: DecideExtras = {}): Decision {
  if (!policy) return { allow: false, reason: "policy_unavailable" };
  if (typeof toolName !== "string") return { allow: false, reason: "tool_not_allowed" };
  if (policy.tools && !policy.tools.includes(toolName) && !TEAM_TOOL_NAMES.has(toolName)) {
    return { allow: false, reason: `tool_not_allowed: ${toolName}` };
  }
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const shell = toolName === "bash" && typeof args.command === "string" ? bashDecision(args.command, policy) : undefined;
  if (shell) return shell;
  if (toolName === "read" && readsUngrantedSkill(input, policy)) return { allow: false, reason: "skill_not_granted: read of a SKILL.md outside the granted skill roots" };
  return extraDecision(toolName, input, extras);
}

/**
 * Layer 2 predicate for `before_agent_start`: keep a listed skill only when its `(name, canonical filePath)`
 * matches a grant (`<root>/SKILL.md`), at most one entry per grant. Construct a FRESH predicate per agent
 * start — the grant slots are single-use (team-plugin audit F3).
 */
function grantedSkillFilter(policy: TeammatePolicy | null): (entry: unknown) => boolean {
  if (!policy?.skills) return policy ? () => true : () => false;
  const slots = policy.skills.map((s) => ({ name: s.name, canonical: canonicalize(path.join(s.root, "SKILL.md")), used: false }));
  return (entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const { name, filePath } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof filePath !== "string") return false;
    const canonical = canonicalize(filePath);
    if (canonical === null) return false;
    const slot = slots.find((s) => !s.used && s.name === name && s.canonical === canonical);
    if (!slot) return false;
    slot.used = true;
    return true;
  };
}

/** Layer 3: is this user input refused? An ungranted `/skill:<name>` or an envelope located outside every granted root. */
function isRefusedInput(text: unknown, policy: TeammatePolicy | null): boolean {
  if (typeof text !== "string") return false;
  if (policy && !policy.skills) return false; // unrestricted
  const command = parseSkillCommand(text);
  if (command) return !policy?.skills?.some((s) => s.name === command.name);
  const envelope = parseSkillBlock(text);
  if (envelope) {
    const location = canonicalize(envelope.location);
    if (location === null) return true;
    return !policy?.skills?.some((s) => insideRoot(s.root, location));
  }
  return false;
}

// ── pi event handlers ────────────────────────────────────────────────────────

export function createToolCallHandler(state: GuardState) {
  return (event: { toolName?: unknown; input?: unknown } | undefined): { block: true; reason: string } | undefined => {
    if (!state.enabled) return undefined;
    const d = decideToolCall(event?.toolName, event?.input, state.policy, state.openspecApply ? { openspecApply: state.openspecApply } : {});
    return d.allow ? undefined : { block: true, reason: `agent-teams: ${d.reason}` };
  };
}

/** Splice `systemPromptOptions.skills` in place; never return a `systemPrompt` string. */
export function createBeforeAgentStartHandler(state: GuardState) {
  return (event: { systemPromptOptions?: { skills?: unknown } } | undefined): undefined => {
    if (!state.enabled) return undefined;
    const skills = event?.systemPromptOptions?.skills;
    if (!Array.isArray(skills)) return undefined;
    skills.splice(0, skills.length, ...skills.filter(grantedSkillFilter(state.policy)));
    return undefined;
  };
}

/** `{action:"handled"}` drops the text before any skill expansion. */
export function createInputHandler(state: GuardState) {
  return (event: { text?: unknown } | undefined): { action: "handled" } | { action: "continue" } => {
    if (!state.enabled) return { action: "continue" };
    return isRefusedInput(event?.text, state.policy) ? { action: "handled" } : { action: "continue" };
  };
}
