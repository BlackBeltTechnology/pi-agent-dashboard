/**
 * Conversations, agents and the idle sweeper (D5/D8). One conversation = one
 * persistent pi session found-or-resumed on demand. The host is reached only
 * through the narrow {@link HostPort}, so the service is unit-testable with a
 * fake. See change: add-team-plugin.
 */
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { piSessionDirForCwd } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import type { PluginSpawnOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { Access } from "./access.js";
import { canonicalize, isInside, type TeamPaths } from "./paths.js";
import { cpLength } from "./persona.js";
import type { ProjectRegistry } from "./projects.js";
import { type LocatedRecord, type Locator, type RecordStore } from "./records.js";
import { collectContextFiles } from "./render.js";
import type { PersonaStore } from "./store-types.js";
import {
  type AvatarSpec,
  type Caller,
  type ConversationRecord,
  type Persona,
  type PersonaRole,
  type Project,
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
  /** Absolute path of the team guard extension (`-e`). */
  guardExtensionPath: string;
  /** Renders persona.md for (persona, uk) and returns its absolute path. */
  renderPersona: (persona: Persona, uk: string) => string;
  now?: () => number;
  spawnTimeoutMs?: number;
  /** Delivered with each spawn so the guard knows its root + preset. */
  sessionDirFor?: (cwd: string) => string;
}

export const GUARD_READY_MESSAGE = "team_guard_ready";
const DEFAULT_MAX_CONVERSATIONS = 50;
const DEFAULT_IDLE_MINUTES = 30;
/** An event older than this is treated as replayed history. */
const REPLAY_AGE_MS = 120_000;

export const TOOL_PRESETS: Record<"chat" | "files" | "full", string[]> = {
  chat: ["read", "grep", "find", "ls"],
  files: ["read", "grep", "find", "ls", "write", "edit"],
  full: ["read", "grep", "find", "ls", "write", "edit", "bash"],
};

export type ConvStatus = "busy" | "running" | "sleeping";
export type AgentStatus = ConvStatus | "new" | "retired" | "unavailable";

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
}

interface Pending {
  sessionId?: string;
  ready: boolean;
  settle: () => void;
}

function newConversationId(): string {
  return randomBytes(16).toString("base64url");
}

export class ConversationService {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly createLocks = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, Pending>();
  private readonly readySessions = new Set<string>();
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
    this.d.host.registerPiHandler(GUARD_READY_MESSAGE, (_msg, sessionId) => {
      this.readySessions.add(sessionId);
      for (const p of this.pending.values()) if (p.sessionId === sessionId) p.settle();
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
    const e = event as { eventType?: string; timestamp?: number; replay?: boolean } | undefined;
    if (!e || e.replay === true) return;
    if (typeof e.timestamp === "number" && this.now() - e.timestamp > REPLAY_AGE_MS) return;
    const rec = this.d.records.read(loc);
    if (!rec || rec.sessionId !== sessionId) return;
    const stamp = this.iso();
    if (e.eventType === "agent_end") {
      rec.lastAgentEndAt = stamp;
      rec.lastActivityAt = stamp;
    } else if (e.eventType === "agent_start" || e.eventType === "message_start") {
      rec.lastActivityAt = stamp;
    } else return;
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
      const last = Date.parse(r.lastAgentEndAt ?? r.lastActivityAt ?? r.startedAt);
      if (Number.isFinite(last) && this.now() - last > idle) {
        void this.d.host.abortSpawnedRun({ sessionId: r.sessionId, graceful: true });
      }
    }
  }

  // ── resolution helpers ─────────────────────────────────────────────────────

  private persona(caller: Caller, key: string): Persona {
    const p = this.d.personas.get(key, caller.uk);
    if (!p) throw new TeamError(404, "persona_not_found");
    return p;
  }

  /** Persona's `projects` ids still usable by the caller (or `_ws`). */
  private effectiveProjects(caller: Caller, p: Persona): Set<string> {
    const usable = new Set(this.d.projects.usableBy(caller, this.d.access.mode()).map((x) => x.id));
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

  private ownLive(rec: ConversationRecord, c: string): HostSession | undefined {
    const s = this.d.host.getSession(rec.sessionId);
    const team = s?.pluginRefs?.team as { conversationId?: unknown } | undefined;
    if (!s || team?.conversationId !== c) return undefined;
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

  private view(lr: { c: string; record: ConversationRecord }, persona: Persona | null): ConversationView {
    const rec = lr.record;
    return {
      id: lr.c,
      title: this.titleOf(rec, lr.c),
      status: this.statusOf(rec, lr.c),
      lastActivityAt: rec.lastActivityAt,
      archived: rec.archived,
      personaStale: !!persona && persona.updatedAt > rec.personaUpdatedAt,
    };
  }

  // ── spawn + bind ───────────────────────────────────────────────────────────

  private logEnsure(caller: Caller, personaKey: string, t: string, c: string, outcome: string, sessionId?: string): void {
    this.d.logger.info(
      `team.ensure uk=${caller.uk} personaKey=${personaKey} t=${t} c=${c} outcome=${outcome} sessionId=${sessionId ?? "-"}`,
    );
  }

  private async launch(
    caller: Caller,
    persona: Persona,
    t: string,
    c: string,
    root: { dir: string; project?: Project },
    resumeFile?: string,
  ): Promise<{ sessionId: string; sessionFile?: string; runId: string; spawnToken: string }> {
    if (!fs.existsSync(this.d.guardExtensionPath)) throw new TeamError(503, "guard_unavailable");
    const personaFile = this.d.renderPersona(persona, caller.uk);
    if (!fs.existsSync(personaFile)) {
      this.d.logger.error(`team.persona_render_failed personaKey=${persona.key}`);
      throw new TeamError(500, "persona_render_failed");
    }
    const contextFiles = root.project?.contextFiles ? collectContextFiles(root.dir) : [];
    const runId = randomUUID();
    const spawnToken = randomUUID();
    const catalog = this.d.config().skillCatalog ?? {};
    const skills = (persona.skills ?? []).map((n) => catalog[n]).filter((p): p is string => typeof p === "string");
    const ownerStamp = this.owner(caller);

    let settleFn: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      settleFn = resolve;
    });
    const entry: Pending = { ready: false, settle: () => {} };
    const readyAndBound = () => !!entry.sessionId && this.readySessions.has(entry.sessionId);
    entry.settle = () => {
      if (readyAndBound()) settleFn();
    };
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
          tools: TOOL_PRESETS[persona.tools],
          ...(skills.length ? { skills } : {}),
          extensions: [this.d.guardExtensionPath],
          extensionConfig: { team: { persona: personaFile, root: root.dir, tools: persona.tools } },
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
      return { sessionId, sessionFile: s?.sessionFile, runId, spawnToken };
    } catch (err) {
      this.pending.delete(runId);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── create / ensure ────────────────────────────────────────────────────────

  private activeCount(caller: Caller, t: string, personaKey: string): number {
    return this.d.records.list(caller.uk, t, personaKey).filter((r) => !r.record.archived).length;
  }

  private snapshot(p: Persona) {
    return { name: p.name, description: p.description, avatar: p.avatar, role: p.role, ...(p.model ? { model: p.model } : {}) };
  }

  async createConversation(caller: Caller, personaKey: string, t: string): Promise<{ id: string; sessionId: string }> {
    const persona = this.persona(caller, personaKey);
    const root = this.target(caller, persona, t);
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
      };
      this.d.records.write(this.loc(caller, personaKey, t, c), rec);
      this.logEnsure(caller, personaKey, t, c, "create", bound.sessionId);
      return { id: c, sessionId: bound.sessionId };
    } finally {
      release();
      void tail.then(() => {
        if (this.createLocks.get(lockKey) === tail) this.createLocks.delete(lockKey);
      });
    }
  }

  async ensureConversation(caller: Caller, personaKey: string, t: string, c: string): Promise<{ sessionId: string }> {
    const { rec } = this.requireRecord(caller, personaKey, t, c);
    if (rec.archived) throw new TeamError(409, "conversation_archived");
    const key = `${caller.uk}|${personaKey}|${t}|${c}`;
    const existing = this.inFlight.get(key) as Promise<{ sessionId: string }> | undefined;
    if (existing) return existing;
    const p = this.ensureInner(caller, personaKey, t, c).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async ensureInner(caller: Caller, personaKey: string, t: string, c: string): Promise<{ sessionId: string }> {
    const l = this.loc(caller, personaKey, t, c);
    const rec = this.d.records.read(l);
    if (!rec) throw new TeamError(404, "conversation_not_found");
    const persona = this.persona(caller, personaKey);
    const root = this.target(caller, persona, t, true);

    // 3. reuse
    const live = this.ownLive(rec, c);
    const team = live?.pluginRefs?.team as { personaKey?: unknown; project?: unknown } | undefined;
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
      // A live session that cannot be reused (cwd moved / owner drift): end it before resuming.
      await this.d.host.abortSpawnedRun({ sessionId: rec.sessionId, graceful: true });
    }

    // 4. resume
    const known = this.d.host.getSession(rec.sessionId);
    const ownerOk = !known || this.ownerMatches(known, caller);
    const file = rec.sessionFile ?? known?.sessionFile;
    const fileExists = !!file && fs.existsSync(file);
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
    const stamp = this.iso();
    this.d.records.delete(l);
    this.d.records.write(l, {
      ...rec,
      sessionId: bound.sessionId,
      sessionFile: bound.sessionFile ?? (fileExists ? file : undefined),
      runId: bound.runId,
      spawnToken: bound.spawnToken,
      startedAt: stamp,
      lastActivityAt: stamp,
      personaUpdatedAt: persona.updatedAt,
      personaSnapshot: this.snapshot(persona),
    });
    this.logEnsure(caller, personaKey, t, c, fileExists ? "resume" : "create", bound.sessionId);
    return { sessionId: bound.sessionId };
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
        await this.d.host.abortSpawnedRun({ sessionId: rec.sessionId, graceful: true });
      }
      if (!body.archived && rec.archived && this.activeCount(caller, t, personaKey) >= this.maxConversations()) {
        throw new TeamError(409, "conversation_limit");
      }
      rec.archived = body.archived;
    }
    this.d.records.write(l, rec);
    return this.view({ c, record: rec }, this.d.personas.get(personaKey, caller.uk));
  }

  async restartConversation(caller: Caller, personaKey: string, t: string, c: string): Promise<void> {
    const { rec } = this.requireRecord(caller, personaKey, t, c);
    await this.d.host.abortSpawnedRun({ sessionId: rec.sessionId, graceful: true });
  }

  async deleteConversation(caller: Caller, personaKey: string, t: string, c: string): Promise<void> {
    const { l, rec } = this.requireRecord(caller, personaKey, t, c);
    await this.d.host.abortSpawnedRun({ sessionId: rec.sessionId, graceful: true });
    this.d.records.delete(l);
  }

  // ── agents (D8) ───────────────────────────────────────────────────────────

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
    const out: AgentView[] = [];
    const seen = new Set<string>();

    for (const p of personas) {
      const assigned = this.effectiveProjects(caller, p).has(t) && p.projects.includes(t);
      const recs = byPersona.get(p.key) ?? [];
      const active = recs.filter((r) => !r.record.archived);
      if (!assigned && active.length === 0) continue;
      seen.add(p.key);
      out.push(this.card(p, recs, assigned, mode));
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

  private card(p: Persona, recs: LocatedRecord[], assigned: boolean, mode: "single" | "multi"): AgentView {
    const active = recs.filter((r) => !r.record.archived);
    const fullBlocked = p.tools === "full" && mode === "multi";
    let status: AgentStatus;
    if (!assigned || fullBlocked) status = "unavailable";
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
      personaStale: active.some((r) => p.updatedAt > r.record.personaUpdatedAt),
      unassigned: !assigned,
      retired: false,
    };
  }

  /** Counts for the folder row: agents assigned to the project + active conversations. */
  folderCounts(caller: Caller, projectId: string): { agents: number; active: number } {
    const cards = this.agents(caller, projectId).filter((a) => !a.retired && a.status !== "unavailable");
    return { agents: cards.length, active: cards.filter((a) => a.status === "running" || a.status === "busy").length };
  }
}

export { isInside };
