/**
 * Strict parse of an `agent-teams:inproc` command (design D3, spec "Command secret", test-plan S36) and the pure builder
 * of the `subagents:spawn` request (task 5.3, design "Required upstream API"). The bus is shared with every extension in the
 * lead, so NOTHING is taken on trust: a command is rebuilt field by field from whitelisted, length-bounded values (hostile
 * extras are dropped, `__proto__`/`constructor` keys reject the command), and the spawn request is built only from that
 * rebuilt command, so `inline`/`isolated`/`managed`/`ask` can never be overridden from the bus.
 * Pure: no bus, no timers. Errors name the FIELD, never the value.
 * See change: add-agent-teams-in-process.
 */
import { MEMBER_NAME_REGEXP } from "../shared/constants.js";
import type { InProcCommand, InProcSpawnSpec, SpawnCommand, SteerCommand } from "../shared/inproc-protocol.js";
import { MANAGED_OWNER, type SpawnLoaderOptions, type SpawnRequestBody, type SubagentsFeature } from "../shared/subagents-contract.js";
import { truncateCodePoints } from "../shared/text.js";

const MAX_CMD_ID_CHARS = 200;
const MAX_PROMPT_CHARS = 1024 * 1024;
const MAX_BLOCKS = 1000;
const MAX_BLOCK_CHARS = 64 * 1024;
const MAX_PATH_CHARS = 4096;
const MAX_LIST = 200;
const DOCK_DESCRIPTION_MAX_CODE_POINTS = 80;
const DOCK_SUBAGENT_TYPE = "teammate";

/** Tools the child must never receive from a command (the package strips them as well; defence in depth). */
const FORBIDDEN_CHILD_TOOLS: readonly string[] = ["Agent", "AgentControl", "ask_parent"];

type Rec = Record<string, unknown>;
export type Parsed = { ok: true; cmd: InProcCommand } | { ok: false; field: string };

const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o: Rec, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const fail = (field: string): Parsed => ({ ok: false, field });
const hasNul = (s: string): boolean => s.includes("\u0000");
const poisoned = (o: Rec): boolean => Object.hasOwn(o, "__proto__") || Object.hasOwn(o, "constructor") || Object.hasOwn(o, "prototype");

/** A usable `cmdId` (`undefined` ⇒ the command cannot even be acknowledged). */
export function cmdIdOf(raw: Rec): string | undefined {
  const id = own(raw, "cmdId");
  return typeof id === "string" && id.length > 0 && id.length <= MAX_CMD_ID_CHARS ? id : undefined;
}

function strList(v: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(v) || v.length > maxItems) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item.length === 0 || item.length > maxChars || hasNul(item)) return undefined;
    out.push(item);
  }
  return out;
}

function parseEnv(v: unknown): Record<string, string | string[]> | undefined {
  if (!isRec(v) || poisoned(v)) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k.length > 200) return undefined;
    if (typeof val === "string") out[k] = val.slice(0, 64 * 1024);
    else if (Array.isArray(val) && val.every((x) => typeof x === "string")) out[k] = val.slice(0, MAX_LIST) as string[];
    else return undefined;
  }
  return out;
}

const optStr = (o: Rec, k: string, max: number): string | undefined | "bad" => {
  const v = own(o, k);
  if (v === undefined) return undefined;
  return typeof v === "string" && v.length <= max && !hasNul(v) ? v : "bad";
};

type SpecLists = Pick<InProcSpawnSpec, "promptFiles" | "env"> & Partial<Pick<InProcSpawnSpec, "tools" | "skills">>;

/** `tools`, `skills`, `promptFiles` and `env` of a spec (each bounded); a string is the offending field. */
function parseSpecLists(v: Rec): SpecLists | string {
  const tools = own(v, "tools") === undefined ? undefined : strList(own(v, "tools"), MAX_LIST, 200);
  if (own(v, "tools") !== undefined && !tools) return "spec.tools";
  const skills = own(v, "skills") === undefined ? undefined : strList(own(v, "skills"), MAX_LIST, MAX_PATH_CHARS);
  if (own(v, "skills") !== undefined && !skills) return "spec.skills";
  const promptFiles = strList(own(v, "promptFiles"), 50, MAX_PATH_CHARS);
  if (!promptFiles) return "spec.promptFiles";
  const env = parseEnv(own(v, "env") ?? {});
  if (!env) return "spec.env";
  return { promptFiles, env, ...(tools ? { tools } : {}), ...(skills ? { skills } : {}) };
}

type SpecFlags = Pick<InProcSpawnSpec, "noMcp" | "noContextFiles" | "leanChildren"> & Partial<Pick<InProcSpawnSpec, "idleTtlSec" | "cwdScope">>;

/** The booleans, the idle TTL and the cwd scope of a spec; a string is the offending field. */
function parseSpecFlags(v: Rec): SpecFlags | string {
  for (const key of ["noMcp", "noContextFiles", "leanChildren"] as const) if (typeof own(v, key) !== "boolean") return `spec.${key}`;
  const idle = own(v, "idleTtlSec");
  if (idle !== undefined && !(typeof idle === "number" && Number.isInteger(idle) && idle >= 1 && idle <= 31_536_000)) return "spec.idleTtlSec";
  const scope = own(v, "cwdScope");
  if (scope !== undefined && scope !== "any") return "spec.cwdScope";
  return {
    noMcp: own(v, "noMcp") as boolean,
    noContextFiles: own(v, "noContextFiles") as boolean,
    leanChildren: own(v, "leanChildren") as boolean,
    ...(idle !== undefined ? { idleTtlSec: idle as number } : {}),
    ...(scope === "any" ? { cwdScope: "any" as const } : {}),
  };
}

function parseSpec(v: unknown): InProcSpawnSpec | string {
  if (!isRec(v) || poisoned(v)) return "spec";
  const cwd = own(v, "cwd");
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > MAX_PATH_CHARS || hasNul(cwd)) return "spec.cwd";
  const model = optStr(v, "model", 200);
  if (model === "bad") return "spec.model";
  const thinking = optStr(v, "thinkingLevel", 40);
  if (thinking === "bad") return "spec.thinkingLevel";
  const lists = parseSpecLists(v);
  if (typeof lists === "string") return lists;
  const flags = parseSpecFlags(v);
  if (typeof flags === "string") return flags;
  return { cwd, ...(model ? { model } : {}), ...(thinking ? { thinkingLevel: thinking } : {}), ...lists, ...flags };
}

function parseSpawn(raw: Rec, cmdId: string, secret: string, member: string): Parsed {
  const teamId = own(raw, "teamId");
  if (typeof teamId !== "string" || teamId.length === 0 || teamId.length > 200 || hasNul(teamId)) return fail("teamId");
  const prompt = own(raw, "prompt");
  if (typeof prompt !== "string" || prompt.length > MAX_PROMPT_CHARS) return fail("prompt");
  const token = own(raw, "proxyToken");
  if (typeof token !== "string" || token.length === 0 || token.length > 256) return fail("proxyToken");
  const role = optStr(raw, "role", 100);
  if (role === "bad") return fail("role");
  const title = optStr(raw, "title", 1000);
  if (title === "bad") return fail("title");
  const mailId = own(raw, "promptMailId");
  if (mailId !== undefined && !(typeof mailId === "number" && Number.isInteger(mailId) && mailId >= 0)) return fail("promptMailId");
  const spec = parseSpec(own(raw, "spec"));
  if (typeof spec === "string") return fail(spec);
  const cmd: SpawnCommand = {
    cmd: "spawn",
    cmdId,
    secret,
    teamId,
    member,
    ...(role ? { role } : {}),
    prompt,
    ...(title ? { title } : {}),
    ...(mailId !== undefined ? { promptMailId: mailId as number } : {}),
    spec,
    proxyToken: token,
  };
  return { ok: true, cmd };
}

function parseSteer(raw: Rec, cmdId: string, secret: string, member: string): Parsed {
  const nudge = own(raw, "nudge");
  if (nudge !== undefined && nudge !== true) return fail("nudge");
  const idsRaw = own(raw, "mailIds");
  if (!Array.isArray(idsRaw) || idsRaw.length > MAX_BLOCKS || !idsRaw.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)) return fail("mailIds");
  const mailIds = idsRaw as number[];
  let blocks: string[] | undefined;
  if (!nudge) {
    const b = own(raw, "blocks");
    if (!Array.isArray(b) || b.length !== mailIds.length || !b.every((x) => typeof x === "string" && x.length <= MAX_BLOCK_CHARS)) return fail("blocks");
    blocks = b as string[];
    if (mailIds.length === 0) return fail("mailIds");
  }
  const cmd: SteerCommand = { cmd: "steer", cmdId, secret, member, mailIds, ...(blocks ? { blocks } : {}), ...(nudge ? { nudge: true as const } : {}) };
  return { ok: true, cmd };
}

/** Strict parse of one raw bus payload that already passed the secret check and has a usable `cmdId`. */
export function parseCommand(raw: Rec, cmdId: string, secret: string): Parsed {
  if (poisoned(raw)) return fail("payload");
  const name = own(raw, "cmd");
  if (name === "snapshot") return { ok: true, cmd: { cmd: "snapshot", cmdId, secret } };
  if (name !== "spawn" && name !== "steer" && name !== "interrupt" && name !== "stop") return fail("cmd");
  const member = own(raw, "member");
  if (typeof member !== "string" || !MEMBER_NAME_REGEXP.test(member)) return fail("member");
  if (name === "spawn") return parseSpawn(raw, cmdId, secret, member);
  if (name === "steer") return parseSteer(raw, cmdId, secret, member);
  if (name === "interrupt") return { ok: true, cmd: { cmd: "interrupt", cmdId, secret, member } };
  const childId = optStr(raw, "childId", 200);
  const agentId = optStr(raw, "agentId", 200);
  if (childId === "bad") return fail("childId");
  if (agentId === "bad") return fail("agentId");
  return { ok: true, cmd: { cmd: "stop", cmdId, secret, member, ...(childId ? { childId } : {}), ...(agentId ? { agentId } : {}) } };
}

// ── spawn request ─────────────────────────────────────────────────────────────────────────────

export interface ChildIdentity {
  teamId: string;
  member: string;
  role?: string;
  /** Lead-proxied secret: lives only in the child extension's closure. */
  token: string;
  /** `ResolvedSpawnSpec.env`: reaches the child as a closure map, never `process.env`. */
  env: Record<string, string | string[]>;
}

/** `<member> — <title>` cut to 80 code points (the dock row text); no token or prompt body beyond the first line. */
function dockDescription(member: string, title: string | undefined, prompt: string): string {
  const firstLine = prompt.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  const label = (title?.trim() || firstLine || DOCK_SUBAGENT_TYPE).replace(/\s+/g, " ");
  return truncateCodePoints(`${member} — ${label}`, DOCK_DESCRIPTION_MAX_CODE_POINTS);
}

/**
 * The `subagents:spawn` request for a validated spawn command. Always `inline:true`, `isolated:true`, `ask:false` and
 * `managed {owner, keepAlive:true}`; `loader` is assembled here from whitelisted keys only (`LOADER_WHITELIST`); `cwdScope:"any"` only when the command asked for
 * it AND the feature `cwd_scope` exists; `skills` map to `noSkills`/`additionalSkillPaths` only with `loader_skills`; `tools` are the validated resolved tools minus {@link FORBIDDEN_CHILD_TOOLS}.
 */
export function buildSpawnRequest(cmd: SpawnCommand, features: readonly SubagentsFeature[], childExtension: unknown): SpawnRequestBody {
  const { spec } = cmd;
  const tools = spec.tools?.filter((t) => !FORBIDDEN_CHILD_TOOLS.includes(t));
  const loader: SpawnLoaderOptions = {
    ...(childExtension !== undefined ? { extensionFactories: [childExtension] } : {}),
    ...(spec.leanChildren ? { noExtensions: true } : {}),
    noContextFiles: spec.noContextFiles,
    ...(spec.promptFiles.length > 0 ? { appendSystemPrompt: [...spec.promptFiles] } : {}),
    // A skill grant reaches the loader only with `loader_skills` (the host refused a non-empty grant without it): `[]` loads none, a list loads exactly those.
    ...(spec.skills && features.includes("loader_skills") ? { noSkills: true, ...(spec.skills.length > 0 ? { additionalSkillPaths: [...spec.skills] } : {}) } : {}),
  };
  return {
    subagent_type: DOCK_SUBAGENT_TYPE,
    description: dockDescription(cmd.member, cmd.title, cmd.prompt),
    prompt: cmd.prompt,
    ...(spec.model ? { model: spec.model } : {}),
    cwd: spec.cwd,
    inline: true,
    isolated: true,
    ...(tools ? { tools } : {}),
    ask: false,
    managed: { owner: MANAGED_OWNER, keepAlive: true, ...(spec.idleTtlSec !== undefined ? { idleTtlSec: spec.idleTtlSec } : {}) },
    ...(spec.cwdScope === "any" && features.includes("cwd_scope") ? { cwdScope: "any" as const } : {}),
    loader,
  };
}
