/**
 * Lead lifecycle of in-process teams (design D7, spec "Lead end, reload and session replacement close the team", "Pending stops retention").
 * Children are in-memory sessions of the LEAD process: they never outlive it, so there is no orphan window.
 *
 * - `onSessionEnded(lead)`  `/new`, `/fork`, process death, heartbeat lapse: members `gone: lead_ended`, tasks released, ONE waking notice, team
 *   closed `lead_ended` at once. Because the host reports an end for a lapse too (the lead may be alive and its children still running),
 *   a `pendingStops` entry is recorded per live child and a best-effort `stop` goes out on the same incarnation's next hello.
 * - `onReload(team)`        the lead's new bridge activation (a different `incarnation`) reports in: the old children are dead, members
 *   `gone: lead_reloaded`, tasks released, the notice is delivered to the (still connected) lead, then the team closes `lead_reloaded`.
 * - `recordStop` / `onHello` / `expireStops`  `pendingStops`: same incarnation ⇒ one `stop` per child; a different one ⇒ discarded (logged);
 *   entries expire after 24 h and never exceed the number of members the team ever had.
 * Both closes are idempotent (a closed team is skipped), so either arrival order of an end and a hello leaves one closed team and one notice.
 * See change: add-agent-teams-in-process.
 */
import type { Clock } from "../shared/clock.js";
import { IN_PROCESS_MODE } from "../shared/inproc-protocol.js";
import type { CloseReason, Member, PendingStop, Team } from "../shared/types.js";
import type { InProcDriver } from "./driver-inproc.js";
import type { InProcAvailability } from "./modes-inproc.js";
import { isLive } from "./op-util.js";
import type { Ops } from "./ops.js";
import type { TeamStore } from "./store.js";
import type { Logger } from "./types.js";

/** Entries older than this are dropped (spec: expire after 24 h). */
export const PENDING_STOP_TTL_MS = 24 * 60 * 60 * 1000;

export interface InProcLeadDeps {
  store: TeamStore;
  clock: Clock;
  logger: Logger;
  driver: InProcDriver;
  availability: InProcAvailability;
  ops: Pick<Ops, "releaseMember" | "teamDelete" | "flushNotices">;
}

export interface InProcLead {
  /** The host ended `sessionId`: true when it was the lead of an in-process team (handled here), false for core to handle. */
  onSessionEnded(sessionId: string): boolean;
  /** The lead's bridge reactivated (different `incarnation`): the team's children are gone. */
  onReload(team: Team): void;
  /** A child may still run after its member ended: remember it for a best-effort `stop`. */
  recordStop(teamId: string, stop: { member: string; childId?: string; agentId?: string }): void;
  /** An available `inproc hello` of `sessionId` with `incarnation`: deliver or discard its teams' pending stops. */
  onHello(sessionId: string, incarnation: string): void;
  /** Drop expired entries (every hello and record does it too). */
  expireStops(): void;
}

const stopOf = (m: Member): { member: string; childId?: string; agentId?: string } => ({ member: m.name, ...(m.childId ? { childId: m.childId } : {}), ...(m.childAgentId ? { agentId: m.childAgentId } : {}) });

export function createInProcLead(deps: InProcLeadDeps): InProcLead {
  const { store, clock, logger, driver, availability, ops } = deps;

  const incarnationOf = (team: Team): string => team.leadIncarnation ?? (team.leadSessionId ? availability.get(team.leadSessionId)?.incarnation : undefined) ?? "unknown";

  function prune(team: Team): PendingStop[] {
    const now = clock.now();
    return (team.pendingStops ?? []).filter((s) => s.at === undefined || now - s.at < PENDING_STOP_TTL_MS);
  }

  function save(team: Team, stops: PendingStop[]): void {
    store.patchTeam(team.id, { pendingStops: stops.length > 0 ? stops : undefined }, { writeThrough: true });
  }

  function recordStop(teamId: string, stop: { member: string; childId?: string; agentId?: string }): void {
    const team = store.get(teamId);
    if (!team || (stop.childId === undefined && stop.agentId === undefined)) return;
    const kept = prune(team).filter((s) => s.childId !== (stop.childId ?? "") || s.agentId !== (stop.agentId ?? ""));
    kept.push({ member: stop.member, childId: stop.childId ?? "", agentId: stop.agentId ?? "", incarnation: incarnationOf(team), at: clock.now() });
    // Never more entries than members the team ever had (oldest dropped).
    save(team, kept.slice(-Math.max(1, team.members.length)));
  }

  /** Members released, the notice posted, the team closed. `connected` ⇒ the lead can still read the notice. */
  function closeTeam(team: Team, reason: CloseReason, memberReason: string, connected: boolean): void {
    if (team.status === "closed") return;
    const members = team.members.filter(isLive);
    if (reason === "lead_ended") for (const m of members) recordStop(team.id, stopOf(m));
    driver.failQueued(team.id, reason); // commands that never left (the spawns among them fail their members)
    if (!connected) store.setLeadConnected(team.id, false);
    for (const m of members) ops.releaseMember(team, m.name, "gone", memberReason);
    ops.flushNotices(team); // the one coalesced waking notice must not be lost with the close
    ops.teamDelete(team, { actor: "server", force: true, closeReason: reason });
    logger.info(`agent-teams: in-process team ${team.id} closed: ${reason}`);
  }

  /** The lead is back: stop the children of the SAME incarnation once; entries of another one (its process restarted) are discarded. */
  function deliverStops(team: Team, incarnation: string): void {
    for (const s of prune(team)) {
      if (s.incarnation !== incarnation) {
        logger.info(`agent-teams: pending stop of child ${s.childId || s.agentId} discarded: the lead restarted (incarnation changed) team=${team.id}`);
        continue;
      }
      logger.info(`agent-teams: pending stop of child ${s.childId || s.agentId} sent team=${team.id}`);
      void driver.stopChild(team.id, { member: s.member ?? (s.childId || s.agentId), ...(s.childId ? { childId: s.childId } : {}), ...(s.agentId ? { agentId: s.agentId } : {}) });
    }
    save(team, []); // best effort: once per child
  }

  return {
    onSessionEnded(sessionId) {
      const binding = store.findBySession(sessionId);
      const team = binding ? store.get(binding.teamId) : undefined;
      if (!binding || !team || binding.who !== "lead" || team.mode !== IN_PROCESS_MODE) return false;
      closeTeam(team, "lead_ended", "lead_ended", false);
      return true;
    },

    onReload(team) {
      closeTeam(team, "lead_reloaded", "lead_reloaded", true);
    },

    recordStop,

    onHello(sessionId, incarnation) {
      for (const team of store.list()) {
        if (team.leadSessionId === sessionId && team.mode === IN_PROCESS_MODE && team.pendingStops?.length) deliverStops(team, incarnation);
      }
    },

    expireStops() {
      for (const team of store.list()) {
        if (!team.pendingStops?.length) continue;
        const kept = prune(team);
        if (kept.length !== team.pendingStops.length) save(team, kept);
      }
    },
  };
}
