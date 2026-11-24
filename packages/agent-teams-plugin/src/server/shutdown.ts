/**
 * Shutdown handshake (tasks 7.2–7.4, design D12): the lead's `ShutdownRequest`
 * puts a member in `shutdown_pending` and wakes it with a `shutdown_request` mail;
 * `ShutdownResponse{approve:false, reason}` returns it to its previous state and
 * wakes the lead through the coalesced notice; `approve:true` releases its tasks,
 * then waits for the member's next settle or `shutdownGraceMs` and calls the
 * driver's `shutdown` EXACTLY once, after which `onExit` (ops `releaseMember`)
 * marks it `gone`. "All pending requests resolved" (the wake rule) is derived from
 * the outstanding request records. A server-initiated request wakes the lead only
 * on a rejection or when the member never answered within `shutdownGraceMs`.
 * Forced `TeamDelete` has its own path in `ops.ts` and creates no request record.
 * See change: add-agent-teams-core.
 */
import type { Clock } from "../shared/clock.js";
import { LEAD_ADDRESS } from "../shared/constants.js";
import type { OpResult, ShutdownResponseResult } from "../shared/protocol.js";
import type { Mail, MemberStatus, Team } from "../shared/types.js";
import { isRecord, own, textField } from "./args.js";
import type { ConfigReader } from "./config.js";
import type { MemberDriver } from "./driver.js";
import type { MailEngine } from "./mail.js";
import { fail, isLive } from "./op-util.js";
import type { TeamStore } from "./store.js";
import type { LeadItem } from "./tasks.js";
import type { Telemetry } from "./telemetry.js";
import type { Actor, Logger } from "./types.js";

interface Request {
  actor: Actor;
  /** Status to return to on a rejection or a timeout. */
  prev: MemberStatus;
  approved: boolean;
  /** Tasks released at approval, for the lead notice written when the session ended. */
  released: string[];
  unowned: string[];
  started: boolean;
  timer?: unknown;
}

export interface ShutdownDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  telemetry: Telemetry;
  config: ConfigReader;
  engine: MailEngine;
  driverFor(team: Team): MemberDriver | undefined;
  mailTo(team: Team, to: string, input: { from: string; kind: string; text: string; wake: boolean }): Mail | undefined;
  notify(team: Team, item: LeadItem): void;
  releaseTasksOf(team: Team, name: string, reason: string): { released: string[]; unowned: string[] };
  /** Mark the member `gone` once its session ended (ops `releaseMember`). */
  onExit(team: Team, name: string): void;
  /** A member returned to work after a rejection/timeout: let the dispatcher look again. */
  onResumed(team: Team): void;
}

const key = (teamId: string, name: string): string => `${teamId}\u0000${name}`;

export function createShutdown(deps: ShutdownDeps) {
  const { store, clock, logger } = deps;
  const requests = new Map<string, Request>();

  function pendingCount(teamId: string): number {
    let n = 0;
    for (const k of requests.keys()) if (k.startsWith(`${teamId}\u0000`)) n++;
    return n;
  }

  /** Request half of the handshake (lane `ShutdownRequest` and the `requestShutdown` actor op). */
  function request(team: Team, name: string, opts: { actor: Actor; reason?: string }): OpResult<{ member: string; status: "shutdown_pending" }> {
    const member = store.member(team, name);
    if (!member) return fail("unknown_recipient", name);
    if (!isLive(member)) return fail("member_gone", name);
    const ok = { ok: true as const, data: { member: name, status: "shutdown_pending" as const } };
    if (member.status === "shutdown_pending") return ok; // idempotent: no second mail
    const k = key(team.id, name);
    const req: Request = { actor: opts.actor, prev: member.status === "spawning" || member.status === "disconnected" ? "idle" : member.status, approved: false, released: [], unowned: [], started: false };
    requests.set(k, req);
    store.patchMember(team.id, name, { status: "shutdown_pending" });
    deps.telemetry.log("shutdown", team.id, { member: name, phase: "requested", actor: opts.actor });
    const from = opts.actor === "server" || opts.actor === "user" ? "server" : LEAD_ADDRESS;
    deps.mailTo(team, name, {
      from,
      kind: "shutdown_request",
      text: opts.reason ? `Shutdown requested: ${opts.reason}` : "Shutdown requested. Finish your current step, then approve or reject with ShutdownResponse.",
      wake: true,
    });
    if (opts.actor === "server") {
      // A server request nobody answers wakes the lead (the only non-rejection wake for a server request).
      req.timer = clock.setTimeout(() => {
        if (requests.get(k) !== req || req.approved) return;
        requests.delete(k);
        const current = store.member(team, name);
        if (current?.status === "shutdown_pending") store.patchMember(team.id, name, { status: req.prev });
        deps.telemetry.log("shutdown", team.id, { member: name, phase: "timeout" });
        deps.notify(team, { head: `${name} did not answer the server's shutdown request`, wake: true });
        deps.onResumed(team);
      }, deps.config().shutdownGraceMs);
    }
    return ok;
  }

  function requestOp(raw: unknown, caller: { role: string; team?: Team }): OpResult<{ member: string; status: "shutdown_pending" }> {
    if (caller.role !== "lead" || !caller.team) return fail("not_lead");
    if (!isRecord(raw)) return fail("invalid_args", "args must be an object");
    const to = own(raw, "to");
    const reason = textField(own(raw, "reason"), 500, { multiline: true });
    if (typeof to !== "string" || !reason.ok) return fail("invalid_args");
    return request(caller.team, to, { actor: "lead", ...(reason.value ? { reason: reason.value } : {}) });
  }

  function responseOp(raw: unknown, caller: { role: string; name: string; team?: Team }): OpResult<ShutdownResponseResult> {
    const team = caller.team;
    if (!team || caller.role !== "member") return fail("not_in_team");
    if (!isRecord(raw)) return fail("invalid_args", "args must be an object");
    const approve = own(raw, "approve");
    const reason = textField(own(raw, "reason"), 500, { multiline: true });
    if (typeof approve !== "boolean" || !reason.ok) return fail("invalid_args");
    const name = caller.name;
    const k = key(team.id, name);
    const req = requests.get(k);
    if (!req || req.approved || store.member(team, name)?.status !== "shutdown_pending") return fail("no_pending_request");
    if (!approve) {
      if (!reason.value) return fail("reason_required", "a rejection needs a reason");
      requests.delete(k);
      if (req.timer !== undefined) clock.clearTimeout(req.timer);
      store.patchMember(team.id, name, { status: req.prev });
      deps.telemetry.log("shutdown", team.id, { member: name, phase: "rejected" });
      deps.notify(team, { head: `${name} rejected the shutdown request`, body: reason.value, wake: true });
      deps.onResumed(team);
      return { ok: true, data: { approved: false } };
    }
    req.approved = true;
    deps.telemetry.log("shutdown", team.id, { member: name, phase: "approved" });
    if (req.timer !== undefined) clock.clearTimeout(req.timer);
    const freed = deps.releaseTasksOf(team, name, "approved shutdown");
    req.released = freed.released;
    req.unowned = freed.unowned;
    // The session ends after the member's next settle, or after the grace period (never twice).
    req.timer = clock.setTimeout(() => begin(team, name), deps.config().shutdownGraceMs);
    return { ok: true, data: { approved: true } };
  }

  /** The member settled: an approved member's session may now end. */
  function onSettle(team: Team, name: string): void {
    const req = requests.get(key(team.id, name));
    if (req?.approved) begin(team, name);
  }

  function begin(team: Team, name: string): void {
    const req = requests.get(key(team.id, name));
    if (!req || !req.approved || req.started) return;
    req.started = true;
    deps.telemetry.log("shutdown", team.id, { member: name, phase: "ending" });
    if (req.timer !== undefined) clock.clearTimeout(req.timer);
    const member = store.member(team, name);
    const driver = deps.driverFor(team);
    const finish = (): void => deps.onExit(team, name);
    if (!member || !driver) return finish();
    void driver
      .shutdown({ teamId: team.id, member: name, ...(member.sessionId ? { sessionId: member.sessionId } : {}) })
      .then((ok) => {
        if (!ok) logger.warn(`agent-teams: shutdown of ${name} was not confirmed`);
      })
      .catch((err: unknown) => logger.warn(`agent-teams: shutdown of ${name} failed: ${(err as Error).message}`))
      .finally(finish);
  }

  /**
   * The member is leaving (session ended or shutdown done): hand back its request
   * record so `releaseMember` can write ONE lead item, and drop the timers. Whether
   * every outstanding request is now resolved is `pendingCount(team) === 0` after this.
   */
  function consume(teamId: string, name: string): { approved: boolean; actor: Actor; released: string[]; unowned: string[] } | undefined {
    const k = key(teamId, name);
    const req = requests.get(k);
    if (!req) return undefined;
    if (req.timer !== undefined) clock.clearTimeout(req.timer);
    requests.delete(k);
    return { approved: req.approved, actor: req.actor, released: req.released, unowned: req.unowned };
  }

  function dispose(): void {
    for (const r of requests.values()) if (r.timer !== undefined) clock.clearTimeout(r.timer);
    requests.clear();
  }

  return { request, requestOp, responseOp, onSettle, consume, pendingCount, dispose };
}
