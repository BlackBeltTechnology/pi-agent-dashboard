/**
 * Team isolation guard (D7): a deny-first `tool_call` decision. Pure — the
 * policy comes from the spawn-time env projection, the filesystem is only read
 * to canonicalise path arguments. See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";

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

export interface TeamPolicy {
  preset: Preset;
  /** Target root (project realpath or own workspace). */
  root: string;
}

export type Decision = { allow: true } | { allow: false; reason: string };

/** Read the policy from `PI_EXT_TEAM_*`; missing / garbage ⇒ null (caller blocks everything). */
export function policyFromEnv(env: Record<string, string | undefined> = process.env): TeamPolicy | null {
  const tools = env.PI_EXT_TEAM_TOOLS;
  const root = env.PI_EXT_TEAM_ROOT;
  if (tools !== "chat" && tools !== "files" && tools !== "full") return null;
  if (typeof root !== "string" || !path.isAbsolute(root)) return null;
  return { preset: tools, root };
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
    if (!inside(root, target)) return { allow: false, reason: "path_outside_root" };
    if (WRITE_TOOLS.has(toolName) && path.relative(root, target).split(path.sep).some((seg) => PROTECTED_SEGMENTS.has(seg))) {
      return { allow: false, reason: "protected_path" };
    }
  }
  return { allow: true };
}
