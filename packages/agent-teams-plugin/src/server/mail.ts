/**
 * Mail delivery engine (tasks 6.2 / 6.3, design D5–D7). Mail is appended to the
 * store log (the queue) by `ops`; the engine HANDS IT OVER through the member
 * driver and tracks what is in flight:
 *
 *  - `flush(teamId, to)` emits every unacked, not-yet-handed-over mail of one
 *    recipient, in mail-id order, grouped by wake flag. A recipient that is not
 *    connected (`spawning`, `disconnected`, released, or a lead that is `starting`
 *    / `orphaned` / not connected) is skipped: the mail stays queued and unacked
 *    and is flushed on its `hello` (`noteHello` re-emits ALL unacked ids — delivery
 *    is at-least-once and the receiver de-duplicates by id).
 *  - After a WAKING mail reached an `idle` member it is only PROVISIONALLY `busy`
 *    (so the dispatcher does not claim in the gap); a `busy`/idle/hello report
 *    confirms, otherwise after `wakeConfirmMs` it reverts to the last confirmed
 *    state and the dispatcher runs again (`onRevert`).
 *  - Urgent path: `holdUrgent` suspends delivery to one recipient until its settle
 *    report (`releaseOnSettle`) or `urgentSettleWaitMs`, so the wake turn is never
 *    started inside the host's persistent-abort window.
 *
 * Nothing here reads mail text into a log line (ids, sender, recipient, size only).
 * See change: add-agent-teams-core.
 */
import type { Clock } from "../shared/clock.js";
import type { Mail, Member, MemberStatus, Team } from "../shared/types.js";
import type { ConfigReader } from "./config.js";
import type { DriverMemberRef, MemberDriver } from "./driver.js";
import type { TeamStore } from "./store.js";
import type { Logger } from "./types.js";

export interface MailEngineDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  config: ConfigReader;
  driverFor(team: Team): MemberDriver | undefined;
  /** The provisional `busy` of a member lapsed: let the dispatcher run again. */
  onRevert(team: Team): void;
}

const key = (teamId: string, name: string): string => `${teamId}\u0000${name}`;

/** Member statuses a mail can be handed to (a bound, connected session). */
const DELIVERABLE: readonly MemberStatus[] = ["idle", "busy", "shutdown_pending"];

export function createMailEngine(deps: MailEngineDeps) {
  const { store, clock, logger } = deps;
  /** Mail ids handed to a driver and not yet acked (so a plain flush never re-emits them). */
  const handed = new Map<string, Set<number>>();
  const provisional = new Map<string, { prev: MemberStatus; timer: unknown }>();
  const holds = new Map<string, { timer: unknown }>();
  /** Members whose waking mail went unconfirmed: a busy report from them may be a LATE answer to an older mail. */
  const suspect = new Set<string>();

  const handedSet = (teamId: string): Set<number> => {
    let set = handed.get(teamId);
    if (!set) {
      set = new Set();
      handed.set(teamId, set);
    }
    return set;
  };

  function targetOf(team: Team, to: string): { ref: DriverMemberRef; member?: Member } | undefined {
    if (to === "lead") {
      if (team.status !== "active" || !team.leadConnected || !team.leadSessionId) return undefined;
      return { ref: { teamId: team.id, member: "lead", sessionId: team.leadSessionId } };
    }
    const member = store.member(team, to);
    if (!member?.sessionId || !DELIVERABLE.includes(member.status)) return undefined;
    return { ref: { teamId: team.id, member: member.name, sessionId: member.sessionId }, member };
  }

  // ── provisional busy ──────────────────────────────────────────────────────

  function startProvisional(team: Team, member: Member): void {
    const k = key(team.id, member.name);
    if (provisional.has(k) || member.status !== "idle") return;
    store.patchMember(team.id, member.name, { status: "busy" });
    const timer = clock.setTimeout(() => {
      if (!provisional.delete(k)) return;
      const current = store.member(team, member.name);
      if (current?.status === "busy") {
        suspect.add(k);
        store.patchMember(team.id, member.name, { status: "idle" });
        logger.info(`agent-teams: ${member.name} did not confirm a waking mail within wakeConfirmMs; reverted to idle`);
        deps.onRevert(team);
      }
    }, deps.config().wakeConfirmMs);
    provisional.set(k, { prev: "idle", timer });
  }

  /** A busy/idle/hello report is the confirmation: the provisional marker is dropped. Returns whether one was active. */
  function confirm(teamId: string, name: string): boolean {
    const k = key(teamId, name);
    const p = provisional.get(k);
    if (!p) return false;
    clock.clearTimeout(p.timer);
    provisional.delete(k);
    return true;
  }

  const isProvisional = (teamId: string, name: string): boolean => provisional.has(key(teamId, name));

  /** Consume the "last waking mail went unconfirmed" flag (a busy report is about to be interpreted). */
  function takeSuspect(teamId: string, name: string): boolean {
    return suspect.delete(key(teamId, name));
  }

  // ── delivery ──────────────────────────────────────────────────────────────

  function flush(teamId: string, to: string): void {
    const team = store.get(teamId);
    if (!team || team.status === "closed") return;
    if (holds.has(key(teamId, to))) return;
    const target = targetOf(team, to);
    if (!target) return;
    const driver = deps.driverFor(team);
    if (!driver) return;
    const sent = handedSet(teamId);
    const queue = store.pendingMail(teamId, to).filter((m) => !sent.has(m.id));
    let i = 0;
    while (i < queue.length) {
      const wake = (queue[i] as Mail).wake;
      const group: Mail[] = [];
      while (i < queue.length && (queue[i] as Mail).wake === wake) group.push(queue[i++] as Mail);
      let ok = false;
      try {
        ok = driver.deliver(target.ref, group, { wake });
      } catch (err) {
        logger.warn(`agent-teams: deliver to ${to} threw: ${(err as Error).message}`);
      }
      if (!ok) return; // stays queued; the rest of the queue keeps its order behind it
      for (const m of group) sent.add(m.id);
      logger.info(`agent-teams: mail ${group.map((m) => m.id).join(",")} -> ${to} (${group.reduce((n, m) => n + m.text.length, 0)} chars, wake=${wake})`);
      if (wake && target.member) startProvisional(team, target.member);
    }
  }

  /** Forget what was handed to `to`: the next flush re-emits every unacked id (it may have missed them). */
  function unhand(teamId: string, to: string): void {
    const sent = handed.get(teamId);
    if (sent) for (const m of store.pendingMail(teamId, to)) sent.delete(m.id);
  }

  /** `hello` from a recipient (reconnect, listener not attached): re-emit every unacked id. */
  function noteHello(teamId: string, to: string): void {
    unhand(teamId, to);
    flush(teamId, to);
  }

  /** Acknowledge mail ids (idempotent); acked ids can never be re-emitted. */
  function ack(teamId: string, ids: readonly number[]): number[] {
    const fresh = store.ackMail(teamId, ids);
    const sent = handed.get(teamId);
    if (sent) for (const id of ids) sent.delete(id);
    return fresh;
  }

  function isHandedOver(teamId: string, mailId: number): boolean {
    return handed.get(teamId)?.has(mailId) === true;
  }

  // ── urgent interrupt ──────────────────────────────────────────────────────

  /** Suspend delivery to `name` until its settle report or `urgentSettleWaitMs` (then deliver as a normal wake). */
  function holdUrgent(team: Team, name: string): void {
    const k = key(team.id, name);
    const old = holds.get(k);
    if (old) clock.clearTimeout(old.timer);
    const timer = clock.setTimeout(() => {
      if (!holds.delete(k)) return;
      logger.warn(`agent-teams: ${name} did not settle within urgentSettleWaitMs; delivering the urgent mail as a normal steer wake`);
      flush(team.id, name);
    }, deps.config().urgentSettleWaitMs);
    holds.set(k, { timer });
  }

  /** The member settled (aborted or not): deliver whatever the urgent hold kept back. */
  function releaseOnSettle(teamId: string, name: string): boolean {
    const k = key(teamId, name);
    const h = holds.get(k);
    if (!h) return false;
    clock.clearTimeout(h.timer);
    holds.delete(k);
    flush(teamId, name);
    return true;
  }

  const isHeld = (teamId: string, name: string): boolean => holds.has(key(teamId, name));

  /** A member exited: drop its provisional/hold state and forget what was handed over. */
  function forget(teamId: string, name: string): void {
    confirm(teamId, name);
    const k = key(teamId, name);
    suspect.delete(k);
    const h = holds.get(k);
    if (h) clock.clearTimeout(h.timer);
    holds.delete(k);
    const sent = handed.get(teamId);
    if (sent) for (const m of store.mailLog(teamId)) if (m.to === name) sent.delete(m.id);
  }

  /** A team closed: drop every timer and in-flight marker it owns. */
  function dropTeam(teamId: string): void {
    const prefix = `${teamId}\u0000`;
    for (const [k, p] of [...provisional]) {
      if (!k.startsWith(prefix)) continue;
      clock.clearTimeout(p.timer);
      provisional.delete(k);
    }
    for (const [k, h] of [...holds]) {
      if (!k.startsWith(prefix)) continue;
      clock.clearTimeout(h.timer);
      holds.delete(k);
    }
    for (const k of [...suspect]) if (k.startsWith(prefix)) suspect.delete(k);
    handed.delete(teamId);
  }

  function dispose(): void {
    for (const p of provisional.values()) clock.clearTimeout(p.timer);
    for (const h of holds.values()) clock.clearTimeout(h.timer);
    provisional.clear();
    holds.clear();
    suspect.clear();
    handed.clear();
  }

  return { flush, noteHello, unhand, ack, isHandedOver, confirm, isProvisional, takeSuspect, holdUrgent, releaseOnSettle, isHeld, forget, dropTeam, dispose };
}

export type MailEngine = ReturnType<typeof createMailEngine>;
