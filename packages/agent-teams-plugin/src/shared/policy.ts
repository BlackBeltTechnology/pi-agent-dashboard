/**
 * Teammate policy (tasks 5.3 / 9.x, design D4 / D11): the spawn-time projection
 * the server hands a teammate through `extensionConfig` (→ `PI_EXT_AGENT_TEAMS_*`
 * env) and the bridge guard enforces. The env is only a HINT for tool/guard
 * selection — the server stays authoritative: it expects `policyHash` in `hello`
 * to equal the hash of the exact policy string it spawned the member with.
 * See change: add-agent-teams-core.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { Committer } from "./types.js";

/** `extensionConfig["agent-teams"]` keys; the host maps them to `PI_EXT_AGENT_TEAMS_<KEY>` (camelCase → SNAKE_CASE). */
export const EXT_KEY_TEAM_ID = "teamId";
export const EXT_KEY_MEMBER = "member";
export const EXT_KEY_POLICY = "policy";
export const EXT_KEY_COMMITTER = "committer";

export const ENV_TEAM_ID = "PI_EXT_AGENT_TEAMS_TEAM_ID";
export const ENV_MEMBER = "PI_EXT_AGENT_TEAMS_MEMBER";
export const ENV_POLICY = "PI_EXT_AGENT_TEAMS_POLICY";
export const ENV_COMMITTER = "PI_EXT_AGENT_TEAMS_COMMITTER";

/** Env of OTHER plugins that confine a session: such a session registers no team tools (no capability escalation). */
export const CONFINING_ENV_KEYS: readonly string[] = ["PI_EXT_TEAM_TOOLS", "PI_EXT_CHAT_GATEWAY_GUARD_POLICY"];

export interface SkillGrant {
  /** pi skill name (directory name of the skill). */
  name: string;
  /** Granted skill root: the directory holding `SKILL.md`. */
  root: string;
}

export interface TeammatePolicy {
  /** Effective tool allowlist INCLUDING the team tools; absent = unrestricted. */
  tools?: string[];
  /** Skill allowlist; absent = unrestricted, `[]` = none. */
  skills?: SkillGrant[];
  blockSleepPolling: boolean;
  blockGitWrite: boolean;
  committer: Committer;
}

/** Resolved `SKILL.md` paths → grants (`name` = directory name, `root` = directory). */
export function skillGrantsFromPaths(paths: readonly string[]): SkillGrant[] {
  return paths.map((p) => {
    const root = path.dirname(p);
    return { name: path.basename(root), root };
  });
}

/** Deterministic serialisation (fixed key order): the string the env carries and the hash covers. */
export function serializePolicy(p: TeammatePolicy): string {
  return JSON.stringify({
    v: 1,
    ...(p.tools ? { tools: p.tools } : {}),
    ...(p.skills ? { skills: p.skills.map((s) => ({ name: s.name, root: s.root })) } : {}),
    blockSleepPolling: p.blockSleepPolling,
    blockGitWrite: p.blockGitWrite,
    committer: p.committer,
  });
}

export function policyHash(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex").slice(0, 32);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Parse the env policy; anything malformed ⇒ `null` (the caller fails closed). */
export function parsePolicy(raw: string | undefined): TeammatePolicy | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.blockSleepPolling !== "boolean" || typeof o.blockGitWrite !== "boolean") return null;
  if (o.committer !== "lead" && o.committer !== "member") return null;
  if (o.tools !== undefined && !isStringArray(o.tools)) return null;
  let skills: SkillGrant[] | undefined;
  if (o.skills !== undefined) {
    if (!Array.isArray(o.skills)) return null;
    skills = [];
    for (const entry of o.skills) {
      if (entry === null || typeof entry !== "object") return null;
      const { name, root } = entry as Record<string, unknown>;
      if (typeof name !== "string" || name === "" || typeof root !== "string" || !path.isAbsolute(root)) return null;
      skills.push({ name, root });
    }
  }
  return {
    ...(o.tools ? { tools: o.tools as string[] } : {}),
    ...(skills ? { skills } : {}),
    blockSleepPolling: o.blockSleepPolling,
    blockGitWrite: o.blockGitWrite,
    committer: o.committer,
  };
}
