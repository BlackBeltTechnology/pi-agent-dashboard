/**
 * In-process `MemberDriver` (design D3/D4/D6): teammates are background children of the LEAD, hosted by the
 * lead's bridge through the `agent-teams:inproc` command channel. This driver never calls `spawnSession`,
 * `abortSession` or `shutdownSession`; its ONLY host call is the command emit.
 *
 * Command channel (server side):
 * - every command has a `cmdId` and the per-activation `secret` the bridge announced in its hello;
 * - commands queue until the lead is connected AND its `inproc hello` reported availability (re-flushed in issue
 *   order after every hello); ONE command per member is outstanding, the next waits behind its ack (decision B100);
 * - an emit the host refuses while the lead is connected and announced is `emit_refused` at once (no wait);
 * - an unacknowledged command fails `delivery_timeout` after `inProcessCmdTimeoutMs`; a timed-out `spawn` sends
 *   `stop` for its member, and a LATE ok-ack of a timed-out spawn stops the orphan child it created;
 * - the queue is bounded (1 000 entries / 8 MiB, oldest first, `inproc_queue_overflow`).
 * `spawn` mints the member's `proxyToken` (persisted, sent only in the spawn command, rotated per spawn), takes the
 * child's prompt from the member's `spawn_prompt` mail and the rest from the same `ResolvedSpawnSpec` a session member
 * gets. A spawn the lead could not answer yet with `no_context` waits for the lead's next `inproc hello` (its
 * `session_start` re-probe) and is re-sent with the SAME `cmdId` until `spawnTimeoutMs` (counted from the first emit) ends it as
 * `spawn_timeout`. A spawn that timed out is only released after `stop` + a `snapshot` showed no child, so the name is not
 * reusable while an orphan may run.
 * `deliver` frames every mail as its own block (`inproc-mail.ts`) and sends ONE `steer` command per delivery, addressed by
 * `(member, mail ids)` so a retry hits the host's replay map; the mails are acked in the store only when the host reports them
 * handed over (`started|queued|duplicate`), a `queued` result records `Member.steerAckRun`, and any other outcome leaves them
 * queued (un-handed for the next flush). The lifecycle event intake (`op:"event"`) is `inproc-lifecycle.ts`; this driver offers it the hooks
 * `onMemberIdle` (nudge), `onMemberBusy` (flush held mail), `retryNotStarted`, `hasPendingCommand` and, for pending stops, `stopChild`.
 * `abort` of a non-busy member is a success no-op (`noop:"not_busy"`), `urgentDegraded`/`spawnNote` word the urgent degradation and the parallelism bound,
 * and an unconfirmed `shutdown` reports `stopUnconfirmed` (the runtime releases the member `gone: not_alive` and records a pending stop).
 * See change: add-agent-teams-in-process.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "../shared/clock.js";
import {
  commandMember,
  IN_PROCESS_MODE,
  INPROC_QUEUE_MAX_BYTES,
  INPROC_QUEUE_MAX_ENTRIES,
  type InProcAck,
  type InProcCommand,
  type InProcSpawnSpec,
} from "../shared/inproc-protocol.js";
import { AGENT_TEAMS_EVENT_INPROC } from "../shared/plugin-id.js";
import type { Mail, Member } from "../shared/types.js";
import type { ConfigReader } from "./config.js";
import type { DriverMemberRef, MemberDriver, SpawnOutcome } from "./driver.js";
import { frameMailBatch, mailIdsKey } from "./inproc-mail.js";
import type { InProcAvailability } from "./modes-inproc.js";
import { mintProxyToken } from "./proxy-identity.js";
import type { TeamStore } from "./store.js";
import type { PluginCounters } from "./templates-hooks.js";
import type { Logger } from "./types.js";

/** A command without the fields the driver adds at emit time (`secret`; `cmdId` is assigned at queue time). */
type CommandInput = InProcCommand extends infer C ? (C extends InProcCommand ? Omit<C, "cmdId" | "secret"> : never) : never;

type CommandOutcome = { ok: true; ack: InProcAck; emittedAt: number } | { ok: false; error: string; message?: string };

export interface InProcDriverDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  config: ConfigReader;
  /** Sends one `agent-teams:inproc` command to the lead session (the runtime binds the host's `emitEventToSession` with that event type): the single host call of this driver. */
  emit: (sessionId: string, data: Record<string, unknown>) => boolean;
  /** Whether a host session socket is connected. */
  isConnected: (sessionId: string) => boolean;
  availability: InProcAvailability;
  counters: PluginCounters;
  /** Mark a member `failed` (releases tasks, waking notice). Absent ⇒ only logged. */
  failMember?: (teamId: string, member: string, message: string) => void;
  /** Mark a member `gone` with a reason (releases tasks, waking notice). Absent ⇒ only logged. */
  goneMember?: (teamId: string, member: string, reason: string) => void;
  /**
   * A child's `stop` was never confirmed (timeout / no confirming event): the runtime marks the member `gone: not_alive` (tasks released) and
   * records a pending stop for the child, so a late-connecting child is still stopped.
   */
  stopUnconfirmed?: (info: { teamId: string; member: string; childId?: string; agentId?: string }) => void;
  /**
   * A spawn was acked `running` (a slot was free: the child already runs): the lifecycle intake arms the readiness deadline now, so a
   * `started` that never arrives (lane down before the outbox flush, bridge crash) cannot leave the member `spawning` forever.
   * A `queued` ack never calls this (the queue wait is unbounded, `spawnTimeoutMs` counts from the first `started`).
   */
  spawnRunning?: (teamId: string, member: string) => void;
  /** Ack handed-over mail ids in the store (default `store.ackMail`; the runtime routes it through core's mail engine). */
  ackMail?: (teamId: string, ids: readonly number[]) => unknown;
  /** Forget what was handed to `member` so the next flush re-emits its unacked mail (core's mail engine `unhand`). */
  unhandMail?: (teamId: string, member: string) => void;
  /** Flush the queued mail of `member` now (core's mail engine `flush`). */
  flushMail?: (teamId: string, member: string) => void;
  /** Test seams. */
  newCmdId?: () => string;
  newToken?: () => string;
}

export interface InProcDriver extends MemberDriver {
  /** The lead's `inproc hello` arrived and reported availability: flush its queued commands. */
  onHello(sessionId: string): void;
  /** An `agent-teams/inproc` ack from `sessionId`; `matched` is false for an unknown/foreign/late id. */
  onAck(sessionId: string, ack: InProcAck): { matched: boolean };
  /** Fail every QUEUED (not yet emitted) command of a team with `error`; returns the members of dropped spawns. */
  failQueued(teamId: string, error: string): string[];
  /** Cancel the opt-in queue-wait deadline of a member (it started). */
  clearQueueTimer(teamId: string, member: string): void;
  /**
   * `member` reported `idle` for `run` (the lifecycle intake calls this): when a steer was acked `queued` into exactly that run and no
   * run has started since, the stale queued message is not read until the child runs again, so send ONE content-free `nudge`
   * (fixed text, no ids, fresh nonce `cmdId`). The host's `nudgedRun` guard makes a repeated report harmless. Returns whether sent.
   */
  onMemberIdle(teamId: string, member: string, run: number): boolean;
  /** `member` became busy (the lifecycle intake calls this): the non-waking mail held for it is handed over now. */
  onMemberBusy(teamId: string, member: string): void;
  /** A child event or slot opened: retry the steers the host answered `not_started` for this team. */
  retryNotStarted(teamId: string): void;
  /** Whether a command about `member` is queued or awaiting its ack (a `spawning` member with none lost its spawn). */
  hasPendingCommand(teamId: string, member: string): boolean;
  /** Best-effort `stop` of a child by id (a recorded pending stop); resolves true when the host confirmed it. */
  stopChild(teamId: string, stop: { member: string; childId?: string; agentId?: string }): Promise<boolean>;
  /** Number of queued (unsent) commands. */
  queueSize(): number;
  dispose(): void;
}

interface Entry {
  cmdId: string;
  sessionId: string;
  teamId: string;
  /** `teamId\0member` or `teamId\0*` (team-level). */
  key: string;
  cmd: CommandInput;
  bytes: number;
  resolve: (outcome: CommandOutcome) => void;
  timer?: unknown;
  emittedAt?: number;
}

const memberKey = (teamId: string, member: string | undefined): string => `${teamId}\u0000${member ?? "*"}`;
const LATE_SPAWN_CAP = 200;

const failureText = (error: string, message: string | undefined): string => (message ? `${error}: ${message}` : error);

/** What a spawn ack records on the member: the child ids and, while it waits for a slot, its 1-based queue position. */
function ackPatch(ack: InProcAck): Partial<Member> {
  const patch: Partial<Member> = {};
  if (ack.childId) patch.childId = ack.childId;
  if (ack.agentId) patch.childAgentId = ack.agentId;
  if (ack.status === "queued" && ack.queuePosition !== undefined) patch.queuePosition = ack.queuePosition;
  return patch;
}

export function createInProcDriver(deps: InProcDriverDeps): InProcDriver {
  const { store, clock, logger, counters, availability } = deps;
  const newCmdId = deps.newCmdId ?? (() => randomUUID());
  const newToken = deps.newToken ?? (() => mintProxyToken());

  const queue: Entry[] = [];
  let queueBytes = 0;
  const outstanding = new Map<string, Entry>();
  const busyKeys = new Set<string>();
  /** Timed-out spawns whose late ack must stop the child it may have created (bounded, oldest first). */
  const lateSpawns = new Map<string, { sessionId: string; teamId: string; member: string }>();
  /** Timed-out steers: a late ok-ack still hands the mail over (bounded, oldest first). */
  const lateSteers = new Map<string, { sessionId: string; teamId: string; member: string; ids: number[]; prev: "idle" | "busy" | undefined }>();
  const queueTimers = new Map<string, unknown>();
  /** Non-waking mail held for an idle child, by `teamId\0member`. */
  const held = new Map<string, Mail[]>();
  /** Spawns waiting for the lead's next hello (`no_context`), by lead session. */
  const helloWaiters = new Map<string, Array<(woken: boolean) => void>>();
  /** `teamId\0member` of steers the host answered `not_started`: retried on the next child event. */
  const notStarted = new Set<string>();

  const leadOf = (teamId: string): string | undefined => store.get(teamId)?.leadSessionId;
  const ready = (sessionId: string): boolean => deps.isConnected(sessionId) && availability.get(sessionId)?.report.available === true;
  const sizeOf = (cmd: CommandInput): number => JSON.stringify(cmd).length;

  function finish(entry: Entry, outcome: CommandOutcome): void {
    if (entry.timer !== undefined) clock.clearTimeout(entry.timer);
    entry.timer = undefined;
    outstanding.delete(entry.cmdId);
    busyKeys.delete(entry.key);
    entry.resolve(outcome);
    pump(entry.sessionId);
  }

  function emitNow(entry: Entry): void {
    const secret = availability.get(entry.sessionId)?.commandSecret ?? "";
    busyKeys.add(entry.key);
    outstanding.set(entry.cmdId, entry);
    entry.emittedAt = clock.now();
    let accepted = false;
    try {
      accepted = deps.emit(entry.sessionId, { ...entry.cmd, cmdId: entry.cmdId, secret });
    } catch (err) {
      logger.warn(`agent-teams: inproc emit threw team=${entry.teamId} cmd=${entry.cmd.cmd}: ${(err as Error).name}`);
    }
    if (!accepted) {
      // Lead connected and announced, yet the host refused: an undeclared event type (a build bug), fail fast.
      counters.inc("inproc_emit_refused", entry.teamId);
      logger.error(`agent-teams: inproc emit refused by the host team=${entry.teamId} event=${AGENT_TEAMS_EVENT_INPROC} cmd=${entry.cmd.cmd} id=${entry.cmdId}`);
      finish(entry, { ok: false, error: "emit_refused", message: `the host refused ${AGENT_TEAMS_EVENT_INPROC}` });
      return;
    }
    logger.info(`agent-teams: inproc cmd team=${entry.teamId} cmd=${entry.cmd.cmd} id=${entry.cmdId} bytes=${entry.bytes}`);
    entry.timer = clock.setTimeout(() => onTimeout(entry), deps.config().inProcessCmdTimeoutMs);
  }

  /** A timed-out spawn may have executed with its ack lost: a late ok-ack stops the child; `spawn()` reconciles (stop + snapshot). */
  function rememberLateSpawn(entry: Entry, member: string): void {
    lateSpawns.set(entry.cmdId, { sessionId: entry.sessionId, teamId: entry.teamId, member });
    if (lateSpawns.size > LATE_SPAWN_CAP) lateSpawns.delete(lateSpawns.keys().next().value as string);
  }

  /** A timed-out steer: the mail stays queued and the member is `disconnected`; a late ok-ack hands the mail over after all. */
  function rememberLateSteer(entry: Entry, member: string, ids: number[]): void {
    const team = store.get(entry.teamId);
    const m = team ? store.member(team, member) : undefined;
    const prev = m && (m.status === "idle" || m.status === "busy") ? m.status : undefined;
    lateSteers.set(entry.cmdId, { sessionId: entry.sessionId, teamId: entry.teamId, member, ids, prev });
    if (lateSteers.size > LATE_SPAWN_CAP) lateSteers.delete(lateSteers.keys().next().value as string);
    if (prev) store.patchMember(entry.teamId, member, { status: "disconnected" });
    deps.unhandMail?.(entry.teamId, member);
  }

  function onTimeout(entry: Entry): void {
    if (!outstanding.has(entry.cmdId)) return;
    counters.inc("inproc_delivery_timeout", entry.teamId);
    logger.warn(`agent-teams: inproc command timed out team=${entry.teamId} cmd=${entry.cmd.cmd} id=${entry.cmdId}`);
    if (entry.cmd.cmd === "spawn") rememberLateSpawn(entry, entry.cmd.member);
    else if (entry.cmd.cmd === "steer") rememberLateSteer(entry, entry.cmd.member, entry.cmd.mailIds);
    finish(entry, { ok: false, error: "delivery_timeout", message: `no acknowledgement within ${deps.config().inProcessCmdTimeoutMs} ms` });
  }

  /** Emit every queued command of `sessionId` that may go now, in issue order, one outstanding per member. */
  function pump(sessionId: string): void {
    if (!ready(sessionId)) return;
    for (const entry of [...queue]) {
      if (entry.sessionId !== sessionId || busyKeys.has(entry.key)) continue;
      queue.splice(queue.indexOf(entry), 1);
      queueBytes -= entry.bytes;
      emitNow(entry);
    }
  }

  /** Queue a command for the team's lead; resolves when it is acked, refused or timed out. */
  function send(teamId: string, cmd: CommandInput, cmdId?: string): Promise<CommandOutcome> {
    const sessionId = leadOf(teamId);
    if (!sessionId) return Promise.resolve({ ok: false, error: "not_connected", message: "the team has no bound lead session" });
    return new Promise<CommandOutcome>((resolve) => {
      const entry: Entry = { cmdId: cmdId ?? `${cmd.cmd}:${newCmdId()}`, sessionId, teamId, key: memberKey(teamId, commandMember(cmd as InProcCommand)), cmd, bytes: sizeOf(cmd), resolve };
      queue.push(entry);
      queueBytes += entry.bytes;
      while (queue.length > INPROC_QUEUE_MAX_ENTRIES || queueBytes > INPROC_QUEUE_MAX_BYTES) {
        const dropped = queue.shift() as Entry;
        queueBytes -= dropped.bytes;
        counters.inc("inproc_queue_overflow", dropped.teamId);
        dropped.resolve({ ok: false, error: "delivery_timeout", message: "command queue overflow" });
      }
      pump(sessionId);
    });
  }

  /** The text of the member's pending `spawn_prompt` mail (the child's prompt) and its id. */
  function spawnPromptOf(teamId: string, member: string): { text: string; id: number } | undefined {
    const mail = [...store.mailLog(teamId)].reverse().find((m) => m.to === member && m.kind === "spawn_prompt" && m.ackedAt === undefined);
    return mail ? { text: mail.text, id: mail.id } : undefined;
  }

  function specOf(spec: Parameters<MemberDriver["spawn"]>[0]["spec"]): InProcSpawnSpec {
    const cfg = deps.config();
    return {
      cwd: spec.cwd,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.thinkingLevel ? { thinkingLevel: spec.thinkingLevel } : {}),
      ...(spec.tools ? { tools: [...spec.tools] } : {}),
      ...(spec.skills ? { skills: [...spec.skills] } : {}),
      noMcp: spec.noMcp,
      noContextFiles: spec.noContextFiles,
      promptFiles: [...spec.promptFiles],
      env: { ...spec.env },
      leanChildren: cfg.inProcessLeanChildren,
      ...(cfg.inProcessIdleTtlSec !== undefined ? { idleTtlSec: cfg.inProcessIdleTtlSec } : {}),
    };
  }

  function spawnCommandOf(req: Parameters<MemberDriver["spawn"]>[0], proxyToken: string): CommandInput {
    const prompt = spawnPromptOf(req.teamId, req.member);
    return {
      cmd: "spawn",
      teamId: req.teamId,
      member: req.member,
      ...(req.role ? { role: req.role } : {}),
      prompt: prompt?.text ?? "",
      ...(prompt ? { promptMailId: prompt.id } : {}),
      spec: specOf(req.spec),
      proxyToken,
    };
  }

  function armQueueTimer(teamId: string, member: string): void {
    const ms = deps.config().inProcessQueueTimeoutMs;
    if (ms === undefined) return;
    const key = memberKey(teamId, member);
    const prev = queueTimers.get(key);
    if (prev !== undefined) clock.clearTimeout(prev);
    queueTimers.set(
      key,
      clock.setTimeout(() => {
        queueTimers.delete(key);
        const team = store.get(teamId);
        const m = team ? store.member(team, member) : undefined;
        if (!team || !m || m.status !== "spawning" || m.queuePosition === undefined) return; // started or gone meanwhile
        logger.warn(`agent-teams: in-process member ${member} still queued after ${ms} ms team=${teamId}`);
        // The queued child is stopped and a snapshot must show it gone before the name is reusable.
        void reconcile(teamId, member, { ...(m.childId ? { childId: m.childId } : {}), ...(m.childAgentId ? { agentId: m.childAgentId } : {}) }).then(() => deps.failMember?.(teamId, member, "spawn_timeout: still queued for a subagents slot"));
      }, ms),
    );
  }

  /** The ack of a spawn that already timed out: the child it created must not outlive the failed member. */
  function onLateAck(sessionId: string, ack: InProcAck): void {
    const late = lateSpawns.get(ack.cmdId);
    if (!late || late.sessionId !== sessionId) return;
    lateSpawns.delete(ack.cmdId);
    if (!ack.ok) return;
    void send(late.teamId, { cmd: "stop", member: late.member, ...(ack.childId ? { childId: ack.childId } : {}), ...(ack.agentId ? { agentId: ack.agentId } : {}) });
  }

  /**
   * Send the spawn; while the lead answers `no_context` (its subagents extension has no context yet) wait for its next hello and re-send
   * with the SAME `cmdId` (still one child) until `spawnTimeoutMs`, counted from the first emit. A string is the failure message.
   */
  async function sendSpawn(teamId: string, lead: string, command: CommandInput, cmdId: string): Promise<CommandOutcome | string> {
    let outcome = await send(teamId, command, cmdId);
    let firstEmit: number | undefined;
    while (outcome.ok && !outcome.ack.ok && outcome.ack.error === "no_context") {
      firstEmit ??= outcome.emittedAt;
      const remaining = deps.config().spawnTimeoutMs - (clock.now() - firstEmit);
      if (remaining <= 0 || !(await waitForHello(lead, remaining))) return "spawn_timeout: the subagents extension had no context before spawnTimeoutMs";
      outcome = await send(teamId, command, cmdId);
    }
    return outcome;
  }

  /** The result of a spawn command as the `MemberDriver` outcome; a timed-out spawn reconciles first (stop + snapshot) so the name stays taken meanwhile. */
  async function settleSpawn(req: Parameters<MemberDriver["spawn"]>[0], command: CommandInput, outcome: CommandOutcome | string): Promise<SpawnOutcome> {
    if (typeof outcome === "string") return { ok: false, message: outcome };
    if (!outcome.ok) {
      if (outcome.error === "delivery_timeout") await reconcile(req.teamId, req.member, {});
      return { ok: false, message: failureText(outcome.error, outcome.message) };
    }
    const ack = outcome.ack;
    if (!ack.ok) return { ok: false, message: failureText(ack.error ?? "spawn_failed", ack.message) };
    // The team closed or the member ended while the spawn was in flight: the child it created must not run on without a member.
    const team = store.get(req.teamId);
    const member = team ? store.member(team, req.member) : undefined;
    if (!team || team.status === "closed" || !member || member.status === "gone" || member.status === "failed") {
      void send(req.teamId, { cmd: "stop", member: req.member, ...(ack.childId ? { childId: ack.childId } : {}), ...(ack.agentId ? { agentId: ack.agentId } : {}) });
      return { ok: false, message: "spawn superseded: the team or member ended before the child was acknowledged" };
    }
    onSpawnAck(req, command, ack);
    return { ok: true, spawnToken: req.spawnToken };
  }

  /** The child exists: record its ids, hand the spawn-prompt mail over (it IS the child's prompt), watch a queued child's wait. */
  function onSpawnAck(req: Parameters<MemberDriver["spawn"]>[0], command: CommandInput, ack: InProcAck): void {
    store.patchMember(req.teamId, req.member, ackPatch(ack));
    logger.info(`agent-teams: inproc spawn reply team=${req.teamId} member=${req.member} status=${ack.status ?? "?"}${ack.queuePosition !== undefined ? ` queuePosition=${ack.queuePosition}` : ""}`);
    if (command.cmd === "spawn" && command.promptMailId !== undefined) ackHandedOver(req.teamId, [command.promptMailId]);
    if (ack.status === "queued" && ack.queuePosition !== undefined) armQueueTimer(req.teamId, req.member);
    else if (ack.status === "running") deps.spawnRunning?.(req.teamId, req.member);
  }

  /** One `steer` command for `mails` (framed per mail, mail-id order); mails acked meanwhile are left out. */
  function sendSteer(teamId: string, member: string, mails: readonly Mail[]): void {
    const pending = new Set(store.pendingMail(teamId, member).map((m) => m.id));
    const unique = [...new Map(mails.filter((m) => pending.has(m.id)).map((m) => [m.id, m])).values()];
    if (unique.length === 0) return;
    const { ids, blocks } = frameMailBatch(unique);
    counters.inc("inproc_steers", teamId);
    void send(teamId, { cmd: "steer", member, mailIds: ids, blocks }, `steer:${teamId}:${member}:${mailIdsKey(ids)}`).then((outcome) => onSteerOutcome(teamId, member, ids, outcome));
  }

  /** Resolves true at the lead's next hello, false after `ms`. */
  function waitForHello(sessionId: string, ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = clock.setTimeout(() => {
        helloWaiters.set(sessionId, (helloWaiters.get(sessionId) ?? []).filter((w) => w !== wake));
        resolve(false);
      }, ms);
      const wake = (woken: boolean): void => {
        clock.clearTimeout(timer);
        resolve(woken);
      };
      helloWaiters.set(sessionId, [...(helloWaiters.get(sessionId) ?? []), wake]);
    });
  }

  /** `stop` a member's child, then ask the host for a `snapshot`; a child that still shows gets one more `stop`. */
  async function reconcile(teamId: string, member: string, ids: { childId?: string; agentId?: string }): Promise<void> {
    await send(teamId, { cmd: "stop", member, ...ids });
    const snap = await send(teamId, { cmd: "snapshot" });
    const still = snap.ok && snap.ack.snapshot?.members.find((m) => m.member === member);
    if (still) await send(teamId, { cmd: "stop", member, childId: still.childId, agentId: still.agentId });
  }

  const ackHandedOver = (teamId: string, ids: readonly number[]): void => void (deps.ackMail ?? ((t, i) => store.ackMail(t, i)))(teamId, ids);

  /** A steer reached the host: handed over ⇒ ack the mail (and note the run of a queued steer); otherwise it stays queued. */
  function onSteerOutcome(teamId: string, member: string, ids: readonly number[], outcome: CommandOutcome): void {
    if (!outcome.ok) {
      if (outcome.error !== "delivery_timeout") deps.unhandMail?.(teamId, member); // a timeout un-handed it already
      return;
    }
    const ack = outcome.ack;
    logger.info(`agent-teams: inproc steer result team=${teamId} member=${member} ok=${ack.ok} ${ack.ok ? `result=${ack.result ?? "?"}` : `error=${ack.error ?? "unknown"}`} mails=${ids.length}`);
    if (ack.ok) {
      ackHandedOver(teamId, ids);
      if (ack.result === "queued" && ack.run !== undefined) store.patchMember(teamId, member, { steerAckRun: ack.run });
      return;
    }
    switch (ack.error) {
      case "not_alive":
        deps.goneMember?.(teamId, member, "not_alive");
        return;
      case "not_started":
        notStarted.add(memberKey(teamId, member));
        deps.unhandMail?.(teamId, member);
        return;
      default:
        logger.warn(`agent-teams: inproc steer to ${member} not handed over team=${teamId}: ${ack.error ?? "unknown"}`);
        deps.unhandMail?.(teamId, member);
    }
  }

  /** The ack of a steer that already timed out: the mail IS handed over, and the member is back from `disconnected`. */
  function onLateSteerAck(sessionId: string, ack: InProcAck): boolean {
    const late = lateSteers.get(ack.cmdId);
    if (!late || late.sessionId !== sessionId) return false;
    lateSteers.delete(ack.cmdId);
    if (!ack.ok) return true;
    const team = store.get(late.teamId);
    const m = team ? store.member(team, late.member) : undefined;
    if (m?.status === "disconnected" && late.prev) store.patchMember(late.teamId, late.member, { status: late.prev });
    ackHandedOver(late.teamId, late.ids);
    if (ack.result === "queued" && ack.run !== undefined) store.patchMember(late.teamId, late.member, { steerAckRun: ack.run });
    return true;
  }

  const driver: InProcDriver = {
    mode: IN_PROCESS_MODE,
    supportsResume: false,
    ownsSpawnClock: true,

    async spawn(req) {
      const team = store.get(req.teamId);
      const member = team ? store.member(team, req.member) : undefined;
      if (!team || !member) return { ok: false, message: "unknown team or member" };
      if (!team.leadSessionId) return { ok: false, message: "the team has no bound lead session" };
      // A non-empty skill grant needs the loader pass-through (task 6.7): refused before any command is built or emitted.
      if ((req.spec.skills?.length ?? 0) > 0 && !availability.hasFeature(team.leadSessionId, "loader_skills")) return { ok: false, message: failureText("skills_unavailable_in_process", "a skill allowlist needs the subagents feature loader_skills") };
      // A fresh token per spawn (rotation): the persisted team file is the only place it lives besides the command.
      const proxyToken = newToken();
      store.patchMember(req.teamId, req.member, { proxyToken, childId: undefined, childAgentId: undefined, queuePosition: undefined }, { writeThrough: true });
      counters.inc("inproc_spawns", req.teamId);
      const command = spawnCommandOf(req, proxyToken);
      const outcome = await sendSpawn(req.teamId, team.leadSessionId, command, `spawn:${req.teamId}:${req.member}:${req.spawnToken}`);
      return settleSpawn(req, command, outcome);
    },

    deliver(ref, mails, { wake }) {
      const team = store.get(ref.teamId);
      const member = team ? store.member(team, ref.member) : undefined;
      const lead = team?.leadSessionId;
      if (!team || !member || !lead || mails.length === 0 || member.childId === undefined || !ready(lead)) return false;
      if (member.status === "spawning") return false; // no first run yet (also a slot-queued child): the caller keeps the mail queued
      const key = memberKey(team.id, member.name);
      if (!wake && member.status === "idle") {
        // A steer into an idle child ALWAYS starts a run: a non-waking mail waits here and rides with the next waking mail or
        // when the child becomes busy. Accepting it keeps the mail behind it deliverable; it is acked only when handed over.
        held.set(key, [...(held.get(key) ?? []), ...mails]);
        return true;
      }
      sendSteer(team.id, member.name, [...(held.get(key) ?? []), ...mails]);
      held.delete(key);
      return true;
    },

    onMemberBusy(teamId, member) {
      const key = memberKey(teamId, member);
      const waiting = held.get(key);
      if (!waiting || waiting.length === 0) return;
      held.delete(key);
      sendSteer(teamId, member, waiting);
    },

    abort(ref) {
      const team = store.get(ref.teamId);
      const member = team ? store.member(team, ref.member) : undefined;
      const lead = team?.leadSessionId;
      if (!team || !member || !lead) return { ok: false, reason: "not_connected" };
      if (member.status === "disconnected") return { ok: false, reason: "not_connected" };
      // Nothing to interrupt (idle / spawning / still in the slot queue): a success no-op, no upstream call; `shutdown_pending` may still be running.
      if (member.status !== "busy" && member.status !== "shutdown_pending") {
        return { ok: true, noop: "not_busy", ...(member.queuePosition !== undefined ? { hint: "the teammate is waiting for a subagents slot: use Stop to remove it from the queue" } : {}) };
      }
      if (!availability.hasFeature(lead, "interrupt")) return { ok: false, reason: "interrupt_unavailable" };
      void send(ref.teamId, { cmd: "interrupt", member: ref.member });
      return { ok: true };
    },

    async shutdown(ref) {
      const team = store.get(ref.teamId);
      const member = team ? store.member(team, ref.member) : undefined;
      if (!team || !member) return false;
      const ids = { ...(member.childId ? { childId: member.childId } : {}), ...(member.childAgentId ? { agentId: member.childAgentId } : {}) };
      const outcome = await send(ref.teamId, { cmd: "stop", member: ref.member, ...ids });
      const confirmed = outcome.ok && outcome.ack.ok;
      if (!confirmed) deps.stopUnconfirmed?.({ teamId: ref.teamId, member: ref.member, ...ids });
      return confirmed;
    },

    urgentDegraded(ref) {
      counters.inc("inproc_degraded_urgent", ref.teamId);
      return "urgent interrupt is unavailable for in-process teammates (the subagents package lacks the `interrupt` feature): the message was delivered as a normal steer after the current tool call";
    },

    spawnNote(team, effectiveMax) {
      const lead = team.leadSessionId;
      const rec = lead ? availability.get(lead) : undefined;
      const max = rec?.report.available ? rec.report.limits.maxConcurrent : team.subagentsApi?.limits.maxConcurrent;
      if (max === undefined || effectiveMax <= max) return undefined;
      return `At most ${max} teammates run in parallel (subagents maxConcurrent, a pool shared with the lead's own Agent calls); the others wait for a slot as spawning with a queue position.`;
    },

    isConnected(ref: DriverMemberRef) {
      const team = store.get(ref.teamId);
      const member = team ? store.member(team, ref.member) : undefined;
      const lead = team?.leadSessionId;
      return !!lead && member?.childId !== undefined && ready(lead);
    },

    onHello(sessionId) {
      pump(sessionId);
      const waiters = helloWaiters.get(sessionId) ?? [];
      helloWaiters.delete(sessionId);
      for (const wake of waiters) wake(true);
    },

    onAck(sessionId, ack) {
      const entry = outstanding.get(ack.cmdId);
      if (entry) {
        if (entry.sessionId !== sessionId) return { matched: false }; // a foreign lead can never settle our command
        logger.info(`agent-teams: inproc ack team=${entry.teamId} cmd=${entry.cmd.cmd} id=${entry.cmdId} ok=${ack.ok}${ack.error ? ` error=${ack.error}` : ""}${ack.result ? ` result=${ack.result}` : ""}`);
        finish(entry, { ok: true, ack, emittedAt: entry.emittedAt ?? clock.now() });
        return { matched: true };
      }
      if (!onLateSteerAck(sessionId, ack)) onLateAck(sessionId, ack);
      return { matched: false };
    },

    failQueued(teamId, error) {
      const members: string[] = [];
      for (const entry of [...queue]) {
        if (entry.teamId !== teamId) continue;
        queue.splice(queue.indexOf(entry), 1);
        queueBytes -= entry.bytes;
        if (entry.cmd.cmd === "spawn") members.push(entry.cmd.member);
        entry.resolve({ ok: false, error });
      }
      return members;
    },

    clearQueueTimer(teamId, member) {
      const key = memberKey(teamId, member);
      const t = queueTimers.get(key);
      if (t !== undefined) clock.clearTimeout(t);
      queueTimers.delete(key);
    },

    onMemberIdle(teamId, member, run) {
      const team = store.get(teamId);
      const m = team ? store.member(team, member) : undefined;
      if (!m || m.steerAckRun !== run) return false;
      counters.inc("inproc_nudges", teamId);
      void send(teamId, { cmd: "steer", member, mailIds: [], nudge: true }, `nudge:${member}:${run}:${newCmdId()}`);
      return true;
    },

    retryNotStarted(teamId) {
      const prefix = `${teamId}\u0000`;
      for (const k of [...notStarted]) {
        if (!k.startsWith(prefix)) continue;
        notStarted.delete(k);
        deps.flushMail?.(teamId, k.slice(prefix.length));
      }
    },

    hasPendingCommand(teamId, member) {
      const key = memberKey(teamId, member);
      return busyKeys.has(key) || queue.some((e) => e.key === key);
    },

    async stopChild(teamId, stop) {
      const outcome = await send(teamId, { cmd: "stop", member: stop.member, ...(stop.childId ? { childId: stop.childId } : {}), ...(stop.agentId ? { agentId: stop.agentId } : {}) });
      return outcome.ok && outcome.ack.ok;
    },

    queueSize: () => queue.length,

    dispose() {
      // Shutdown: nothing will ack or hello again, so every caller still waiting is settled (as failQueued does), never left hanging.
      const waiters = [...helloWaiters.values()].flat();
      const unsettled = [...outstanding.values(), ...queue];
      for (const e of outstanding.values()) if (e.timer !== undefined) clock.clearTimeout(e.timer);
      for (const t of queueTimers.values()) clock.clearTimeout(t);
      queueTimers.clear();
      helloWaiters.clear();
      held.clear();
      notStarted.clear();
      lateSteers.clear();
      outstanding.clear();
      busyKeys.clear();
      queue.length = 0;
      queueBytes = 0;
      for (const wake of waiters) wake(false);
      for (const e of unsettled) e.resolve({ ok: false, error: "disposed", message: "the server is shutting down" });
    },
  };
  return driver;
}
