/**
 * Teammate types (design D5): resolve `<leadCwd>/.pi/agents/<name>.md` (only when the project is
 * trusted) then `<piAgentDir>/agents/<name>.md`, and map the file to spawn data. A small re-implementation
 * of the subagents reader: no bundled/package tiers, `tools` MUST be a YAML array (never widened to all
 * tools), `inherit_context` is ignored. Pure functions returning typed results; nothing here throws.
 * The spawn resolver and prompt-file contributor consume `AgentSpawnData`.
 * See change: add-agent-teams-templates-hooks.
 */
import path from "node:path";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import { entryExists, projectTrusted, readSourceFile, resolveSourceDir } from "./template-fs.js";
import { splitFrontmatter } from "./template-yaml.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

export const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const AGENT_MAX_BYTES = 64 * 1024;

type AgentErrorCode = "agent_not_found" | "agent_untrusted" | "agent_invalid";
type AgentSource = "project" | "user";

/** The spawn-ready subset (`renderAgentPrompt` input): role, model, thinking level, tool allowlist, prompt text. */
interface AgentSpawnData {
  role: string;
  model?: string;
  thinking?: string;
  /** Present ⇒ an allowlist (`[]` = no extra tools). */
  tools?: string[];
  /** `prompt:` key, else the markdown body (possibly empty). */
  prompt: string;
}

export interface ResolvedAgent extends AgentSpawnData {
  name: string;
  source: AgentSource;
  /** Non-fatal findings (unknown key, ignored thinking level). */
  warnings: string[];
}

export type ResolveAgentResult = { ok: true; agent: ResolvedAgent } | { ok: false; code: AgentErrorCode; message: string };
export type ParseAgentResult = { ok: true; data: AgentSpawnData; warnings: string[] } | { ok: false; message: string };

export type AgentDeps = Pick<TemplatesHooksDeps, "host" | "logger">;

const KNOWN_KEYS = ["name", "description", "model", "thinking", "tools", "prompt", "inherit_context"];

type Fm = Record<string, unknown>;
const strKey = (fm: Fm, key: string): string | undefined | "invalid" => {
  if (!Object.hasOwn(fm, key)) return undefined;
  return typeof fm[key] === "string" ? (fm[key] as string) : "invalid";
};

function readTools(fm: Fm): string[] | undefined | "invalid" {
  if (!Object.hasOwn(fm, "tools")) return undefined;
  const t = fm.tools;
  return Array.isArray(t) && t.every((e) => typeof e === "string" && e !== "") ? (t as string[]) : "invalid";
}

function readThinking(fm: Fm, warnings: string[]): string | undefined {
  if (!Object.hasOwn(fm, "thinking")) return undefined;
  const v = fm.thinking;
  if (typeof v === "string" && (THINKING_LEVELS as readonly string[]).includes(v)) return v;
  warnings.push(`unknown thinking level ${typeof v === "string" ? JSON.stringify(v) : typeof v} ignored`);
  return undefined;
}

/** Parse one agent file's text. `name` is the agent name (default role). */
export function parseAgentFile(name: string, text: string): ParseAgentResult {
  const split = splitFrontmatter(text, { required: false });
  if (!split.ok) return { ok: false, message: `frontmatter is invalid: ${split.message}` };
  const fm = split.data;
  const warnings = Object.keys(fm)
    .filter((k) => !KNOWN_KEYS.includes(k))
    .map((k) => `unknown key ${k} ignored`);
  const description = strKey(fm, "description");
  const model = strKey(fm, "model");
  const prompt = strKey(fm, "prompt");
  const invalidKey = (["description", "model", "prompt"] as const).find((k) => strKey(fm, k) === "invalid");
  if (invalidKey) return { ok: false, message: `${invalidKey} must be a string` };
  const tools = readTools(fm);
  if (tools === "invalid") return { ok: false, message: "tools must be a YAML array of tool names (a comma string would widen the member to all tools)" };
  const thinking = readThinking(fm, warnings);
  const role = description === undefined ? "" : description.replace(/\s+/g, " ").trim();
  const modelText = model?.trim();
  return {
    ok: true,
    warnings,
    data: {
      role: role === "" ? name : role,
      prompt: prompt ?? split.body.trim(),
      ...(modelText ? { model: modelText } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
      ...(tools !== undefined ? { tools } : {}),
    },
  };
}

const bad = (code: AgentErrorCode, message: string): ResolveAgentResult => ({ ok: false, code, message });

function userAgentsDir(deps: AgentDeps): ReturnType<typeof resolveSourceDir> {
  try {
    return resolveSourceDir(deps.host.resolvePiAgentDir(), "agents");
  } catch {
    return { ok: false, code: "not_found" };
  }
}

/** One tier: the resolved agent, a hard failure, or `undefined` to fall through to the next tier. */
function readTier(source: AgentSource, dir: ReturnType<typeof resolveSourceDir>, name: string): ResolveAgentResult | undefined {
  if (!dir.ok) return dir.code === "outside_source_dir" ? bad("agent_invalid", `${source} agents directory resolves outside its root`) : undefined;
  const read = readSourceFile(dir.dir, `${name}.md`, AGENT_MAX_BYTES);
  if (!read.ok) return read.code === "not_found" ? undefined : bad("agent_invalid", `agent "${name}" (${source}) is unusable: ${read.code.replace(/_/g, " ")}`);
  const parsed = parseAgentFile(name, read.text);
  if (!parsed.ok) return bad("agent_invalid", `agent "${name}" (${source}): ${parsed.message}`);
  return { ok: true, agent: { name, source, warnings: parsed.warnings, ...parsed.data } };
}

/**
 * Resolve agent `name` against the team's `leadCwd`. Trusted project file → user file; an untrusted
 * project file never shadows a user file (only-untrusted ⇒ `agent_untrusted`, none ⇒ `agent_not_found`).
 */
export function resolveAgent(name: unknown, leadCwd: string, deps: AgentDeps): ResolveAgentResult {
  if (typeof name !== "string" || !AGENT_NAME_RE.test(name)) return bad("agent_invalid", "agent name must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$");
  const trusted = projectTrusted(deps, leadCwd);
  const proj = resolveSourceDir(leadCwd, path.join(".pi", "agents"));
  const hit = (trusted ? readTier("project", proj, name) : undefined) ?? readTier("user", userAgentsDir(deps), name);
  if (hit) return hit;
  if (!trusted && proj.ok && entryExists(proj.dir, `${name}.md`)) return bad("agent_untrusted", `agent "${name}" exists only in the untrusted project`);
  return bad("agent_not_found", `agent "${name}" was not found`);
}

/** Registrar: nothing to wire — the spawn resolver and prompt contributor call `resolveAgent` directly. */
export function registerAgents(_deps: TemplatesHooksDeps): void {}
