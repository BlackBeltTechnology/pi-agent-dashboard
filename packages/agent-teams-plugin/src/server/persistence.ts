/**
 * Team persistence (tasks 2.4, 2.5, 2.13, design D2/D14): one JSON file per team
 * (`<dataDir>/teams/<id>.json`, atomic temp + rename, ≤1 write / 100 ms / team,
 * write-through for claim/complete, sync flush on shutdown) plus a separate
 * append-only mail log (`<id>.mail.jsonl`, acks as tombstone lines, compacted at
 * `maxMailLogBytes`). Disk writes go through ONE per-team promise chain whose
 * tasks serialise the CURRENT in-memory state when they run, so persistence is
 * asynchronous but can never reorder or roll back a mutation.
 * See change: add-agent-teams-core.
 */
import nodeFs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Clock } from "../shared/clock.js";
import { SCHEMA_VERSION } from "../shared/constants.js";
import type { Mail, Team, TeamStatus } from "../shared/types.js";
import type { Logger } from "./types.js";

const WRITE_COALESCE_MS = 100;
const TEAM_STATUSES: readonly TeamStatus[] = ["starting", "active", "orphaned", "closing", "closed"];
const DAY_MS = 86_400_000;

/** Async file operations used on the write path (injectable for fault injection). */
export interface PersistFs {
  mkdir(dir: string): Promise<void>;
  writeFile(file: string, data: string): Promise<void>;
  appendFile(file: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(file: string): Promise<void>;
}

export const nodePersistFs: PersistFs = {
  async mkdir(dir) {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  },
  writeFile: (file, data) => fsp.writeFile(file, data, { encoding: "utf8", mode: 0o600 }),
  appendFile: (file, data) => fsp.appendFile(file, data, { encoding: "utf8", mode: 0o600 }),
  rename: (from, to) => fsp.rename(from, to),
  unlink: (file) => fsp.unlink(file),
};

/** What persistence reads from the store (set by `attach`). */
export interface PersistenceSource {
  getTeam(teamId: string): Team | undefined;
  getMail(teamId: string): readonly Mail[];
  getRev(teamId: string): number;
  /** Compaction dropped these acked ids from the file; drop them from memory too. */
  dropMail(teamId: string, ids: readonly number[]): void;
}

export interface UnavailableTeam {
  id: string;
  reason: "corrupt" | "future";
  file: string;
}

interface LoadedTeam {
  team: Team;
  mail: Mail[];
}

export interface LoadResult {
  teams: LoadedTeam[];
  unavailable: UnavailableTeam[];
}

export interface PersistenceOptions {
  dir: string;
  clock: Clock;
  logger: Logger;
  fs?: PersistFs;
  maxMailLogBytes?: () => number;
  closedRetentionDays?: () => number;
}

interface TeamIo {
  chain: Promise<void>;
  timer?: unknown;
  logBytes: number;
  /** Rev of the newest state already on disk (skips redundant writes). */
  writtenRev: number;
}

/** Byte size of one mail-log line (exported so tests can hit the cap exactly). */
export function mailLineBytes(mail: Mail): number {
  return Buffer.byteLength(`${JSON.stringify({ t: "m", ...mail })}\n`);
}

/**
 * Entries to keep when compacting: EVERY unacked entry plus the newest acked
 * ones until the kept log is at most half of `capBytes`. Unacked mail is never
 * dropped, even when it alone exceeds the half-cap.
 */
export function selectCompaction(mail: readonly Mail[], capBytes: number): { keep: Mail[]; dropped: number[] } {
  const target = Math.floor(capBytes / 2);
  const keepIds = new Set<number>();
  let bytes = 0;
  for (const m of mail) {
    if (m.ackedAt === undefined) {
      keepIds.add(m.id);
      bytes += mailLineBytes(m);
    }
  }
  for (let i = mail.length - 1; i >= 0; i--) {
    const m = mail[i] as Mail;
    if (m.ackedAt === undefined) continue;
    const size = mailLineBytes(m);
    if (bytes + size > target) break;
    keepIds.add(m.id);
    bytes += size;
  }
  return {
    keep: mail.filter((m) => keepIds.has(m.id)),
    dropped: mail.filter((m) => !keepIds.has(m.id)).map((m) => m.id),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Structural check of a persisted team (wrong types → corrupt). */
function isTeamShape(v: unknown): v is Team {
  if (!isObject(v)) return false;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.name === "string" &&
    typeof v.status === "string" &&
    (TEAM_STATUSES as readonly string[]).includes(v.status) &&
    typeof v.leadCwd === "string" &&
    typeof v.mode === "string" &&
    typeof v.maxTeammates === "number" &&
    typeof v.nextTaskId === "number" &&
    typeof v.nextMailId === "number" &&
    Array.isArray(v.members) &&
    v.members.every((m) => isObject(m) && typeof m.name === "string" && typeof m.status === "string") &&
    Array.isArray(v.tasks) &&
    v.tasks.every((t) => isObject(t) && typeof t.id === "string" && typeof t.status === "string")
  );
}

/** Replay a mail log: later lines win per id, ack tombstones fold into `ackedAt`, a torn last line is skipped. */
function parseMailLog(raw: string): Mail[] {
  const byId = new Map<number, Mail>();
  const acks: Array<{ ids: number[]; at: number }> = [];
  for (const line of raw.split("\n")) {
    const rec = parseJsonLine(line);
    if (!rec) continue;
    if (rec.t === "m" && typeof rec.id === "number") {
      const { t: _t, ...mail } = rec;
      byId.set(rec.id, mail as unknown as Mail);
    } else if (rec.t === "a" && Array.isArray(rec.ids) && typeof rec.at === "number") {
      acks.push({ ids: rec.ids.filter((i): i is number => typeof i === "number"), at: rec.at });
    }
  }
  for (const a of acks) {
    for (const id of a.ids) {
      const m = byId.get(id);
      if (m && m.ackedAt === undefined) m.ackedAt = a.at;
    }
  }
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  if (line === "") return undefined;
  try {
    const rec: unknown = JSON.parse(line);
    return isObject(rec) ? rec : undefined;
  } catch {
    return undefined;
  }
}

export class TeamPersistence {
  private readonly dir: string;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly fs: PersistFs;
  private readonly maxMailLogBytes: () => number;
  private readonly closedRetentionDays: () => number;
  private readonly io = new Map<string, TeamIo>();
  private source: PersistenceSource | undefined;
  private degradedFlag = false;
  private degradedLogged = false;
  private compactionCount = 0;
  private unavailableList: UnavailableTeam[] = [];

  constructor(opts: PersistenceOptions) {
    this.dir = opts.dir;
    this.clock = opts.clock;
    this.logger = opts.logger;
    this.fs = opts.fs ?? nodePersistFs;
    this.maxMailLogBytes = opts.maxMailLogBytes ?? (() => 2 * 1024 * 1024);
    this.closedRetentionDays = opts.closedRetentionDays ?? (() => 7);
  }

  attach(source: PersistenceSource): void {
    this.source = source;
  }

  /** True after a failed write until a later write succeeds (`persist_degraded`). */
  get degraded(): boolean {
    return this.degradedFlag;
  }

  get compactions(): number {
    return this.compactionCount;
  }

  get unavailable(): readonly UnavailableTeam[] {
    return this.unavailableList;
  }

  logBytes(teamId: string): number {
    return this.ioFor(teamId).logBytes;
  }

  teamFile(teamId: string): string {
    return path.join(this.dir, `${teamId}.json`);
  }

  mailFile(teamId: string): string {
    return path.join(this.dir, `${teamId}.mail.jsonl`);
  }

  // ── write path ──────────────────────────────────────────────────────────────

  private ioFor(teamId: string): TeamIo {
    let io = this.io.get(teamId);
    if (!io) {
      io = { chain: Promise.resolve(), logBytes: 0, writtenRev: -1 };
      this.io.set(teamId, io);
    }
    return io;
  }

  private enqueue(teamId: string, task: () => Promise<void>): void {
    const io = this.ioFor(teamId);
    io.chain = io.chain.then(task).catch((err: unknown) => {
      this.logger.error(`agent-teams: persistence task failed for ${teamId}: ${(err as Error).message}`);
    });
  }

  /** A team changed. Write-through (claim/complete) skips the 100 ms coalescing delay. */
  markDirty(teamId: string, writeThrough = false): void {
    const io = this.ioFor(teamId);
    if (writeThrough) {
      if (io.timer !== undefined) {
        this.clock.clearTimeout(io.timer);
        io.timer = undefined;
      }
      this.enqueue(teamId, () => this.writeTeam(teamId));
      return;
    }
    if (io.timer !== undefined) return;
    io.timer = this.clock.setTimeout(() => {
      io.timer = undefined;
      this.enqueue(teamId, () => this.writeTeam(teamId));
    }, WRITE_COALESCE_MS);
  }

  private async writeTeam(teamId: string): Promise<void> {
    const team = this.source?.getTeam(teamId);
    const io = this.ioFor(teamId);
    if (!team) return;
    const rev = this.source?.getRev(teamId) ?? 0;
    if (rev === io.writtenRev && !this.degradedFlag) return;
    const tmp = `${this.teamFile(teamId)}.${process.pid}.${rev}.tmp`;
    try {
      await this.fs.mkdir(this.dir);
      await this.fs.writeFile(tmp, JSON.stringify(team));
      await this.fs.rename(tmp, this.teamFile(teamId));
      io.writtenRev = rev;
      this.degradedFlag = false;
      this.degradedLogged = false;
    } catch (err) {
      this.degradedFlag = true;
      if (!this.degradedLogged) {
        this.degradedLogged = true;
        this.logger.error(`agent-teams: team file write failed for ${teamId}: ${(err as Error).message}`);
      }
      // `writtenRev` stays behind, so the next mutation (or flush) retries the full state.
      io.writtenRev = -1;
    }
  }

  /** Append a mail to the log (and compact when the log exceeds the cap). */
  appendMail(teamId: string, mail: Mail): void {
    this.appendLine(teamId, `${JSON.stringify({ t: "m", ...mail })}\n`);
  }

  /** Record acknowledgements as a tombstone line. */
  appendAck(teamId: string, ids: readonly number[], at: number): void {
    this.appendLine(teamId, `${JSON.stringify({ t: "a", ids, at })}\n`);
  }

  private appendLine(teamId: string, line: string): void {
    const io = this.ioFor(teamId);
    io.logBytes += Buffer.byteLength(line);
    this.enqueue(teamId, async () => {
      try {
        await this.fs.mkdir(this.dir);
        await this.fs.appendFile(this.mailFile(teamId), line);
      } catch (err) {
        this.logger.error(`agent-teams: mail log append failed for ${teamId}: ${(err as Error).message}`);
      }
    });
    if (io.logBytes > this.maxMailLogBytes()) this.compact(teamId);
  }

  /**
   * Decide the compaction NOW (synchronously, so the snapshot is exactly the log
   * as queued so far and later appends cannot be written twice), account for the
   * new size at once, drop the pruned (acked) entries from memory, and queue the
   * atomic rewrite behind the appends already in the chain.
   */
  private compact(teamId: string): void {
    const source = this.source;
    if (!source) return;
    const io = this.ioFor(teamId);
    const { keep, dropped } = selectCompaction(source.getMail(teamId), this.maxMailLogBytes());
    const body = keep.map((m) => `${JSON.stringify({ t: "m", ...m })}\n`).join("");
    io.logBytes = Buffer.byteLength(body);
    this.compactionCount++;
    if (dropped.length > 0) source.dropMail(teamId, dropped);
    this.enqueue(teamId, async () => {
      const tmp = `${this.mailFile(teamId)}.${process.pid}.tmp`;
      try {
        await this.fs.mkdir(this.dir);
        await this.fs.writeFile(tmp, body);
        await this.fs.rename(tmp, this.mailFile(teamId));
      } catch (err) {
        this.logger.error(`agent-teams: mail log compaction failed for ${teamId}: ${(err as Error).message}`);
      }
    });
  }

  /** Remove a team's files (pruning). */
  async remove(teamId: string): Promise<void> {
    this.enqueue(teamId, async () => {
      for (const f of [this.teamFile(teamId), this.mailFile(teamId)]) {
        await this.fs.unlink(f).catch(() => undefined);
      }
    });
    await this.ioFor(teamId).chain;
    this.io.delete(teamId);
  }

  /** Resolve when every queued write has finished (tests, flush). */
  async idle(): Promise<void> {
    await Promise.all([...this.io.values()].map((io) => io.chain));
  }

  /** Write every pending team now (no coalescing delay) and wait. */
  async flush(): Promise<void> {
    for (const [teamId, io] of this.io) {
      if (io.timer !== undefined) {
        this.clock.clearTimeout(io.timer);
        io.timer = undefined;
        this.enqueue(teamId, () => this.writeTeam(teamId));
      }
    }
    await this.idle();
  }

  /**
   * Synchronous flush for `ctx.onShutdown` (a `() => void` hook cannot await):
   * writes every team whose newest state is not yet on disk. Async writes already
   * in flight serialised an older state; `writtenRev` is advanced so a stale
   * async rename cannot overwrite the fresher file.
   */
  flushSync(): void {
    const source = this.source;
    if (!source) return;
    for (const [teamId, io] of this.io) {
      if (io.timer !== undefined) {
        this.clock.clearTimeout(io.timer);
        io.timer = undefined;
      }
      const team = source.getTeam(teamId);
      const rev = source.getRev(teamId);
      if (!team || rev === io.writtenRev) continue;
      try {
        nodeFs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        const tmp = `${this.teamFile(teamId)}.${process.pid}.sync.tmp`;
        nodeFs.writeFileSync(tmp, JSON.stringify(team), { mode: 0o600 });
        nodeFs.renameSync(tmp, this.teamFile(teamId));
        io.writtenRev = Number.MAX_SAFE_INTEGER;
      } catch (err) {
        this.logger.error(`agent-teams: shutdown flush failed for ${teamId}: ${(err as Error).message}`);
      }
    }
  }

  // ── load path (synchronous, once at start) ──────────────────────────────────

  private quarantine(file: string, id: string, reason: "corrupt" | "future", detail: string): void {
    const target = `${file}.${reason}`;
    try {
      nodeFs.renameSync(file, target);
    } catch (err) {
      this.logger.error(`agent-teams: could not quarantine ${file}: ${(err as Error).message}`);
    }
    this.logger.warn(`agent-teams: team file ${id} is unavailable (${reason}): ${detail}`);
    this.unavailableList.push({ id, reason, file: target });
  }

  /** Parse one team file into a team, or quarantine it (corrupt / newer schema) and return undefined. */
  private readTeamFile(file: string, id: string): Team | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(nodeFs.readFileSync(file, "utf8"));
    } catch (err) {
      this.quarantine(file, id, "corrupt", (err as Error).message);
      return undefined;
    }
    if (isObject(parsed) && typeof parsed.schemaVersion === "number" && parsed.schemaVersion > SCHEMA_VERSION) {
      this.quarantine(file, id, "future", `schemaVersion ${parsed.schemaVersion}`);
      return undefined;
    }
    if (!isTeamShape(parsed) || parsed.schemaVersion !== SCHEMA_VERSION) {
      this.quarantine(file, id, "corrupt", "unexpected shape");
      return undefined;
    }
    return parsed;
  }

  /** Classify one directory entry: temp files are removed, quarantined files are listed, `*.json` is a team id. */
  private teamIdOf(name: string): string | undefined {
    const file = path.join(this.dir, name);
    if (name.endsWith(".tmp")) {
      nodeFs.rmSync(file, { force: true });
    } else if (name.endsWith(".json.corrupt") || name.endsWith(".json.future")) {
      const reason = name.endsWith(".future") ? "future" : "corrupt";
      this.unavailableList.push({ id: name.slice(0, name.indexOf(".json")), reason, file });
    } else if (name.endsWith(".json")) {
      return name.slice(0, -".json".length);
    }
    return undefined;
  }

  /** Load every readable team; quarantine unreadable ones; prune expired closed teams. */
  load(): LoadResult {
    const result: LoadResult = { teams: [], unavailable: [] };
    this.unavailableList = [];
    let entries: string[];
    try {
      entries = nodeFs.readdirSync(this.dir);
    } catch {
      return result;
    }
    const now = this.clock.now();
    const retentionMs = this.closedRetentionDays() * DAY_MS;
    for (const name of entries.sort()) {
      const id = this.teamIdOf(name);
      if (id === undefined) continue;
      const team = this.readTeamFile(path.join(this.dir, name), id);
      if (!team) continue;
      if (team.status === "closed" && team.closedAt !== undefined && now - team.closedAt > retentionMs) {
        nodeFs.rmSync(this.teamFile(id), { force: true });
        nodeFs.rmSync(this.mailFile(id), { force: true });
        continue;
      }
      result.teams.push({ team, mail: this.loadMail(team.id) });
    }
    result.unavailable = [...this.unavailableList];
    return result;
  }

  private loadMail(teamId: string): Mail[] {
    let raw: string;
    try {
      raw = nodeFs.readFileSync(this.mailFile(teamId), "utf8");
    } catch {
      return [];
    }
    const mail = parseMailLog(raw);
    this.ioFor(teamId).logBytes = Buffer.byteLength(raw);
    if (this.ioFor(teamId).logBytes > this.maxMailLogBytes()) this.compactSync(teamId, mail);
    return mail;
  }

  /** Compact at load: synchronous, before any write is queued. */
  private compactSync(teamId: string, mail: Mail[]): void {
    const { keep, dropped } = selectCompaction(mail, this.maxMailLogBytes());
    const body = keep.map((m) => `${JSON.stringify({ t: "m", ...m })}\n`).join("");
    const file = this.mailFile(teamId);
    try {
      const tmp = `${file}.${process.pid}.tmp`;
      nodeFs.writeFileSync(tmp, body, { mode: 0o600 });
      nodeFs.renameSync(tmp, file);
      this.ioFor(teamId).logBytes = Buffer.byteLength(body);
      this.compactionCount++;
      const drop = new Set(dropped);
      mail.splice(0, mail.length, ...mail.filter((m) => !drop.has(m.id)));
    } catch (err) {
      this.logger.error(`agent-teams: load-time compaction failed for ${teamId}: ${(err as Error).message}`);
    }
  }
}
