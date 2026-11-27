/**
 * Lifecycle intake of the in-process mode (design D6/D7, spec "Child lifecycle mapping", "Server restart keeps children"):
 * what the server DOES with the lead host's `agent-teams/inproc {op:"event"}` reports and with the `snapshot` of an `inproc hello`.
 *
 * Reports (`started | idle | gone | state`) are applied through core's own member ops so dedupe, auto-claim, notices and hooks behave
 * as in session mode:
 * - `started`  `spawning|idle|disconnected → busy` (a `spawning` member is `busy` at its first run, queue position cleared, held mail
 *   handed over, the readiness clock `spawnTimeoutMs` starts HERE), a stale `started` of an already-settled run is ignored;
 * - `idle`     core's `ops.idle` with `settleId = run` (deduped by `lastSettleId`, one coalesced notice, auto-claim, aborted ⇒ silent), then
 *   the queued-steer nudge and the `not_started` retries;
 * - `gone`     `releaseMember` (tasks back to `pending`, one waking notice); an unknown reason becomes `stopped` (`inproc_unknown_event`);
 * - `state`    resolves core's provisional `busy`; carries `queuePosition` of a continued run that re-queued.
 * A hello's `snapshot` re-binds `disconnected` members (restart), acks mail the child already got, applies an unacknowledged settle and
 * marks members the host no longer has `gone: not_alive` (a `spawning` member with no pending command: `failed`).
 * Logs carry ids and sizes only. See change: add-agent-teams-in-process.
 */
import type { Clock } from "../shared/clock.js";
import type { InProcEvent, InProcSnapshot, InProcSnapshotMember } from "../shared/inproc-protocol.js";
import type { OpResult } from "../shared/protocol.js";
import type { Member, Team } from "../shared/types.js";
import type { ConfigReader } from "./config.js";
import type { InProcDriver } from "./driver-inproc.js";
import { isLive } from "./op-util.js";
import type { Caller, Ops } from "./ops.js";
import type { TeamStore } from "./store.js";
import type { PluginCounters } from "./templates-hooks.js";
import type { Logger } from "./types.js";

/** `Member.goneReason` values a host report may carry; anything else is upstream drift and becomes `stopped`. */
const GONE_REASONS: readonly string[] = ["stopped", "timeout", "idle_disposed", "lead_ended", "child_failed", "not_alive"];

const MAX_TEXT_CHARS = 1_048_576;
const MAX_NAME_CHARS = 200;

type OpsSubset = Pick<Ops, "idle" | "reportMemberState" | "releaseMember" | "mailHandover">;

export interface InProcLifecycleDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  config: ConfigReader;
  counters: PluginCounters;
  driver: InProcDriver;
  ops: OpsSubset;
}

export interface InProcLifecycle {
  /** One `{op:"event"}` report of `sessionId` (the lead) about a member of `team`. */
  onEvent(team: Team, sessionId: string, payload: unknown): OpResult<unknown> | Promise<OpResult<unknown>>;
  /** Re-bind / reconcile the members of `team` with the host's `snapshot` (an `inproc hello` of the same incarnation). */
  reconcile(team: Team, sessionId: string, snapshot: InProcSnapshot): void;
  dispose(): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
const get = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

const optText = (o: Record<string, unknown>, k: string, max: number): string | undefined => {
  const v = get(o, k);
  return typeof v === "string" ? v.slice(0, max) : undefined;
};
const isCount = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const withField = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]?: V }));

/** Strict parse of a report; `undefined` ⇒ invalid. */
function parseEvent(payload: unknown): InProcEvent | undefined {
  if (!isRecord(payload)) return undefined;
  const member = get(payload, "member");
  const run = get(payload, "run");
  const kind = get(payload, "kind");
  const state = get(payload, "state");
  const queuePosition = get(payload, "queuePosition");
  if (typeof member !== "string" || member.length === 0 || member.length > MAX_NAME_CHARS || !isCount(run, 0)) return undefined;
  if (kind !== "started" && kind !== "idle" && kind !== "gone" && kind !== "state") return undefined;
  if (kind === "state" && state !== "busy" && state !== "idle") return undefined;
  return {
    op: "event",
    member,
    run,
    kind,
    ...withField("finalText", optText(payload, "finalText", MAX_TEXT_CHARS)),
    ...withField("error", optText(payload, "error", MAX_TEXT_CHARS)),
    ...(get(payload, "aborted") === true ? { aborted: true } : {}),
    ...withField("reason", optText(payload, "reason", 80)),
    ...(state === "busy" || state === "idle" ? { state } : {}),
    ...(isCount(queuePosition, 1) ? { queuePosition } : {}),
  };
}

export function createInProcLifecycle(deps: InProcLifecycleDeps): InProcLifecycle {
  const { store, clock, logger, counters, driver, ops } = deps;
  /** Readiness deadlines (`spawnTimeoutMs` from the first `started`), by `teamId\0member`. */
  const readyTimers = new Map<string, unknown>();
  const key = (teamId: string, name: string): string => `${teamId}\u0000${name}`;

  const memberCaller = (team: Team, name: string, sessionId: string): Caller => ({ sessionId, role: "member", binding: { teamId: team.id, who: name }, team, name, proxied: true });

  /** The child never became a guarded teammate within `spawnTimeoutMs` of its first `started`: stop it and fail the member. */
  function armReady(team: Team, member: Member): void {
    const k = key(team.id, member.name);
    const prev = readyTimers.get(k);
    if (prev !== undefined) clock.clearTimeout(prev);
    const token = member.spawnToken;
    const ms = deps.config().spawnTimeoutMs;
    readyTimers.set(
      k,
      clock.setTimeout(() => {
        readyTimers.delete(k);
        const t = store.get(team.id);
        const m = t ? store.member(t, member.name) : undefined;
        if (t && m && isLive(m) && m.spawnToken === token && !m.guardActive) failNotReady(t, m, ms);
      }, ms),
    );
  }

  function failNotReady(team: Team, m: Member, ms: number): void {
    logger.warn(`agent-teams: in-process member ${m.name} did not report a guarded hello within ${ms} ms of its first run team=${team.id}`);
    void driver.stopChild(team.id, { member: m.name, ...(m.childId ? { childId: m.childId } : {}), ...(m.childAgentId ? { agentId: m.childAgentId } : {}) });
    ops.releaseMember(team, m.name, "failed", `spawn failed: ${m.name} did not become ready within ${Math.round(ms / 1000)}s of its first run: the child never reported a guarded hello`);
  }

  /** `spawning` ⇒ `busy` (first run): the queue wait is over, the readiness clock starts, queued mail goes out. */
  function firstRun(team: Team, m: Member): void {
    store.patchMember(team.id, m.name, { status: "busy", queuePosition: undefined, steerAckRun: undefined }, { writeThrough: true });
    driver.clearQueueTimer(team.id, m.name);
    armReady(team, m);
    // The spawn prompt IS the child's first run: it must never go out again as a steer, whatever order the spawn ack and this report arrived in.
    const prompts = store.pendingMail(team.id, m.name).filter((x) => x.kind === "spawn_prompt").map((x) => x.id);
    if (prompts.length > 0) ops.mailHandover.ack(team.id, prompts);
    ops.mailHandover.flush(team.id, m.name);
  }

  function onStarted(team: Team, m: Member, ev: InProcEvent): void {
    if (ev.run <= m.lastSettleId) return; // a re-sent `started` of a run that already settled
    if (m.status === "spawning") {
      firstRun(team, m);
    } else if (m.status === "idle" || m.status === "disconnected") {
      // Confirms core's provisional busy. NOT core's `busy` op: it would undo a just-dispatched task, but an in-process run only ever starts
      // from our own steer, so a `started` is never "busy all along" evidence (and over a synchronous lane it can precede the provisional marker).
      ops.reportMemberState(team, m.name, "busy");
      store.patchMember(team.id, m.name, { queuePosition: undefined, steerAckRun: undefined }); // the next run drained any queued steer
      ops.mailHandover.flush(team.id, m.name);
    } else if (m.queuePosition !== undefined) {
      store.patchMember(team.id, m.name, { queuePosition: undefined });
    }
    driver.onMemberBusy(team.id, m.name);
  }

  function afterIdle(team: Team, name: string, run: number, res: OpResult<{ ignored: boolean }>): void {
    if (res.ok && !res.data.ignored) driver.onMemberIdle(team.id, name, run);
    driver.retryNotStarted(team.id); // a slot opened: steers the host answered `not_started` go again
  }

  function onIdle(team: Team, m: Member, ev: InProcEvent, sessionId: string): OpResult<unknown> | Promise<OpResult<unknown>> {
    if (m.status === "spawning") firstRun(team, m); // `started` was lost or reordered: the run did happen
    if (m.queuePosition !== undefined) store.patchMember(team.id, m.name, { queuePosition: undefined });
    const res = ops.idle(
      { settleId: ev.run, ...(ev.finalText !== undefined ? { finalText: ev.finalText } : {}), ...(ev.error !== undefined ? { error: ev.error } : {}), ...(ev.aborted ? { aborted: true } : {}) },
      memberCaller(team, m.name, sessionId),
    );
    // `TeammateIdle` gates make core's idle asynchronous: answer the report only once it committed, so an outbox entry never leaves on a lost settle.
    if (res instanceof Promise) {
      return res.then((r) => {
        afterIdle(team, m.name, ev.run, r);
        return r;
      });
    }
    afterIdle(team, m.name, ev.run, res);
    return res;
  }

  function onGone(team: Team, m: Member, ev: InProcEvent): void {
    let reason = ev.reason ?? "stopped";
    if (!GONE_REASONS.includes(reason)) {
      counters.inc("inproc_unknown_event", team.id);
      reason = "stopped";
    }
    // A child that failed before any run is a failed spawn (name reusable); every other end is `gone`.
    ops.releaseMember(team, m.name, m.status === "spawning" && reason === "child_failed" ? "failed" : "gone", reason);
  }

  function onState(team: Team, m: Member, ev: InProcEvent): void {
    if (ev.state === undefined || ev.run < m.lastSettleId) return;
    ops.reportMemberState(team, m.name, ev.state);
    // `queuePosition` of a continued run that re-queued (idle + position) or a start that got its slot (busy: cleared).
    if (ev.state === "busy") {
      if (m.queuePosition !== undefined) store.patchMember(team.id, m.name, { queuePosition: undefined });
    } else if (ev.queuePosition !== m.queuePosition) {
      store.patchMember(team.id, m.name, { queuePosition: ev.queuePosition });
    }
  }

  /** A member the host no longer has: its child is gone (a `spawning` one only when its spawn is not on the way any more). */
  function reconcileAbsent(team: Team, m: Member): void {
    // Its spawn is still on the way (command queued / awaiting its ack), or was acknowledged after this snapshot was taken: not lost yet.
    if (m.status === "spawning" && (driver.hasPendingCommand(team.id, m.name) || m.childId !== undefined)) return;
    logger.warn(`agent-teams: in-process member ${m.name} is not in the lead host's snapshot team=${team.id}`);
    if (m.status === "spawning") ops.releaseMember(team, m.name, "failed", "spawn failed: the lead host has no such child");
    else ops.releaseMember(team, m.name, "gone", "not_alive");
  }

  /** Mail the child already received whose ack the server never saw is final. */
  function ackDelivered(team: Team, m: Member, s: InProcSnapshotMember): void {
    const pending = new Set(store.pendingMail(team.id, m.name).map((x) => x.id));
    const handed = s.deliveredMailIds.filter((id) => pending.has(id));
    if (handed.length > 0) ops.mailHandover.ack(team.id, handed);
  }

  /** A member the host still has: re-bind its child ids and state, settle what the server missed, send the queued mail again. */
  function reconcilePresent(team: Team, m: Member, s: InProcSnapshotMember, sessionId: string): void {
    if (m.childId !== s.childId || m.childAgentId !== s.agentId) store.patchMember(team.id, m.name, { childId: s.childId, childAgentId: s.agentId }, { writeThrough: true });
    ackDelivered(team, m, s);
    if (m.status === "disconnected") store.patchMember(team.id, m.name, { status: s.state }, { writeThrough: true });
    if (s.unackedSettle) {
      const u = s.unackedSettle;
      void onIdle(team, m, { op: "event", member: m.name, run: u.run, kind: "idle", ...withField("finalText", u.finalText), ...withField("error", u.error), ...(u.aborted ? { aborted: true } : {}) }, sessionId);
    }
    const now = store.member(team, m.name);
    if (now && (now.status === "idle" || now.status === "busy")) ops.mailHandover.redeliver(team.id, m.name); // queued mail goes out again
  }

  const lifecycle: InProcLifecycle = {
    onEvent(team, sessionId, payload) {
      const ev = parseEvent(payload);
      if (!ev) return { ok: false, error: "invalid_args", message: "invalid inproc event" };
      const m = store.member(team, ev.member);
      if (!m) return { ok: false, error: "not_in_team", message: "no such member" };
      logger.info(`agent-teams: inproc event team=${team.id} member=${ev.member} kind=${ev.kind} run=${ev.run} bytes=${(ev.finalText?.length ?? 0) + (ev.error?.length ?? 0)}`);
      if (!isLive(m)) return { ok: true, data: { ignored: true } }; // a released member is never resurrected
      if (ev.kind === "idle") return onIdle(team, m, ev, sessionId);
      if (ev.kind === "started") onStarted(team, m, ev);
      else if (ev.kind === "gone") onGone(team, m, ev);
      else onState(team, m, ev);
      return { ok: true, data: { ignored: false } };
    },

    reconcile(team, sessionId, snapshot) {
      const present = new Map(snapshot.members.map((s) => [s.member, s]));
      for (const m of team.members.filter(isLive)) {
        const s = present.get(m.name);
        if (s) reconcilePresent(team, m, s, sessionId);
        else reconcileAbsent(team, m);
      }
    },

    dispose() {
      for (const h of readyTimers.values()) clock.clearTimeout(h);
      readyTimers.clear();
    },
  };
  return lifecycle;
}
