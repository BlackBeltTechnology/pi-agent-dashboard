/**
 * Conversations, agents and the idle sweeper (D5/D8). One conversation = one
 * persistent pi session found-or-resumed on demand. The host is reached only
 * through the narrow {@link HostPort}, so the service is unit-testable with a
 * fake. See change: add-team-plugin.
 */
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PluginCwdPolicy, PluginSpawnOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { piSessionDirForCwd } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { PRESET_TOOLS } from "../extension/guard.js";
import type { Access } from "./access.js";
import { canonicalize, type TeamPaths, userKey } from "./paths.js";
import { cpLength } from "./persona.js";
import type { ProjectRegistry } from "./projects.js";
import { type LocatedRecord, type Locator, type RecordStore, spawnedSkillNames } from "./records.js";
import { collectContextFiles } from "./render.js";
import { allowed, type SkillBlockReason, type SkillEntry, type SkillSnapshot, type SkillsService } from "./skills-service.js";
import type { PersonaStore } from "./store-types.js";
import {
  type AvatarSpec,
  type Caller,
  type ConversationRecord,
  type Persona,
  type PersonaRole,
  type Project,
  type SpawnedSkill,
  type TeamConfig,
  TeamError,
  WORKSPACE_TARGET,
} from "./types.js";

export interface HostSession {
  id: string;
  cwd: string;
  status: "active" | "idle" | "streaming" | "ended";
  sessionFile?: string;
  name?: string;
  firstMessage?: string;
  principalOwner?: { iss: string; sub: string };
  /** `pluginRefs[pluginId]` = the whole ref the plugin filed at spawn. */
  pluginRefs?: Record<string, Record<string, unknown>>;
}

export interface HostPort {
  spawnSession(opts: PluginSpawnOptions): Promise<{ success: boolean; message?: string; spawnToken?: string }>;
  abortSpawnedRun(args: { sessionId?: string; spawnToken?: string; graceful?: boolean }): Promise<boolean> | boolean;
  getSession(id: string): HostSession | undefined;
  listAll(): HostSession[];
  onSessionResolved(h: (sessionId: string, ref: Record<string, unknown>) => void): () => void;
  onEvent(h: (sessionId: string, event: unknown) => void): () => void;
  registerPiHandler(type: string, h: (msg: unknown, sessionId: string) => void): void;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ServiceDeps {
  host: HostPort;
  access: Access;
  paths: TeamPaths;
  personas: PersonaStore;
  projects: ProjectRegistry;
  records: RecordStore;
  config: () => TeamConfig;
  logger: Logger;
  /** Skill catalog: start check (D6), listing state (D14), spawn resolver (D7). */
  skills: SkillsService;
  /**
   * Host cwd capability floor for a spawn dir (D7 composition, mirrors
   * `mergeCwdPolicy`'s read of `CwdPolicyRegistry`). Absent (older host, no
   * `host.resolveCwdPolicy` service) → no composition narrowing possible.
   */
  resolveCwdPolicy?: (cwd: string) => PluginCwdPolicy | undefined;
  /** Absolute path of the team guard extension (`-e`). */
  guardExtensionPath: string;
  /** Renders persona.md for (persona, uk) and returns its absolute path. */
  renderPersona: (persona: Persona, uk: string) => string;
  now?: () => number;
  spawnTimeoutMs?: number;
  /** Delivered with each spawn so the guard knows its root + preset. */
  sessionDirFor?: (cwd: string) => string;
}

const GUARD_READY_MESSAGE = "team_guard_ready";
const DEFAULT_MAX_CONVERSATIONS = 50;
const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_MAX_LIVE_SESSIONS = 10;
/** `lastActivityAt` writes caused by streaming events are coalesced to at most one per this interval. */
const ACTIVITY_WRITE_MS = 10_000;
/** An event older than this is treated as replayed history. */
const REPLAY_AGE_MS = 120_000;

/** Current realpath of a directory, or null when it no longer resolves. */
function realpathOf(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export type ConvStatus = "busy" | "running" | "sleeping";
type AgentStatus = ConvStatus | "new" | "retired" | "unavailable";

export interface ConversationView {
  id: string;
  title: string;
  status: ConvStatus;
  lastActivityAt: string;
  archived: boolean;
  personaStale: boolean;
}

export interface AgentView {
  key: string;
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: PersonaRole;
  model?: string;
  scope: "shared" | "private";
  tools: "chat" | "files" | "full";
  unconfined: boolean;
  status: AgentStatus;
  activeCount: number;
  latest?: { id: string; title: string; status: ConvStatus; lastActivityAt: string };
  personaStale: boolean;
  unassigned: boolean;
  retired: boolean;
  /** Persona skills the caller may use in this target (persona order). */
  effectiveSkills: string[];
  /** Spawn-check state (D6/D14): the first skill that would refuse the start. */
  skillBlock: { skill: string; reason: SkillBlockReason } | null;
}

interface Pending {
  sessionId?: string;
  ready: boolean;
  settle: () => void;
}

/** `end` = `agent_end`, `activity` = turn / message start; replayed history and everything else ⇒ null. */
function classifyLiveEvent(event: unknown, now: number): "end" | "activity" | null {
  const e = event as { eventType?: string; timestamp?: number; replay?: boolean } | undefined;
  if (!e || e.replay === true) return null;
  if (typeof e.timestamp === "number" && now - e.timestamp > REPLAY_AGE_MS) return null;
  if (e.eventType === "agent_end") return "end";
  return e.eventType === "agent_start" || e.eventType === "message_start" ? "activity" : null;
}

function newConversationId(): string {
  return randomBytes(16).toString("base64url");
}

export class ConversationService {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly createLocks = new Map<string, Promise<void>>();
  /** Launches admitted but not yet bound, per user (live-cap reservation). */
  private readonly launching = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  /** runId → sessionId, from the guard's `team_guard_ready` (bounded). */
  private readonly readyRuns = new Map<string, string>();
  /** Last time a record was persisted for activity (debounce), by session id. */
  private readonly activityWrittenAt = new Map<string, number>();
  private readonly unsubs: Array<() => void> = [];
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly d: ServiceDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }
  private iso(ms = this.now()): string {
    return new Date(ms).toISOString();
  }
  private maxConversations(): number {
    const v = this.d.config().maxConversations;
    return typeof v === "number" && v >= 1 ? Math.floor(v) : DEFAULT_MAX_CONVERSATIONS;
  }
  /** Active-conversation cap per user × agent × target (config, default 50). */
  limit(): number {
    return this.maxConversations();
  }
  private idleMs(): number {
    const v = this.d.config().idleMinutes;
    return (typeof v === "number" && v >= 0 ? v : DEFAULT_IDLE_MINUTES) * 60_000;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  start(sweepEveryMs = 5 * 60_000): void {
    this.d.records.scanAll();
    this.d.host.registerPiHandler(GUARD_READY_MESSAGE, (msg, sessionId) => {
      const runId = (msg as { payload?: { runId?: unknown } } | undefined)?.payload?.runId;
      if (typeof runId !== "string" || runId.length === 0) return;
      this.readyRuns.set(runId, sessionId);
      if (this.readyRuns.size > 1000) {
        const oldest = this.readyRuns.keys().next().value;
        if (oldest !== undefined) this.readyRuns.delete(oldest);
      }
      this.pending.get(runId)?.settle();
    });
    this.unsubs.push(
      this.d.host.onSessionResolved((sessionId, ref) => {
        const team = ref?.team as { runId?: unknown } | undefined;
        const runId = typeof team?.runId === "string" ? team.runId : undefined;
        if (!runId) return;
        const p = this.pending.get(runId);
        if (!p) {
          // Late arrival of a run we already gave up on: make sure it does not linger.
          void this.d.host.abortSpawnedRun({ sessionId, graceful: false });
          return;
        }
        p.sessionId = sessionId;
        p.settle();
      }),
      this.d.host.onEvent((sessionId, event) => this.onEvent(sessionId, event)),
    );
    this.sweepIdle();
    if (sweepEveryMs > 0) {
      this.sweepTimer = setInterval(() => this.sweepIdle(), sweepEveryMs);
      this.sweepTimer.unref?.();
    }
  }

  stop(): void {
    for (const u of this.unsubs.splice(0)) u();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  private onEvent(sessionId: string, event: unknown): void {
    const loc = this.d.records.locate(sessionId);
    if (!loc) return;
    const kind = classifyLiveEvent(event, this.now());
    if (!kind) return;
    const isEnd = kind === "end";
    // Streaming events fire many times per turn: coalesce activity writes, always persist the turn end.
    if (!isEnd && this.now() - (this.activityWrittenAt.get(sessionId) ?? 0) < ACTIVITY_WRITE_MS) return;
    const rec = this.d.records.read(loc);
    if (!rec || rec.sessionId !== sessionId) return;
    const stamp = this.iso();
    this.activityWrittenAt.set(sessionId, this.now());
    if (isEnd) {
      rec.lastAgentEndAt = stamp;
      rec.lastActivityAt = stamp;
    } else {
      rec.lastActivityAt = stamp;
    }
    const s = this.d.host.getSession(sessionId);
    if (s?.sessionFile && s.sessionFile !== rec.sessionFile) rec.sessionFile = s.sessionFile;
    this.d.records.write(loc, rec);
  }

  /** End sessions idle past `idleMinutes` (never `busy`). */
  sweepIdle(): void {
    const idle = this.idleMs();
    if (idle === 0) return;
    for (const lr of this.d.records.scanAll()) {
      const r = lr.record;
      if (r.archived) continue;
      const s = this.d.host.getSession(r.sessionId);
      if (!s || s.status === "ended" || s.status === "streaming") continue;
      // Multi-user: only end a session the record's user owns (a misbound record must not reach another user's).
      if (this.d.access.mode() === "multi" && (!s.principalOwner || userKey(s.principalOwner.iss, s.principalOwner.sub) !== lr.uk)) continue;
      const last = Date.parse(r.lastAgentEndAt ?? r.lastActivityAt ?? r.startedAt);
      if (Number.isFinite(last) && this.now() - last > idle) {
        void this.d.host.abortSpawnedRun({ sessionId: r.sessionId, graceful: true });
      }
    }
  }

  /**
   * D6 epoch re-check: a managed catalog write between the start check and
   * the session correlating re-runs the check on the now-live session. A
   * revocation aborts it (non-graceful — it was never handed out) and answers
   * the same 409, before any record is written.
   */
  private async assertUnblockedAtCorrelation(
    caller: Caller,
    personaKey: string,
    t: string,
    persona: Persona,
    epoch: number,
    sessionId: string,
    spawned: SpawnedSkill[],
  ): Promise<void> {
    if (this.d.skills.epoch() === epoch) return;
    // The spawned set is authoritative for a session born seconds ago; the persona's current list
    // only covers records without one (audit F4).
    const names = spawned.map((s) => s.name);
    const now = this.d.skills.firstBlockedSkill(names.length > 0 ? names : (persona.skills ?? []), caller, t);
    if (!now) {
      // A managed path edit that MOVED a granted root also aborts, even when every name is still
      // allowed (audit F5).
      for (const s of spawned) {
        const r = this.d.skills.resolveSkillRoot(s.name, caller, t);
        if (r?.root === s.root) continue;
        await this.d.host.abortSpawnedRun({ sessionId, graceful: false });
        throw this.skillBlocked(caller, personaKey, t, { skill: s.name, reason: "invalid" });
      }
      return;
    }
    await this.d.host.abortSpawnedRun({ sessionId, graceful: false });
    throw this.skillBlocked(caller, personaKey, t, now);
  }

  /**
   * D8: after a successful managed catalog write, end every live, owner-bound
   * session whose grant of `name` changed (denied / removed / realpath
   * moved). Modelled on `sweepIdle`, but revocation is a security event: it
   * ends even a streaming session, non-gracefully, and keeps every record.
   * Reachable only from a successful admin write (SkillsService), never from
   * ensure/resume/restart routes. Returns the number of sessions ended.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear pass over records with per-record owner binding
  async invalidateSkill(name: string, before: SkillEntry | null, after: SkillEntry | null, by: string): Promise<number> {
    const mode = this.d.access.mode();
    let ended = 0;
    for (const lr of this.d.records.scanAll()) {
      if (lr.record.archived) continue;
      const s = this.d.host.getSession(lr.record.sessionId);
      if (!s || s.status === "ended") continue;
      // Same owner binding as sweepIdle: a misbound record never reaches another user's session.
      if (mode === "multi" && (!s.principalOwner || userKey(s.principalOwner.iss, s.principalOwner.sub) !== lr.uk)) continue;
      const persona = this.d.personas.get(lr.record.personaKey, lr.uk);
      // The session is judged by the skills it was SPAWNED with (recorded at correlation); the
      // persona's current list is only the fallback for records predating that (audit F4).
      if (!(spawnedSkillNames(lr.record) ?? persona?.skills ?? []).includes(name)) continue;
      const owner = s.principalOwner ?? { iss: "", sub: "" };
      const holder: Caller = { uk: lr.uk, iss: owner.iss, sub: owner.sub, admin: false };
      if (!this.lostGrant(before, after, holder, lr.t)) continue;
      await this.d.host.abortSpawnedRun({ sessionId: lr.record.sessionId, graceful: false });
      ended++;
      this.d.logger.info(`team.skill_end name=${name} uk=${lr.uk} t=${lr.t} by=${by}`);
    }
    return ended;
  }

  /** D8 grant delta: the session held the grant and now loses it (denied / removed / realpath moved). */
  private lostGrant(before: SkillEntry | null, after: SkillEntry | null, holder: Caller, t: string): boolean {
    const mode = this.d.access.mode();
    // Only a session that HELD the grant can lose it: widenings and cosmetic edits end nothing.
    if (before === null || !allowed(before, holder, t, mode)) return false;
    const denied = after === null || !allowed(after, holder, t, mode);
    const rootChanged = after !== null && realpathOf(before.path) !== realpathOf(after.path);
    return denied || rootChanged;
  }

  // ── resolution helpers ─────────────────────────────────────────────────────

  private persona(caller: Caller, key: string): Persona {
    const p = this.d.personas.get(key, caller.uk);
    if (!p) throw new TeamError(404, "persona_not_found");
    return p;
  }

  /** Persona's `projects` ids still usable by the caller (or `_ws`). */
  private effectiveProjects(p: Persona, usable: ReadonlySet<string>): Set<string> {
    return new Set(p.projects.filter((id) => id === WORKSPACE_TARGET || usable.has(id)));
  }

  /** Resolve target `t` to its root directory (D13). */
  private target(caller: Caller, persona: Persona, t: string, existing = false): { dir: string; project?: Project } {
    if (t === WORKSPACE_TARGET) {
      if (!persona.projects.includes(WORKSPACE_TARGET)) throw new TeamError(409, "persona_not_in_project");
      const dir = this.d.paths.workspaceDir(caller.uk);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return { dir: canonicalize(dir) };
    }
    const project = this.d.projects.get(t);
    if (!project || !this.d.projects.canUse(project, caller, this.d.access.mode())) {
      // An existing conversation on a removed / no-longer-allowed project stays listed but cannot continue.
      throw new TeamError(existing ? 409 : 404, existing ? "project_unavailable" : "project_not_found");
    }
    if (!persona.projects.includes(t)) throw new TeamError(409, "persona_not_in_project");
    if (!project.available || !project.path) throw new TeamError(409, "project_unavailable");
    return { dir: project.path, project };
  }

  private owner(caller: Caller): { iss: string; sub: string } | undefined {
    return this.d.access.mode() === "multi" ? { iss: caller.iss, sub: caller.sub } : undefined;
  }

  private ownerMatches(s: HostSession, caller: Caller): boolean {
    if (this.d.access.mode() === "single") return true;
    return s.principalOwner?.iss === caller.iss && s.principalOwner?.sub === caller.sub;
  }

  private loc(caller: Caller, personaKey: string, t: string, c: string): Locator {
    return { uk: caller.uk, t, personaKey, c };
  }

  private requireRecord(caller: Caller, personaKey: string, t: string, c: string): { l: Locator; rec: ConversationRecord } {
    const l = this.loc(caller, personaKey, t, c);
    const rec = this.d.records.read(l);
    if (!rec) throw new TeamError(404, "conversation_not_found");
    return { l, rec };
  }

  /**
   * The host stores the WHOLE ref we filed under `pluginRefs.<pluginId>`, i.e.
   * `pluginRefs.team = { team: { personaKey, project, conversationId, uk, runId }, principalOwner }`.
   */
  private teamRef(s: HostSession | undefined): { personaKey?: unknown; project?: unknown; conversationId?: unknown } | undefined {
    const filed = s?.pluginRefs?.team as { team?: unknown } | undefined;
    const t = filed?.team;
    return t && typeof t === "object" ? (t as { personaKey?: unknown; project?: unknown; conversationId?: unknown }) : undefined;
  }

  private ownLive(rec: ConversationRecord, c: string): HostSession | undefined {
    const s = this.d.host.getSession(rec.sessionId);
    if (!s || this.teamRef(s)?.conversationId !== c) return undefined;
    return s;
  }

  private statusOf(rec: ConversationRecord, c: string): ConvStatus {
    const s = this.ownLive(rec, c);
    if (!s || s.status === "ended") return "sleeping";
    return s.status === "streaming" ? "busy" : "running";
  }

  private titleOf(rec: ConversationRecord, c: string): string {
    if (rec.title) return rec.title;
    const s = this.d.host.getSession(rec.sessionId);
    if (s?.name) return s.name;
    if (s?.firstMessage) return [...s.firstMessage.trim()].slice(0, 60).join("");
    return `Beszélgetés · ${rec.createdAt.slice(0, 10)}`;
  }

  /**
   * "Restart to apply" only makes sense for a LIVE session: a sleeping conversation (idle-ended or
   * just restarted) already picks the current persona up on its next start.
   */
  private isStale(rec: ConversationRecord, c: string, persona: Persona | null): boolean {
    return !!persona && persona.updatedAt > rec.personaUpdatedAt && this.statusOf(rec, c) !== "sleeping";
  }

  private view(lr: { c: string; record: ConversationRecord }, persona: Persona | null): ConversationView {
    const rec = lr.record;
    return {
      id: lr.c,
      title: this.titleOf(rec, lr.c),
      status: this.statusOf(rec, lr.c),
      lastActivityAt: rec.lastActivityAt,
      archived: rec.archived,
      personaStale: this.isStale(rec, lr.c, persona),
    };
  }

  // ── spawn + bind ───────────────────────────────────────────────────────────

  private logEnsure(caller: Caller, personaKey: string, t: string, c: string, outcome: string, sessionId?: string): void {
    this.d.logger.info(
      `team.ensure uk=${caller.uk} personaKey=${personaKey} t=${t} c=${c} outcome=${outcome} sessionId=${sessionId ?? "-"}`,
    );
  }

  /** D6 refusal: log without paths/skill text, answer 409 {skill, reason}. */
  private skillBlocked(caller: Caller, personaKey: string, t: string, b: { skill: string; reason: string }): TeamError {
    this.d.logger.info(`team.skill_not_allowed name=${b.skill} uk=${caller.uk} target=${t} reason=${b.reason}`);
    return new TeamError(409, "skill_not_allowed", { skill: b.skill, reason: b.reason });
  }

  /**
   * D7 composition: would the host's `mergeCwdPolicy` change the skill set?
   * Mirrors `intersectAllow` (absent caller list = the floor applies
   * wholesale). Returns the first offending skill + counts, or null.
   */
  private composedSkillDelta(cwd: string, requested: readonly { name: string; root: string }[]): { skill: string; requested: number; composed: number } | null {
    const floor = this.d.resolveCwdPolicy?.(cwd)?.skills;
    if (!floor) return null;
    if (requested.length === 0) {
      return floor.length > 0 ? { skill: path.basename(floor[0]), requested: 0, composed: floor.length } : null;
    }
    const keep = new Set(floor);
    const composed = requested.filter((s) => keep.has(s.root));
    if (composed.length === requested.length) return null;
    return { skill: requested.find((s) => !keep.has(s.root))?.name ?? "", requested: requested.length, composed: composed.length };
  }

  /** D7 refusal: log counts only (no paths), answer 409 {skill, reason:"invalid"}. */
  private skillsNarrowed(caller: Caller, t: string, delta: { skill: string; requested: number; composed: number }): TeamError {
    this.d.logger.info(`team.skills_narrowed name=${delta.skill} uk=${caller.uk} target=${t} requested=${delta.requested} composed=${delta.composed}`);
    return new TeamError(409, "skill_not_allowed", { skill: delta.skill, reason: "invalid" });
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
  private async launch(
    caller: Caller,
    persona: Persona,
    t: string,
    c: string,
    root: { dir: string; project?: Project },
    resumeFile?: string,
  ): Promise<{ sessionId: string; sessionFile?: string; runId: string; spawnToken: string; skills: SpawnedSkill[]; release: () => void }> {
    if (!fs.existsSync(this.d.guardExtensionPath)) throw new TeamError(503, "guard_unavailable");
    // An unconfined (`full`) persona must never run in multi-user mode, whatever mode it was authored in.
    if (persona.tools === "full" && this.d.access.mode() === "multi") throw new TeamError(409, "persona_unavailable");
    const personaFile = this.d.renderPersona(persona, caller.uk);
    if (!fs.existsSync(personaFile)) {
      this.d.logger.error(`team.persona_render_failed personaKey=${persona.key}`);
      throw new TeamError(500, "persona_render_failed");
    }
    const contextFiles = root.project?.contextFiles ? collectContextFiles(root.dir) : [];
    const runId = randomUUID();
    const spawnToken = randomUUID();
    const snap = this.d.skills.snapshot();
    const effective = (persona.skills ?? []).flatMap((n) => {
      const r = this.d.skills.resolveSkillRoot(n, caller, t, snap);
      return r ? [r] : [];
    });
    // D7: the host may compose a cwd capability floor into the spawn — refuse
    // rather than run with a narrowed (or forced) skill set.
    const delta = this.composedSkillDelta(root.dir, effective);
    if (delta) throw this.skillsNarrowed(caller, t, delta);
    const ownerStamp = this.owner(caller);

    let settleFn: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settleFn = resolve;
    });
    const entry: Pending = { ready: false, settle: () => {} };
    const readyAndBound = () => !!entry.sessionId && this.readyRuns.get(runId) === entry.sessionId;
    entry.settle = () => {
      if (readyAndBound()) settleFn();
    };
    const releaseSlot = this.reserveLiveSlot(caller);
    this.pending.set(runId, entry);

    const timeoutMs = this.d.spawnTimeoutMs ?? 30_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
      timer.unref?.();
    });

    try {
      const res = await this.d.host.spawnSession({
        cwd: root.dir,
        ...(persona.model ? { model: persona.model } : {}),
        pluginRef: {
          team: { personaKey: persona.key, project: t, conversationId: c, uk: caller.uk, runId },
          ...(ownerStamp ? { principalOwner: ownerStamp } : {}),
        },
        lifecycle: { recover: false, finalizeOnSocketClose: true },
        scope: {
          tools: [...PRESET_TOOLS[persona.tools]],
          // D7: exact skill set — never discovered/settings/package skills.
          // `noSkills` always; `skills` is the effective realpaths (the mapper
          // drops an empty list, so no `--skill` reaches argv); the guard
          // policy travels as one JSON string (`sanitizeExtensionConfig`
          // keeps strings verbatim → `PI_EXT_TEAM_SKILLS`).
          skills: effective.map((s) => s.root),
          noSkills: true,
          extensions: [this.d.guardExtensionPath],
          extensionConfig: {
            team: { persona: personaFile, root: root.dir, tools: persona.tools, runId, skills: JSON.stringify(effective) },
          },
          appendSystemPrompt: [personaFile, ...contextFiles],
          noContextFiles: true,
          noProjectTrust: true,
          sessionDir: (this.d.sessionDirFor ?? ((cwd: string) => piSessionDirForCwd(cwd)))(root.dir),
        },
        spawnToken,
        ...(resumeFile ? { resume: { sessionFile: resumeFile } } : {}),
      });
      if (!res.success) {
        this.pending.delete(runId);
        throw new TeamError(503, "spawn_failed");
      }
      entry.settle();
      const outcome = await Promise.race([settled.then(() => "ok" as const), timedOut]);
      if (outcome === "timeout") {
        const sid = entry.sessionId;
        this.pending.delete(runId);
        await this.d.host.abortSpawnedRun(sid ? { sessionId: sid, graceful: false } : { spawnToken });
        if (sid) throw new TeamError(503, "guard_unavailable");
        throw new TeamError(504, "spawn_timeout");
      }
      this.pending.delete(runId);
      const sessionId = entry.sessionId as string;
      const s = this.d.host.getSession(sessionId);
      // The caller releases the slot AFTER the record is written, so the new session is never uncounted.
      return { sessionId, sessionFile: s?.sessionFile, runId, spawnToken, skills: effective.map((s) => ({ name: s.name, root: s.root })), release: releaseSlot };
    } catch (err) {
      this.pending.delete(runId);
      releaseSlot();
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      this.readyRuns.delete(runId);
    }
  }

  // ── create / ensure ────────────────────────────────────────────────────────

  /** Live pi processes are bounded per user (not only per conversation list), `maxLiveSessions` default 10. */
  private reserveLiveSlot(caller: Caller): () => void {
    const cap = this.d.config().maxLiveSessions;
    const limit = typeof cap === "number" && cap >= 1 ? Math.floor(cap) : DEFAULT_MAX_LIVE_SESSIONS;
    let live = 0;
    for (const lr of this.d.records.scanAll()) {
      if (lr.uk !== caller.uk) continue;
      const s = this.d.host.getSession(lr.record.sessionId);
      if (s && s.status !== "ended") live++;
    }
    // In-flight launches count too: admission is synchronous, so concurrent creates cannot all see room.
    const inFlight = this.launching.get(caller.uk) ?? 0;
    if (live + inFlight >= limit) throw new TeamError(429, "session_limit");
    this.launching.set(caller.uk, inFlight + 1);
    return () => {
      const n = (this.launching.get(caller.uk) ?? 1) - 1;
      if (n <= 0) this.launching.delete(caller.uk);
      else this.launching.set(caller.uk, n);
    };
  }

  private activeCount(caller: Caller, t: string, personaKey: string): number {
    return this.d.records.list(caller.uk, t, personaKey).filter((r) => !r.record.archived).length;
  }

  private snapshot(p: Persona) {
    return { name: p.name, description: p.description, avatar: p.avatar, role: p.role, ...(p.model ? { model: p.model } : {}) };
  }

  async createConversation(caller: Caller, personaKey: string, t: string): Promise<{ id: string; sessionId: string }> {
    const persona = this.persona(caller, personaKey);
    const root = this.target(caller, persona, t);
    const blocked = this.d.skills.firstBlockedSkill(persona.skills ?? [], caller, t);
    if (blocked) throw this.skillBlocked(caller, personaKey, t, blocked);
    const epoch = this.d.skills.epoch();
    const lockKey = `${caller.uk}|${personaKey}|${t}`;
    const prev = this.createLocks.get(lockKey) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((r) => {
      release = r;
    });
    const tail = prev.then(() => mine);
    this.createLocks.set(lockKey, tail);
    await prev;
    try {
      if (this.activeCount(caller, t, personaKey) >= this.maxConversations()) throw new TeamError(409, "conversation_limit");
      const c = newConversationId();
      let bound: Awaited<ReturnType<ConversationService["launch"]>>;
      try {
        bound = await this.launch(caller, persona, t, c, root);
      } catch (err) {
        if (err instanceof TeamError && (err.code === "spawn_timeout" || err.code === "guard_unavailable")) {
          this.logEnsure(caller, personaKey, t, c, err.code === "spawn_timeout" ? "timeout" : "guard_unavailable");
        }
        throw err;
      }
      try {
        // D6 epoch: a managed write may have landed while the spawn was in flight.
        await this.assertUnblockedAtCorrelation(caller, personaKey, t, persona, epoch, bound.sessionId, bound.skills);
        const stamp = this.iso();
        const rec: ConversationRecord = {
          schemaVersion: 1,
          c,
          personaKey,
          project: t,
          sessionId: bound.sessionId,
          ...(bound.sessionFile ? { sessionFile: bound.sessionFile } : {}),
          runId: bound.runId,
          spawnToken: bound.spawnToken,
          createdAt: stamp,
          startedAt: stamp,
          lastActivityAt: stamp,
          personaUpdatedAt: persona.updatedAt,
          archived: false,
          personaSnapshot: this.snapshot(persona),
          // The spawned skill set: revocation and the start check judge THIS set, not the
          // persona's current list (audit F4).
          skills: bound.skills.map((s) => ({ name: s.name, root: s.root })),
        };
        this.d.records.write(this.loc(caller, personaKey, t, c), rec);
        this.logEnsure(caller, personaKey, t, c, "create", bound.sessionId);
        return { id: c, sessionId: bound.sessionId };
      } finally {
        bound.release();
      }
    } finally {
      release();
      void tail.then(() => {
        if (this.createLocks.get(lockKey) === tail) this.createLocks.delete(lockKey);
      });
    }
  }

  /**
   * Read-only handle on a conversation's transcript: the host session id, so the client can replay history
   * when a start is blocked (`409 skill_not_allowed`) and no session will be spawned. Never spawns, ends or
   * writes. Owner-fail-closed like resume: in multi-user mode only a host session this caller owns is returned.
   * See change: add-team-skill-access.
   */
  historyHandle(caller: Caller, personaKey: string, t: string, c: string): { sessionId: string } {
    const { rec } = this.requireRecord(caller, personaKey, t, c);
    const known = this.d.host.getSession(rec.sessionId);
    if (!known || !this.ownerMatches(known, caller)) throw new TeamError(404, "history_unavailable");
    return { sessionId: rec.sessionId };
  }

  async ensureConversation(caller: Caller, personaKey: string, t: string, c: string): Promise<{ sessionId: string }> {
    const { rec } = this.requireRecord(caller, personaKey, t, c);
    if (rec.archived) throw new TeamError(409, "conversation_archived");
    const key = `${caller.uk}|${personaKey}|${t}|${c}`;
    const existing = this.inFlight.get(key) as Promise<{ sessionId: string }> | undefined;
    if (existing !== undefined) return existing;
    const p = this.ensureInner(caller, personaKey, t, c).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, p);
    return p;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
  private async ensureInner(caller: Caller, personaKey: string, t: string, c: string): Promise<{ sessionId: string }> {
    const l = this.loc(caller, personaKey, t, c);
    const rec = this.d.records.read(l);
    if (!rec) throw new TeamError(404, "conversation_not_found");
    const persona = this.persona(caller, personaKey);
    const root = this.target(caller, persona, t, true);
    const live = this.ownLive(rec, c);

    // 2. Start check on EVERY path (D6): before reuse, so a revoked skill also
    // ends the live session instead of handing it back out. A live session is
    // also judged by the skill set it was SPAWNED with (audit F4): the persona
    // may have been edited since, but the session keeps the roots it was born
    // with. Records without a spawned set fall back to persona.skills.
    const spawned = spawnedSkillNames(rec);
    const checked = spawned ? [...new Set([...spawned, ...(persona.skills ?? [])])] : (persona.skills ?? []);
    const blocked = this.d.skills.firstBlockedSkill(checked, caller, t);
    if (blocked) {
      if (live && live.status !== "ended" && this.ownerMatches(live, caller)) {
        await this.d.host.abortSpawnedRun({ sessionId: rec.sessionId, graceful: true });
      }
      throw this.skillBlocked(caller, personaKey, t, blocked);
    }
    const epoch = this.d.skills.epoch();

    // 3. reuse
    const team = this.teamRef(live);
    if (
      live &&
      live.status !== "ended" &&
      canonicalize(live.cwd) === root.dir &&
      this.ownerMatches(live, caller) &&
      team?.personaKey === personaKey &&
      team?.project === t
    ) {
      this.logEnsure(caller, personaKey, t, c, "reuse", rec.sessionId);
      return { sessionId: rec.sessionId };
    }
    if (live && live.status !== "ended") {
      // Ownership BEFORE any side effect: a live session that is not this user's is never touched.
      if (!this.ownerMatches(live, caller)) {
        this.logEnsure(caller, personaKey, t, c, "unrecoverable", rec.sessionId);
        throw new TeamError(409, "conversation_unrecoverable");
      }
      // Ours but not reusable (cwd moved): end it before resuming.
      await this.d.host.abortSpawnedRun({ sessionId: rec.sessionId, graceful: true });
    }

    // 4. resume
    const known = this.d.host.getSession(rec.sessionId);
    const file = rec.sessionFile ?? known?.sessionFile;
    const fileExists = !!file && fs.existsSync(file);
    // Owner-fail-closed (D5 step 4): in multi-user mode an existing transcript is only resumed when the host's
    // persisted session record proves it is this user's; a session the host cannot vouch for is never adopted.
    const ownerOk = known ? this.ownerMatches(known, caller) : !(this.d.access.mode() === "multi" && fileExists);
    const neverTalked = !rec.lastAgentEndAt;
    if (!ownerOk || (!fileExists && !neverTalked)) {
      this.logEnsure(caller, personaKey, t, c, "unrecoverable", rec.sessionId);
      throw new TeamError(409, "conversation_unrecoverable");
    }

    let bound: Awaited<ReturnType<ConversationService["launch"]>>;
    try {
      bound = await this.launch(caller, persona, t, c, root, fileExists ? file : undefined);
    } catch (err) {
      if (err instanceof TeamError && (err.code === "spawn_timeout" || err.code === "guard_unavailable")) {
        this.logEnsure(caller, personaKey, t, c, err.code === "spawn_timeout" ? "timeout" : "guard_unavailable");
      }
      throw err;
    }
    try {
      // The conversation may have been archived / deleted while the spawn was in flight: never resurrect it.
      const cur = this.d.records.read(l);
      if (!cur || cur.archived) {
        await this.d.host.abortSpawnedRun({ sessionId: bound.sessionId, graceful: true });
        throw new TeamError(cur ? 409 : 404, cur ? "conversation_archived" : "conversation_not_found");
      }
      // D6 epoch: a managed write may have landed while the spawn was in flight.
      await this.assertUnblockedAtCorrelation(caller, personaKey, t, persona, epoch, bound.sessionId, bound.skills);
      const stamp = this.iso();
      this.d.records.write(l, {
        ...cur,
        sessionId: bound.sessionId,
        sessionFile: bound.sessionFile ?? (fileExists ? file : undefined),
        runId: bound.runId,
        spawnToken: bound.spawnToken,
        startedAt: stamp,
        lastActivityAt: stamp,
        personaUpdatedAt: persona.updatedAt,
        personaSnapshot: this.snapshot(persona),
        // The spawned skill set (audit F4) — replaces any set recorded by an earlier spawn.
        skills: bound.skills.map((s) => ({ name: s.name, root: s.root })),
      });
      this.logEnsure(caller, personaKey, t, c, fileExists ? "resume" : "create", bound.sessionId);
      return { sessionId: bound.sessionId };
    } finally {
      bound.release();
    }
  }

  // ── conversation management ───────────────────────────────────────────────

  listConversations(caller: Caller, personaKey: string, t: string, archived: boolean): ConversationView[] {
    const persona = this.d.personas.get(personaKey, caller.uk);
    return this.d.records
      .list(caller.uk, t, personaKey)
      .filter((r) => r.record.archived === archived)
      .map((r) => this.view(r, persona))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: title + archive validation with the merge-after-abort step; each branch is a single guard
  async patchConversation(
    caller: Caller,
    personaKey: string,
    t: string,
    c: string,
    body: { title?: unknown; archived?: unknown },
  ): Promise<ConversationView> {
    const { l, rec } = this.requireRecord(caller, personaKey, t, c);
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || cpLength(body.title.trim()) < 1 || cpLength(body.title) > 80) {
        throw new TeamError(400, "invalid_title");
      }
      rec.title = body.title.trim();
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") throw new TeamError(400, "invalid_archived");
      if (body.archived && !rec.archived) {
        await this.endOwnSession(caller, rec.sessionId);
        // `onEvent` may have persisted activity while we awaited: merge into the fresh record.
        const fresh = this.d.records.read(l);
        if (!fresh) throw new TeamError(404, "conversation_not_found"); // deleted while we awaited: never write it back
        Object.assign(rec, { lastAgentEndAt: fresh.lastAgentEndAt, lastActivityAt: fresh.lastActivityAt });
      }
      if (!body.archived && rec.archived && this.activeCount(caller, t, personaKey) >= this.maxConversations()) {
        throw new TeamError(409, "conversation_limit");
      }
      rec.archived = body.archived;
    }
    this.d.records.write(l, rec);
    return this.view({ c, record: rec }, this.d.personas.get(personaKey, caller.uk));
  }

  /** End a conversation's session only when it is the caller's: a stale / misbound record never lets one user end another's session. */
  private async endOwnSession(caller: Caller, sessionId: string): Promise<void> {
    const s = this.d.host.getSession(sessionId);
    if (s && !this.ownerMatches(s, caller)) return;
    await this.d.host.abortSpawnedRun({ sessionId, graceful: true });
  }

  async restartConversation(caller: Caller, personaKey: string, t: string, c: string): Promise<void> {
    const { rec } = this.requireRecord(caller, personaKey, t, c);
    await this.endOwnSession(caller, rec.sessionId);
  }

  async deleteConversation(caller: Caller, personaKey: string, t: string, c: string): Promise<void> {
    const { l, rec } = this.requireRecord(caller, personaKey, t, c);
    await this.endOwnSession(caller, rec.sessionId);
    this.d.records.delete(l);
  }

  // ── agents (D8) ───────────────────────────────────────────────────────────

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
  agents(caller: Caller, t: string): AgentView[] {
    const mode = this.d.access.mode();
    const records = this.d.records.list(caller.uk, t);
    const byPersona = new Map<string, LocatedRecord[]>();
    for (const r of records) {
      const arr = byPersona.get(r.personaKey) ?? [];
      arr.push(r);
      byPersona.set(r.personaKey, arr);
    }
    const personas = [...this.d.personas.listShared(), ...this.d.personas.listPrivate(caller.uk)];
    // Computed ONCE per request (each call re-validates every project path on disk).
    const usable = new Set(this.d.projects.usableBy(caller, mode).map((x) => x.id));
    // Catalog validated once per request (D14).
    const snap = this.d.skills.snapshot();
    const out: AgentView[] = [];
    const seen = new Set<string>();

    for (const p of personas) {
      const assigned = this.effectiveProjects(p, usable).has(t) && p.projects.includes(t);
      const recs = byPersona.get(p.key) ?? [];
      const active = recs.filter((r) => !r.record.archived);
      if (!assigned && active.length === 0) continue;
      seen.add(p.key);
      out.push(this.card(p, recs, assigned, mode, caller, t, snap));
    }
    // Retired: records whose persona no longer exists.
    for (const [key, recs] of byPersona) {
      if (seen.has(key) || personas.some((p) => p.key === key)) continue;
      const newest = [...recs].sort((a, b) => b.record.lastActivityAt.localeCompare(a.record.lastActivityAt))[0];
      if (!newest) continue;
      const snap = newest.record.personaSnapshot;
      const active = recs.filter((r) => !r.record.archived);
      const latest = this.latestOf(active);
      out.push({
        key,
        name: snap.name,
        description: snap.description,
        avatar: snap.avatar,
        role: snap.role,
        model: snap.model,
        scope: key.startsWith("shared:") ? "shared" : "private",
        tools: "chat",
        unconfined: false,
        status: "retired",
        activeCount: active.length,
        latest,
        personaStale: false,
        unassigned: false,
        retired: true,
        effectiveSkills: [],
        skillBlock: null,
      });
    }
    return out;
  }

  private latestOf(active: LocatedRecord[]): AgentView["latest"] {
    const top = [...active].sort((a, b) => b.record.lastActivityAt.localeCompare(a.record.lastActivityAt))[0];
    if (!top) return undefined;
    return {
      id: top.c,
      title: this.titleOf(top.record, top.c),
      status: this.statusOf(top.record, top.c),
      lastActivityAt: top.record.lastActivityAt,
    };
  }

  private card(
    p: Persona,
    recs: LocatedRecord[],
    assigned: boolean,
    mode: "single" | "multi",
    caller: Caller,
    t: string,
    snap: SkillSnapshot,
  ): AgentView {
    const active = recs.filter((r) => !r.record.archived);
    const fullBlocked = p.tools === "full" && mode === "multi";
    const skillBlock = this.d.skills.firstBlockedSkill(p.skills ?? [], caller, t, snap);
    const effectiveSkills = skillBlock ? this.d.skills.effectiveSkills(p.skills ?? [], caller, t, snap) : [...(p.skills ?? [])];
    let status: AgentStatus;
    if (!assigned || fullBlocked || skillBlock) status = "unavailable";
    else if (active.length === 0) status = "new";
    else {
      const statuses = active.map((r) => this.statusOf(r.record, r.c));
      status = statuses.includes("busy") ? "busy" : statuses.includes("running") ? "running" : "sleeping";
    }
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      avatar: p.avatar,
      role: p.role,
      model: p.model,
      scope: p.scope,
      tools: p.tools,
      unconfined: p.tools === "full",
      status,
      activeCount: active.length,
      latest: this.latestOf(active),
      personaStale: active.some((r) => this.isStale(r.record, r.c, p)),
      unassigned: !assigned,
      retired: false,
      effectiveSkills,
      skillBlock,
    };
  }

  /** Counts for the folder row: agents assigned to the project + active conversations. */
  folderCounts(caller: Caller, projectId: string): { agents: number; active: number } {
    const cards = this.agents(caller, projectId).filter((a) => !a.retired && a.status !== "unavailable");
    return { agents: cards.length, active: cards.filter((a) => a.status === "running" || a.status === "busy").length };
  }
}

