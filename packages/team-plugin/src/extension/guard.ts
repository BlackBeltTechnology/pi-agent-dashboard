/**
 * Team isolation guard: a deny-first `tool_call` decision plus the skill
 * gates (D9/D10). Pure — the policy comes from the spawn-time env projection,
 * the filesystem is only read to canonicalise path arguments.
 * See change: add-team-plugin, add-team-skill-access.
 */
import fs from "node:fs";
import path from "node:path";
import { parseSkillBlock, parseSkillCommand } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

export type Preset = "chat" | "files" | "full";

export const PRESET_TOOLS: Record<Preset, readonly string[]> = {
  chat: ["read", "grep", "find", "ls"],
  files: ["read", "grep", "find", "ls", "write", "edit"],
  full: ["read", "grep", "find", "ls", "write", "edit", "bash"],
};

/** Mutating tools additionally may not touch VCS / agent-config dirs (a planted hook or `.pi` resource would run for the operator). */
const WRITE_TOOLS = new Set(["write", "edit"]);
const PROTECTED_SEGMENTS = new Set([".git", ".pi", ".claude"]);

/** Tools whose `path` argument is confined to the target root. */
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

/** Read-only tools may additionally reach into effective skill roots (D9). */
const READONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

interface SkillRoot {
  /** The catalog name — pi's skill name (D1). */
  name: string;
  /** The granted skill root: the skill directory's realpath (D3). */
  root: string;
}

export interface TeamPolicy {
  preset: Preset;
  /** Target root (project realpath or own workspace). */
  root: string;
  /** Effective skills only (D9): the plugin always sets `PI_EXT_TEAM_SKILLS`, `"[]"` when empty. */
  skills: SkillRoot[];
}

export type Decision = { allow: true } | { allow: false; reason: string };

/** Parse `PI_EXT_TEAM_SKILLS` (D7 transport): a JSON array of `{name, root}`. Anything else ⇒ null (fail closed). */
function parseSkills(raw: string | undefined): SkillRoot[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const skills: SkillRoot[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null;
    const { name, root } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !name) return null;
    if (typeof root !== "string" || !path.isAbsolute(root)) return null;
    skills.push({ name, root });
  }
  return skills;
}

/** Read the policy from `PI_EXT_TEAM_*`; missing / garbage ⇒ null (caller blocks everything). */
export function policyFromEnv(env: Record<string, string | undefined> = process.env): TeamPolicy | null {
  const tools = env.PI_EXT_TEAM_TOOLS;
  const root = env.PI_EXT_TEAM_ROOT;
  if (tools !== "chat" && tools !== "files" && tools !== "full") return null;
  if (typeof root !== "string" || !path.isAbsolute(root)) return null;
  const skills = parseSkills(env.PI_EXT_TEAM_SKILLS);
  if (!skills) return null; // D9: a missing or unparseable skill policy is an unusable policy — no readiness.
  return { preset: tools, root, skills };
}

function canonicalize(p: string): string {
  const abs = path.resolve(p);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(head);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

function inside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Mirror pi's path normalisation (`@` prefix, unicode spaces) before resolving. */
function normalise(raw: string): string | null {
  if (raw.includes("\0")) return null;
  let p = raw.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (p.startsWith("~")) return null; // pi expands ~ to the home dir: never confine-able lexically
  // pi turns `file://…` into a real filesystem path; any `scheme:` prefix (≥ 2 chars, so a drive letter
  // stays legal) is refused instead of mirroring every conversion pi might add.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(p)) return null;
  return p;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
export function decideToolCall(toolName: unknown, input: unknown, policy: TeamPolicy | null): Decision {
  if (!policy) return { allow: false, reason: "policy_unavailable" };
  if (typeof toolName !== "string" || !PRESET_TOOLS[policy.preset].includes(toolName)) {
    return { allow: false, reason: "tool_not_allowed" };
  }
  if (!PATH_TOOLS.has(toolName)) return { allow: true };
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const root = canonicalize(policy.root);
  for (const key of ["path", "file_path"]) {
    const v = args[key];
    if (v === undefined) continue;
    if (typeof v !== "string") return { allow: false, reason: "invalid_path" };
    const n = normalise(v);
    if (n === null) return { allow: false, reason: "invalid_path" };
    const target = canonicalize(path.isAbsolute(n) ? n : path.join(root, n));
    if (!inside(root, target)) {
      // D9: outside the target root, a read-only tool may still reach into an effective skill root.
      const inSkillRoot = READONLY_TOOLS.has(toolName) && policy.skills.some((s) => inside(canonicalize(s.root), target));
      if (!inSkillRoot) return { allow: false, reason: "path_outside_root" };
    }
    if (WRITE_TOOLS.has(toolName) && path.relative(root, target).split(path.sep).some((seg) => PROTECTED_SEGMENTS.has(seg))) {
      return { allow: false, reason: "protected_path" };
    }
  }
  return { allow: true };
}

/**
 * D10: predicate for the `before_agent_start` filter — keep a listed skill only when its `(name, canonical
 * filePath)` matches a policy entry (`<root>/SKILL.md`), at most one entry per policy slot (the canonical
 * granted skill). A missing policy grants nothing: every skill is filtered out. The returned predicate
 * holds one-shot per-slot state: construct a FRESH predicate per agent start (the handler does) —
 * reusing one across starts would drop every granted skill after the first (audit F3).
 */
export function grantedSkillFilter(policy: TeamPolicy | null): (entry: unknown) => boolean {
  if (!policy) return () => false;
  const slots = policy.skills.map((s) => ({ name: s.name, canonical: canonicalize(path.join(s.root, "SKILL.md")), used: false }));
  return (entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const { name, filePath } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof filePath !== "string") return false;
    const canonical = canonicalize(filePath);
    const slot = slots.find((s) => !s.used && s.name === name && s.canonical === canonical);
    if (!slot) return false;
    slot.used = true;
    return true;
  };
}

/**
 * D10/D13: is this user input refused? An ungranted `/skill:<name>` command, or a `<skill …>` envelope whose
 * canonical location lies outside every effective skill root. A missing policy fails closed: every skill
 * command and every envelope is refused; plain text still continues. The caller returns `{action:"handled"}`
 * and never calls `ctx.ui.notify` (the bridge owns the user-facing refusal, D12).
 */
export function isRefusedInput(text: unknown, policy: TeamPolicy | null): boolean {
  if (typeof text !== "string") return false;
  const command = parseSkillCommand(text);
  if (command) return !policy?.skills.some((s) => s.name === command.name);
  const envelope = parseSkillBlock(text);
  if (envelope) {
    const location = canonicalize(envelope.location);
    return !policy?.skills.some((s) => inside(canonicalize(s.root), location));
  }
  return false;
}
