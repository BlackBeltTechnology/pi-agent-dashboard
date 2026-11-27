/**
 * Lead-side host of in-process teammates (design D3/D5/D6/D10; tasks 3.5, 5.3–5.16). The lead bridge is the ONLY caller of the
 * subagents bus API: it executes the server's `agent-teams:inproc` commands, answers on `agent-teams/inproc`, observes the
 * `subagents:*` events of its children and reports their lifecycle through a durable outbox.
 *
 * - COMMANDS (`spawn|steer|interrupt|stop|snapshot`): the per-activation `commandSecret` is checked first (a wrong or missing
 *   one is ignored and counted `inproc_bad_command`), the shape is rebuilt strictly (`inproc-command.ts`), a repeated `cmdId`
 *   replays the stored ack (a result that must be RETRIED — `not_started`, `no_context`, an empty reply — and every `snapshot`
 *   are never stored), a repeat while the first is still pending JOINS it (one upstream call, equal acks).
 * - REGISTRY: member ↔ child (`childId`/`agentId`), the run counters (`run`, `lastIdleRun` — from `idle {run}` only, never
 *   counted from `started`, which upstream also emits as progress), the bounded `deliveredMailIds` ledger (200, FIFO), the
 *   queued-steer record `steerAckRun = lastIdleRun + 1` and its `nudgedRun` guard.
 * - MAPPER: `completed|failed` and `idle` of one run arrive in the same tick; the decision (idle report vs. gone) is taken in a
 *   microtask AFTER the tick. `started` is a transition only from `spawning`/`idle`. Events for ids outside the registry are
 *   ignored silently; malformed ones and unknown `disposed.reason`/`stoppedBy` values are counted `inproc_unknown_event`.
 * - OUTBOX: reports flush in order after every accepted `inproc hello`; the hello also carries the member snapshot.
 * - PROBE: `subagents:capabilities` at `session_start`, on the first `subagents:*` event while unavailable and after any
 *   empty reply, each reported as an `inproc hello`.
 * No pi import: the bus, the lane sender and the clock are injected. Logs carry ids and sizes only.
 * See change: add-agent-teams-in-process.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { MAIL_KIND_PLAN_DECISION } from "../shared/approval-mail.js";
import type { Clock } from "../shared/clock.js";
import {
  type InProcAck,
  type InProcAvailabilityReport,
  type InProcCommand,
  type InProcEvent,
  type InProcSnapshot,
  type InProcSnapshotMember,
  NUDGE_TEXT,
  type SpawnCommand,
  type SteerCommand,
} from "../shared/inproc-protocol.js";
import { parseEnvelope } from "../shared/mail-format.js";
import { AGENT_TEAMS_EVENT_INPROC } from "../shared/plugin-id.js";
import {
  type CapabilityVerdict,
  type InterruptRequest,
  type InterruptResult,
  type SpawnFailReason,
  type SpawnOut,
  type SpawnRequest,
  type SteerRequest,
  type SteerResult,
  SUBAGENTS_CHANNEL,
  type SubagentsFeature,
} from "../shared/subagents-contract.js";
import { createCapabilityProber } from "./inproc-capabilities.js";
import { buildSpawnRequest, type ChildIdentity, cmdIdOf, parseCommand } from "./inproc-command.js";
import { createOutbox, type Outbox, type ReportResult } from "./inproc-outbox.js";
import { type CwdDeps, checkPromptFiles, checkSkills, decideCwd, type ReadFileFn } from "./inproc-spawn-checks.js";
import { cutFinalText } from "./inproc-text.js";

export type { ReportResult } from "./inproc-outbox.js";

/** The slice of `pi.events` the host uses. */
interface HostBus {
  on(channel: string, fn: (payload: unknown) => void): unknown;
  emit(channel: string, payload: unknown): void;
}

export interface InProcHostDeps {
  bus: HostBus;
  clock: Clock;
  /** One request on the lane type `agent-teams/inproc` (never rejects: a transport failure is `{ok:false, transport:true}`). */
  send(payload: Record<string, unknown>): Promise<ReportResult>;
  /** Builds the inline team extension of one child (task 6.2); absent ⇒ the spawn request carries no `extensionFactories`. */
  childExtension?: (identity: ChildIdentity) => unknown;
  /** A `plan_decision` mail was handed to the child of `member`: its proxied `hello` is refreshed (task 6.5). */
  onPlanDecision?: (member: string) => void;
  /** The lead's cwd: the reference of the package's `cwdScope:"repo"` (task 6.8). Absent ⇒ the cwd rule is not applied host-side. */
  leadCwd?: () => string | undefined;
  /** Test seams of the spawn admission (prompt file reads, git/fs probes of the cwd rule). */
  readFile?: ReadFileFn;
  cwdDeps?: CwdDeps;
  log?: (message: string) => void;
  /** Test seams. */
  newIncarnation?: () => string;
  newSecret?: () => string;
}

export interface InProcHost {
  readonly incarnation: string;
  readonly commandSecret: string;
  /** Counter inventory of this activation (`inproc_*`). */
  counters(): Readonly<Record<string, number>>;
  /** `session_start`: probe the subagents extension and send the `inproc hello`. */
  onSessionStart(): void;
  /** The lane came back up: send the hello (and so flush the outbox) again. */
  onReconnect(): void;
  /** The current registry as the `snapshot` carries it. */
  snapshot(): InProcSnapshot;
  readonly outbox: Outbox;
  dispose(): void;
}

/** What an ack carries besides `op` and `cmdId`. */
type AckBody = Omit<InProcAck, "op" | "cmdId">;

/** A command's result plus the work that must run only AFTER its ack was sent (the reports of a fresh child follow the spawn ack). */
interface Outcome {
  body: AckBody;
  after?: () => void;
}

/** Results that must stay executable on a repeat of the same `cmdId` (never stored for replay). */
const RETRYABLE_ERRORS = new Set(["no_context", "not_started", "subagents_extension_missing", "delivery_timeout"]);
const REPLAY_MAP_MAX = 1000;
const LEDGER_MAX = 200;
/** A steer / stop that nobody answers frees its in-flight slot after this long (the server timed out long before). */
const STEER_WAIT_MS = 125_000;
const STOP_CONFIRM_MS = 125_000;
const HELLO_RETRIES = 20;

const SPAWN_ERROR_CODES: Record<SpawnFailReason, string> = {
  no_context: "no_context",
  cap: "team_full",
  cwd_not_found: "cwd_outside_scope",
  cwd_not_dir: "cwd_outside_scope",
  cwd_out_of_scope: "cwd_outside_scope",
  vetoed: "spawn_vetoed",
  unsupported: "subagents_extension_outdated",
  invalid: "invalid_args",
};

const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const isThenable = (v: unknown): v is PromiseLike<unknown> => v !== null && typeof v === "object" && typeof (v as { then?: unknown }).then === "function";
const failure = (error: string, message?: string): AckBody => ({ ok: false, error, ...(message ? { message } : {}) });
const clip = (s: string): string => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

type RunState = "spawning" | "busy" | "idle" | "gone";

interface MemberRec {
  member: string;
  teamId: string;
  childId: string;
  agentId: string;
  state: RunState;
  /** Current run number: `lastIdleRun + 1` while the child runs. */
  run: number;
  lastIdleRun: number;
  delivered: number[];
  steerAckRun?: number;
  nudgedRun?: number;
  /** Events of the tick being decided. */
  tick?: { completed?: { result?: string; stopped: boolean; stoppedBy?: string }; failed?: { error?: string; stopped: boolean; stoppedBy?: string }; idle?: { run: number; aborted: boolean } };
}

interface ParsedEvent {
  agentId: string;
  run?: number;
  result?: string;
  error?: string;
  aborted?: boolean;
  status?: string;
  stoppedBy?: string;
  reason?: string;
}

/** Line 0 of a framed block is the runtime-authored envelope header (peer text is quoted): its kind says whether this is a plan decision. */
const isPlanDecisionBlock = (block: string): boolean => parseEnvelope(block)?.kind === MAIL_KIND_PLAN_DECISION;

const poisoned = (o: Record<string, unknown>): boolean => Object.hasOwn(o, "__proto__") || Object.hasOwn(o, "constructor");

/** An optional field of `kind`: `undefined` when absent, `null` when present with the wrong type. */
function field(o: Record<string, unknown>, key: string, kind: "string" | "boolean" | "count"): string | boolean | number | undefined | null {
  const v = own(o, key);
  if (v === undefined) return undefined;
  if (kind === "string") return typeof v === "string" ? v : null;
  if (kind === "boolean") return typeof v === "boolean" ? v : null;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Strict read of one `subagents:*` payload (version drift guard); `undefined` = malformed. */
function readEvent(payload: unknown): ParsedEvent | undefined {
  if (!isRec(payload) || poisoned(payload)) return undefined;
  const agentId = own(payload, "agentId");
  if (typeof agentId !== "string" || agentId.length === 0 || agentId.length > 200) return undefined;
  const run = field(payload, "run", "count");
  const result = field(payload, "result", "string");
  const error = field(payload, "error", "string");
  const reason = field(payload, "reason", "string");
  const aborted = field(payload, "aborted", "boolean");
  const detailsRaw = own(payload, "details");
  if (detailsRaw !== undefined && !isRec(detailsRaw)) return undefined;
  const status = detailsRaw ? field(detailsRaw, "status", "string") : undefined;
  const stoppedBy = detailsRaw ? field(detailsRaw, "stoppedBy", "string") : undefined;
  if ([run, result, error, reason, aborted, status, stoppedBy].includes(null as never)) return undefined;
  const out: Record<string, unknown> = { agentId };
  for (const [key, value] of Object.entries({ run, result, error, reason, aborted, status, stoppedBy })) if (value !== undefined) out[key] = value;
  return out as unknown as ParsedEvent;
}

const STOPPED_STATUSES = ["stopped", "aborted"];
const KNOWN_STOPPED_BY = ["timeout", "user", "dock", "queue-removal"];

/** `gone` reason of a stopped run (`undefined` stoppedBy ⇒ `stopped`, an unknown value ⇒ `stopped` and `unknown:true`). */
function stoppedReason(stoppedBy: string | undefined): { reason: string; unknown: boolean } {
  if (stoppedBy === undefined || stoppedBy === "") return { reason: "stopped", unknown: false };
  if (stoppedBy === "timeout") return { reason: "timeout", unknown: false };
  return { reason: "stopped", unknown: !KNOWN_STOPPED_BY.includes(stoppedBy) };
}

/** `gone` reason of a `disposed` event. */
function disposedReason(reason: string | undefined): { reason: string; unknown: boolean } {
  switch (reason) {
    case "ttl":
    case "cap":
      return { reason: "idle_disposed", unknown: false };
    case "cancel":
      return { reason: "stopped", unknown: false };
    case "shutdown":
      return { reason: "lead_ended", unknown: false };
    case undefined:
    case "":
      return { reason: "stopped", unknown: false };
    default:
      return { reason: "stopped", unknown: true };
  }
}

function reportOf(verdict: CapabilityVerdict): InProcAvailabilityReport {
  return verdict.available
    ? { available: true, apiVersion: verdict.apiVersion, features: [...verdict.features], limits: { ...verdict.limits } }
    : { available: false, reason: verdict.reason, ...(verdict.missing.length > 0 ? { missing: [...verdict.missing] } : {}) };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type SpawnVerdict = { fail: AckBody } | { id: string; agentId: string; queued: boolean; queuePosition?: number };

/** The upstream `subagents:spawn` reply as a stable ack error or the child it names (a malformed `ok:true` is never a child). */
function mapSpawnReply(out: unknown): SpawnVerdict {
  if (!isRec(out) || typeof out.ok !== "boolean") return { fail: failure("subagents_extension_outdated", "malformed spawn reply") };
  if (out.ok === false) {
    const code = SPAWN_ERROR_CODES[(out as { reason: SpawnFailReason }).reason];
    return { fail: failure(code ?? "subagents_extension_outdated", code === undefined ? "unknown spawn failure reason" : undefined) };
  }
  const { id, agentId, status, queuePosition } = out as Extract<SpawnOut, { ok: true }>;
  if (typeof id !== "string" || id === "" || typeof agentId !== "string" || agentId === "") return { fail: failure("subagents_extension_outdated", "spawn reply without child ids") };
  const queued = status === "queued";
  return { id, agentId, queued, ...(queued && typeof queuePosition === "number" && Number.isInteger(queuePosition) && queuePosition >= 1 ? { queuePosition } : {}) };
}

export function createInProcHost(deps: InProcHostDeps): InProcHost {
  const { bus, clock } = deps;
  const log = deps.log ?? (() => undefined);
  const incarnation = (deps.newIncarnation ?? (() => randomUUID()))();
  const commandSecret = (deps.newSecret ?? (() => randomBytes(24).toString("hex")))();
  const counts: Record<string, number> = {};
  const count = (name: string): void => void (counts[name] = (counts[name] ?? 0) + 1);

  const registry = new Map<string, MemberRec>();
  const byAgent = new Map<string, MemberRec>();
  const results = new Map<string, AckBody>();
  const inflight = new Map<string, Promise<AckBody>>();
  const stopWaiters = new Map<string, Array<() => void>>();
  /** Events of a `subagents:spawn` emit: the child exists upstream before the reply names it. */
  let capture: Array<[string, unknown]> | undefined;
  let disposed = false;
  let helloOk = false;
  let helloInFlight = false;
  let helloTimer: unknown;
  const offs: unknown[] = [];

  // ── outbox + hello ──────────────────────────────────────────────────────────────────────────

  const outbox = createOutbox({
    send: (report) => deps.send({ ...report }),
    onOverflow: (r) => {
      count("inproc_outbox_overflow");
      log(`agent-teams: inproc outbox overflow member=${r.member} run=${r.run} kind=${r.kind}`);
    },
    onDeadLetter: (r, error) => {
      count("inproc_dead_letter");
      log(`agent-teams: inproc report dead-lettered member=${r.member} run=${r.run} kind=${r.kind} error=${error ?? "unknown"}`);
    },
  });

  function flushOutbox(): void {
    if (!helloOk || disposed) return;
    void outbox.flush().then(() => {
      if (outbox.size > 0) helloOk = false; // a transport failure: wait for the next hello
    });
  }

  function report(kind: InProcEvent["kind"], rec: MemberRec, extra: Partial<InProcEvent> = {}, run: number = rec.run): void {
    outbox.push({ op: "event", member: rec.member, run, kind, ...extra });
    flushOutbox();
  }

  function snapshotMember(rec: MemberRec, state: Exclude<RunState, "gone">): InProcSnapshotMember {
    const unacked = outbox.unackedSettle(rec.member);
    return {
      member: rec.member,
      childId: rec.childId,
      agentId: rec.agentId,
      state,
      run: rec.run,
      lastIdleRun: rec.lastIdleRun,
      deliveredMailIds: [...rec.delivered],
      ...(unacked ? { unackedSettle: { run: unacked.run, ...(unacked.finalText !== undefined ? { finalText: unacked.finalText } : {}), ...(unacked.error !== undefined ? { error: unacked.error } : {}), ...(unacked.aborted ? { aborted: true } : {}) } } : {}),
    };
  }

  function snapshot(): InProcSnapshot {
    const members: InProcSnapshotMember[] = [];
    for (const rec of registry.values()) if (rec.state !== "gone") members.push(snapshotMember(rec, rec.state));
    return { members };
  }

  const prober = createCapabilityProber({
    bus,
    clock,
    report: () => void sendHello(0),
  });

  async function sendHello(attempt: number): Promise<void> {
    if (disposed || helloInFlight) return;
    const verdict = prober.verdict;
    if (!verdict) return;
    helloInFlight = true;
    helloOk = false;
    let res: ReportResult;
    try {
      res = await deps.send({ op: "hello", incarnation, commandSecret, inProcess: reportOf(verdict), snapshot: snapshot() });
    } catch {
      res = { ok: false, transport: true };
    } finally {
      helloInFlight = false;
    }
    if (disposed) return;
    if (res.ok) {
      helloOk = true;
      flushOutbox();
      return;
    }
    if (res.transport && attempt < HELLO_RETRIES) {
      helloTimer = clock.setTimeout(() => void sendHello(attempt + 1), Math.min(5000, 250 * 1.5 ** attempt));
    }
  }

  // ── acks ────────────────────────────────────────────────────────────────────────────────────

  function sendAck(cmdId: string, body: AckBody): void {
    if (disposed) return;
    void deps.send({ op: "ack", cmdId, ...body }).catch(() => undefined);
  }

  // ── registry / mapper ───────────────────────────────────────────────────────────────────────

  function resolveStopWaiters(agentId: string): void {
    for (const fn of stopWaiters.get(agentId) ?? []) fn();
    stopWaiters.delete(agentId);
  }

  function markGone(rec: MemberRec, reason: string): void {
    if (rec.state === "gone") return;
    rec.state = "gone";
    rec.tick = undefined;
    report("gone", rec, { reason });
    resolveStopWaiters(rec.agentId);
  }

  const ledgerHas = (rec: MemberRec, id: number): boolean => rec.delivered.includes(id);
  function ledgerAdd(rec: MemberRec, ids: readonly number[]): void {
    for (const id of ids) {
      if (rec.delivered.includes(id)) continue;
      rec.delivered.push(id);
      if (rec.delivered.length > LEDGER_MAX) rec.delivered.shift();
    }
  }

  /** The settle of a run that ended with `idle`: its text or error, never both attached blindly. */
  function reportIdle(rec: MemberRec, t: NonNullable<MemberRec["tick"]>, idle: { run: number; aborted: boolean }): void {
    const text = t.completed?.result;
    const hasText = text !== undefined && text.trim() !== "";
    const error = t.failed ? (t.failed.error ?? "the run failed") : text !== undefined && !hasText && !idle.aborted ? "subagent produced no final output" : undefined;
    report("idle", rec, { ...(hasText ? { finalText: cutFinalText(text) } : {}), ...(error !== undefined ? { error: cutFinalText(error) } : {}), ...(idle.aborted ? { aborted: true } : {}) }, idle.run);
  }

  /** A run that ended with no `idle`: a stop (reason by `stoppedBy`), a plain failure, or drift. */
  function reportEnded(rec: MemberRec, t: NonNullable<MemberRec["tick"]>): void {
    const stoppedEv = t.completed?.stopped ? t.completed : t.failed?.stopped ? t.failed : undefined;
    if (stoppedEv) {
      const r = stoppedReason(stoppedEv.stoppedBy);
      if (r.unknown) count("inproc_unknown_event");
      markGone(rec, r.reason);
    } else if (t.failed) {
      markGone(rec, "child_failed");
    } else {
      count("inproc_unknown_event"); // a `completed` with neither `idle` nor a stop: the same-tick guarantee drifted
      log(`agent-teams: inproc completed without idle member=${rec.member}`);
    }
  }

  /** The decision of one tick: an `idle` report, or `gone` for a stopped/failed run that was not followed by `idle`. */
  function decide(rec: MemberRec): void {
    const t = rec.tick;
    rec.tick = undefined;
    if (!t || rec.state === "gone") return;
    if (t.idle) reportIdle(rec, t, t.idle);
    else reportEnded(rec, t);
  }

  function scheduleDecision(rec: MemberRec): void {
    queueMicrotask(() => {
      try {
        decide(rec);
      } catch (err) {
        log(`agent-teams: inproc mapper failed member=${rec.member}: ${(err as Error).name}`);
      }
    });
  }

  function onStarted(rec: MemberRec): void {
    if (rec.tick) decide(rec); // a settle of the previous run is reported BEFORE the next run's start, whatever the tick boundaries
    if ((rec.state as RunState) === "gone") return; // the decision above may have ended the member
    if (rec.state !== "spawning" && rec.state !== "idle") return; // while busy: a progress emission, ignored
    rec.state = "busy";
    rec.run = rec.lastIdleRun + 1;
    rec.steerAckRun = undefined; // the next run drained any queued steer: a mail is final now
    report("started", rec);
  }

  function onIdle(rec: MemberRec, ev: ParsedEvent): void {
    if (ev.run === undefined) {
      count("inproc_unknown_event");
      return;
    }
    if (ev.run <= rec.lastIdleRun) return; // duplicate or older run
    rec.lastIdleRun = ev.run;
    rec.run = ev.run;
    rec.state = "idle";
    rec.tick = { ...rec.tick, idle: { run: ev.run, aborted: ev.aborted === true } };
    scheduleDecision(rec);
  }

  function onDisposed(rec: MemberRec, ev: ParsedEvent): void {
    const r = disposedReason(ev.reason);
    if (r.unknown) count("inproc_unknown_event");
    markGone(rec, r.reason);
  }

  /** `completed` / `failed` of one run: remembered for the decision after the tick. */
  function onRunEnd(rec: MemberRec, key: "completed" | "failed", ev: ParsedEvent): void {
    const end = { ...(key === "completed" ? (ev.result !== undefined ? { result: ev.result } : {}) : ev.error !== undefined ? { error: ev.error } : {}), stopped: isStoppedEvent(ev), ...(ev.stoppedBy !== undefined ? { stoppedBy: ev.stoppedBy } : {}) };
    rec.tick = { ...rec.tick, [key]: end };
    scheduleDecision(rec);
  }

  /** An event for an id outside the registry (the lead's own subagents) is silent; a pending `stop` of an untracked id is still confirmed. */
  function onForeignEvent(channel: string, ev: ParsedEvent): void {
    if (channel === SUBAGENTS_CHANNEL.disposed || (channel === SUBAGENTS_CHANNEL.completed && isStoppedEvent(ev))) resolveStopWaiters(ev.agentId);
  }

  const childHandlers: Record<string, (rec: MemberRec, ev: ParsedEvent) => void> = {
    [SUBAGENTS_CHANNEL.started]: (rec) => onStarted(rec),
    [SUBAGENTS_CHANNEL.completed]: (rec, ev) => onRunEnd(rec, "completed", ev),
    [SUBAGENTS_CHANNEL.failed]: (rec, ev) => onRunEnd(rec, "failed", ev),
    [SUBAGENTS_CHANNEL.idle]: onIdle,
    [SUBAGENTS_CHANNEL.disposed]: onDisposed,
    // `created` and friends carry nothing the mapper needs
  };

  function onChildEvent(channel: string, payload: unknown): void {
    const ev = readEvent(payload);
    if (!ev) {
      count("inproc_unknown_event");
      return;
    }
    const rec = byAgent.get(ev.agentId);
    if (!rec) onForeignEvent(channel, ev);
    else if (rec.state !== "gone") childHandlers[channel]?.(rec, ev); // a gone member is never resurrected
  }

  function isStoppedEvent(ev: ParsedEvent): boolean {
    return ev.status !== undefined && STOPPED_STATUSES.includes(ev.status);
  }

  function onSubagentsEvent(channel: string, payload: unknown): void {
    if (disposed) return;
    prober.onSubagentsEvent();
    if (capture) {
      capture.push([channel, payload]);
      return;
    }
    try {
      onChildEvent(channel, payload);
    } catch (err) {
      log(`agent-teams: inproc event mapping failed channel=${channel}: ${(err as Error).name}`);
    }
  }

  // ── command execution ───────────────────────────────────────────────────────────────────────

  const featuresOf = (): readonly SubagentsFeature[] => {
    const v = prober.verdict;
    return v?.available ? v.features : [];
  };

  async function withDeadline<T>(p: PromiseLike<T>, ms: number): Promise<T | "deadline"> {
    return new Promise<T | "deadline">((resolve) => {
      const timer = clock.setTimeout(() => resolve("deadline"), ms);
      p.then(
        (v) => {
          clock.clearTimeout(timer);
          resolve(v);
        },
        () => {
          clock.clearTimeout(timer);
          resolve("deadline");
        },
      );
    });
  }

  /** Emit `subagents:spawn`, resolving a Promise reply; `"threw"` when the emit itself failed. */
  async function requestSpawn(query: SpawnRequest): Promise<unknown> {
    try {
      bus.emit(SUBAGENTS_CHANNEL.spawn, query);
    } catch {
      return "threw";
    }
    return isThenable(query.out) ? await query.out : query.out;
  }

  /** A child the upstream accepted: registered (a respawn starts from a clean outbox). */
  function registerChild(cmd: SpawnCommand, child: { id: string; agentId: string }): MemberRec {
    const rec: MemberRec = { member: cmd.member, teamId: cmd.teamId, childId: child.id, agentId: child.agentId, state: "spawning", run: 1, lastIdleRun: 0, delivered: [] };
    registry.set(rec.member, rec);
    byAgent.set(rec.agentId, rec);
    outbox.forget(rec.member);
    count("inproc_spawns");
    return rec;
  }

  /** The spawn reply as the command's outcome: a failure ack, or the registered child (its first events follow the ack). */
  function acceptSpawnReply(cmd: SpawnCommand, out: unknown, captured: Array<[string, unknown]>): Outcome {
    if (out === "threw") return { body: failure("host_error", "the spawn request threw") };
    if (out === undefined) {
      prober.onEmptyReply();
      return { body: failure("subagents_extension_missing", "no subagents extension answered the spawn request") };
    }
    const verdict = mapSpawnReply(out);
    if ("fail" in verdict) return { body: verdict.fail };
    const rec = registerChild(cmd, verdict);
    return {
      body: { ok: true, childId: rec.childId, agentId: rec.agentId, status: verdict.queued ? "queued" : "running", ...(verdict.queuePosition !== undefined ? { queuePosition: verdict.queuePosition } : {}) },
      // The child's first events fired inside the request, before the reply named it: they follow the ack.
      after: () => {
        if (byAgent.get(rec.agentId) === rec) for (const [channel, payload] of captured) onSubagentsEvent(channel, payload);
      },
    };
  }

  /** Skills, prompt files and the cwd rule (tasks 6.7, 6.8, 6.10) before anything reaches the upstream; a refusal creates no child. */
  async function admitSpawn(cmd: SpawnCommand): Promise<{ fail: AckBody } | { cmd: SpawnCommand }> {
    const features = featuresOf();
    const refused = checkSkills(cmd.spec, features) ?? (await checkPromptFiles(cmd.spec.promptFiles, deps.readFile));
    if (refused) return { fail: failure(refused.error, refused.message) };
    const leadCwd = deps.leadCwd?.();
    if (leadCwd === undefined) return { cmd };
    const verdict = prober.verdict;
    const decision = await decideCwd(leadCwd, cmd.spec.cwd, { features, ...(verdict?.available && verdict.limits.cwdScope ? { globalScope: verdict.limits.cwdScope } : {}) }, deps.cwdDeps);
    if (decision.refusal) return { fail: failure(decision.refusal.error, decision.refusal.message) };
    const { cwdScope: _fromCommand, ...spec } = cmd.spec;
    return { cmd: { ...cmd, spec: { ...spec, ...(decision.cwdScope ? { cwdScope: decision.cwdScope } : {}) } } };
  }

  async function doSpawn(raw: SpawnCommand): Promise<Outcome> {
    const existing = registry.get(raw.member);
    if (existing && existing.state !== "gone") return { body: failure("name_taken", "a child of this member is still alive") };
    const admitted = await admitSpawn(raw);
    if ("fail" in admitted) return { body: admitted.fail };
    const cmd = admitted.cmd;
    const childExt = deps.childExtension?.({ teamId: cmd.teamId, member: cmd.member, ...(cmd.role ? { role: cmd.role } : {}), token: cmd.proxyToken, env: cmd.spec.env });
    const captured: Array<[string, unknown]> = [];
    capture = captured;
    try {
      return acceptSpawnReply(cmd, await requestSpawn({ request: buildSpawnRequest(cmd, featuresOf(), childExt) }), captured);
    } finally {
      capture = undefined;
    }
  }

  const stateReport = (rec: MemberRec): void => report("state", rec, { state: rec.state === "busy" ? "busy" : "idle" });

  /** What to send for a steer: the message and the ids it hands over, or an ack that settles the command without an upstream call. */
  function planSteer(rec: MemberRec, cmd: SteerCommand): { message: string; handed: number[]; planDecision: boolean } | { ack: AckBody } {
    if (cmd.nudge) {
      // A nudge is exempt from the ledger drop but runs at most once per recorded run, and only while that run is parked idle.
      if (rec.steerAckRun === undefined || rec.nudgedRun === rec.steerAckRun || rec.state !== "idle") return { ack: { ok: true, result: "duplicate" } };
      rec.nudgedRun = rec.steerAckRun;
      count("inproc_nudges");
      return { message: NUDGE_TEXT, handed: [], planDecision: false };
    }
    const ids = cmd.mailIds;
    const blocks = cmd.blocks ?? [];
    const keep = ids.map((_, i) => i).filter((i) => !ledgerHas(rec, ids[i] as number));
    if (keep.length === 0) {
      stateReport(rec);
      return { ack: { ok: true, result: "duplicate" } };
    }
    const kept = keep.map((i) => blocks[i] as string);
    return { message: kept.join("\n\n"), handed: keep.map((i) => ids[i] as number), planDecision: kept.some(isPlanDecisionBlock) };
  }

  /** The ack of a finished steer request (handed over ⇒ the ids enter the ledger). */
  function steerAck(rec: MemberRec, cmd: SteerCommand, result: SteerResult, handed: number[]): AckBody {
    switch (result) {
      case "started":
        ledgerAdd(rec, handed);
        return { ok: true, result: "started" };
      case "queued": {
        ledgerAdd(rec, handed);
        // The queued message belongs to the run that is current NOW: read from the registry, never counted from events.
        const run = rec.lastIdleRun + 1;
        if (!cmd.nudge) rec.steerAckRun = run;
        return { ok: true, result: "queued", run };
      }
      case "not_started":
        return failure("not_started");
      case "not_alive":
      case "not_found":
        markGone(rec, "not_alive");
        return failure("not_alive");
      default:
        return failure("steer_failed", "unknown steer result");
    }
  }

  async function doSteer(cmd: SteerCommand): Promise<AckBody> {
    const rec = registry.get(cmd.member);
    if (!rec) return failure("unknown_member");
    if (rec.state === "gone") return failure("not_alive");
    const plan = planSteer(rec, cmd);
    if ("ack" in plan) return plan.ack;
    const req: SteerRequest = { id: rec.childId, message: plan.message, mode: "steer" };
    try {
      bus.emit(SUBAGENTS_CHANNEL.steerRequest, req);
    } catch {
      return failure("host_error", "the steer request threw");
    }
    if (req.out === undefined) {
      count("inproc_delivery_timeout");
      prober.onEmptyReply();
      return failure("subagents_extension_missing", "no subagents extension answered the steer request");
    }
    const result = await withDeadline<SteerResult>(req.out, STEER_WAIT_MS);
    if (result === "deadline") return failure("steer_failed", "no usable steer result");
    const ack = steerAck(rec, cmd, result, plan.handed);
    // A `plan_decision` mail changes what the child may do: its proxied hello is refreshed from the mail KIND (the runtime header), never from child text.
    if (ack.ok && plan.planDecision) deps.onPlanDecision?.(rec.member);
    return ack;
  }

  async function doInterrupt(cmd: { member: string }): Promise<AckBody> {
    const rec = registry.get(cmd.member);
    if (!rec) return failure("unknown_member");
    if (rec.state === "gone") return failure("not_alive");
    if (!featuresOf().includes("interrupt")) return failure("interrupt_unavailable");
    if (rec.state !== "busy") return { ok: true, result: "not_busy" };
    const req: InterruptRequest = { id: rec.childId };
    try {
      bus.emit(SUBAGENTS_CHANNEL.interruptRequest, req);
    } catch {
      return failure("host_error", "the interrupt request threw");
    }
    if (req.out === undefined) {
      prober.onEmptyReply();
      return failure("subagents_extension_missing", "no subagents extension answered the interrupt request");
    }
    const result = await withDeadline<InterruptResult>(req.out, STEER_WAIT_MS);
    switch (result) {
      case "interrupted":
        return { ok: true, result: "interrupted" };
      case "not_running":
        return { ok: true, result: "not_running" }; // the run ended on its own: not an error
      case "not_alive":
      case "not_found":
        return failure("not_alive");
      default:
        return failure("interrupt_failed", "no usable interrupt result");
    }
  }

  async function doStop(cmd: { member: string; agentId?: string }): Promise<AckBody> {
    const rec = registry.get(cmd.member);
    const agentId = cmd.agentId ?? rec?.agentId;
    if (!agentId) return failure("unknown_member");
    if (rec?.state === "gone") return { ok: true };
    const confirmed = new Promise<void>((resolve) => stopWaiters.set(agentId, [...(stopWaiters.get(agentId) ?? []), resolve]));
    try {
      bus.emit(SUBAGENTS_CHANNEL.stop, { agentId });
    } catch {
      return failure("host_error", "the stop request threw");
    }
    const res = await withDeadline(confirmed, STOP_CONFIRM_MS);
    if (res === "deadline") {
      stopWaiters.delete(agentId);
      return failure("not_found", "no event confirmed the stop");
    }
    return { ok: true };
  }

  async function execute(cmd: InProcCommand): Promise<Outcome> {
    switch (cmd.cmd) {
      case "spawn":
        return doSpawn(cmd);
      case "steer":
        return { body: await doSteer(cmd) };
      case "interrupt":
        return { body: await doInterrupt(cmd) };
      case "stop":
        return { body: await doStop(cmd) };
      case "snapshot":
        return { body: { ok: true, snapshot: snapshot() } };
    }
  }

  function remember(cmdId: string, body: AckBody): void {
    results.set(cmdId, body);
    if (results.size > REPLAY_MAP_MAX) results.delete(results.keys().next().value as string);
  }

  /** The secret and `cmdId` checks of one bus payload; `undefined` ⇒ ignored (counted), nothing is acknowledged to a forger. */
  function authenticate(raw: unknown): { payload: Record<string, unknown>; cmdId: string; secret: string } | undefined {
    if (!isRec(raw)) {
      count("inproc_bad_command");
      return undefined;
    }
    const secret = own(raw, "secret");
    if (typeof secret !== "string" || !safeEqual(secret, commandSecret)) {
      count("inproc_bad_command");
      log("agent-teams: inproc command ignored: wrong or missing secret");
      return undefined;
    }
    const cmdId = cmdIdOf(raw);
    if (cmdId === undefined) {
      count("inproc_invalid_command");
      log("agent-teams: inproc command ignored: unusable cmdId");
      return undefined;
    }
    return { payload: raw, cmdId, secret };
  }

  function run(cmdId: string, cmd: InProcCommand): void {
    const outcome = execute(cmd).catch((err: Error): Outcome => {
      log(`agent-teams: inproc command failed id=${clip(cmdId)} cmd=${cmd.cmd}: ${err.name}`);
      return { body: failure("host_error", "the command failed") };
    });
    inflight.set(cmdId, outcome.then((o) => o.body));
    void outcome.then(({ body, after }) => {
      inflight.delete(cmdId);
      if (cmd.cmd !== "snapshot" && !(body.ok === false && RETRYABLE_ERRORS.has(body.error ?? ""))) remember(cmdId, body);
      log(`agent-teams: inproc cmd=${cmd.cmd} id=${clip(cmdId)} ok=${body.ok}${body.error ? ` error=${body.error}` : ""}`);
      sendAck(cmdId, body);
      after?.();
    });
  }

  function onCommand(raw: unknown): void {
    if (disposed) return;
    const auth = authenticate(raw);
    if (!auth) return;
    const { payload, cmdId, secret } = auth;
    const stored = results.get(cmdId);
    if (stored) {
      sendAck(cmdId, stored); // a repeat: the stored ack, byte-identical
      return;
    }
    const pending = inflight.get(cmdId);
    if (pending) {
      void pending.then((body) => sendAck(cmdId, body)); // a repeat while the first runs: join it
      return;
    }
    const parsed = parseCommand(payload, cmdId, secret);
    if (parsed.ok) {
      run(cmdId, parsed.cmd);
      return;
    }
    count("inproc_invalid_command");
    log(`agent-teams: inproc command rejected id=${clip(cmdId)} field=${parsed.field}`);
    sendAck(cmdId, failure("invalid_args", `invalid ${parsed.field}`));
  }

  // ── wiring ──────────────────────────────────────────────────────────────────────────────────

  offs.push(bus.on(AGENT_TEAMS_EVENT_INPROC, onCommand));
  for (const channel of [SUBAGENTS_CHANNEL.created, SUBAGENTS_CHANNEL.started, SUBAGENTS_CHANNEL.completed, SUBAGENTS_CHANNEL.failed, SUBAGENTS_CHANNEL.idle, SUBAGENTS_CHANNEL.disposed, SUBAGENTS_CHANNEL.slot]) {
    offs.push(bus.on(channel, (payload) => onSubagentsEvent(channel, payload)));
  }

  return {
    incarnation,
    commandSecret,
    counters: () => ({ ...counts }),
    onSessionStart() {
      void prober.probe("session_start");
    },
    onReconnect() {
      helloOk = false;
      if (prober.verdict) void sendHello(0);
      else void prober.probe("session_start");
    },
    snapshot,
    outbox,
    dispose() {
      disposed = true;
      if (helloTimer !== undefined) clock.clearTimeout(helloTimer);
      for (const off of offs) if (typeof off === "function") (off as () => void)();
      prober.dispose();
      registry.clear();
      byAgent.clear();
      inflight.clear();
      stopWaiters.clear();
    },
  };
}
