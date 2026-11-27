/**
 * TeamStore (tasks 2.3 / 2.5, design D2): the server-owned source of truth.
 * Every mutation is a SYNCHRONOUS method (no `await` between a read and its
 * write, so claims are atomic in Node's single thread); persistence is
 * asynchronous and driven through `TeamPersistence`. Each committed change bumps
 * a per-team in-memory `rev` and emits typed events AFTER the state changed;
 * a throwing listener never affects the commit.
 * See change: add-agent-teams-core.
 */
import { randomBytes } from "node:crypto";
import type { Clock } from "../shared/clock.js";
import { SCHEMA_VERSION } from "../shared/constants.js";
import {
  type CloseReason,
  type Committer,
  type Mail,
  type MailPriority,
  type Member,
  type MemberStatus,
  RELEASED_MEMBER_STATUSES,
  type SessionBinding,
  type Task,
  type TaskStatus,
  type Team,
  type TeamOverrides,
  type TeamStatus,
} from "../shared/types.js";
import type { LoadResult, TeamPersistence } from "./persistence.js";
import type { Logger } from "./types.js";

export interface StoreEventMap {
  change: { team: Team; rev: number };
  team_created: { team: Team };
  lead_bound: { team: Team; rebind: boolean };
  task_completed: { team: Team; task: Task };
  member_status: { team: Team; member: Member; from: MemberStatus; to: MemberStatus };
  team_closed: { team: Team };
}
export type StoreEventName = keyof StoreEventMap;

export interface CreateTeamInput {
  name: string;
  description?: string;
  /** Required unless `starting`. */
  leadSessionId?: string;
  starting?: boolean;
  leadCwd: string;
  mode: string;
  maxTeammates: number;
  owner?: string;
  committer?: Committer;
  overrides?: TeamOverrides;
  defaultSkills?: string[];
  defaultTools?: string[];
  /** Additive fields of the templates-hooks change (all optional; absent = unchanged behaviour). */
  template?: Team["template"];
  hooks?: Team["hooks"];
  leadSpawnToken?: string;
  leadBindDeadline?: number;
}

/** Team fields `patchTeam` may set (an `undefined` value clears the field). */
export type TeamPatch = Partial<
  Pick<Team, "overrides" | "defaultSkills" | "defaultTools" | "maxTeammates" | "description" | "template" | "hooks" | "plans" | "leadSpawnToken" | "leadBindDeadline" | "leadIncarnation" | "subagentsApi" | "pendingStops">
>;

export interface AddTaskInput {
  title: string;
  description: string;
  blockedBy?: string[];
  owner?: string;
  ownerLocked?: boolean;
  createdBy: string;
}

export interface AppendMailInput {
  from: string;
  to: string;
  kind: string;
  text: string;
  priority?: MailPriority;
  wake?: boolean;
  details?: Record<string, unknown>;
}

export interface StoreOptions {
  clock: Clock;
  logger: Logger;
  persistence?: TeamPersistence;
  /** Test seam: deterministic team ids. */
  idFactory?: () => string;
  /** In-memory mail log cap (oldest ACKED entries are pruned first). */
  maxMailLog?: number;
}

type Listener<E extends StoreEventName> = (event: StoreEventMap[E]) => void;

export class TeamStore {
  private readonly teams = new Map<string, Team>();
  private readonly mail = new Map<string, Mail[]>();
  private readonly revs = new Map<string, number>();
  private readonly index = new Map<string, SessionBinding>();
  private readonly listeners = new Map<StoreEventName, Set<Listener<StoreEventName>>>();
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly persistence: TeamPersistence | undefined;
  private readonly idFactory: () => string;
  private readonly maxMailLog: number;

  constructor(opts: StoreOptions) {
    this.clock = opts.clock;
    this.logger = opts.logger;
    this.persistence = opts.persistence;
    this.idFactory = opts.idFactory ?? (() => `t_${randomBytes(4).toString("hex")}`);
    this.maxMailLog = opts.maxMailLog ?? 1000;
    opts.persistence?.attach({
      getTeam: (id) => this.teams.get(id),
      getMail: (id) => this.mail.get(id) ?? [],
      getRev: (id) => this.revs.get(id) ?? 0,
      dropMail: (id, ids) => this.dropMail(id, ids),
    });
  }

  // ── events ──────────────────────────────────────────────────────────────────

  on<E extends StoreEventName>(event: E, fn: Listener<E>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<StoreEventName>);
    return () => {
      set?.delete(fn as Listener<StoreEventName>);
    };
  }

  private emit<E extends StoreEventName>(event: E, payload: StoreEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        this.logger.error(`agent-teams: store listener for ${event} threw: ${(err as Error).message}`);
      }
    }
  }

  /** Bump rev, schedule persistence, then emit `change` and the specific events. */
  private commit(team: Team, opts: { writeThrough?: boolean } = {}, after?: () => void): void {
    const rev = (this.revs.get(team.id) ?? 0) + 1;
    this.revs.set(team.id, rev);
    this.persistence?.markDirty(team.id, opts.writeThrough === true);
    this.emit("change", { team, rev });
    after?.();
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  get(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  list(): Team[] {
    return [...this.teams.values()];
  }

  rev(teamId: string): number {
    return this.revs.get(teamId) ?? 0;
  }

  /** `sessionId → {teamId, lead|member}`; closed teams and released members are never indexed. */
  findBySession(sessionId: string): SessionBinding | undefined {
    return this.index.get(sessionId);
  }

  member(team: Team, name: string): Member | undefined {
    return team.members.find((m) => m.name === name);
  }

  task(team: Team, id: string): Task | undefined {
    return team.tasks.find((t) => t.id === id);
  }

  /** Derived, never stored: a task is blocked iff any `blockedBy` task is not completed. */
  isBlocked(team: Team, task: Task): boolean {
    return task.blockedBy.some((id) => this.task(team, id)?.status !== "completed");
  }

  mailLog(teamId: string): readonly Mail[] {
    return this.mail.get(teamId) ?? [];
  }

  /** Unacked mail for one recipient, in mail-id order. */
  pendingMail(teamId: string, to: string): Mail[] {
    return (this.mail.get(teamId) ?? []).filter((m) => m.to === to && m.ackedAt === undefined);
  }

  /** Teams counted against `maxActiveTeams`: `starting`, `active` and `orphaned`, never `closed`. */
  activeTeamCount(): number {
    let n = 0;
    for (const t of this.teams.values()) if (t.status === "starting" || t.status === "active" || t.status === "orphaned") n++;
    return n;
  }

  get persistDegraded(): boolean {
    return this.persistence?.degraded ?? false;
  }

  /** Teams whose file could not be read (REST lists them as unavailable). */
  get unavailableTeams(): ReadonlyArray<{ id: string; reason: "corrupt" | "future" }> {
    return this.persistence?.unavailable ?? [];
  }

  // ── lifecycle mutations ─────────────────────────────────────────────────────

  createTeam(input: CreateTeamInput): Team {
    const starting = input.starting === true;
    if (!starting && !input.leadSessionId) throw new Error("createTeam: leadSessionId required unless starting");
    let id = this.idFactory();
    while (this.teams.has(id)) id = this.idFactory();
    const team: Team = {
      id,
      name: input.name,
      leadConnected: !starting,
      leadCwd: input.leadCwd,
      mode: input.mode,
      status: starting ? "starting" : "active",
      committer: input.committer ?? "lead",
      maxTeammates: input.maxTeammates,
      members: [],
      tasks: [],
      nextTaskId: 1,
      nextMailId: 1,
      createdAt: this.clock.now(),
      schemaVersion: SCHEMA_VERSION,
    };
    if (input.description !== undefined) team.description = input.description;
    if (input.leadSessionId !== undefined) team.leadSessionId = input.leadSessionId;
    if (input.owner !== undefined) team.owner = input.owner;
    if (input.overrides !== undefined) team.overrides = input.overrides;
    if (input.defaultSkills !== undefined) team.defaultSkills = input.defaultSkills;
    if (input.defaultTools !== undefined) team.defaultTools = input.defaultTools;
    if (input.template !== undefined) team.template = input.template;
    if (input.hooks !== undefined) team.hooks = input.hooks;
    if (input.leadSpawnToken !== undefined) team.leadSpawnToken = input.leadSpawnToken;
    if (input.leadBindDeadline !== undefined) team.leadBindDeadline = input.leadBindDeadline;
    this.teams.set(id, team);
    this.mail.set(id, []);
    if (team.leadSessionId) this.index.set(team.leadSessionId, { teamId: id, who: "lead" });
    this.commit(team, { writeThrough: true }, () => this.emit("team_created", { team }));
    return team;
  }

  /**
   * Bind (or re-bind) the lead session. `owner` is kept when already set (a
   * server-started team keeps its owner); otherwise the lead's `principalOwner`.
   */
  bindLead(teamId: string, sessionId: string, opts: { principalOwner?: string } = {}): Team | undefined {
    const team = this.teams.get(teamId);
    if (!team || team.status === "closed") return undefined;
    const rebind = team.leadSessionId !== undefined;
    if (team.leadSessionId && team.leadSessionId !== sessionId) this.index.delete(team.leadSessionId);
    team.leadSessionId = sessionId;
    team.leadConnected = true;
    if (team.owner === undefined && opts.principalOwner !== undefined) team.owner = opts.principalOwner;
    if (team.status === "starting" || team.status === "orphaned") {
      team.status = "active";
      delete team.orphanedAt;
    }
    this.index.set(sessionId, { teamId, who: "lead" });
    this.commit(team, { writeThrough: true }, () => this.emit("lead_bound", { team, rebind }));
    return team;
  }

  setLeadConnected(teamId: string, connected: boolean): void {
    const team = this.teams.get(teamId);
    if (!team || team.leadConnected === connected) return;
    team.leadConnected = connected;
    this.commit(team);
  }

  /** Move a team to `status`; `closed` stamps `closedAt`, records the reason, drops the index and emits `team_closed`. */
  setTeamStatus(teamId: string, status: TeamStatus, opts: { closeReason?: CloseReason } = {}): Team | undefined {
    const team = this.teams.get(teamId);
    if (!team || team.status === status) return team;
    team.status = status;
    if (status === "orphaned") team.orphanedAt = this.clock.now();
    else delete team.orphanedAt;
    if (opts.closeReason !== undefined) team.closeReason = opts.closeReason;
    if (status === "closed") {
      team.closedAt = this.clock.now();
      this.dropIndexFor(team);
    }
    this.commit(team, { writeThrough: status === "closed" || status === "closing" }, () => {
      if (status === "closed") this.emit("team_closed", { team });
    });
    return team;
  }

  /**
   * Patch settable team fields; a key whose value is `undefined` is DELETED (so a cleared
   * `leadSpawnToken` leaves no key in the persisted JSON). `writeThrough` flushes at once
   * (use it for `template`/`hooks`/`leadSpawnToken`/`leadBindDeadline`, which a restart must see).
   */
  patchTeam(teamId: string, patch: TeamPatch, opts: { writeThrough?: boolean } = {}): void {
    const team = this.teams.get(teamId);
    if (!team) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (team as unknown as Record<string, unknown>)[k];
      else (team as unknown as Record<string, unknown>)[k] = v;
    }
    this.commit(team, opts);
  }

  private dropIndexFor(team: Team): void {
    for (const [sid, b] of this.index) if (b.teamId === team.id) this.index.delete(sid);
  }

  // ── members ─────────────────────────────────────────────────────────────────

  /** Add a member; a `gone`/`failed` record of the same name is replaced (name release). */
  reserveMember(teamId: string, member: Member): Member | undefined {
    const team = this.teams.get(teamId);
    if (!team || team.status === "closed" || team.status === "closing") return undefined;
    const at = team.members.findIndex((m) => m.name === member.name);
    if (at >= 0) {
      const old = team.members[at] as Member;
      if (!RELEASED_MEMBER_STATUSES.includes(old.status)) return undefined;
      team.members[at] = member;
    } else {
      team.members.push(member);
    }
    if (member.sessionId) this.index.set(member.sessionId, { teamId, who: member.name });
    this.commit(team, { writeThrough: true });
    return member;
  }

  /** Patch a member; a status change emits `member_status`; `gone`/`failed` leaves the index. */
  patchMember(teamId: string, name: string, patch: Partial<Member>, opts: { writeThrough?: boolean } = {}): Member | undefined {
    const team = this.teams.get(teamId);
    const member = team?.members.find((m) => m.name === name);
    if (!team || !member) return undefined;
    const from = member.status;
    const oldSession = member.sessionId;
    Object.assign(member, patch);
    if (oldSession && oldSession !== member.sessionId) this.index.delete(oldSession);
    if (member.sessionId) {
      if (RELEASED_MEMBER_STATUSES.includes(member.status)) this.index.delete(member.sessionId);
      else this.index.set(member.sessionId, { teamId, who: name });
    }
    this.commit(team, opts, () => {
      if (from !== member.status) this.emit("member_status", { team, member, from, to: member.status });
    });
    return member;
  }

  // ── tasks (state primitives; business rules live in the task ops) ───────────

  addTask(teamId: string, input: AddTaskInput): Task | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    const task: Task = {
      id: String(team.nextTaskId++),
      title: input.title,
      description: input.description,
      status: "pending",
      blockedBy: [...(input.blockedBy ?? [])],
      createdBy: input.createdBy,
      createdAt: this.clock.now(),
    };
    if (input.owner !== undefined) task.owner = input.owner;
    if (input.ownerLocked) task.ownerLocked = true;
    team.tasks.push(task);
    this.commit(team);
    return task;
  }

  /** Patch a task. Claim (`in_progress`) and completion are write-through; completion emits `task_completed`. */
  patchTask(teamId: string, taskId: string, patch: Partial<Omit<Task, "id" | "createdAt">> & { clearOwner?: boolean }): Task | undefined {
    const team = this.teams.get(teamId);
    const task = team?.tasks.find((t) => t.id === taskId);
    if (!team || !task) return undefined;
    const from: TaskStatus = task.status;
    const { clearOwner, ...fields } = patch;
    Object.assign(task, fields);
    if (clearOwner) delete task.owner;
    const now = this.clock.now();
    if (from !== task.status && task.status === "in_progress") {
      task.claimedAt = now;
      delete task.note;
    }
    if (from !== "completed" && task.status === "completed") task.completedAt = now;
    if (from === "in_progress" && task.status === "pending") delete task.claimedAt;
    const writeThrough = from !== task.status && (task.status === "in_progress" || task.status === "completed");
    this.commit(team, { writeThrough }, () => {
      if (from !== "completed" && task.status === "completed") this.emit("task_completed", { team, task });
    });
    return task;
  }

  // ── mail ────────────────────────────────────────────────────────────────────

  appendMail(teamId: string, input: AppendMailInput): Mail | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    const mail: Mail = {
      id: team.nextMailId++,
      from: input.from,
      to: input.to,
      kind: input.kind,
      text: input.text,
      priority: input.priority ?? "normal",
      wake: input.wake ?? false,
      createdAt: this.clock.now(),
    };
    if (input.details !== undefined) mail.details = input.details;
    const log = this.mail.get(teamId) ?? [];
    log.push(mail);
    this.mail.set(teamId, log);
    this.pruneAcked(log);
    this.persistence?.appendMail(teamId, mail);
    this.commit(team);
    return mail;
  }

  /** Idempotent: an id already acked (or unknown) is a no-op. Returns the ids newly acked. */
  ackMail(teamId: string, ids: readonly number[]): number[] {
    const team = this.teams.get(teamId);
    const log = this.mail.get(teamId);
    if (!team || !log) return [];
    const fresh: number[] = [];
    const now = this.clock.now();
    for (const m of log) {
      if (ids.includes(m.id) && m.ackedAt === undefined) {
        m.ackedAt = now;
        fresh.push(m.id);
      }
    }
    if (fresh.length > 0) {
      this.persistence?.appendAck(teamId, fresh, now);
      this.commit(team);
    }
    return fresh;
  }

  /** Discard a recipient's unacked mail (member exit). Returns how many were discarded. */
  discardMailFor(teamId: string, to: string): number {
    const team = this.teams.get(teamId);
    const pending = this.pendingMail(teamId, to);
    if (!team || pending.length === 0) return 0;
    this.ackMail(teamId, pending.map((m) => m.id));
    return pending.length;
  }

  private pruneAcked(log: Mail[]): void {
    let excess = log.length - this.maxMailLog;
    if (excess <= 0) return;
    for (let i = 0; i < log.length && excess > 0; ) {
      if ((log[i] as Mail).ackedAt !== undefined) {
        log.splice(i, 1);
        excess--;
      } else i++;
    }
  }

  private dropMail(teamId: string, ids: readonly number[]): void {
    const log = this.mail.get(teamId);
    if (!log) return;
    const drop = new Set(ids);
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i] as Mail;
      if (drop.has(m.id) && m.ackedAt !== undefined) log.splice(i, 1);
    }
  }

  // ── restart ─────────────────────────────────────────────────────────────────

  /**
   * Load persisted teams. Every non-terminal member becomes `disconnected` (a
   * `spawning` member stays `spawning` so reconciliation can fail it after the
   * grace period) and every lead `leadConnected=false`; the index is rebuilt.
   */
  hydrate(loaded: LoadResult): void {
    for (const { team, mail } of loaded.teams) {
      team.leadConnected = false;
      for (const m of team.members) {
        if (m.status !== "spawning" && !RELEASED_MEMBER_STATUSES.includes(m.status)) m.status = "disconnected";
      }
      this.teams.set(team.id, team);
      this.mail.set(team.id, mail);
      this.revs.set(team.id, 0);
      if (team.status === "closed") continue;
      if (team.leadSessionId) this.index.set(team.leadSessionId, { teamId: team.id, who: "lead" });
      for (const m of team.members) {
        if (m.sessionId && !RELEASED_MEMBER_STATUSES.includes(m.status)) this.index.set(m.sessionId, { teamId: team.id, who: m.name });
      }
    }
  }

  /** Teams persisted as `closing`: the closing resume at startup re-requests shutdown. */
  closingTeams(): Team[] {
    return this.list().filter((t) => t.status === "closing");
  }
}
