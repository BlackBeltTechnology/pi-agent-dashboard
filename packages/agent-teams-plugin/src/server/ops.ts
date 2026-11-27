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
 *  - `mailer`               → replaces the built-in mail engine's flush (tests); the engine (`mail.ts`) is the default
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
  TRUNCATION_MARKER,
} from "../shared/constants.js";
import { isRegisteredMailKind } from "../shared/mail-format.js";
import { ownerKeyFrom } from "../shared/owner-key.js";
import { AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import {
  type AckPayload,
  type BusyPayload,
  type HelloPayload,
  type HelloReply,
  type IdlePayload,
  isStartOp,
  isTeamOp,
  LEAD_ONLY_OPS,
  type OpResult,
  type StartOp,
  type TeamCreateResult,
  type TeamDeleteResult,
  type TeammateSpawnArgs,
  type TeammateSpawnResult,
  type TeamOp,
  type TeamRole,
  type TeamStatusResult,
} from "../shared/protocol.js";
import { codePointLength, sanitizeText, truncateWithMarker } from "../shared/text.js";
import type {
  CloseReason,
  Committer,
  Mail,
  Member,
  SessionBinding,
  Team,
  TeamOverrides,
} from "../shared/types.js";
import { isRecord, own, stringList, textField } from "./args.js";
import { type ConfigReader, effectiveCoalesceWindowMs, type TeamsConfig } from "./config.js";
import { createDispatcher } from "./dispatch.js";
import type { MemberDriver } from "./driver.js";
import {
  type ExtensionPoints,
  IDLE_GATE_OP,
  type MemberSpawnExtras,
  runOpGatePipeline,
  runOpGates,
  type SpawnResolution,
  type SpawnSource,
  type TrustedSpawnOptions,
} from "./extension-points.js";
import { createMailEngine } from "./mail.js";
import { createMailLimits } from "./mail-limits.js";
import { createMessaging } from "./messaging.js";
import type { ModeRegistry } from "./modes.js";
import { createNoticeBuffer } from "./notices.js";
import { fail, isLive } from "./op-util.js";
import { type AsClaim, asClaimOf, resolveProxied } from "./proxy-identity.js";
import { createShutdown } from "./shutdown.js";
import { createSpawnFlow, createSpawnPlanner } from "./spawn.js";
import type { CreateTeamInput as StoreCreateTeamInput, TeamStore } from "./store.js";
import { createTaskOps } from "./tasks.js";
import { createTelemetry } from "./telemetry.js";
import type { Actor, HostSessionLookup, Logger } from "./types.js";

/** The minimal slice of the host's `getPiResources` result the skill resolver reads. */
type PiResourcesLookup = (cwd?: string) => Promise<{
  local?: { skills?: Array<{ name: string; filePath: string }> };
  global?: { skills?: Array<{ name: string; filePath: string }> };
  packages?: Array<{ resources?: { skills?: Array<{ name: string; filePath: string }> } }>;
}>;

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
  /** In-process: the caller is a member identified by a lead-proxied `as {member, token}` on the lead's socket (`sessionId` is the LEAD's). */
  proxied?: true;
  /** A present-but-invalid `as`: the lane answers this code and never falls back to the socket identity. */
  rejected?: "forbidden" | "member_gone";
}

// ── seams ────────────────────────────────────────────────────────────────────

export interface PreparedSpawn {
  cwd: string;
  model?: string;
  /** From the spawn resolver (`SpawnResolution.thinkingLevel`); passed to the host spawn. */
  thinkingLevel?: string;
  tools?: string[];
  skills?: string[];
  noMcp: boolean;
  noContextFiles: boolean;
  committer?: Committer;
}

interface SpawnPlanInput {
  leadCwd: string;
  team?: Team;
  args: TeammateSpawnArgs;
  trusted?: TrustedSpawnOptions;
  config: TeamsConfig;
  /** Skill allowlist resolved to `SKILL.md` paths by the async step before the sync spawn (absent ⇒ none requested). */
  resolvedSkills?: string[];
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
  /** Host kill by spawn token (`ctx.abortSpawnedRun`). */
  abortSpawnedRun?: (args: { sessionId?: string; spawnToken?: string }) => unknown;
  /** Host skill discovery (`ctx.getPiResources`); absent ⇒ a skill allowlist is refused (`skill_resolution_unavailable`). */
  getPiResources?: PiResourcesLookup;
  /** Host model availability; absent ⇒ only the model id syntax is validated. */
  isKnownModel?: (model: string) => boolean;
  /** A proxied `as` was rejected (`inproc_forbidden` counter + ids-only log); absent ⇒ silent. */
  onProxyRejected?: (info: { sessionId: string; reason: "forbidden" | "member_gone"; teamId?: string }) => void;
}

// ── small helpers ────────────────────────────────────────────────────────────

/** The only `TeamCreate {mode}` values (exact, lowercase). */
const VALID_MODE_ARGS: readonly string[] = ["session", "in-process"];

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
  /** Canonical team default tools / skills (`Team.defaultTools` / `Team.defaultSkills`). */
  defaultTools?: string[];
  defaultSkills?: string[];
  /** Legacy aliases of `defaultTools` / `defaultSkills` (the `TeamCreate` tool args); the `default*` names win. */
  skills?: string[];
  tools?: string[];
  callerSessionId?: string;
  overrides?: TeamOverrides;
  /** Templates-hooks fields persisted on the team record. */
  template?: StoreCreateTeamInput["template"];
  hooks?: StoreCreateTeamInput["hooks"];
  leadSpawnToken?: string;
  leadBindDeadline?: number;
}

/** Values the async step before the sync op resolved (`TeammateSpawn`: allowlisted skill names → `SKILL.md` paths, the spawn resolution). */
export interface CallExtra {
  skills?: string[];
  /** The spawn resolver's output for this call (absent when no resolver is registered). */
  spawn?: SpawnResolution;
}

export type OpHandler = (args: unknown, caller: Caller, extra?: CallExtra) => OpResult<unknown>;

/** A server-side start op (`team.start`, `team.templates`): may be async; the caller is the lane socket's session. */
export type StartOpHandler = (args: unknown, caller: Caller) => OpResult<unknown> | Promise<OpResult<unknown>>;

export interface StartOpOptions {
  /** Roles allowed to call it (default `["plain"]`). Others get `nested_team_forbidden` (member) / `already_in_team` (lead). */
  roles?: readonly TeamRole[];
  /** Refuse a confined plain session with `lead_confined` like `TeamCreate` (default `true`). */
  refuseConfined?: boolean;
}

export function createOps(deps: OpsDeps) {
  const { store, clock, logger } = deps;
  const telemetry = createTelemetry(logger);
  const reports = deps.reports ?? new Map<string, SessionReport>();
  const planner = deps.planner ?? createSpawnPlanner(deps.isKnownModel ? { isKnownModel: deps.isKnownModel } : {});
  const newToken = deps.newToken ?? (() => `at-${randomUUID()}`);
  const wakeSeqs = new Map<string, number>();
  const wakeKey = (teamId: string, member: string): string => `${teamId}\u0000${member}`;
  /** Count of waking mails queued for a member since the server started (the idle gate compares it before/after its await). */
  const wakeSeq = (teamId: string, member: string): number => wakeSeqs.get(wakeKey(teamId, member)) ?? 0;
  const orphanTimers = new Map<string, unknown>();
  const closeTimers = new Map<string, unknown>();

  const driverFor = (team: Team): MemberDriver | undefined => deps.modes.get(team.mode)?.driver ?? deps.modes.get("session")?.driver;

  // ── §4/§6/§7 modules (constructed here; they call back through the lambdas below) ──
  const limits = createMailLimits(clock);
  const engine = createMailEngine({ store, clock, logger, config: deps.config, telemetry, driverFor, onRevert: (team) => dispatcher.run(team) });
  const mailer: MailFlusher = deps.mailer ?? engine;
  const notices = createNoticeBuffer({
    store,
    clock,
    logger,
    config: deps.config,
    post: (team, notice) => void mailTo(team, LEAD_ADDRESS, { from: "server", kind: "notice", text: notice.text, wake: notice.wake, details: notice.details }),
  });
  const dispatcher = createDispatcher({
    store,
    config: deps.config,
    telemetry,
    isEligible: (team, member) => isDispatchEligible(team, member),
    mailTo: (team, to, input) => mailTo(team, to, input),
    onClaim: (team) => limits.resetPairs(team.id),
  });
  const taskOps = createTaskOps({
    store,
    config: deps.config,
    logger,
    telemetry,
    onActivity: (team) => {
      limits.resetPairs(team.id);
      dispatcher.run(team);
    },
    notify: (team, item) => notices.add(team, item),
  });
  const shutdown = createShutdown({
    store,
    clock,
    logger,
    telemetry,
    config: deps.config,
    engine,
    driverFor,
    mailTo: (team, to, input) => mailTo(team, to, input),
    notify: (team, item) => notices.add(team, item),
    releaseTasksOf: (team, name, reason) => taskOps.releaseTasksOf(team, name, reason),
    onExit: (team, name) => void releaseMember(team, name, "gone", "shutdown approved"),
    onResumed: (team) => void dispatcher.run(team),
  });
  const messaging = createMessaging({
    store,
    config: deps.config,
    logger,
    telemetry,
    limits,
    engine,
    driverFor,
    mailTo: (team, to, input) => mailTo(team, to, input),
    notify: (team, item) => notices.add(team, item),
    drainNotices: (team) => notices.drain(team),
  });

  const flow = createSpawnFlow({
    store,
    clock,
    logger,
    telemetry,
    config: deps.config,
    ext: deps.ext,
    driverFor,
    hostSession: deps.hostSession,
    ...(deps.abortSpawnedRun ? { abortSpawnedRun: deps.abortSpawnedRun } : {}),
    fail: (team, name, message) => failSpawn(team, name, message),
    notify: (team, item) => notices.add(team, item),
  });
  const starter: SpawnStarter = deps.starter ?? flow.start;

  function refOf(team: Team, member: Member) {
    return { teamId: team.id, member: member.name, ...(member.sessionId ? { sessionId: member.sessionId } : {}) };
  }

  // ── identity ────────────────────────────────────────────────────────────────

  /**
   * The single caller-resolution function: identity comes from the lane socket's
   * `sessionId` through the binding index, plus ONE explicit branch: a payload carrying
   * `as {member, token}` (in-process mode, `proxy-identity.ts`) is accepted only from the
   * lead socket of an in-process team with the member's token; any other `as` yields a
   * `rejected` caller (`forbidden` / `member_gone`) and never falls back to the socket identity.
   * See change: add-agent-teams-in-process.
   */
  function resolveCaller(meta: { sessionId: string }, payload?: unknown): Caller {
    const claim = asClaimOf(payload);
    if (claim !== undefined) return resolveProxiedCaller(meta.sessionId, claim);
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

  function resolveProxiedCaller(sessionId: string, claim: Exclude<AsClaim, undefined>): Caller {
    const decision = resolveProxied(store, sessionId, claim);
    if (decision.ok) return { sessionId, role: "member", binding: { teamId: decision.team.id, who: decision.member.name }, team: decision.team, name: decision.member.name, proxied: true };
    const binding = store.findBySession(sessionId);
    deps.onProxyRejected?.({ sessionId, reason: decision.error, ...(binding ? { teamId: binding.teamId } : {}) });
    return { sessionId, role: "plain", name: "", rejected: decision.error };
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
    if (mail) {
      if (input.wake && to !== LEAD_ADDRESS) wakeSeqs.set(wakeKey(team.id, to), wakeSeq(team.id, to) + 1);
      mailer.flush(team.id, to);
      if (!engine.isHandedOver(team.id, mail.id)) {
        telemetry.count(team.id, "queued");
        telemetry.log("queue", team.id, { from: input.from, chars: input.text.length, wake: input.wake }, `mail ${mail.id} -> ${to}`);
      }
    }
    return mail;
  }

  /**
   * Server-authored notice for the lead, appended at once (a direct, already
   * composed notice: later changes use it for their own events); queues while the
   * team has no bound lead. The coalesced lifecycle buffer is flushed first so
   * mail ids keep the order the events happened in. `coalesce: true` instead adds
   * the text (one line) as an item of the lead-notice coalescer, so several
   * notices inside `notifyCoalesceMs` travel as ONE mail (and one wake); nothing is
   * returned then. Default `false`: behaviour unchanged.
   */
  function enqueueLeadNotice(team: Team, input: { text: string; wake: boolean; coalesce?: boolean }): Mail | undefined {
    if (input.coalesce === true) {
      notices.add(team, { head: input.text, wake: input.wake });
      return undefined;
    }
    notices.drain(team);
    return mailTo(team, LEAD_ADDRESS, { from: "server", kind: "notice", text: input.text, wake: input.wake });
  }

  /** Server mail to one live member (or the lead, `to === "lead"`) in a registered kind (sender `server`). */
  function sendServerMail(team: Team, to: string, input: { kind: string; text: string; wake: boolean; details?: Record<string, unknown> }): OpResult<{ mailId: number }> {
    if (!isRegisteredMailKind(input.kind)) return fail("invalid_args", `unregistered mail kind: ${input.kind}`);
    if (to !== LEAD_ADDRESS) {
      const member = store.member(team, to);
      if (!member) return fail("unknown_recipient", to);
      if (!isLive(member)) return fail("member_gone", to);
    }
    const mail = mailTo(team, to, { from: "server", kind: input.kind, text: input.text, wake: input.wake, ...(input.details ? { details: input.details } : {}) });
    return mail ? { ok: true, data: { mailId: mail.id } } : fail("team_closed");
  }

  // ── member exit ─────────────────────────────────────────────────────────────

  /**
   * A member is `gone`/`failed`: release its tasks (`in_progress` → `pending`
   * unowned with a note, owned `pending` → unowned), discard its queued mail and
   * tell the lead (waking; coalesced) which tasks were affected. A member that
   * APPROVED a shutdown yields one item that also closes the handshake: it wakes
   * the lead only when every outstanding request is resolved (and none was
   * server-initiated).
   */
  function releaseMember(team: Team, name: string, status: "gone" | "failed", reason: string): { released: string[]; unowned: string[] } {
    const out = { released: [] as string[], unowned: [] as string[] };
    const member = store.member(team, name);
    if (!member || !isLive(member)) return out;
    const handshake = shutdown.consume(team.id, name);
    flow.clear(team.id, name);
    store.patchMember(team.id, name, { status, goneReason: reason }, { writeThrough: true });
    const freed = taskOps.releaseTasksOf(team, name, reason);
    out.released.push(...(handshake?.released ?? []), ...freed.released);
    out.unowned.push(...(handshake?.unowned ?? []), ...freed.unowned);
    store.discardMailFor(team.id, name);
    engine.forget(team.id, name);
    const parts = [handshake?.approved ? `${name} approved the shutdown request and exited` : `${name} is ${status} (${reason})`];
    if (out.released.length) parts.push(`released to pending: ${out.released.join(", ")}`);
    if (out.unowned.length) parts.push(`unowned: ${out.unowned.join(", ")}`);
    const wake = handshake?.approved ? handshake.actor !== "server" && shutdown.pendingCount(team.id) === 0 : true;
    notices.add(team, { head: parts.join("; "), wake });
    dispatcher.run(team);
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
      ...((input.defaultSkills ?? input.skills) ? { defaultSkills: (input.defaultSkills ?? input.skills) as string[] } : {}),
      ...((input.defaultTools ?? input.tools) ? { defaultTools: (input.defaultTools ?? input.tools) as string[] } : {}),
      ...(input.overrides ? { overrides: input.overrides } : {}),
      ...(input.template ? { template: input.template } : {}),
      ...(input.hooks ? { hooks: input.hooks } : {}),
      ...(input.leadSpawnToken ? { leadSpawnToken: input.leadSpawnToken } : {}),
      ...(input.leadBindDeadline !== undefined ? { leadBindDeadline: input.leadBindDeadline } : {}),
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
    telemetry.log("bind", teamId, { role: "lead" });
    // Mail and notices for the lead queued while it was absent (starting/orphaned) flush on (re)bind.
    mailer.flush(teamId, LEAD_ADDRESS);
    dispatcher.run(bound);
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
    limits.forgetTeam(team.id);
    for (const k of wakeSeqs.keys()) if (k.startsWith(`${team.id}\u0000`)) wakeSeqs.delete(k);
    engine.dropTeam(team.id);
    notices.drop(team.id);
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
    telemetry.log("orphan", team.id, { members: team.members.filter(isLive).length });
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
    if (caller.role === "lead") {
      // A team's mode is fixed at creation: asking a lead's second TeamCreate for ANOTHER mode is `invalid_args` naming `mode`.
      const asked = isRecord(raw) ? own(raw, "mode") : undefined;
      return asked !== undefined && asked !== caller.team?.mode ? fail("invalid_args", "mode cannot be changed: it is fixed when the team is created") : fail("already_in_team");
    }
    if (isConfined(caller.sessionId)) return fail("lead_confined");
    const args = isRecord(raw) ? raw : undefined;
    if (!args) return fail("invalid_args", "args must be an object");
    // Spec "Mode argument validation": only the exact values `session` and `in-process`; anything else is `invalid_args`, never a fallback.
    const rawMode = own(args, "mode");
    if (rawMode !== undefined && !(typeof rawMode === "string" && VALID_MODE_ARGS.includes(rawMode))) return fail("invalid_args", "mode must be exactly \"session\" or \"in-process\"");
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
    if (own(raw, "mode") !== undefined) return fail("invalid_args", "mode cannot be set on TeammateSpawn: it is fixed when the team is created");
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
    // The agent NAME is validated by the resolver (`agent_invalid`: empty, > 64 chars, bad characters), so it is only bounded here.
    const rawAgent = own(raw, "agent");
    const agent = typeof rawAgent === "string" && rawAgent.length <= 256 ? ({ ok: true, value: rawAgent.trim() } as const) : rawAgent === undefined || rawAgent === null ? ({ ok: true, value: undefined } as const) : ({ ok: false } as const);
    const planPolicy = own(raw, "requirePlanApproval");
    if (!prompt.ok || !role.ok || !model.ok || !agent.ok || tools === "invalid" || skills === "invalid") return fail("invalid_args");
    if (planPolicy !== undefined && typeof planPolicy !== "boolean" && planPolicy !== "user") return fail("invalid_args", 'requirePlanApproval must be true, false or "user"');
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
        // Parsed for the spawn resolver; core itself ignores both (no resolver registered ⇒ no effect).
        ...(agent.value !== undefined ? { agent: agent.value } : {}),
        ...(planPolicy !== undefined ? { requirePlanApproval: planPolicy } : {}),
      },
    };
  }

  /**
   * Actor op: validate, reserve the name and persist `spawning`, ALL before any
   * `await`, then hand the async host spawn to the `starter` seam. `trusted`
   * options come only from in-process server callers; the lane never passes them.
   */
  function spawnMember(
    team: Team,
    args: TeammateSpawnArgs,
    trusted?: TrustedSpawnOptions,
    resolvedSkills?: string[],
    resolution?: Pick<SpawnResolution, "thinkingLevel" | "member">,
  ): OpResult<TeammateSpawnResult> {
    const cfg = deps.config();
    if (team.status === "closed" || team.status === "closing") return fail("team_closed");
    const existing = store.member(team, args.name);
    const resume = args.resume === true;
    if (resume && driverFor(team)?.supportsResume === false) return fail("resume_unsupported_in_process", "in-process teammates cannot be resumed; spawn it again to start a fresh context");
    if (resume) {
      if (!existing) return fail("nothing_to_resume", args.name);
      if (isLive(existing) && existing.status !== "disconnected") return fail("name_taken", args.name);
      if (!existing.sessionFile) return fail("nothing_to_resume", args.name);
    } else if (existing && isLive(existing)) {
      return fail("name_taken", args.name);
    }
    const live = team.members.filter((m) => isLive(m) && m.name !== (resume ? args.name : ""));
    if (live.length >= effectiveMaxTeammates(team, cfg)) return fail("team_full", `at most ${effectiveMaxTeammates(team, cfg)} teammates`);
    const plan = planner.prepare({ leadCwd: team.leadCwd, team, args, ...(trusted ? { trusted } : {}), ...(resolvedSkills ? { resolvedSkills } : {}), config: cfg });
    if (!plan.ok) return plan;
    const p: PreparedSpawn = resolution?.thinkingLevel ? { ...plan.data, thinkingLevel: resolution.thinkingLevel } : plan.data;
    const extras: MemberSpawnExtras | undefined = resolution?.member;
    const record: Member = {
      name: args.name,
      ...(args.role ? { role: args.role } : {}),
      spawnToken: newToken(),
      ...(resume && existing?.sessionFile ? { sessionFile: existing.sessionFile } : {}),
      // A resumed record sheds its previous session binding and failure state.
      ...(resume ? { sessionId: undefined, goneReason: undefined, degraded: undefined, agent: undefined, requirePlanApproval: undefined, planApproval: undefined, hold: undefined } : {}),
      // Resolver-provided member state (agent type, plan approval policy/state, dispatch hold); absent without a resolver.
      ...(extras?.agent ? { agent: extras.agent } : {}),
      ...(extras?.requirePlanApproval !== undefined ? { requirePlanApproval: extras.requirePlanApproval } : {}),
      ...(extras?.planApproval ? { planApproval: extras.planApproval } : {}),
      ...(extras?.hold ? { hold: extras.hold } : {}),
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
      text: `Team "${team.name}" · you are teammate "${args.name}"${args.role ? ` (role: ${args.role})` : ""}. The lead is "${LEAD_ADDRESS}".\n\n${args.prompt}`,
      wake: true,
      ...(args.role ? { details: { role: args.role } } : {}),
    });
    try {
      const started = starter({ team, member: reserved, prompt: args.prompt, prepared: p, resume });
      if (started && typeof (started as Promise<void>).catch === "function") {
        (started as Promise<void>).catch((err: unknown) => failSpawn(team, args.name, (err as Error).message));
      }
    } catch (err) {
      failSpawn(team, args.name, (err as Error).message);
    }
    const note = driverFor(team)?.spawnNote?.(team, effectiveMaxTeammates(team, cfg));
    return { ok: true, data: { member: args.name, status: "spawning", ...(note ? { note } : {}) } };
  }

  function failSpawn(team: Team, name: string, message: string): void {
    logger.error(`agent-teams: spawn of ${name} failed: ${message}`);
    releaseMember(team, name, "failed", `spawn failed: ${message}`);
  }

  /**
   * Run the registered spawn resolver (none ⇒ the parsed args pass through untouched). The resolver
   * returns the EFFECTIVE args; core re-pins `name`/`resume`, bounds the prompt again and keeps
   * everything else the resolver decided (the planner still confines `cwd` and validates `model`).
   */
  function resolveSpawn(input: { team: Team | undefined; leadCwd: string; args: TeammateSpawnArgs; trusted?: TrustedSpawnOptions; source: SpawnSource; callerSessionId?: string }): OpResult<SpawnResolution> {
    const resolver = deps.ext.spawnResolver;
    if (!resolver) return { ok: true, data: { args: input.args } };
    let res: OpResult<SpawnResolution>;
    try {
      res = resolver(input);
    } catch (err) {
      logger.error(`agent-teams: spawn resolver threw: ${(err as Error).message}`);
      return fail("invalid_args", "spawn resolution failed");
    }
    if (!res.ok) return res;
    const args: TeammateSpawnArgs = { ...res.data.args, name: input.args.name, ...(input.args.resume !== undefined ? { resume: input.args.resume } : {}) };
    if (codePointLength(args.prompt) > deps.config().maxMessageChars) return fail("message_too_long", `at most ${deps.config().maxMessageChars} characters`);
    return { ok: true, data: { ...res.data, args } };
  }

  function teammateSpawn(raw: unknown, caller: Caller, extra?: CallExtra): OpResult<TeammateSpawnResult> {
    if (caller.role === "member") return fail("not_lead");
    const cfg = deps.config();
    const parsed = parseSpawnArgs(raw, cfg);
    if (!parsed.ok) return parsed;
    let team = caller.team;
    let leadCwd = team?.leadCwd;
    if (caller.role === "plain") {
      if (isConfined(caller.sessionId)) return fail("lead_confined");
      const host = deps.hostSession(caller.sessionId);
      if (!host?.cwd) return fail("invalid_args", "caller working directory unknown");
      leadCwd = host.cwd;
    }
    // The async step before this sync op normally resolved already (`extra.spawn`); a direct `call` resolves here.
    const spawn: OpResult<SpawnResolution> | undefined = extra?.spawn ? { ok: true, data: extra.spawn } : (leadCwd !== undefined ? resolveSpawn({ team, leadCwd, args: parsed.data, source: "lane", callerSessionId: caller.sessionId }) : undefined);
    if (spawn && !spawn.ok) return spawn;
    const args = spawn?.data.args ?? parsed.data;
    const resolution = spawn ? { ...(spawn.data.thinkingLevel ? { thinkingLevel: spawn.data.thinkingLevel } : {}), ...(spawn.data.member ? { member: spawn.data.member } : {}) } : undefined;
    if (caller.role === "plain") {
      const host = deps.hostSession(caller.sessionId);
      // Dry-run the spawn plan before creating anything, so a refused spawn leaves no team behind.
      const plan = planner.prepare({ leadCwd: host?.cwd as string, args, config: cfg, ...(extra?.skills ? { resolvedSkills: extra.skills } : {}) });
      if (!plan.ok) return plan;
      const created = createTeam({
        name: `${basename(host?.cwd as string)} team`.slice(0, TEAM_NAME_MAX_CHARS),
        leadCwd: host?.cwd as string,
        leadSessionId: caller.sessionId,
        callerSessionId: caller.sessionId,
        ...(host?.principalOwner ? { owner: host.principalOwner } : {}),
      });
      if (!created.ok) return created;
      team = created.data;
    }
    if (!team) return fail("not_in_team");
    return spawnMember(team, args, undefined, extra?.skills, resolution);
  }

  /**
   * In-process spawn through the SAME path the agent tool takes (resolver → skill-name resolution →
   * `spawnMember`): eager template members, seeds. `trusted` is honoured exactly like `spawnMember`.
   * Async because skill names resolve through the host; the reserve itself is synchronous inside.
   */
  async function spawnTeammate(team: Team, args: TeammateSpawnArgs, opts: { trusted?: TrustedSpawnOptions; source?: SpawnSource } = {}): Promise<OpResult<TeammateSpawnResult>> {
    const spawn = resolveSpawn({ team, leadCwd: team.leadCwd, args, source: opts.source ?? "server", ...(opts.trusted ? { trusted: opts.trusted } : {}) });
    if (!spawn.ok) return spawn;
    const eff = spawn.data.args;
    let skills: string[] | undefined;
    const names = eff.skills ?? team.defaultSkills;
    if (names !== undefined) {
      const r = await resolveSkillPaths(names, team.leadCwd);
      if (!r.ok) return r;
      skills = r.data;
    }
    const resolution = { ...(spawn.data.thinkingLevel ? { thinkingLevel: spawn.data.thinkingLevel } : {}), ...(spawn.data.member ? { member: spawn.data.member } : {}) };
    return spawnMember(team, eff, opts.trusted, skills, resolution);
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
   * Request a member's shutdown (handshake request half, `shutdown.ts`): the member
   * goes `shutdown_pending` and receives a waking `shutdown_request` mail. With actor
   * `server` the envelope is `from server`; the lead is woken only on a rejection or
   * when the member never answers within `shutdownGraceMs`.
   */
  function requestShutdown(team: Team, name: string, opts: { actor: Actor; reason?: string }): OpResult<{ member: string; status: "shutdown_pending" }> {
    return shutdown.request(team, name, opts);
  }

  /**
   * Stop a member's in-flight run and nothing else: no confirmation step, its
   * tasks stay `in_progress`, it is not woken, and the lead gets ONE waking notice.
   * `notify: false` suppresses that notice for a caller that queues its own (the
   * dashboard Stop action names owned task ids); default `true`.
   */
  function abortMember(team: Team, name: string, opts: { actor: Actor; notify?: boolean }): OpResult<{ member: string; aborted: true; details?: { noop: "not_busy"; hint?: string } }> {
    const member = store.member(team, name);
    if (!member) return fail("unknown_recipient", name);
    if (!isLive(member)) return fail("member_gone", name);
    const driver = driverFor(team);
    const res = driver?.abort(refOf(team, member)) ?? { ok: false, reason: "no_driver" };
    if (!res.ok) return fail("interrupt_unavailable", res.reason);
    // Nothing was running (in-process: an idle / spawning member): a success no-op, the lead is not woken.
    if (res.noop) return { ok: true, data: { member: name, aborted: true, details: { noop: res.noop, ...(res.hint ? { hint: res.hint } : {}) } } };
    if (opts.notify !== false) enqueueLeadNotice(team, { text: `${name}'s current run was stopped by ${opts.actor}; its tasks stay in_progress`, wake: true });
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
      if (m?.status === "spawning") {
        flow.clear(team.id, name);
        flow.abort(m); // a spawn in flight is aborted by its token
      }
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
      // A member the driver already released as `not_alive` (an in-process child whose stop was never confirmed) keeps that reason.
      if (store.member(team, m.name)?.goneReason === "not_alive") continue;
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

  /** Re-deliver a recipient's unacked mail after it (re)connected. */
  function redeliver(teamId: string, to: string): void {
    if (deps.mailer) deps.mailer.flush(teamId, to);
    else engine.noteHello(teamId, to);
  }

  function hello(payload: HelloPayload, caller: Caller): OpResult<HelloReply> {
    if (!caller.proxied) reports.set(caller.sessionId, { ...payload, at: clock.now() }); // a child's hello must not overwrite its lead's report
    const { team } = caller;
    if (!team) return fail("not_in_team");
    if (caller.role === "lead") {
      if (team.status === "orphaned") {
        const elapsed = clock.now() - (team.orphanedAt ?? clock.now());
        if (elapsed >= deps.config().orphanTtlMs) {
          closeTeam(team, "orphan_ttl");
          return fail("not_in_team");
        }
        engine.unhand(team.id, LEAD_ADDRESS);
        bindLead(team.id, caller.sessionId); // flushes the queue once
        logger.info(`agent-teams: team ${team.id} lead re-bound`);
      } else {
        store.setLeadConnected(team.id, true);
        redeliver(team.id, LEAD_ADDRESS);
      }
      return { ok: true, data: { ...contribute(team, undefined, "lead", payload).reply, role: "lead", teamId: team.id } };
    }
    const member = store.member(team, caller.name);
    if (!member) return fail("not_in_team");
    const patch: Partial<Member> = { guardActive: payload.guardActive };
    if (payload.sessionFile) patch.sessionFile = payload.sessionFile;
    const contributed = contribute(team, member, "member", payload);
    // Contributor fields first so `role`/`teamId`/`member` can never be overridden.
    const reply: OpResult<HelloReply> = { ok: true, data: { ...contributed.reply, role: "member", teamId: team.id, member: member.name } };
    const degraded = guardVerdict(member, payload) ?? contributed.degraded;
    if (degraded) {
      // Never run unguarded: team tools refused, no dispatch, the lead is told (once per reason).
      if (member.degraded !== degraded) {
        notices.add(team, { head: `${member.name} is degraded (${degraded}): its team tools are refused and it gets no work`, wake: true });
      }
      store.patchMember(team.id, member.name, { ...patch, degraded });
      return reply;
    }
    if (member.degraded !== undefined) patch.degraded = undefined;
    // A `spawning` member becomes `busy` on its guarded hello: the `spawn_prompt` below is a waking mail.
    if (member.status === "spawning") patch.status = "busy";
    else if (member.status === "idle" || member.status === "busy" || member.status === "disconnected") {
      patch.status = payload.isIdle ? "idle" : "busy";
    }
    engine.confirm(team.id, member.name); // `hello` is authoritative: a provisional busy ends here
    engine.takeSuspect(team.id, member.name);
    store.patchMember(team.id, member.name, patch);
    redeliver(team.id, member.name);
    dispatcher.run(team);
    return reply;
  }

  /** Run the hello contributors in order: replies merge (later keys win), the first `degraded` wins; a throwing contributor is skipped. */
  function contribute(team: Team, member: Member | undefined, role: TeamRole, payload: HelloPayload): { reply: Partial<HelloReply>; degraded?: Member["degraded"] } {
    const out: { reply: Partial<HelloReply>; degraded?: Member["degraded"] } = { reply: {} };
    for (const fn of deps.ext.helloContributors) {
      try {
        const c = fn({ team, member, role, payload });
        if (!c) continue;
        if (c.reply) Object.assign(out.reply, c.reply);
        if (c.degraded !== undefined && out.degraded === undefined && role === "member") out.degraded = c.degraded;
      } catch (err) {
        logger.error(`agent-teams: hello contributor threw: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /**
   * Guard-ready handshake (D14, spec "Guard-ready handshake"): a bound member is only live
   * once its bridge reports tools + guard (and the exact policy it was spawned with).
   */
  function guardVerdict(member: Member, payload: HelloPayload): Member["degraded"] | undefined {
    if (!payload.toolsActive) return "team_tools_unavailable";
    if (!payload.guardActive) return "guard_unavailable";
    if (member.policyHash === undefined) return undefined;
    if (payload.policyHash === undefined) return "guard_unavailable";
    return payload.policyHash === member.policyHash ? undefined : "guard_mismatch";
  }

  /**
   * A busy report arriving for a member the server believes confirmed-idle that
   * already holds a just-dispatched, not-yet-acked task: the member was busy all
   * along, so the task returns to `pending` (invariant: ≤1 `in_progress` task per
   * member) and its undelivered `task_assigned` mail is discarded.
   */
  function undoUnackedDispatch(team: Team, member: Member): void {
    for (const task of team.tasks.filter((t) => t.owner === member.name && t.status === "in_progress")) {
      const mail = store.pendingMail(team.id, member.name).find((m) => m.kind === "task_assigned" && m.details?.taskId === task.id);
      if (!mail) continue;
      store.ackMail(team.id, [mail.id]);
      store.patchTask(team.id, task.id, mail.details?.preOwned === true ? { status: "pending" } : { status: "pending", clearOwner: true });
      logger.info(`agent-teams: task ${task.id} returned to pending: ${member.name} was already busy`);
    }
  }

  function busy(_payload: BusyPayload, caller: Caller): OpResult<Record<string, never>> {
    const member = caller.team && caller.role === "member" ? store.member(caller.team, caller.name) : undefined;
    if (!caller.team || !member) return fail("not_in_team");
    const confirmed = engine.confirm(caller.team.id, member.name);
    const late = engine.takeSuspect(caller.team.id, member.name);
    if (late || (member.status === "idle" && !confirmed)) undoUnackedDispatch(caller.team, member);
    if (member.status === "idle" || member.status === "disconnected") store.patchMember(caller.team.id, member.name, { status: "busy" });
    return { ok: true, data: {} };
  }

  /**
   * Idle report. With no `TeammateIdle` gate registered (or for a `shutdown_pending` member, an
   * errored or aborted settle) it commits synchronously exactly as before. Otherwise it first
   * awaits the gates under the shared `opGateBudgetMs`, then RE-VALIDATES everything against the
   * store (team/member still there and live, settle not superseded, no waking mail arrived since
   * the report — the member's `wakeSeq` is compared) and only then commits:
   *   allow → normal idle handling; veto → member stays `busy`, `lastSettleId` is consumed, NO lead
   *   notice, no claim, then the veto's `afterBlock()` runs; gate throw/timeout/budget → fail-open (allow).
   */
  function idle(payload: IdlePayload, caller: Caller): OpResult<{ ignored: boolean }> | Promise<OpResult<{ ignored: boolean }>> {
    const team = caller.team;
    const member = team && caller.role === "member" ? store.member(team, caller.name) : undefined;
    if (!team || !member) return fail("not_in_team");
    if (!Number.isInteger(payload.settleId)) return fail("invalid_args");
    if (payload.settleId <= member.lastSettleId) return { ok: true, data: { ignored: true } };
    const gates = payload.error === undefined && payload.aborted !== true && member.status !== "shutdown_pending" ? deps.ext.gatesFor(IDLE_GATE_OP) : [];
    if (gates.length === 0) return commitIdle(team, member, payload);
    const at = wakeSeq(team.id, member.name);
    const input = {
      op: IDLE_GATE_OP,
      team,
      callerName: member.name,
      args: payload,
      idle: { settleId: payload.settleId, ...(payload.finalText !== undefined ? { finalText: payload.finalText } : {}) },
      wakeSeq: { at, read: () => wakeSeq(team.id, member.name) },
    };
    return runOpGatePipeline(gates, input, deps.config().opGateBudgetMs, clock).then((outcome) => {
      if (outcome.kind === "failed") {
        logger.warn(`agent-teams: idle gate for ${member.name} failed open: ${outcome.refusal.ok ? "" : outcome.refusal.message}`);
      }
      // Re-validate: state may have moved during the await.
      const t = store.get(team.id);
      const m = t ? store.member(t, member.name) : undefined;
      if (!t || !m || t.status === "closed" || !isLive(m) || payload.settleId <= m.lastSettleId) return { ok: true, data: { ignored: true } };
      if (wakeSeq(t.id, m.name) !== at) return { ok: true, data: { ignored: true } }; // a waking mail arrived: the idle is stale
      if (outcome.kind === "veto") return blockIdle(t, m, payload, outcome.veto.afterBlock);
      return commitIdle(t, m, payload);
    });
  }

  /** The gate vetoed an idle: consume the settle, keep the member `busy`, tell nobody. */
  function blockIdle(team: Team, member: Member, payload: IdlePayload, afterBlock?: () => void): OpResult<{ ignored: boolean }> {
    telemetry.log("idle", team.id, { member: member.name, settleId: payload.settleId, blocked: true });
    const patch: Partial<Member> = { lastSettleId: payload.settleId };
    if (member.status === "idle" || member.status === "disconnected") patch.status = "busy";
    engine.confirm(team.id, member.name);
    engine.takeSuspect(team.id, member.name);
    store.patchMember(team.id, member.name, patch);
    if (afterBlock) {
      try {
        afterBlock();
      } catch (err) {
        logger.error(`agent-teams: idle gate follow-up threw: ${(err as Error).message}`);
      }
    }
    return { ok: true, data: { ignored: false } };
  }

  function commitIdle(team: Team, member: Member, payload: IdlePayload): OpResult<{ ignored: boolean }> {
    telemetry.log("idle", team.id, { member: member.name, settleId: payload.settleId, aborted: payload.aborted === true, errored: payload.error !== undefined, finalChars: payload.finalText?.length ?? 0 });
    const patch: Partial<Member> = { lastSettleId: payload.settleId };
    if (member.status === "busy" || member.status === "disconnected" || member.status === "idle") patch.status = "idle";
    engine.confirm(team.id, member.name);
    engine.takeSuspect(team.id, member.name);
    store.patchMember(team.id, member.name, patch);
    shutdown.onSettle(team, member.name); // an approved member's session may now end
    engine.releaseOnSettle(team.id, member.name); // an urgent mail held for this settle goes out before any claim
    if (payload.aborted === true || member.status !== "idle") return { ok: true, data: { ignored: false } }; // aborted: no notice, no claim
    const cfg = deps.config();
    const name = member.name;
    if (payload.error !== undefined) {
      notices.add(team, { head: `${name} stopped with an error`, body: truncateWithMarker(sanitizeText(payload.error, { keepNewlines: true }), cfg.maxFinalTextChars, TRUNCATION_MARKER), wake: true });
      return { ok: true, data: { ignored: false } };
    }
    const open = (): number => team.tasks.filter((t) => t.owner === name && t.status === "in_progress").length;
    const before = open();
    dispatcher.run(team);
    const claimedNext = open() > before;
    // A registered filter (e.g. a member with a pending plan) may suppress the lead notice; the claim above still ran.
    if (deps.ext.suppressIdleNotice(team, member, { settleId: payload.settleId, ...(payload.finalText !== undefined ? { finalText: payload.finalText } : {}) })) {
      return { ok: true, data: { ignored: false } };
    }
    const text = payload.finalText === undefined ? "" : truncateWithMarker(sanitizeText(payload.finalText, { keepNewlines: true }).trim(), cfg.maxFinalTextChars, TRUNCATION_MARKER);
    notices.add(team, {
      head: `${name} is idle${text === "" ? " (no final text)" : ""}${claimedNext ? " and picked up its next task" : ""}`,
      ...(text !== "" ? { body: text } : {}),
      wake: !claimedNext,
    });
    return { ok: true, data: { ignored: false } };
  }

  /**
   * In-process `state` report of a member (after a duplicate-only waking mail no run started): the provisional `busy` of core's
   * waking mail resolves to the host's real state before `wakeConfirmMs` lapses, and an `idle` member is looked at by the dispatcher again.
   */
  function reportMemberState(team: Team, name: string, state: "busy" | "idle"): void {
    const member = store.member(team, name);
    if (!member || !isLive(member)) return;
    engine.confirm(team.id, name);
    engine.takeSuspect(team.id, name);
    if (member.status !== state && (member.status === "busy" || member.status === "idle" || member.status === "disconnected")) store.patchMember(team.id, name, { status: state });
    if (state === "idle") dispatcher.run(team);
  }

  /** Acknowledge mail addressed to the caller only; idempotent. */
  function ack(payload: AckPayload, caller: Caller): OpResult<{ acked: number[] }> {
    const { team } = caller;
    if (!team) return fail("not_in_team");
    const own = new Set(store.mailLog(team.id).filter((m) => m.to === caller.name).map((m) => m.id));
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).filter((i): i is number => Number.isInteger(i) && own.has(i));
    const acked = engine.ack(team.id, ids);
    if (caller.role === "member" && store.mailLog(team.id).some((m) => ids.includes(m.id) && m.kind === "spawn_prompt")) flow.complete(team, caller.name);
    return { ok: true, data: { acked } };
  }

  // ── host session events ─────────────────────────────────────────────────────

  /** `onSessionResolved`: a session spawned with a lead-role pluginRef binds to its `starting` team. */
  function handleSessionResolved(sessionId: string, pluginRef: Record<string, unknown>): void {
    if (flow.onResolved(sessionId, pluginRef)) return;
    const ref = pluginRef[AGENT_TEAMS_PLUGIN_ID];
    if (!isRecord(ref) || ref.role !== "lead" || typeof ref.teamId !== "string") return;
    const team = store.get(ref.teamId);
    if (team?.status !== "starting") return;
    const principalOwner = ownerKeyFrom(pluginRef.principalOwner) ?? deps.hostSession(sessionId)?.principalOwner;
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
    ["TaskCreate", taskOps.taskCreate],
    ["TaskList", taskOps.taskList],
    ["TaskGet", taskOps.taskGet],
    ["TaskUpdate", taskOps.taskUpdate],
    ["SendMessage", messaging.sendMessage],
    ["ShutdownRequest", shutdown.requestOp],
    ["ShutdownResponse", shutdown.responseOp],
  ]);

  /** Later sections add their op here; identity is always `caller`, never a payload field. */
  function registerOp(op: TeamOp, handler: OpHandler): void {
    table.set(op, handler);
  }

  const startTable = new Map<StartOp, { handler: StartOpHandler; roles: readonly TeamRole[]; refuseConfined: boolean }>();

  /**
   * Register a server-side start op (`team.start` / `team.templates`). Only before the first lane
   * request (`ext.seal()`); a second registration replaces nothing and throws. These ops are NOT agent
   * tools: they are reached only through `agent-teams/call` from bridge code, and `callAsync` is
   * their only entry (`call` stays the synchronous core path and answers `unknown_op`).
   */
  function registerStartOp(op: StartOp, handler: StartOpHandler, opts: StartOpOptions = {}): void {
    if (deps.ext.sealed) throw new Error(`agent-teams: start op ${op} must be registered before the first request`);
    if (startTable.has(op)) throw new Error(`agent-teams: start op ${op} is already registered`);
    startTable.set(op, { handler, roles: opts.roles ?? ["plain"], refuseConfined: opts.refuseConfined !== false });
  }

  function callStart(op: StartOp, args: unknown, caller: Caller): OpResult<unknown> | Promise<OpResult<unknown>> {
    if (caller.team?.status === "closed") return fail("team_closed");
    const entry = startTable.get(op);
    if (!entry) return fail("unknown_op", op);
    if (!entry.roles.includes(caller.role)) return caller.role === "member" ? fail("nested_team_forbidden") : fail("already_in_team");
    if (caller.role === "plain" && entry.refuseConfined && isConfined(caller.sessionId)) return fail("lead_confined");
    try {
      const out = entry.handler(args, caller);
      if (out && typeof (out as Promise<unknown>).then === "function") {
        return (out as Promise<OpResult<unknown>>).catch((err: unknown) => {
          logger.error(`agent-teams: start op ${op} failed: ${(err as Error).message}`);
          return fail("invalid_args", `${op} failed`);
        });
      }
      return out as OpResult<unknown>;
    } catch (err) {
      logger.error(`agent-teams: start op ${op} threw: ${(err as Error).message}`);
      return fail("invalid_args", `${op} failed`);
    }
  }

  function call(op: unknown, args: unknown, caller: Caller, extra?: CallExtra): OpResult<unknown> {
    if (!isTeamOp(op)) return fail("unknown_op", typeof op === "string" ? op.slice(0, 40) : undefined);
    if (caller.team?.status === "closed") return fail("team_closed");
    if (caller.role === "plain" && op !== "TeamCreate" && op !== "TeammateSpawn") return fail("not_in_team");
    if (caller.role === "member" && (LEAD_ONLY_OPS as readonly string[]).includes(op)) return fail("not_lead");
    if (caller.role === "member" && caller.team) {
      const degraded = store.member(caller.team, caller.name)?.degraded;
      if (degraded !== undefined) return fail("member_degraded", `team tools are refused: ${degraded}`, { degraded });
    }
    const handler = table.get(op);
    if (!handler) return fail("unknown_op", op);
    return handler(args, caller, extra);
  }

  /** Resolve allowlisted skill names to `SKILL.md` paths through the host (layer 1 of the skill allowlist). */
  async function resolveSkillPaths(names: readonly string[], cwd: string): Promise<OpResult<string[]>> {
    if (names.length === 0) return { ok: true, data: [] };
    if (!deps.getPiResources) return fail("skill_resolution_unavailable", "this host cannot resolve skill names");
    let res: Awaited<ReturnType<PiResourcesLookup>>;
    try {
      res = await deps.getPiResources(cwd);
    } catch (err) {
      logger.warn(`agent-teams: skill resolution failed: ${(err as Error).message}`);
      return fail("skill_resolution_unavailable", "skill discovery failed");
    }
    const known = [res.local?.skills, res.global?.skills, ...(res.packages ?? []).map((p) => p.resources?.skills)].flatMap((l) => l ?? []);
    const paths: string[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const hit = known.find((k) => k.name === name);
      if (!hit) missing.push(name);
      else paths.push(hit.filePath.endsWith(".md") ? hit.filePath : `${hit.filePath.replace(/\/+$/, "")}/SKILL.md`);
    }
    if (missing.length > 0) return fail("skill_not_found", missing.join(", "), { skills: missing });
    return { ok: true, data: paths };
  }

  /** Ops that registered gates may veto before they commit: `TaskCreate` and `TaskUpdate` that completes (D17). */
  function isGated(op: unknown, args: unknown): op is "TaskCreate" | "TaskUpdate" {
    if (op === "TaskCreate") return true;
    return op === "TaskUpdate" && isRecord(args) && own(args, "status") === "completed";
  }

  /** State may have moved during an await: resolve again (a proxied member must still be live; its token was verified at admission). */
  function reresolve(caller: Caller): Caller {
    if (!caller.proxied || !caller.team) return resolveCaller({ sessionId: caller.sessionId });
    const team = store.get(caller.team.id);
    const member = team ? store.member(team, caller.name) : undefined;
    if (!team || !member || !isLive(member)) return { sessionId: caller.sessionId, role: "plain", name: "", rejected: "member_gone" };
    return { ...caller, team };
  }

  /**
   * Lane entry. A gated op with registered gates first awaits them under one
   * shared budget (a veto, a throw or a timeout refuses it with `op_blocked`),
   * then re-resolves the caller — state may have moved during the await — and
   * continues exactly as without gates. No gate registered ⇒ the sync path.
   */
  function callAsync(op: unknown, args: unknown, caller: Caller): OpResult<unknown> | Promise<OpResult<unknown>> {
    if (isStartOp(op)) return callStart(op, args, caller);
    const team = caller.team;
    const gatedOp = isGated(op, args) ? op : undefined;
    const gates = team && gatedOp ? deps.ext.gatesFor(gatedOp) : [];
    if (!team || !gatedOp || gates.length === 0) return callUngated(op, args, caller);
    return runOpGates(gates, { op: gatedOp, team, callerName: caller.name, args }, deps.config().opGateBudgetMs, clock).then((veto) => veto ?? callUngated(op, args, reresolve(caller)));
  }

  /**
   * Like `call`, but a `TeammateSpawn` first runs the spawn resolver (if any) and resolves the
   * effective skill allowlist names (sync otherwise).
   */
  function callUngated(op: unknown, args: unknown, caller: Caller): OpResult<unknown> | Promise<OpResult<unknown>> {
    const eligible = op === "TeammateSpawn" && (caller.role === "lead" || (caller.role === "plain" && !isConfined(caller.sessionId)));
    if (!eligible || caller.team?.status === "closed") return call(op, args, caller);
    const parsed = parseSpawnArgs(args, deps.config());
    if (!parsed.ok) return call(op, args, caller);
    const cwd = caller.team?.leadCwd ?? deps.hostSession(caller.sessionId)?.cwd ?? "";
    let spawn: OpResult<SpawnResolution> | undefined;
    if (deps.ext.spawnResolver && cwd !== "") {
      spawn = resolveSpawn({ team: caller.team, leadCwd: cwd, args: parsed.data, source: "lane", callerSessionId: caller.sessionId });
      if (!spawn.ok) return spawn;
    }
    const resolved = spawn?.ok ? spawn.data : undefined;
    const names = (resolved?.args ?? parsed.data).skills ?? caller.team?.defaultSkills;
    if (names === undefined) return call(op, args, caller, resolved ? { spawn: resolved } : undefined);
    return resolveSkillPaths(names, cwd).then((r) => (r.ok ? call(op, args, caller, { skills: r.data, ...(resolved ? { spawn: resolved } : {}) }) : r));
  }

  function dispose(): void {
    for (const t of orphanTimers.values()) clock.clearTimeout(t);
    for (const t of closeTimers.values()) clock.clearTimeout(t);
    orphanTimers.clear();
    closeTimers.clear();
    flow.dispose();
    notices.dispose();
    engine.dispose();
    shutdown.dispose();
  }

  return {
    telemetry,
    reports,
    resolveCaller,
    isConfined,
    call,
    callAsync,
    resolveSkillPaths,
    registerOp,
    registerStartOp,
    hostSession: deps.hostSession,
    wakeSeq,
    /** The mail engine's per-recipient handover controls (the in-process driver acks handed-over mail and un-hands a failed handover). */
    mailHandover: {
      /** Re-emit every unacked mail of `to` (it may have missed them; the receiver de-duplicates by id). */
      redeliver: (teamId: string, to: string) => engine.noteHello(teamId, to),
      ack: (teamId: string, ids: readonly number[]) => engine.ack(teamId, ids),
      unhand: (teamId: string, to: string) => engine.unhand(teamId, to),
      flush: (teamId: string, to: string) => (deps.mailer ?? engine).flush(teamId, to),
    },
    coalesceWindowMs: (team: Team): number => effectiveCoalesceWindowMs(team, deps.config()),
    spawnTeammate,
    createTeam,
    bindLead,
    spawnMember,
    abortMember,
    teamDelete,
    requestShutdown,
    sendServerMail,
    enqueueLeadNotice,
    releaseMember,
    createTask: taskOps.createTask,
    updateTask: taskOps.updateTask,
    orphanTeam,
    canDispatch,
    isDispatchEligible,
    teamCreate,
    teammateSpawn,
    teamStatus,
    hello,
    reportMemberState,
    /** Post the coalesced lead notice now (a closing path that must not lose it). */
    flushNotices: (team: Team) => notices.drain(team),
    busy,
    idle,
    ack,
    handleSessionResolved,
    handleSessionEnded,
    resumeClosing,
    rearmOrphans,
    reconcile: flow.reconcile,
    dispose,
  };
}

export type Ops = ReturnType<typeof createOps>;
