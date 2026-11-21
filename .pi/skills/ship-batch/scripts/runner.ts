/**
 * ship-batch runner: the thin I/O shell around the pure scheduler / outcome /
 * lock modules. Every external effect goes through `Deps` (REST, bus, clock,
 * docker teardown, tool probes), so the whole run is testable with a fake
 * dashboard; git is driven for real (tests use mkdtemp repos with a bare origin).
 *
 * Loop (every 10 s): observe (bus snapshot, questions, archived listing) →
 * `nextActions` → execute → persist. See change: add-ship-batch-orchestrator.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CliArgs } from "./args.ts";
import { type LockInfo, lockDecision } from "./lock.ts";
import { classify, type TeardownStep, teardownPlan, type WorktreeFacts } from "./outcome.ts";
import {
  adopt,
  batchMembers,
  isDone,
  nextActions,
  type PlanChange,
  type PlanEdge,
  planQueue,
  resolveGroup,
  setState,
} from "./scheduler.ts";
import {
  type Action,
  type BatchState,
  type Item,
  isTerminal,
  type Observations,
  type Outcome,
  type SessionObs,
} from "./types.ts";

// ── Ports ───────────────────────────────────────────────────────────

export interface RestResponse {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: REST envelopes are loosely typed JSON
  json: any;
}

export interface BusPort {
  /** Connect (throws when the dashboard is unreachable). */
  connect(): Promise<void>;
  connected(): boolean;
  sessions(): SessionObs[];
  spawn(opts: {
    cwd: string;
    attachProposal: string;
    model: string;
    initialPrompt: string;
    timeout?: number;
    onWarning?: (w: string) => void;
  }): Promise<string>;
  prompt(sessionId: string, text: string): void;
  close(): void;
}

export interface Deps {
  /** REST call; throws when the dashboard cannot be reached. */
  rest(method: "GET" | "POST", path: string, body?: unknown): Promise<RestResponse>;
  bus: BusPort;
  now(): number;
  sleep(ms: number): Promise<void>;
  out(line: string): void;
  err(line: string): void;
  hostname: string;
  pid: number;
  isAlive?: (pid: number) => boolean;
  /** `docker/test-down.sh` from the worktree (idempotent). */
  dockerDown(worktree: string): Promise<void>;
  /** `openspec list --json` in the repo (active changes). */
  listChanges(repo: string): Promise<PlanChange[]>;
  hasTool(name: string): boolean;
}

// ── Constants ───────────────────────────────────────────────────────

type Step<T> = { ok: true; value: T } | { ok: false; reason: string };

const restOk = (res: RestResponse): boolean => res.status >= 200 && res.status < 300 && res.json?.success !== false;

export const TICK_MS = 10_000;
export const DEP_RETRY_ATTEMPTS = 10;
export const DEP_RETRY_DELAY_MS = 3_000;
export const ARCHIVE_BOUND_MS = 3 * 60_000;
export const SPAWN_TIMEOUT_MS = 60_000;
export const SHIP_IT_PROMPT = "/skill:ship-it";
const RECONNECT_CAP_MS = 60_000;

export class ExitError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

// ── git ─────────────────────────────────────────────────────────────

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[]): GitResult {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : "") };
}

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** The main checkout: parent of the realpath of `git rev-parse --git-common-dir`. */
export function mainCheckout(cwd: string): string | null {
  const r = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!r.ok) return null;
  return path.dirname(real(r.stdout.trim()));
}

const stateDir = (repo: string): string => path.join(repo, ".worktrees", ".ship-batch");
const safeId = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, "_");

function ensureExcluded(repo: string): void {
  const r = git(repo, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
  if (!r.ok) return;
  const file = r.stdout.trim();
  try {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (/^\/?\.worktrees\/?$/m.test(cur)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${cur && !cur.endsWith("\n") ? "\n" : ""}.worktrees/\n`);
  } catch {
    /* best effort */
  }
}

/** Default `Deps.dockerDown`: run the worktree's `docker/test-down.sh` from the worktree (idempotent). */
export async function dockerDownScript(worktree: string): Promise<void> {
  const script = path.join(worktree, "docker", "test-down.sh");
  if (!fs.existsSync(script)) return;
  const r = spawnSync("bash", [script], { cwd: worktree, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`docker/test-down.sh failed: ${(r.stderr || r.stdout).trim()}`);
}

// ── Report helpers ──────────────────────────────────────────────────

export function renderTable(state: BatchState, now: number): string[] {
  const lines = [`group ${state.groupName} (${state.groupId})  parallel=${state.params.parallel} max-live=${state.params.maxLive}`];
  if (state.unreachableSince) lines.push(`dashboard unreachable since ${new Date(state.unreachableSince).toISOString()}`);
  if (state.halted) lines.push(`scheduling halted: ${state.halted}`);
  for (const i of state.items) {
    const age = i.history.length ? `${Math.round((now - i.history[i.history.length - 1].at) / 1000)}s` : "";
    const extra = [i.sessionId ? `session ${i.sessionId}` : "", i.reason ?? "", i.state === "kept" && i.worktree ? `kept at ${i.worktree}` : ""]
      .filter(Boolean)
      .join("; ");
    lines.push(`  ${i.change.padEnd(40)} ${i.state.padEnd(11)} ${age.padStart(6)}  ${extra}`);
  }
  return lines;
}

// ── Runner ──────────────────────────────────────────────────────────

export class Runner {
  state!: BatchState;
  actionsExecuted = 0;
  private stateFile = "";
  private eventsFile = "";
  private lockFile = "";
  private seen = new Map<string, number>();
  private busUpSince: number | null = null;
  private reconnectAttempts = 0;
  private nextReconnectAt = 0;
  private archivedCache = new Set<string>();
  private stopCode: number | null = null;
  private stopWake: (() => void) | null = null;
  private lockHeld = false;

  constructor(
    private readonly deps: Deps,
    private readonly args: CliArgs,
    readonly repo: string,
  ) {}

  // ── persistence ───────────────────────────────────────────────────

  private paths(groupId: string): void {
    const dir = stateDir(this.repo);
    this.stateFile = path.join(dir, `${safeId(groupId)}.json`);
    this.eventsFile = path.join(dir, `${safeId(groupId)}.events.jsonl`);
    this.lockFile = path.join(dir, "lock");
  }

  private event(ev: string, data: Record<string, unknown>): void {
    if (!this.eventsFile) return;
    try {
      fs.appendFileSync(this.eventsFile, `${JSON.stringify({ t: this.deps.now(), ev, ...data })}\n`);
    } catch {
      /* never fail a run on logging */
    }
  }

  private flushTransitions(): void {
    for (const item of this.state.items) {
      const from = this.seen.get(item.change) ?? 0;
      for (const h of item.history.slice(from)) {
        this.event("transition", { change: item.change, from: h.from, to: h.to, ...(h.reason ? { reason: h.reason } : {}) });
      }
      this.seen.set(item.change, item.history.length);
    }
  }

  private persist(): void {
    this.state.updatedAt = this.deps.now();
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
    fs.renameSync(tmp, this.stateFile);
  }

  private writeLock(): void {
    const info: LockInfo = { pid: this.deps.pid, hostname: this.deps.hostname, groupId: this.state?.groupId ?? this.args.group ?? "", heartbeatAt: this.deps.now() };
    const tmp = `${this.lockFile}.${this.deps.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(info));
    fs.renameSync(tmp, this.lockFile);
  }

  private acquireLock(groupId: string): void {
    fs.mkdirSync(stateDir(this.repo), { recursive: true });
    ensureExcluded(this.repo);
    const info: LockInfo = { pid: this.deps.pid, hostname: this.deps.hostname, groupId, heartbeatAt: this.deps.now() };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(this.lockFile, "wx");
        fs.writeSync(fd, JSON.stringify(info));
        fs.closeSync(fd);
        this.lockHeld = true;
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      let existing: LockInfo | null = null;
      try {
        existing = JSON.parse(fs.readFileSync(this.lockFile, "utf8")) as LockInfo;
      } catch {
        existing = null; // unreadable / vanished → treat as stale
      }
      const decision = existing
        ? lockDecision(existing, { hostname: this.deps.hostname, pid: this.deps.pid }, this.deps.now(), this.deps.isAlive)
        : ({ action: "takeover" } as const);
      if (decision.action === "refuse") throw new ExitError(decision.reason, 1);
      fs.rmSync(this.lockFile, { force: true });
    }
    throw new ExitError("could not acquire the ship-batch lock (lost a race)", 1);
  }

  private releaseLock(): void {
    if (!this.lockHeld) return;
    try {
      const cur = JSON.parse(fs.readFileSync(this.lockFile, "utf8")) as LockInfo;
      if (cur.pid === this.deps.pid && cur.hostname === this.deps.hostname) fs.rmSync(this.lockFile, { force: true });
    } catch {
      /* already gone */
    }
    this.lockHeld = false;
  }

  // ── REST helpers ──────────────────────────────────────────────────

  private async get(p: string): Promise<RestResponse> {
    return this.deps.rest("GET", p);
  }

  private q(extra: Record<string, string>): string {
    return Object.entries(extra)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
  }

  // ── plan ──────────────────────────────────────────────────────────

  private fetchArchiveDirs(): string[] | null {
    const f = git(this.repo, ["fetch", "origin", "develop"]);
    if (!f.ok) return null;
    return this.lsArchive();
  }

  private lsArchive(): string[] {
    const r = git(this.repo, ["ls-tree", "--name-only", "origin/develop", "openspec/changes/archive/"]);
    if (!r.ok) return [];
    return r.stdout
      .split("\n")
      .map((l) => path.basename(l.trim()))
      .filter(Boolean);
  }

  /** Plan the queue. Throws `ExitError(1)` before any side effect on a planning failure. */
  async plan(groupQuery: string): Promise<{ state: BatchState; willAsk: Record<string, string[]> }> {
    const gres = await this.get(`/api/openspec/groups?${this.q({ cwd: this.repo })}`);
    if (gres.status !== 200 || !gres.json?.data) throw new ExitError(`cannot read the OpenSpec groups (HTTP ${gres.status})`, 1);
    const file = gres.json.data as { groups: { id: string; name: string }[]; assignments: Record<string, string>; changeOrder?: Record<string, string[]> };
    const resolved = resolveGroup(file.groups, groupQuery);
    if (!resolved.ok) throw new ExitError(resolved.error, 1);
    const group = resolved.group;

    const archiveDirs = this.fetchArchiveDirs();
    if (archiveDirs === null) throw new ExitError("cannot fetch origin/develop (needed to detect already-shipped changes)", 1);
    const active = await this.deps.listChanges(this.repo);
    const probe = { groupId: group.id, assignments: file.assignments, active, archiveDirs };
    const { eligible } = batchMembers(probe);

    const edges: Record<string, PlanEdge[]> = {};
    for (const c of eligible) edges[c.name] = await this.dependencyEdges(c.name);

    const now = this.deps.now();
    const planned = planQueue({ ...probe, changeOrder: file.changeOrder, edges, now });
    const state: BatchState = {
      version: 1,
      groupId: group.id,
      groupName: group.name,
      repo: this.repo,
      params: {
        parallel: this.args.parallel,
        maxLive: this.args.maxLive,
        nudges: this.args.nudges,
        settleMs: this.args.settleMs,
        startTimeoutMs: this.args.startTimeoutMs,
        model: this.args.model,
      },
      planArchive: archiveDirs,
      items: planned.items,
      alreadyShipped: planned.alreadyShipped,
      createdAt: now,
      updatedAt: now,
      notes: planned.alreadyShipped.map((c) => `${c}: already shipped — pull develop`),
    };

    // Members whose worktree already hosts a live session are not touched.
    const live = await this.residentSessions();
    for (const item of state.items) {
      if (isTerminal(item.state)) continue;
      const wt = path.join(this.repo, ".worktrees", `os-${item.change}`);
      if (fs.existsSync(wt) && this.sessionsUnder(live, wt).length > 0) setState(item, "skipped", now, "live session present");
    }
    const willAsk: Record<string, string[]> = {};
    for (const i of state.items) if (i.outOfBatch.length) willAsk[i.change] = i.outOfBatch;
    return { state, willAsk };
  }

  private async dependencyEdges(change: string): Promise<PlanEdge[]> {
    const url = `/api/openspec/dependencies?${this.q({ cwd: this.repo, change })}`;
    for (let attempt = 1; attempt <= DEP_RETRY_ATTEMPTS; attempt++) {
      const res = await this.get(url);
      if (res.status === 200) {
        const edges = res.json?.data?.dependencies?.blockedBy ?? [];
        return (edges as PlanEdge[]).map((e) => ({ change: e.change, state: e.state }));
      }
      if (res.status !== 503) throw new ExitError(`dependency lookup for ${change} failed (HTTP ${res.status})`, 1);
      if (attempt < DEP_RETRY_ATTEMPTS) await this.deps.sleep(DEP_RETRY_DELAY_MS);
    }
    throw new ExitError(`dependency lookup for ${change} still pending after ${DEP_RETRY_ATTEMPTS} attempts`, 1);
  }

  private async residentSessions(): Promise<SessionObs[]> {
    const res = await this.get("/api/sessions");
    const rows = (res.status === 200 ? res.json?.data : null) as SessionObs[] | null;
    return Array.isArray(rows) ? rows.filter((s) => s.status !== "ended") : [];
  }

  private sessionsUnder(sessions: readonly SessionObs[], dir: string): SessionObs[] {
    const root = real(dir);
    return sessions.filter((s) => {
      const c = real(s.cwd);
      return c === root || c.startsWith(root + path.sep);
    });
  }

  // ── run ───────────────────────────────────────────────────────────

  private readExisting(): BatchState | null {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as BatchState;
    } catch {
      return null;
    }
  }

  /** Re-attach an unfinished run: the CLI's params win, scheduling is un-halted. */
  private resumeFrom(existing: BatchState, fresh: BatchState): BatchState {
    existing.params = fresh.params;
    existing.halted = undefined;
    for (const i of existing.items) {
      if (i.state !== "starting") continue;
      // Spawned but the runner died before moving it on: it is running.
      if (i.sessionId) setState(i, "running", this.deps.now());
      else if (i.spawnRequestedAt === undefined) setState(i, "queued", this.deps.now());
    }
    this.event("resume", { items: existing.items.length });
    return existing;
  }

  /** Load a resumable state, or rotate a finished one and plan fresh. */
  async prepare(groupQuery: string): Promise<void> {
    const { state: fresh } = await this.plan(groupQuery);
    this.paths(fresh.groupId);
    this.acquireLock(fresh.groupId);
    const prior = this.readExisting();
    const resumed = prior?.items.some((i) => !isTerminal(i.state)) === true;
    if (prior && !resumed) {
      fs.renameSync(this.stateFile, path.join(stateDir(this.repo), `${safeId(fresh.groupId)}.${this.deps.now()}.json`));
    }
    this.state = resumed ? this.resumeFrom(prior as BatchState, fresh) : fresh;
    // A resumed run already logged its history; a fresh plan logs from the start.
    for (const i of this.state.items) this.seen.set(i.change, resumed ? i.history.length : 0);
    this.flushTransitions();
    this.busUpSince = this.deps.now(); // `runMain` connected the bus just before
    this.persist();
  }

  requestStop(code: number): void {
    if (this.stopCode === null) this.stopCode = code;
    this.stopWake?.();
  }

  private async interruptibleSleep(ms: number): Promise<void> {
    await Promise.race([
      this.deps.sleep(ms),
      new Promise<void>((resolve) => {
        this.stopWake = resolve;
      }),
    ]);
    this.stopWake = null;
  }

  /** Execute the loop until every item is terminal or a stop is requested. Returns the exit code. */
  async runLoop(): Promise<number> {
    while (this.stopCode === null && !isDone(this.state)) {
      try {
        await this.tick();
      } catch (e) {
        this.event("error", { what: "tick", message: String((e as Error)?.message ?? e) });
      }
      if (this.stopCode !== null || isDone(this.state)) break;
      const wait = this.busUpSince === null ? Math.max(1, Math.min(TICK_MS, this.nextReconnectAt - this.deps.now())) : TICK_MS;
      await this.interruptibleSleep(wait);
    }
    this.persist();
    this.flushTransitions();
    this.releaseLock();
    if (this.stopCode !== null) return this.stopCode;
    return this.state.items.every((i) => i.state === "shipped") ? 0 : 2;
  }

  report(): string[] {
    const lines = ["ship-batch report:"];
    for (const i of this.state.items) {
      const kept = i.state === "kept" || (i.state !== "shipped" && i.worktree && fs.existsSync(i.worktree));
      lines.push(
        `  ${i.change}: ${i.state}${i.reason ? ` — ${i.reason}` : ""}${i.branch ? ` [branch ${i.branch}]` : ""}${kept && i.worktree ? ` [worktree kept at ${i.worktree}]` : ""}`,
      );
    }
    for (const n of this.state.notes) lines.push(`  note: ${n}`);
    return lines;
  }

  // ── tick ──────────────────────────────────────────────────────────

  private async ensureBus(now: number): Promise<boolean> {
    const { bus } = this.deps;
    if (bus.connected()) {
      if (this.busUpSince === null) this.busUpSince = now;
      return true;
    }
    if (this.busUpSince !== null) {
      this.busUpSince = null;
      this.reconnectAttempts = 0;
      this.nextReconnectAt = now;
    }
    this.state.unreachableSince ??= now;
    if (now < this.nextReconnectAt) return false;
    try {
      await bus.connect();
      this.busUpSince = this.deps.now();
      this.reconnectAttempts = 0;
      this.state.unreachableSince = null;
      return true;
    } catch (e) {
      this.reconnectAttempts++;
      const delayMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), RECONNECT_CAP_MS);
      this.nextReconnectAt = now + delayMs;
      this.event("error", { what: "bus_reconnect", attempt: this.reconnectAttempts, delayMs, message: String((e as Error)?.message ?? e) });
      return false;
    }
  }

  private async observe(now: number): Promise<Observations | null> {
    let qres: RestResponse;
    try {
      qres = await this.get("/api/questions");
    } catch (e) {
      this.state.unreachableSince ??= now;
      this.event("error", { what: "questions", message: String((e as Error)?.message ?? e) });
      return null;
    }
    if (qres.status !== 200) {
      this.event("error", { what: "questions", message: `HTTP ${qres.status}` });
      return null;
    }
    this.state.unreachableSince = null;
    const questions = new Set<string>(((qres.json?.data ?? []) as { sessionId: string }[]).map((r) => r.sessionId));
    const sessions: Record<string, SessionObs> = {};
    for (const s of this.deps.bus.sessions()) sessions[s.id] = s;
    for (const item of this.state.items) {
      const id = item.sessionId;
      if (!id || isTerminal(item.state) || sessions[id]) continue;
      if (await this.isArchived(id)) this.archivedCache.add(id);
    }
    return { connected: true, connectedSince: this.busUpSince, sessions, questions, archived: this.archivedCache };
  }

  private async isArchived(id: string): Promise<boolean> {
    if (this.archivedCache.has(id)) return true;
    try {
      const res = await this.get(`/api/sessions/archived/${encodeURIComponent(id)}`);
      if (res.status === 200) {
        this.archivedCache.add(id);
        return true;
      }
    } catch {
      /* unknown → not archived */
    }
    return false;
  }

  async tick(): Promise<void> {
    const now = this.deps.now();
    if (!(await this.ensureBus(now))) {
      this.persist();
      return;
    }
    const obs = await this.observe(now);
    if (!obs) {
      this.persist();
      return;
    }
    const actions = nextActions(this.state, obs, now);
    this.flushTransitions();
    this.persist();
    for (const action of actions) {
      if (this.stopCode !== null && action.kind === "start") continue;
      this.event("action", { ...action });
      this.actionsExecuted++;
      try {
        await this.exec(action);
      } catch (e) {
        const item = this.item(action.change);
        this.event("error", { what: action.kind, change: action.change, message: String((e as Error)?.message ?? e) });
        if (item && !isTerminal(item.state)) {
          item.outcome = item.outcome ?? "unknown";
          setState(item, "kept", this.deps.now(), `error during ${action.kind}: ${String((e as Error)?.message ?? e)}`);
        }
      }
      this.flushTransitions();
      this.persist();
    }
    this.writeLockHeartbeat();
  }

  private writeLockHeartbeat(): void {
    try {
      this.writeLock();
    } catch {
      /* heartbeat is best effort */
    }
  }

  private item(change: string): Item | undefined {
    return this.state.items.find((i) => i.change === change);
  }

  private async exec(a: Action): Promise<void> {
    const item = this.item(a.change) as Item;
    switch (a.kind) {
      case "skip":
        return;
      case "nudge":
        this.deps.bus.prompt(a.sessionId, a.text);
        return;
      case "start":
        return this.startItem(item);
      case "adopt":
        return this.adoptItem(item);
      case "classify":
        return this.classifyItem(item);
      case "teardown":
        return this.teardownItem(item);
    }
  }

  // ── start (D4) ────────────────────────────────────────────────────

  private worktreeRegistered(wt: string): boolean {
    const r = git(this.repo, ["worktree", "list", "--porcelain"]);
    if (!r.ok) return false;
    const target = real(wt);
    return r.stdout.split("\n").some((l) => l.startsWith("worktree ") && real(l.slice(9).trim()) === target);
  }

  private refExists(ref: string): boolean {
    return git(this.repo, ["rev-parse", "--verify", "--quiet", ref]).ok;
  }

  private async failStart(item: Item, reason: string): Promise<void> {
    item.outcome = "failed";
    if (!item.worktree) {
      // Failed before a worktree existed: nothing to tear down.
      setState(item, "failed", this.deps.now(), reason);
      return;
    }
    setState(item, "teardown", this.deps.now(), reason);
    this.flushTransitions();
    return this.teardownItem(item, { startFailure: reason });
  }

  /** The worktree for `item`: reuse a registered one, else check out / fork per D4 (retrying a husk once). */
  private async ensureWorktree(item: Item, wt: string): Promise<Step<string>> {
    if (this.worktreeRegistered(wt)) return { ok: true, value: wt };
    const branch = `os/${item.change}`;
    let body: Record<string, string>;
    if (this.refExists(`refs/heads/${branch}`)) body = { cwd: this.repo, base: branch };
    else {
      git(this.repo, ["fetch", "origin", branch]); // best effort: refresh the remote-tracking ref
      body = this.refExists(`refs/remotes/origin/${branch}`)
        ? { cwd: this.repo, base: `origin/${branch}` }
        : { cwd: this.repo, base: "develop", newBranch: branch };
    }
    let res = await this.deps.rest("POST", "/api/git/worktree", body);
    if (res.status === 409 && res.json?.code === "path_exists") {
      await this.deps.rest("POST", "/api/git/worktree/orphan-cleanup", { cwd: this.repo, path: wt });
      res = await this.deps.rest("POST", "/api/git/worktree", body);
    }
    if (!restOk(res)) {
      return { ok: false, reason: String(res.json?.code ?? res.json?.error ?? `worktree create failed (HTTP ${res.status})`) };
    }
    item.freshWorktree = body.newBranch !== undefined;
    return { ok: true, value: (res.json?.data?.path as string | undefined) ?? wt };
  }

  /** Run the worktree init hook; an untrusted hook halts scheduling (never auto-trusted). */
  private async initWorktree(item: Item, wt: string): Promise<Step<null>> {
    const init = await this.deps.rest("POST", "/api/git/worktree/init", { cwd: wt });
    if (restOk(init)) return { ok: true, value: null };
    const code = String(init.json?.code ?? "init_failed");
    if (code === "init_untrusted") {
      this.state.halted = `init hook for ${item.change} is untrusted — trust the init hook once, then re-run`;
      this.state.notes.push(
        `${item.change}: the worktree init hook is untrusted — trust the init hook once in the dashboard (open the worktree, approve the hook), then re-run ship-batch.`,
      );
    }
    return { ok: false, reason: code };
  }

  /** Several sessions share the worktree: never guess, keep the item. */
  private keepAmbiguous(item: Item, wt: string, sessionIds: string[]): void {
    this.state.notes.push(`${item.change}: several sessions in ${wt} (${sessionIds.join(", ")}); none adopted`);
    item.outcome = "unknown";
    setState(item, "kept", this.deps.now(), "ambiguous session adoption");
  }

  /** Spawn the ship-it session; on a spawn timeout adopt the one matching resident session (D4). */
  private async spawnSession(item: Item, wt: string): Promise<Step<string> | { ok: "ambiguous" }> {
    try {
      const id = await this.deps.bus.spawn({
        cwd: wt,
        attachProposal: item.change,
        model: this.state.params.model,
        initialPrompt: SHIP_IT_PROMPT,
        timeout: SPAWN_TIMEOUT_MS,
        onWarning: (w) => this.state.notes.push(`${item.change}: ${w}`),
      });
      return { ok: true, value: id };
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/timed out/i.test(msg)) return { ok: false, reason: msg };
      const sessions = this.deps.bus.sessions();
      const adoption = adopt({ worktree: wt, spawnRequestedAt: item.spawnRequestedAt as number, sessions, realpath: real });
      if (adoption.kind === "adopted") return { ok: true, value: adoption.sessionId };
      if (adoption.kind === "ambiguous") {
        this.keepAmbiguous(item, wt, adoption.sessionIds);
        return { ok: "ambiguous" };
      }
      return { ok: false, reason: "spawn timed out and no session was adopted" };
    }
  }

  private async startItem(item: Item): Promise<void> {
    item.branch = `os/${item.change}`;
    const wt = await this.ensureWorktree(item, path.join(this.repo, ".worktrees", `os-${item.change}`));
    if (!wt.ok) return this.failStart(item, wt.reason);
    item.worktree = wt.value;
    const init = await this.initWorktree(item, wt.value);
    if (!init.ok) return this.failStart(item, init.reason);

    item.spawnRequestedAt = this.deps.now();
    this.persist();
    const session = await this.spawnSession(item, wt.value);
    if (session.ok === "ambiguous") return;
    if (!session.ok) return this.failStart(item, session.reason);
    item.sessionId = session.value;
    item.lastPromptAt = this.deps.now();
    item.streamedSincePrompt = false;
    item.idleSince = null;
    setState(item, "running", this.deps.now());
    this.persist();
  }

  private async adoptItem(item: Item): Promise<void> {
    const wt = item.worktree ?? path.join(this.repo, ".worktrees", `os-${item.change}`);
    const r = adopt({ worktree: wt, spawnRequestedAt: item.spawnRequestedAt as number, sessions: this.deps.bus.sessions(), realpath: real });
    if (r.kind === "adopted") {
      item.sessionId = r.sessionId;
      item.lastPromptAt ??= item.spawnRequestedAt;
      setState(item, "running", this.deps.now(), "adopted after restart");
    } else if (r.kind === "none") {
      setState(item, "queued", this.deps.now(), "no session found after restart; spawning again");
    } else {
      this.keepAmbiguous(item, wt, r.sessionIds);
    }
  }

  // ── classify ──────────────────────────────────────────────────────

  private async classifyItem(item: Item): Promise<void> {
    const wt = item.worktree ?? path.join(this.repo, ".worktrees", `os-${item.change}`);
    const result = await classify({
      change: item.change,
      planArchive: this.state.planArchive,
      fetchArchive: async () => this.fetchArchiveDirs(),
      blockedFileExists: () => fs.existsSync(path.join(wt, "openspec", "changes", item.change, "SHIP_IT_BLOCKED.md")),
      sleep: (ms) => this.deps.sleep(ms),
    });
    item.outcome = result.outcome;
    this.event("outcome", { change: item.change, outcome: result.outcome, fetches: result.fetches });
  }

  // ── teardown (D6) ─────────────────────────────────────────────────

  /** One archive attempt/check. `done` | `wait` | `giveup`. */
  private async archiveStep(item: Item): Promise<"done" | "wait" | "giveup"> {
    const id = item.sessionId as string;
    const now = this.deps.now();
    const a = (item.archive ??= { startedAt: now, pending: false, lastAttemptAt: -Infinity, done: false });
    if (a.done) return "done";
    if (await this.isArchived(id)) {
      a.done = true;
      return "done";
    }
    if (now - a.startedAt >= ARCHIVE_BOUND_MS) return "giveup";

    const resident = this.deps.bus.sessions().find((s) => s.id === id);
    const alive = resident !== undefined && resident.status !== "ended";
    const spacing = this.state.params.settleMs;
    const mayPost = a.pending ? !alive : now - a.lastAttemptAt >= spacing;
    if (!mayPost) return "wait";

    a.lastAttemptAt = now;
    const res = await this.deps.rest("POST", `/api/session/${encodeURIComponent(id)}/archive`, {});
    if (res.status === 200 && res.json?.success !== false) {
      if (res.json?.pending) {
        a.pending = true;
        return "wait";
      }
      a.done = true;
      this.archivedCache.add(id);
      return "done";
    }
    if (res.status === 409) {
      a.pending = false;
      return "wait";
    }
    if (res.status === 404 && (await this.isArchived(id))) {
      a.done = true;
      return "done";
    }
    return "wait";
  }

  private gatherFacts(item: Item, wt: string): WorktreeFacts {
    const branch = `os/${item.change}`;
    const registered = this.worktreeRegistered(wt);
    const branchExists = this.refExists(`refs/heads/${branch}`);
    if (!registered || !fs.existsSync(wt)) return { registered: false, dirt: [], aheadOfDevelop: 0, midOperation: false, branchExists };

    const st = git(wt, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const dirt: string[] = [];
    const entries = st.stdout.split("\0").filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      dirt.push(e.slice(3));
      if (e[0] === "R" || e[0] === "C" || e[1] === "R" || e[1] === "C") i++; // skip the rename origin
    }
    const ahead = git(wt, ["rev-list", "--count", "origin/develop..HEAD"]);
    const aheadLocal = ahead.ok ? ahead : git(wt, ["rev-list", "--count", "develop..HEAD"]);
    const aheadOfDevelop = aheadLocal.ok ? Number.parseInt(aheadLocal.stdout.trim(), 10) || 0 : 1; // unknown → conservative
    const gitPath = (p: string): string => path.resolve(wt, git(wt, ["rev-parse", "--git-path", p]).stdout.trim());
    const midOperation =
      ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].some((p) => fs.existsSync(gitPath(p))) ||
      !git(wt, ["symbolic-ref", "-q", "HEAD"]).ok;
    return { registered, dirt, aheadOfDevelop, midOperation, branchExists };
  }

  private keep(item: Item, reason: string): void {
    this.state.notes.push(`${item.change}: kept — ${reason}${item.worktree ? ` (${item.worktree})` : ""}`);
    setState(item, "kept", this.deps.now(), reason);
  }

  /**
   * The common teardown prefix (D6): archive the session, bring the harness down,
   * guard against live sessions. `go` = proceed to the per-outcome plan.
   */
  private async teardownPrefix(item: Item, wt: string): Promise<"go" | "stop"> {
    if (item.sessionId) {
      const step = await this.archiveStep(item);
      if (step === "wait") return "stop";
      if (step === "giveup") {
        this.keep(item, "session not archivable");
        return "stop";
      }
    }
    if (fs.existsSync(path.join(wt, ".pi-test-harness.json"))) {
      try {
        await this.deps.dockerDown(wt); // idempotent; always before any removal
      } catch (e) {
        this.event("error", { what: "docker_down", change: item.change, message: String((e as Error)?.message ?? e) });
      }
    }
    const live = this.sessionsUnder(await this.residentSessions(), wt).filter((s) => s.id !== item.sessionId);
    if (live.length > 0) {
      this.keep(item, `live session present in the worktree (${live.map((s) => s.id).join(", ")})`);
      return "stop";
    }
    return "go";
  }

  private async teardownItem(item: Item, opts: { startFailure?: string } = {}): Promise<void> {
    const outcome: Outcome = item.outcome ?? "unknown";
    const wt = item.worktree ?? path.join(this.repo, ".worktrees", `os-${item.change}`);
    if ((await this.teardownPrefix(item, wt)) === "stop") return;

    const plan = teardownPlan(outcome, this.gatherFacts(item, wt));
    for (const step of plan.steps) {
      const failure = await this.runStep(item, wt, step, outcome);
      if (failure) return this.keep(item, failure);
    }
    if (plan.result === "kept") return this.keep(item, plan.keptReason ?? "kept");
    if (opts.startFailure && plan.result === "failed") return setState(item, "failed", this.deps.now(), opts.startFailure);
    setState(item, plan.result, this.deps.now(), plan.result === "shipped" ? undefined : (item.reason ?? `outcome ${outcome}`));
  }

  /** Execute one teardown step; returns a failure reason when the worktree must be kept. */
  private async runStep(item: Item, wt: string, step: TeardownStep, outcome: Outcome): Promise<string | null> {
    const branch = `os/${item.change}`;
    switch (step.op) {
      case "prune":
        git(this.repo, ["worktree", "prune"]);
        return null;
      case "branch-delete": {
        const r = git(this.repo, ["branch", "-D", branch]);
        if (!r.ok) this.event("error", { what: "branch_delete", change: item.change, message: r.stderr.trim() });
        return null;
      }
      case "wip-commit": {
        const add = git(wt, ["add", "-A", "--", ".", ":!.pi/settings.json"]);
        if (!add.ok) return `git add failed: ${add.stderr.trim()}`;
        if (git(wt, ["diff", "--cached", "--quiet"]).ok) return null; // nothing staged
        const c = git(wt, ["commit", "--no-verify", "-m", `wip(ship-batch): ${item.change} ${outcome}`]);
        return c.ok ? null : `WIP commit failed: ${c.stderr.trim()}`;
      }
      case "push": {
        const p = git(wt, ["push", "-u", "origin", branch]);
        return p.ok ? null : `push failed: ${p.stderr.trim().split("\n").pop()}`;
      }
      case "remove": {
        const res = await this.deps.rest("POST", "/api/git/worktree/remove", { cwd: wt, force: step.force, deleteBranch: step.deleteBranch });
        if (res.status >= 200 && res.status < 300 && res.json?.success !== false) return null;
        return `worktree remove refused: ${res.json?.code ?? res.json?.error ?? `HTTP ${res.status}`}`;
      }
    }
  }
}

// ── Entry ───────────────────────────────────────────────────────────

/** Everything the CLI does after argument parsing. Never throws; returns the exit code. */
export async function runMain(args: CliArgs, deps: Deps, opts: { onRunner?: (r: Runner) => void } = {}): Promise<number> {
  try {
    return await runMainInner(args, deps, opts);
  } catch (e) {
    if (e instanceof ExitError) {
      deps.err(e.message);
      return e.code;
    }
    deps.err(`ship-batch: fatal: ${String((e as Error)?.stack ?? e)}`);
    return 1;
  } finally {
    try {
      deps.bus.close();
    } catch {
      /* ignore */
    }
  }
}

/** Checks that must pass before any side effect; returns the main checkout. */
async function preflight(args: CliArgs, deps: Deps): Promise<string> {
  const cwd = path.resolve(args.cwd ?? process.cwd());
  for (const tool of ["git", "openspec"]) if (!deps.hasTool(tool)) throw new ExitError(`preflight: \`${tool}\` is not on PATH`, 1);
  const repo = mainCheckout(cwd);
  if (!repo) throw new ExitError(`preflight: ${cwd} is not inside a git repository`, 1);
  if (args.status) return repo; // reads local state only

  let cfg: RestResponse;
  try {
    cfg = await deps.rest("GET", "/api/config");
  } catch (e) {
    throw new ExitError(`preflight: dashboard unreachable (${String((e as Error)?.message ?? e)})`, 1);
  }
  const strategy = cfg.json?.data?.spawnStrategy;
  if (cfg.status !== 200 || strategy !== "headless") {
    throw new ExitError(`preflight: spawnStrategy must be "headless" (got ${JSON.stringify(strategy)}); bus spawn correlation needs it`, 1);
  }
  if (!git(repo, ["remote", "get-url", "origin"]).ok) throw new ExitError("preflight: the repository has no `origin` remote", 1);
  return repo;
}

async function runMainInner(args: CliArgs, deps: Deps, opts: { onRunner?: (r: Runner) => void }): Promise<number> {
  const repo = await preflight(args, deps);
  if (args.status) return statusMain(args, deps, repo);

  const runner = new Runner(deps, args, repo);
  opts.onRunner?.(runner);

  if (args.dryRun) {
    const { state, willAsk } = await runner.plan(args.group as string);
    for (const line of renderDryRun(state, willAsk)) deps.out(line);
    return 0;
  }

  // Connect before any side effect; an unreachable bus is a preflight failure.
  try {
    await deps.bus.connect();
  } catch (e) {
    throw new ExitError(`preflight: cannot connect to the dashboard bus (${String((e as Error)?.message ?? e)})`, 1);
  }
  await runner.prepare(args.group as string);
  const code = await runner.runLoop();
  for (const line of runner.report()) deps.out(line);
  return code;
}

/** SIGINT/SIGTERM → stop new starts, persist, release the lock, exit 130/143 (live sessions untouched). */
export function installSignalHandlers(getRunner: () => Runner | undefined, proc: NodeJS.Process = process): () => void {
  const sigint = (): void => getRunner()?.requestStop(130);
  const sigterm = (): void => getRunner()?.requestStop(143);
  proc.on("SIGINT", sigint);
  proc.on("SIGTERM", sigterm);
  return () => {
    proc.off("SIGINT", sigint);
    proc.off("SIGTERM", sigterm);
  };
}

export function renderDryRun(state: BatchState, willAsk: Record<string, string[]>): string[] {
  const lines = [`ship-batch dry-run: group ${state.groupName} (${state.groupId}) parallel=${state.params.parallel} max-live=${state.params.maxLive}`, "order:"];
  state.items.forEach((i, n) => {
    const notes: string[] = [];
    if (i.state === "skipped") notes.push(`skipped: ${i.reason}`);
    if (i.blockedBy.length) notes.push(`waits for ${i.blockedBy.join(", ")}`);
    if (willAsk[i.change]) notes.push(`will ask (open blocker outside the batch): ${willAsk[i.change].join(", ")}`);
    lines.push(`  ${n + 1}. ${i.change}${notes.length ? `  — ${notes.join("; ")}` : ""}`);
  });
  for (const c of state.alreadyShipped) lines.push(`already shipped — pull develop: ${c}`);
  return lines;
}

function statusMain(args: CliArgs, deps: Deps, repo: string): number {
  const dir = stateDir(repo);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !/\.\d{8,}\.json$/.test(f));
  } catch {
    files = [];
  }
  let printed = 0;
  for (const f of files) {
    let st: BatchState;
    try {
      st = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BatchState;
    } catch {
      continue;
    }
    if (args.group && st.groupId !== args.group && st.groupName.toLowerCase() !== args.group.toLowerCase()) continue;
    for (const line of renderTable(st, deps.now())) deps.out(line);
    printed++;
  }
  if (printed === 0) deps.out("no ship-batch state found");
  return 0;
}
