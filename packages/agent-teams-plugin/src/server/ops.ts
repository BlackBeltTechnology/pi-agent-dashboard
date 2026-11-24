/**
 * Team operations (tasks 3.1–3.4, 3.6, 3.7; design "Tool contract", D4, D12, D17).
 * One function per tool plus the actor operations later changes call
 * (`createTeam`, `bindLead`, `spawnMember`, `abortMember`, `teamDelete`,
 * `requestShutdown`, `sendServerMail`, `enqueueLeadNotice`). Every handler is a
 * SYNCHRONOUS state transition: cap and name checks and the reservation happen
 * with no `await` in between, so concurrent calls cannot exceed a cap. The caller
 * is resolved from the lane socket's session id only (`resolveCaller`).
 *
 * Seams left for later sections (all optional, inert by default):
 *  - `planner` / `starter`  → §5 spawn (cwd confinement, scope, host spawn)
 *  - `mailer`               → §6 mail delivery (queued mail stays unacked until set)
 * See change: add-agent-teams-core.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "../shared/clock.js";
import {
  LEAD_ADDRESS,
  MEMBER_NAME_REGEXP,
  RESERVED_MEMBER_NAMES,
  TEAM_DESCRIPTION_MAX_CHARS,
  TEAM_NAME_MAX_CHARS,
} from "../shared/constants.js";
import { isRegisteredMailKind } from "../shared/mail-format.js";
import { AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import {
  type AckPayload,
  type BusyPayload,
  type ErrorCode,
  type HelloPayload,
  type HelloReply,
  type IdlePayload,
  isTeamOp,
  LEAD_ONLY_OPS,
  type OpResult,
  type TeamCreateResult,
  type TeamDeleteResult,
  type TeammateSpawnArgs,
  type TeammateSpawnResult,
  type TeamOp,
  type TeamRole,
  type TeamStatusResult,
} from "../shared/protocol.js";
import { sanitizeText } from "../shared/text.js";
import {
  type CloseReason,
  type Committer,
  type Mail,
  type Member,
  RELEASED_MEMBER_STATUSES,
  type SessionBinding,
  type Team,
} from "../shared/types.js";
import { isRecord, own, stringList, textField } from "./args.js";
import type { ConfigReader, TeamsConfig } from "./config.js";
import type { MemberDriver } from "./driver.js";
import type { ExtensionPoints, TrustedSpawnOptions } from "./extension-points.js";
import type { ModeRegistry } from "./modes.js";
import type { TeamStore } from "./store.js";
import type { Actor, HostSessionLookup, Logger } from "./types.js";

// ── caller / reports ──────────────────────────────────────────────────────────

/** What a session last told us about itself in `hello` (memory only). */
export interface SessionReport extends HelloPayload {
  at: number;
}

export interface Caller {
  sessionId: string;
  role: TeamRole;
  binding?: SessionBinding;
  team?: Team;
  /** `"lead"`, the member name, or `""` for a plain session. */
  name: string;
}

// ── seams ────────────────────────────────────────────────────────────────────

export interface PreparedSpawn {
  cwd: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  noMcp: boolean;
  noContextFiles: boolean;
  committer?: Committer;
}

export interface SpawnPlanInput {
  leadCwd: string;
  team?: Team;
  args: TeammateSpawnArgs;
  trusted?: TrustedSpawnOptions;
  config: TeamsConfig;
}

/** Synchronous validation + resolution BEFORE the member record exists (§5.2/5.12 replace the default). */
export interface SpawnPlanner {
  prepare(input: SpawnPlanInput): OpResult<PreparedSpawn>;
}

export interface SpawnStartInput {
  team: Team;
  member: Member;
  prompt: string;
  prepared: PreparedSpawn;
  resume: boolean;
}
/** Asynchronous host spawn started after the member is reserved and persisted (§5.1). */
export type SpawnStarter = (input: SpawnStartInput) => void | Promise<void>;

/** Attempt delivery of a recipient's queued mail (§6). Absent ⇒ mail simply stays queued. */
export interface MailFlusher {
  flush(teamId: string, to: string): void;
}

export interface OpsDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  config: ConfigReader;
  modes: ModeRegistry;
  ext: ExtensionPoints;
  hostSession: HostSessionLookup;
  reports?: Map<string, SessionReport>;
  planner?: SpawnPlanner;
  starter?: SpawnStarter;
  mailer?: MailFlusher;
  newToken?: () => string;
}

/** Default planner: no cwd (or exactly the lead cwd) only; any other cwd is refused until §5.2 adds realpath confinement. */
export const defaultSpawnPlanner: SpawnPlanner = {
  prepare({ leadCwd, args, trusted }) {
    let cwd = leadCwd;
    if (trusted?.cwd !== undefined) cwd = trusted.cwd;
    else if (args.cwd !== undefined && args.cwd !== leadCwd) {
      return fail("cwd_outside_lead", "per-member cwd is not available yet");
    }
    return {
      ok: true,
      data: {
        cwd,
        ...(args.model ? { model: args.model } : {}),
        ...(args.tools ? { tools: args.tools } : {}),
        ...(args.skills ? { skills: args.skills } : {}),
        noMcp: args.noMcp === true,
        noContextFiles: args.noContextFiles === true,
        ...(trusted?.committer ? { committer: trusted.committer } : {}),
      },
    };
  },
};

// ── small helpers ────────────────────────────────────────────────────────────

function fail(error: ErrorCode, message?: string, details?: Record<string, unknown>): { ok: false; error: ErrorCode; message?: string; details?: Record<string, unknown> } {
  return { ok: false, error, ...(message !== undefined ? { message } : {}), ...(details ? { details } : {}) };
}

const isLive = (m: Member): boolean => !RELEASED_MEMBER_STATUSES.includes(m.status);

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "team";
}

export interface CreateTeamInput {
  name: string;
  leadCwd: string;
  leadSessionId?: string;
  starting?: boolean;
  owner?: string;
  mode?: string;
  description?: string;
  maxTeammates?: number;
  committer?: Committer;
  skills?: string[];
  tools?: string[];
  callerSessionId?: string;
}

export type OpHandler = (args: unknown, caller: Caller) => OpResult<unknown>;

export function createOps(deps: OpsDeps) {
  const { store, clock, logger } = deps;
  const reports = deps.reports ?? new Map<string, SessionReport>();
  const planner = deps.planner ?? defaultSpawnPlanner;
  const newToken = deps.newToken ?? (() => `at-${randomUUID()}`);
  const orphanTimers = new Map<string, unknown>();
  const closeTimers = new Map<string, unknown>();

  const driverFor = (team: Team): MemberDriver | undefined => deps.modes.get(team.mode)?.driver ?? deps.modes.get("session")?.driver;

  function refOf(team: Team, member: Member) {
    return { teamId: team.id, member: member.name, ...(member.sessionId ? { sessionId: member.sessionId } : {}) };
  }

  // ── identity ────────────────────────────────────────────────────────────────

  /**
   * The single caller-resolution function: identity comes from the lane socket's
   * `sessionId` through the binding index and nothing else. A later mode MAY add
   * an explicit `as` branch HERE and only here.
   */
  function resolveCaller(meta: { sessionId: string }): Caller {
    const binding = store.findBySession(meta.sessionId);
    const team = binding ? store.get(binding.teamId) : undefined;
    if (!binding || !team) return { sessionId: meta.sessionId, role: "plain", name: "" };
    return {
      sessionId: meta.sessionId,
      role: binding.who === LEAD_ADDRESS ? "lead" : "member",
      binding,
      team,
      name: binding.who,
    };
  }

  /** A session confined by another plugin must never lead (`lead_confined`). */
  function isConfined(sessionId: string): boolean {
    if (reports.get(sessionId)?.confined) return true;
    const refs = deps.hostSession(sessionId)?.pluginRefs;
    return refs !== undefined && Object.keys(refs).some((k) => k !== AGENT_TEAMS_PLUGIN_ID);
  }

  // ── mail helpers (seam-aware) ───────────────────────────────────────────────

  function mailTo(team: Team, to: string, input: { from: string; kind: string; text: string; wake: boolean; priority?: "normal" | "urgent"; details?: Record<string, unknown> }): Mail | undefined {
    const mail = store.appendMail(team.id, {
      from: input.from,
      to,
      kind: input.kind,
      text: sanitizeText(input.text, { keepNewlines: true }),
      wake: input.wake,
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.details ? { details: input.details } : {}),
    });
    if (mail) deps.mailer?.flush(team.id, to);
    return mail;
  }

  /** Server-authored notice for the lead; queues while the team has no bound lead. */
  function enqueueLeadNotice(team: Team, input: { text: string; wake: boolean }): Mail | undefined {
    return mailTo(team, LEAD_ADDRESS, { from: "server", kind: "notice", text: input.text, wake: input.wake });
  }

  /** Server mail to one live member in a registered kind (sender `server`). */
  function sendServerMail(team: Team, to: string, input: { kind: string; text: string; wake: boolean }): OpResult<{ mailId: number }> {
    if (!isRegisteredMailKind(input.kind)) return fail("invalid_args", `unregistered mail kind: ${input.kind}`);
    const member = store.member(team, to);
    if (!member) return fail("unknown_recipient", to);
    if (!isLive(member)) return fail("member_gone", to);
    const mail = mailTo(team, to, { from: "server", kind: input.kind, text: input.text, wake: input.wake });
    return mail ? { ok: true, data: { mailId: mail.id } } : fail("team_closed");
  }

  // ── member exit ─────────────────────────────────────────────────────────────

  /**
   * A member is `gone`/`failed`: release its tasks (`in_progress` → `pending`
   * unowned, owned `pending` → unowned), discard its queued mail and tell the
   * lead (waking) which tasks were affected.
   */
  function releaseMember(team: Team, name: string, status: "gone" | "failed", reason: string): { released: string[]; unowned: string[] } {
    const out = { released: [] as string[], unowned: [] as string[] };
    const member = store.member(team, name);
    if (!member || !isLive(member)) return out;
    store.patchMember(team.id, name, { status, goneReason: reason }, { writeThrough: true });
    for (const task of [...team.tasks]) {
      if (task.owner !== name || task.status === "completed") continue;
      if (task.status === "in_progress") {
        store.patchTask(team.id, task.id, { status: "pending", clearOwner: true });
        out.released.push(task.id);
      } else {
        store.patchTask(team.id, task.id, { clearOwner: true });
        out.unowned.push(task.id);
      }
    }
    store.discardMailFor(team.id, name);
    const parts = [`${name} is ${status} (${reason})`];
    if (out.released.length) parts.push(`released to pending: ${out.released.join(", ")}`);
    if (out.unowned.length) parts.push(`unowned: ${out.unowned.join(", ")}`);
    enqueueLeadNotice(team, { text: parts.join("; "), wake: true });
    return out;
  }

  // ── lifecycle: create / bind / close ────────────────────────────────────────

  /** Actor op: create a team (lane `TeamCreate` and server-started teams both land here). */
  function createTeam(input: CreateTeamInput): OpResult<Team> {
    const cfg = deps.config();
    const mode = deps.modes.resolve(input.mode, cfg.teammateMode, input.callerSessionId ?? input.leadSessionId);
    if (!mode.ok) return fail("mode_unavailable", mode.reason);
    if (store.activeTeamCount() >= cfg.maxActiveTeams) return fail("team_cap_reached", `at most ${cfg.maxActiveTeams} active teams`);
    let cap = cfg.maxTeammates;
    if (input.maxTeammates !== undefined) {
      if (!Number.isInteger(input.maxTeammates) || input.maxTeammates < 1 || input.maxTeammates > cfg.maxTeammates) {
        return fail("invalid_args", `maxTeammates must be an integer in 1-${cfg.maxTeammates}`);
      }
      cap = input.maxTeammates;
    }
    const team = store.createTeam({
      name: input.name,
      leadCwd: input.leadCwd,
      mode: mode.mode,
      maxTeammates: cap,
      ...(input.starting ? { starting: true } : {}),
      ...(input.leadSessionId ? { leadSessionId: input.leadSessionId } : {}),
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.committer ? { committer: input.committer } : {}),
      ...(input.skills ? { defaultSkills: input.skills } : {}),
      ...(input.tools ? { defaultTools: input.tools } : {}),
    });
    return { ok: true, data: team };
  }

  /** Actor op: bind a session as the lead of a `starting` team (keeps a set `owner`). */
  function bindLead(teamId: string, sessionId: string, opts: { principalOwner?: string } = {}): OpResult<Team> {
    const team = store.get(teamId);
    if (!team) return fail("not_in_team");
    if (team.status === "closed" || team.status === "closing") return fail("team_closed");
    const bound = store.bindLead(teamId, sessionId, opts);
    if (!bound) return fail("team_closed");
    clearOrphanTimer(teamId);
    // Mail and notices for the lead queued while it was absent (starting/orphaned) flush on (re)bind.
    deps.mailer?.flush(teamId, LEAD_ADDRESS);
    return { ok: true, data: bound };
  }

  /**
   * Whether the dispatcher may claim for `member` now: the team is `active`, the
   * member is idle, not on hold or degraded, owns no `in_progress` task (a member
   * stopped by `abortMember` keeps its task and is therefore skipped) and every
   * registered eligibility hook agrees.
   */
  function isDispatchEligible(team: Team, member: Member): boolean {
    if (!canDispatch(team)) return false;
    if (member.status !== "idle" || member.hold !== undefined || member.degraded !== undefined) return false;
    if (team.tasks.some((t) => t.owner === member.name && t.status === "in_progress")) return false;
    return deps.ext.isEligible(team, member);
  }

  /** Dispatch runs only for an `active` team: `starting` queues until a lead binds, `orphaned` pauses. */
  function canDispatch(team: Team): boolean {
    return team.status === "active";
  }

  function clearOrphanTimer(teamId: string): void {
    const t = orphanTimers.get(teamId);
    if (t !== undefined) clock.clearTimeout(t);
    orphanTimers.delete(teamId);
  }

  function closeTeam(team: Team, reason: CloseReason): void {
    if (team.status === "closed") return;
    clearOrphanTimer(team.id);
    const closeTimer = closeTimers.get(team.id);
    if (closeTimer !== undefined) clock.clearTimeout(closeTimer);
    closeTimers.delete(team.id);
    const leadSession = team.leadSessionId;
    store.setTeamStatus(team.id, "closed", { closeReason: reason });
    if (leadSession) driverFor(team)?.notifyTeamClosed?.(leadSession, { teamId: team.id, closeReason: reason });
  }

  /** Lead session ended in session mode: orphan the team, tell members, arm the TTL. */
  function orphanTeam(team: Team): void {
    if (team.status !== "active" && team.status !== "starting") return;
    store.setLeadConnected(team.id, false);
    store.setTeamStatus(team.id, "orphaned");
    for (const m of team.members.filter(isLive)) {
      mailTo(team, m.name, { from: "server", kind: "notice", text: "lead is gone: finish current work and stop", wake: false });
    }
    armOrphanTimer(team);
    logger.info(`agent-teams: team ${team.id} orphaned`);
  }

  function armOrphanTimer(team: Team): void {
    clearOrphanTimer(team.id);
    const ttl = deps.config().orphanTtlMs;
    const elapsed = team.orphanedAt === undefined ? 0 : clock.now() - team.orphanedAt;
    orphanTimers.set(
      team.id,
      clock.setTimeout(() => {
        orphanTimers.delete(team.id);
        if (team.status === "orphaned") closeTeam(team, "orphan_ttl");
      }, Math.max(0, ttl - elapsed)),
    );
  }

  // ── TeamCreate ──────────────────────────────────────────────────────────────

  function teamCreate(raw: unknown, caller: Caller): OpResult<TeamCreateResult> {
    if (caller.role === "member") return fail("nested_team_forbidden");
    if (caller.role === "lead") return fail("already_in_team");
    if (isConfined(caller.sessionId)) return fail("lead_confined");
    const args = isRecord(raw) ? raw : undefined;
    if (!args) return fail("invalid_args", "args must be an object");
    const name = textField(own(args, "name"), TEAM_NAME_MAX_CHARS, { required: true });
    const description = textField(own(args, "description"), TEAM_DESCRIPTION_MAX_CHARS, { multiline: true });
    const mode = textField(own(args, "mode"), 40);
    const skills = stringList(own(args, "skills"));
    const tools = stringList(own(args, "tools"));
    const maxTeammates = own(args, "maxTeammates");
    if (!name.ok || !description.ok || !mode.ok || skills === "invalid" || tools === "invalid") return fail("invalid_args");
    if (maxTeammates !== undefined && typeof maxTeammates !== "number") return fail("invalid_args", "maxTeammates must be a number");
    const host = deps.hostSession(caller.sessionId);
    if (!host?.cwd) return fail("invalid_args", "caller working directory unknown");
    const created = createTeam({
      name: name.value as string,
      leadCwd: host.cwd,
      leadSessionId: caller.sessionId,
      callerSessionId: caller.sessionId,
      ...(host.principalOwner ? { owner: host.principalOwner } : {}),
      ...(mode.value ? { mode: mode.value } : {}),
      ...(description.value ? { description: description.value } : {}),
      ...(typeof maxTeammates === "number" ? { maxTeammates } : {}),
      ...(skills ? { skills } : {}),
      ...(tools ? { tools } : {}),
    });
    if (!created.ok) return created;
    const cfg = deps.config();
    return {
      ok: true,
      data: {
        teamId: created.data.id,
        name: created.data.name,
        limits: { maxTeammates: effectiveMaxTeammates(created.data, cfg), maxTasks: cfg.maxTasks },
        role: "lead",
      },
    };
  }

  function effectiveMaxTeammates(team: Team, cfg: TeamsConfig): number {
    return Math.min(team.maxTeammates, cfg.maxTeammates);
  }

  // ── TeammateSpawn ───────────────────────────────────────────────────────────

  /** Parse and bound the `TeammateSpawn` args (lane payload or in-process caller). */
  function parseSpawnArgs(raw: unknown, cfg: TeamsConfig): OpResult<TeammateSpawnArgs> {
    if (!isRecord(raw)) return fail("invalid_args", "args must be an object");
    const rawName = own(raw, "name");
    if (typeof rawName !== "string") return fail("invalid_args", "name must be a string");
    if (RESERVED_MEMBER_NAMES.includes(rawName)) return fail("name_reserved", rawName);
    if (!MEMBER_NAME_REGEXP.test(rawName)) return fail("invalid_args", "name must match ^[a-z][a-z0-9-]{0,31}$");
    const prompt = textField(own(raw, "prompt"), cfg.maxMessageChars, { required: true, multiline: true });
    const role = textField(own(raw, "role"), 80);
    const model = textField(own(raw, "model"), 200);
    const cwd = own(raw, "cwd");
    const tools = stringList(own(raw, "tools"));
    const skills = stringList(own(raw, "skills"));
    const noMcp = own(raw, "noMcp");
    const noContextFiles = own(raw, "noContextFiles");
    const resume = own(raw, "resume");
    if (!prompt.ok || !role.ok || !model.ok || tools === "invalid" || skills === "invalid") return fail("invalid_args");
    if ((cwd !== undefined && typeof cwd !== "string") || (noMcp !== undefined && typeof noMcp !== "boolean")) return fail("invalid_args");
    if ((noContextFiles !== undefined && typeof noContextFiles !== "boolean") || (resume !== undefined && typeof resume !== "boolean")) return fail("invalid_args");
    return {
      ok: true,
      data: {
        name: rawName,
        prompt: prompt.value as string,
        ...(role.value ? { role: role.value } : {}),
        ...(model.value ? { model: model.value } : {}),
        ...(typeof cwd === "string" ? { cwd } : {}),
        ...(tools ? { tools } : {}),
        ...(skills ? { skills } : {}),
        ...(typeof noMcp === "boolean" ? { noMcp } : {}),
        ...(typeof noContextFiles === "boolean" ? { noContextFiles } : {}),
        ...(typeof resume === "boolean" ? { resume } : {}),
      },
    };
  }

  /**
   * Actor op: validate, reserve the name and persist `spawning`, ALL before any
   * `await`, then hand the async host spawn to the `starter` seam. `trusted`
   * options come only from in-process server callers; the lane never passes them.
   */
  function spawnMember(team: Team, args: TeammateSpawnArgs, trusted?: TrustedSpawnOptions): OpResult<TeammateSpawnResult> {
    const cfg = deps.config();
    if (team.status === "closed" || team.status === "closing") return fail("team_closed");
    const existing = store.member(team, args.name);
    const resume = args.resume === true;
    if (resume) {
      if (!existing || (existing.status !== "gone" && existing.status !== "disconnected")) return fail("nothing_to_resume", args.name);
    } else if (existing && isLive(existing)) {
      return fail("name_taken", args.name);
    }
    const live = team.members.filter((m) => isLive(m) && m.name !== (resume ? args.name : ""));
    if (live.length >= effectiveMaxTeammates(team, cfg)) return fail("team_full", `at most ${effectiveMaxTeammates(team, cfg)} teammates`);
    const plan = planner.prepare({ leadCwd: team.leadCwd, team, args, ...(trusted ? { trusted } : {}), config: cfg });
    if (!plan.ok) return plan;
    const p = plan.data;
    const record: Member = {
      name: args.name,
      ...(args.role ? { role: args.role } : {}),
      spawnToken: newToken(),
      ...(resume && existing?.sessionFile ? { sessionFile: existing.sessionFile } : {}),
      cwd: p.cwd,
      ...(p.model ? { model: p.model } : {}),
      status: "spawning",
      ...(p.committer ? { committer: p.committer } : {}),
      guardActive: false,
      ...(p.tools ? { tools: p.tools } : {}),
      ...(p.skills ? { skills: p.skills } : {}),
      noMcp: p.noMcp,
      noContextFiles: p.noContextFiles,
      lastSettleId: 0,
    };
    const reserved = resume && existing ? store.patchMember(team.id, args.name, { ...record }, { writeThrough: true }) : store.reserveMember(team.id, record);
    if (!reserved) return fail("team_closed");
    // The spawn prompt is the first waking mail; it is delivered after bind + guarded hello (§5.11).
    mailTo(team, args.name, {
      from: LEAD_ADDRESS,
      kind: "spawn_prompt",
      text: args.prompt,
      wake: true,
      ...(args.role ? { details: { role: args.role } } : {}),
    });
    if (deps.starter) {
      try {
        const started = deps.starter({ team, member: reserved, prompt: args.prompt, prepared: p, resume });
        if (started && typeof (started as Promise<void>).catch === "function") {
          (started as Promise<void>).catch((err: unknown) => failSpawn(team, args.name, (err as Error).message));
        }
      } catch (err) {
        failSpawn(team, args.name, (err as Error).message);
      }
    }
    return { ok: true, data: { member: args.name, status: "spawning" } };
  }

  function failSpawn(team: Team, name: string, message: string): void {
    logger.error(`agent-teams: spawn of ${name} failed: ${message}`);
    releaseMember(team, name, "failed", `spawn failed: ${message}`);
  }

  function teammateSpawn(raw: unknown, caller: Caller): OpResult<TeammateSpawnResult> {
    if (caller.role === "member") return fail("not_lead");
    const cfg = deps.config();
    const args = parseSpawnArgs(raw, cfg);
    if (!args.ok) return args;
    let team = caller.team;
    if (caller.role === "plain") {
      if (isConfined(caller.sessionId)) return fail("lead_confined");
      const host = deps.hostSession(caller.sessionId);
      if (!host?.cwd) return fail("invalid_args", "caller working directory unknown");
      // Dry-run the spawn plan before creating anything, so a refused spawn leaves no team behind.
      const plan = planner.prepare({ leadCwd: host.cwd, args: args.data, config: cfg });
      if (!plan.ok) return plan;
      const created = createTeam({
        name: `${basename(host.cwd)} team`.slice(0, TEAM_NAME_MAX_CHARS),
        leadCwd: host.cwd,
        leadSessionId: caller.sessionId,
        callerSessionId: caller.sessionId,
        ...(host.principalOwner ? { owner: host.principalOwner } : {}),
      });
      if (!created.ok) return created;
      team = created.data;
    }
    if (!team) return fail("not_in_team");
    return spawnMember(team, args.data);
  }

  // ── TeamStatus ──────────────────────────────────────────────────────────────

  function teamStatus(_raw: unknown, caller: Caller): OpResult<TeamStatusResult> {
    const team = caller.team;
    if (!team) return fail("not_in_team");
    const counts = { pending: 0, in_progress: 0, completed: 0 };
    for (const t of team.tasks) counts[t.status]++;
    return {
      ok: true,
      data: {
        team: { id: team.id, name: team.name, status: team.status, mode: team.mode },
        members: team.members.map((m) => ({
          name: m.name,
          status: m.status,
          ...(m.role ? { role: m.role } : {}),
          taskIds: team.tasks.filter((t) => t.owner === m.name && t.status !== "completed").map((t) => t.id),
          ...(m.degraded ? { degraded: m.degraded } : {}),
        })),
        counts: { members: team.members.length, tasks: counts },
      },
    };
  }

  // ── shutdown / delete / abort (actor ops) ───────────────────────────────────

  /**
   * Request a member's shutdown (handshake request half): the member goes
   * `shutdown_pending` and receives a waking `shutdown_request` mail. With actor
   * `server` the envelope is `from server`; the lead is woken only on a
   * rejection or a timeout (handled where the response is processed).
   */
  function requestShutdown(team: Team, name: string, opts: { actor: Actor; reason?: string }): OpResult<{ member: string; status: "shutdown_pending" }> {
    const member = store.member(team, name);
    if (!member) return fail("unknown_recipient", name);
    if (!isLive(member)) return fail("member_gone", name);
    store.patchMember(team.id, name, { status: "shutdown_pending" });
    const from = opts.actor === "server" || opts.actor === "user" ? "server" : LEAD_ADDRESS;
    mailTo(team, name, {
      from,
      kind: "shutdown_request",
      text: opts.reason ? `Shutdown requested: ${opts.reason}` : "Shutdown requested. Finish your current step, then approve or reject.",
      wake: true,
    });
    return { ok: true, data: { member: name, status: "shutdown_pending" } };
  }

  /**
   * Stop a member's in-flight run and nothing else: no confirmation step, its
   * tasks stay `in_progress`, it is not woken, and the lead gets ONE waking notice.
   */
  function abortMember(team: Team, name: string, opts: { actor: Actor }): OpResult<{ member: string; aborted: true }> {
    const member = store.member(team, name);
    if (!member) return fail("unknown_recipient", name);
    if (!isLive(member)) return fail("member_gone", name);
    const driver = driverFor(team);
    const res = driver?.abort(refOf(team, member)) ?? { ok: false, reason: "no_driver" };
    if (!res.ok) return fail("interrupt_unavailable", res.reason);
    enqueueLeadNotice(team, { text: `${name}'s current run was stopped by ${opts.actor}; its tasks stay in_progress`, wake: true });
    return { ok: true, data: { member: name, aborted: true } };
  }

  /**
   * Close a team. Without `force` it refuses while any member is live
   * (`members_active`). `force` — and the `user` actor always — first posts a
   * visible NON-waking notice to every live member session, requests shutdown,
   * ends the remaining sessions after `shutdownGraceMs` even if one rejected, then
   * closes the team. The lead session itself is never shut down here.
   */
  function teamDelete(team: Team, opts: { actor: Actor; force?: boolean; closeReason?: CloseReason }): OpResult<TeamDeleteResult> {
    if (team.status === "closed") return fail("team_closed");
    const live = team.members.filter(isLive);
    const force = opts.force === true || opts.actor === "user";
    if (!force && live.length > 0) return fail("members_active", live.map((m) => m.name).join(", "), { members: live.map((m) => m.name) });
    const reason: CloseReason = opts.closeReason ?? (opts.actor === "user" ? "user" : "team_delete");
    if (live.length === 0) {
      closeTeam(team, reason);
      return { ok: true, data: { closed: true, shutdown: [] } };
    }
    if (team.status !== "closing") store.setTeamStatus(team.id, "closing", { closeReason: reason });
    beginForcedClose(team, live.map((m) => m.name), reason, opts.actor);
    return { ok: true, data: { closed: true, shutdown: live.map((m) => m.name) } };
  }

  function beginForcedClose(team: Team, names: string[], reason: CloseReason, actor: Actor): void {
    for (const name of names) {
      mailTo(team, name, {
        from: "server",
        kind: "notice",
        text: `This team is being closed by force (${actor}). Your session will end shortly.`,
        wake: false,
      });
      const m = store.member(team, name);
      if (m && m.status !== "shutdown_pending") store.patchMember(team.id, name, { status: "shutdown_pending" });
      mailTo(team, name, { from: actor === "lead" ? LEAD_ADDRESS : "server", kind: "shutdown_request", text: "Team closed by force: shut down now.", wake: true });
    }
    if (closeTimers.has(team.id)) return;
    closeTimers.set(
      team.id,
      clock.setTimeout(() => {
        closeTimers.delete(team.id);
        void finishForcedClose(team, reason);
      }, deps.config().shutdownGraceMs),
    );
  }

  async function finishForcedClose(team: Team, reason: CloseReason): Promise<void> {
    const driver = driverFor(team);
    const targets = team.members.filter(isLive).map((m) => ({ m, ref: refOf(team, m) }));
    await Promise.all(
      targets.map(async ({ m, ref }) => {
        const ok = (await driver?.shutdown(ref)) ?? false;
        if (!ok) logger.warn(`agent-teams: shutdown of ${m.name} was not confirmed`);
      }),
    );
    for (const { m } of targets) {
      store.patchMember(team.id, m.name, { status: "gone", goneReason: reason });
      store.discardMailFor(team.id, m.name);
    }
    closeTeam(team, reason);
  }

  /** Startup: a team persisted as `closing` re-requests shutdown and closes once (a lost grace timer cannot leave it open). */
  function resumeClosing(): number {
    let n = 0;
    for (const team of store.closingTeams()) {
      const live = team.members.filter(isLive).map((m) => m.name);
      if (live.length === 0) {
        closeTeam(team, team.closeReason ?? "team_delete");
      } else {
        beginForcedClose(team, live, team.closeReason ?? "team_delete", "server");
      }
      n++;
    }
    return n;
  }

  /** Startup: re-arm the TTL timer of teams persisted as `orphaned` (from their original `orphanedAt`). */
  function rearmOrphans(): void {
    for (const team of store.list()) if (team.status === "orphaned") armOrphanTimer(team);
  }

  function teamDeleteOp(raw: unknown, caller: Caller): OpResult<TeamDeleteResult> {
    if (caller.role !== "lead" || !caller.team) return fail("not_lead");
    const args = isRecord(raw) ? raw : {};
    const force = own(args, "force");
    if (force !== undefined && typeof force !== "boolean") return fail("invalid_args");
    return teamDelete(caller.team, { actor: "lead", force: force === true });
  }

  // ── lane reports: hello / busy / idle / ack ─────────────────────────────────

  function hello(payload: HelloPayload, caller: Caller): OpResult<HelloReply> {
    reports.set(caller.sessionId, { ...payload, at: clock.now() });
    const { team } = caller;
    if (!team) return fail("not_in_team");
    if (caller.role === "lead") {
      if (team.status === "orphaned") {
        const elapsed = clock.now() - (team.orphanedAt ?? clock.now());
        if (elapsed >= deps.config().orphanTtlMs) {
          closeTeam(team, "orphan_ttl");
          return fail("not_in_team");
        }
        bindLead(team.id, caller.sessionId);
        logger.info(`agent-teams: team ${team.id} lead re-bound`);
      } else {
        store.setLeadConnected(team.id, true);
      }
      return { ok: true, data: { role: "lead", teamId: team.id } };
    }
    const member = store.member(team, caller.name);
    if (!member) return fail("not_in_team");
    const patch: Partial<Member> = { guardActive: payload.guardActive };
    if (payload.sessionFile) patch.sessionFile = payload.sessionFile;
    // A `spawning` member leaves that state through the spawn flow (bind + guarded hello + prompt ack).
    if (member.status === "idle" || member.status === "busy" || member.status === "disconnected") {
      patch.status = payload.isIdle ? "idle" : "busy";
    }
    store.patchMember(team.id, member.name, patch);
    return { ok: true, data: { role: "member", teamId: team.id, member: member.name } };
  }

  function busy(_payload: BusyPayload, caller: Caller): OpResult<Record<string, never>> {
    const member = caller.team && caller.role === "member" ? store.member(caller.team, caller.name) : undefined;
    if (!caller.team || !member) return fail("not_in_team");
    if (member.status === "idle" || member.status === "disconnected") store.patchMember(caller.team.id, member.name, { status: "busy" });
    return { ok: true, data: {} };
  }

  function idle(payload: IdlePayload, caller: Caller): OpResult<{ ignored: boolean }> {
    const member = caller.team && caller.role === "member" ? store.member(caller.team, caller.name) : undefined;
    if (!caller.team || !member) return fail("not_in_team");
    if (!Number.isInteger(payload.settleId)) return fail("invalid_args");
    if (payload.settleId <= member.lastSettleId) return { ok: true, data: { ignored: true } };
    const patch: Partial<Member> = { lastSettleId: payload.settleId };
    if (member.status === "busy" || member.status === "disconnected" || member.status === "idle") patch.status = "idle";
    store.patchMember(caller.team.id, member.name, patch);
    return { ok: true, data: { ignored: false } };
  }

  /** Acknowledge mail addressed to the caller only; idempotent. */
  function ack(payload: AckPayload, caller: Caller): OpResult<{ acked: number[] }> {
    const { team } = caller;
    if (!team) return fail("not_in_team");
    const own = new Set(store.mailLog(team.id).filter((m) => m.to === caller.name).map((m) => m.id));
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).filter((i): i is number => Number.isInteger(i) && own.has(i));
    return { ok: true, data: { acked: store.ackMail(team.id, ids) } };
  }

  // ── host session events ─────────────────────────────────────────────────────

  /** `onSessionResolved`: a session spawned with a lead-role pluginRef binds to its `starting` team. */
  function handleSessionResolved(sessionId: string, pluginRef: Record<string, unknown>): void {
    const ref = pluginRef[AGENT_TEAMS_PLUGIN_ID];
    if (!isRecord(ref) || ref.role !== "lead" || typeof ref.teamId !== "string") return;
    const team = store.get(ref.teamId);
    if (team?.status !== "starting") return;
    const principalOwner = typeof pluginRef.principalOwner === "string" ? pluginRef.principalOwner : deps.hostSession(sessionId)?.principalOwner;
    bindLead(team.id, sessionId, principalOwner ? { principalOwner } : {});
  }

  /** `onSessionEnded`: a lead ending orphans its team (session mode); a member ending is `gone`. */
  function handleSessionEnded(sessionId: string): void {
    reports.delete(sessionId);
    const binding = store.findBySession(sessionId);
    const team = binding ? store.get(binding.teamId) : undefined;
    if (!binding || !team) return;
    if (binding.who === LEAD_ADDRESS) {
      if (team.status === "active" || team.status === "starting") orphanTeam(team);
      return;
    }
    releaseMember(team, binding.who, "gone", "session ended");
  }

  // ── op table / lane dispatch ────────────────────────────────────────────────

  const table = new Map<TeamOp, OpHandler>([
    ["TeamCreate", teamCreate],
    ["TeammateSpawn", teammateSpawn],
    ["TeamStatus", teamStatus],
    ["TeamDelete", teamDeleteOp],
  ]);

  /** Later sections add their op here; identity is always `caller`, never a payload field. */
  function registerOp(op: TeamOp, handler: OpHandler): void {
    table.set(op, handler);
  }

  function call(op: unknown, args: unknown, caller: Caller): OpResult<unknown> {
    if (!isTeamOp(op)) return fail("unknown_op", typeof op === "string" ? op.slice(0, 40) : undefined);
    if (caller.team?.status === "closed") return fail("team_closed");
    if (caller.role === "plain" && op !== "TeamCreate" && op !== "TeammateSpawn") return fail("not_in_team");
    if (caller.role === "member" && (LEAD_ONLY_OPS as readonly string[]).includes(op)) return fail("not_lead");
    const handler = table.get(op);
    if (!handler) return fail("unknown_op", op);
    return handler(args, caller);
  }

  function dispose(): void {
    for (const t of orphanTimers.values()) clock.clearTimeout(t);
    for (const t of closeTimers.values()) clock.clearTimeout(t);
    orphanTimers.clear();
    closeTimers.clear();
  }

  return {
    reports,
    resolveCaller,
    isConfined,
    call,
    registerOp,
    createTeam,
    bindLead,
    spawnMember,
    abortMember,
    teamDelete,
    requestShutdown,
    sendServerMail,
    enqueueLeadNotice,
    releaseMember,
    orphanTeam,
    canDispatch,
    isDispatchEligible,
    teamCreate,
    teammateSpawn,
    teamStatus,
    hello,
    busy,
    idle,
    ack,
    handleSessionResolved,
    handleSessionEnded,
    resumeClosing,
    rearmOrphans,
    dispose,
  };
}

export type Ops = ReturnType<typeof createOps>;
