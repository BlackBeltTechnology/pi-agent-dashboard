/**
 * Teammate spawn (tasks 5.1–5.3, 5.6–5.8, 5.12; design D10, D11, D14): the
 * synchronous `SpawnPlanner` (cwd confinement, model/tools/skills validation —
 * all BEFORE the member record exists) and the `SpawnFlow` that starts the host
 * spawn through the member driver, binds the resolved session, enforces
 * `spawnTimeoutMs` (bind + guarded `hello` + `spawn_prompt` ack) and reconciles
 * stragglers after a server restart.
 *
 * Host facts this module relies on (verified against the host sources):
 *  - `onSessionResolved` fires ONLY on a session's first register (spawn token
 *    resolution), never on a reconnect or cold-start restore; after a server restart
 *    a live teammate re-binds through the persisted `sessionId` index + `hello`.
 *  - `extensionConfig` values project to `PI_EXT_AGENT_TEAMS_<KEY>` (camelCase →
 *    SNAKE_CASE); arrays as JSON, strings verbatim.
 * See change: add-agent-teams-core.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Clock } from "../shared/clock.js";
import { AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import {
  EXT_KEY_COMMITTER,
  EXT_KEY_MEMBER,
  EXT_KEY_POLICY,
  EXT_KEY_TEAM_ID,
  policyHash,
  serializePolicy,
  skillGrantsFromPaths,
} from "../shared/policy.js";
import { type OpResult, TEAM_TOOLS_BY_ROLE } from "../shared/protocol.js";
import type { Member, Team } from "../shared/types.js";
import type { ConfigReader, TeamsConfig } from "./config.js";
import type { MemberDriver, ResolvedSpawnSpec } from "./driver.js";
import { applySpawnContributors, type ExtensionPoints } from "./extension-points.js";
import { fail, isLive } from "./op-util.js";
import type { PreparedSpawn, SpawnPlanner, SpawnStartInput } from "./ops.js";
import type { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";
import type { HostSessionLookup, Logger } from "./types.js";

const PROMPT_DIR = fileURLToPath(new URL("../../prompts/", import.meta.url));
const TEAMMATE_PROMPT = path.join(PROMPT_DIR, "teammate.md");
const TEAMMATE_MEMBER_COMMIT_PROMPT = path.join(PROMPT_DIR, "teammate-member-commit.md");

// ── planner (synchronous, before the member record exists) ─────────────────────

/** The two filesystem reads the cwd confinement needs (injectable for tests). */
interface SpawnFs {
  realpathSync(p: string): string;
  statSync(p: string): { isDirectory(): boolean };
}

export interface SpawnPlannerDeps {
  fs?: SpawnFs;
  /** Whether a model id is available to the host; absent ⇒ only the syntax is checked. */
  isKnownModel?: (model: string) => boolean;
}

const MODEL_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@._:/+-]{0,199}$/;

/** Path-segment containment: `/work/lead-evil` is NOT inside `/work/lead`. */
function isInside(child: string, root: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function realOrLexical(fsx: SpawnFs, p: string): string {
  try {
    return fsx.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Resolve a member `cwd` against the lead cwd + `extraCwdRoots`; confinement first, then existence. */
function resolveMemberCwd(fsx: SpawnFs, leadCwd: string, requested: string, extraRoots: readonly string[]): OpResult<string> {
  const abs = path.resolve(leadCwd, requested);
  const lexicalRoots = [leadCwd, ...extraRoots].map((r) => path.resolve(r));
  const realRoots = lexicalRoots.map((r) => realOrLexical(fsx, r));
  let real: string;
  try {
    real = fsx.realpathSync(abs);
  } catch {
    if (!lexicalRoots.some((r) => isInside(abs, r)) && !realRoots.some((r) => isInside(abs, r))) {
      return fail("cwd_outside_lead", "cwd is outside the lead cwd and every extra root");
    }
    return fail("invalid_args", "cwd does not exist");
  }
  if (!realRoots.some((r) => isInside(real, r))) return fail("cwd_outside_lead", "cwd is outside the lead cwd and every extra root");
  try {
    if (!fsx.statSync(real).isDirectory()) return fail("invalid_args", "cwd is not a directory");
  } catch {
    return fail("invalid_args", "cwd does not exist");
  }
  return { ok: true, data: real };
}

export function createSpawnPlanner(deps: SpawnPlannerDeps = {}): SpawnPlanner {
  const fsx: SpawnFs = deps.fs ?? fs;
  return {
    prepare({ leadCwd, team, args, trusted, config, resolvedSkills }) {
      let cwd = leadCwd;
      if (trusted?.cwd !== undefined) cwd = trusted.cwd;
      else if (args.cwd !== undefined) {
        const r = resolveMemberCwd(fsx, leadCwd, args.cwd, config.extraCwdRoots);
        if (!r.ok) return r;
        cwd = r.data;
      }
      if (args.model !== undefined && (!MODEL_PATTERN.test(args.model) || deps.isKnownModel?.(args.model) === false)) {
        return fail("invalid_args", `unknown or unavailable model: ${args.model.slice(0, 60)}`);
      }
      const tools = args.tools ?? team?.defaultTools;
      const wantsSkills = (args.skills ?? team?.defaultSkills) !== undefined;
      if (wantsSkills && resolvedSkills === undefined) return fail("skill_resolution_unavailable", "skill names could not be resolved");
      return {
        ok: true,
        data: {
          cwd,
          ...(args.model ? { model: args.model } : {}),
          ...(tools ? { tools: [...tools] } : {}),
          ...(resolvedSkills ? { skills: [...resolvedSkills] } : {}),
          noMcp: args.noMcp === true,
          noContextFiles: args.noContextFiles === true,
          ...(trusted?.committer ? { committer: trusted.committer } : {}),
        },
      };
    },
  };
}

// ── spec building (env + policy) ──────────────────────────────────────────────

const unique = (xs: readonly string[]): string[] => [...new Set(xs)];

/**
 * Build the resolved spawn spec for one member: base spec → spawn-spec contributors
 * (narrow-only) → team tools appended to any allowlist → env/policy projection.
 * The returned `policyHash` is what the member's `hello` must report.
 */
function buildSpawnSpec(input: {
  team: Team;
  member: Member;
  prepared: PreparedSpawn;
  config: TeamsConfig;
  ext: ExtensionPoints;
  logger: Logger;
}): { spec: ResolvedSpawnSpec; policyHash: string } {
  const { team, member, prepared, config } = input;
  const committer = prepared.committer ?? member.committer ?? team.committer;
  const base: ResolvedSpawnSpec = {
    cwd: prepared.cwd,
    ...(prepared.model ? { model: prepared.model } : {}),
    ...(prepared.thinkingLevel ? { thinkingLevel: prepared.thinkingLevel } : {}),
    ...(prepared.tools ? { tools: [...prepared.tools] } : {}),
    ...(prepared.skills ? { skills: [...prepared.skills] } : {}),
    noMcp: prepared.noMcp,
    noContextFiles: prepared.noContextFiles,
    promptFiles: [committer === "member" ? TEAMMATE_MEMBER_COMMIT_PROMPT : TEAMMATE_PROMPT],
    env: {},
  };
  const contributed = applySpawnContributors(base, input.ext.spawnContributors, { team, member, logger: input.logger });
  const tools = contributed.tools ? unique([...contributed.tools, ...TEAM_TOOLS_BY_ROLE.member]) : undefined;
  const policy = serializePolicy({
    ...(tools ? { tools } : {}),
    ...(contributed.skills ? { skills: skillGrantsFromPaths(contributed.skills) } : {}),
    blockSleepPolling: config.blockSleepPolling,
    blockGitWrite: config.blockGitWrite,
    committer,
  });
  const spec: ResolvedSpawnSpec = {
    ...contributed,
    ...(tools ? { tools } : {}),
    env: {
      ...contributed.env,
      [EXT_KEY_TEAM_ID]: team.id,
      [EXT_KEY_MEMBER]: member.name,
      [EXT_KEY_POLICY]: policy,
      [EXT_KEY_COMMITTER]: committer,
    },
  };
  return { spec, policyHash: policyHash(policy) };
}

// ── spawn flow (host bindings) ────────────────────────────────────────────────

export interface SpawnFlowDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  config: ConfigReader;
  telemetry: Telemetry;
  ext: ExtensionPoints;
  driverFor(team: Team): MemberDriver | undefined;
  hostSession: HostSessionLookup;
  /** Host kill by spawn token / session id (`ctx.abortSpawnedRun`); absent on a host that lacks it. */
  abortSpawnedRun?: (args: { sessionId?: string; spawnToken?: string }) => Promise<boolean> | boolean | unknown;
  /** Mark the member `failed` (releases its tasks, posts the waking notice). */
  fail(team: Team, name: string, message: string): void;
  /** Queue a lead notice (coalesced). */
  notify(team: Team, item: { head: string; body?: string; wake: boolean }): void;
}

const key = (teamId: string, name: string): string => `${teamId}\u0000${name}`;

export function createSpawnFlow(deps: SpawnFlowDeps) {
  const { store, clock, logger } = deps;
  const timers = new Map<string, unknown>();
  let reconcileTimer: unknown;

  function abortRun(args: { spawnToken?: string; sessionId?: string }): void {
    if (!deps.abortSpawnedRun) return;
    try {
      const out = deps.abortSpawnedRun(args);
      if (out && typeof (out as Promise<unknown>).catch === "function") {
        (out as Promise<unknown>).catch((err: unknown) => logger.warn(`agent-teams: abortSpawnedRun failed: ${(err as Error).message}`));
      }
    } catch (err) {
      logger.warn(`agent-teams: abortSpawnedRun failed: ${(err as Error).message}`);
    }
  }

  function abort(member: Member): void {
    abortRun({ spawnToken: member.spawnToken, ...(member.sessionId ? { sessionId: member.sessionId } : {}) });
  }

  function clear(teamId: string, name: string): void {
    const handle = timers.get(key(teamId, name));
    if (handle !== undefined) clock.clearTimeout(handle);
    timers.delete(key(teamId, name));
  }

  /** What is still missing when the spawn deadline passes. */
  function missing(team: Team, member: Member): string {
    if (!member.sessionId) return "the session never registered";
    const prompt = store.mailLog(team.id).find((m) => m.to === member.name && m.kind === "spawn_prompt" && m.ackedAt === undefined);
    if (!member.guardActive) return "the bridge never reported a guarded hello";
    return prompt ? "the spawn prompt was not acknowledged" : "the spawn did not complete";
  }

  function arm(team: Team, member: Member): void {
    clear(team.id, member.name);
    const ms = deps.config().spawnTimeoutMs;
    const teamId = team.id;
    const name = member.name;
    const spawnToken = member.spawnToken;
    timers.set(
      key(teamId, name),
      clock.setTimeout(() => {
        timers.delete(key(teamId, name));
        const t = store.get(teamId);
        const m = t ? store.member(t, name) : undefined;
        // Still pending = not completed by a prompt ack (a ready-but-unacked member counts: the timeout covers the ack).
        if (!t || !m || !isLive(m) || m.spawnToken !== spawnToken) return;
        const why = missing(t, m);
        abort(m);
        deps.fail(t, name, `${name} did not become ready within ${Math.round(ms / 1000)}s: ${why}`);
      }, ms),
    );
  }

  /** Start the host spawn for a reserved member (called synchronously after the reserve; async below the first await). */
  async function start(input: SpawnStartInput): Promise<void> {
    const { team, member, prepared, resume } = input;
    const driver = deps.driverFor(team);
    if (!driver) throw new Error(`no driver for mode ${team.mode}`);
    const { spec, policyHash: hash } = buildSpawnSpec({ team, member, prepared, config: deps.config(), ext: deps.ext, logger });
    store.patchMember(team.id, member.name, { policyHash: hash, guardActive: false, ...(spec.tools ? { tools: spec.tools } : {}), ...(spec.skills ? { skills: spec.skills } : {}) });
    arm(team, member);
    deps.telemetry.count(team.id, "spawns");
    deps.telemetry.log("spawn", team.id, { member: member.name, resume: resume === true, tools: spec.tools?.length, skills: spec.skills?.length });
    const outcome = await driver.spawn({
      teamId: team.id,
      teamName: team.name,
      member: member.name,
      role: "member",
      spawnToken: member.spawnToken,
      ...(team.owner ? { principalOwner: team.owner } : {}),
      spec,
      ...(resume && member.sessionFile ? { resume: { sessionFile: member.sessionFile } } : {}),
    });
    if (!outcome.ok) throw new Error(outcome.message);
  }

  /** `onSessionResolved` for a teammate ref: bind the session to its `spawning` member. Returns whether the ref was a member ref. */
  function onResolved(sessionId: string, ref: Record<string, unknown>): boolean {
    const own = ref[AGENT_TEAMS_PLUGIN_ID];
    if (own === null || typeof own !== "object") return false;
    const r = own as Record<string, unknown>;
    if (r.role === "lead" || typeof r.teamId !== "string" || typeof r.member !== "string") return false;
    const team = store.get(r.teamId);
    const member = team ? store.member(team, r.member) : undefined;
    if (!team || !member || team.status === "closed" || member.status !== "spawning" || member.sessionId) {
      // A first registration with no spawning member to own it (failed, closed, replaced) must not keep running unowned.
      logger.warn(`agent-teams: resolved session ${sessionId} has no spawning member ${r.member}; aborting it`);
      abortRun({ sessionId });
      return true;
    }
    const sessionFile = deps.hostSession(sessionId)?.sessionFile;
    store.patchMember(team.id, member.name, { sessionId, ...(sessionFile ? { sessionFile } : {}) }, { writeThrough: true });
    deps.telemetry.log("bind", team.id, { role: "member", member: member.name });
    return true;
  }

  /** A `spawn_prompt` was acknowledged: the spawn is complete. */
  function complete(team: Team, name: string): void {
    clear(team.id, name);
  }

  /**
   * Startup reconciliation (D14): after `reconcileGraceMs` members still `spawning`
   * fail (token-based abort); members still `disconnected` are reported to the lead.
   */
  function reconcile(): void {
    const pending = store.list().filter((t) => t.status !== "closed" && t.members.some((m) => m.status === "spawning" || m.status === "disconnected"));
    if (pending.length === 0) return;
    clock.clearTimeout(reconcileTimer);
    reconcileTimer = clock.setTimeout(() => {
      reconcileTimer = undefined;
      for (const t of pending) {
        const team = store.get(t.id);
        if (!team || team.status === "closed") continue;
        const stragglers = team.members.filter((m) => m.status === "spawning" && !timers.has(key(team.id, m.name)));
        for (const m of stragglers) {
          abort(m);
          deps.fail(team, m.name, `${m.name} did not resolve after the server restart`);
        }
        const lost = team.members.filter((m) => m.status === "disconnected").map((m) => m.name);
        if (lost.length > 0) {
          deps.notify(team, { head: `${lost.join(", ")} did not reconnect after the server restart (respawn with resume:true)`, wake: true });
        }
      }
    }, deps.config().reconcileGraceMs);
  }

  function dispose(): void {
    for (const h of timers.values()) clock.clearTimeout(h);
    timers.clear();
    if (reconcileTimer !== undefined) clock.clearTimeout(reconcileTimer);
    reconcileTimer = undefined;
  }

  return { start, onResolved, complete, clear, abort, reconcile, dispose };
}
