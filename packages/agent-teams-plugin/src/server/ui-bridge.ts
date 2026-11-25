/**
 * Live-state bridge (design D3, D6): store events → (1) a coalesced, content-free
 * `agent-teams:changed` `plugin_event` frame scoped to the lead session, and
 * (2) the lead's `agent-teams-lead` session-ref stamp, recomputed idempotently
 * from the store's live teams.
 *
 * Frames: at most one per team per `windowMs`, LEADING and TRAILING — the first
 * mutation of a quiet team goes out at once, later ones within the window collapse
 * into one more frame at the window's end carrying the latest `rev`; a team's
 * close is its last frame (`closed:true`). A frame holds ids and counters only
 * (teamId, epoch, rev, closed): never a name or any agent text. The frame is a
 * hint — the snapshot route is the state. Per-team state exists only while a
 * window is open (no timer and no entry at rest).
 *
 * Stamp: `reconcileStamp(sessionId)` compares the live team the session leads
 * with the last applied stamp and writes only a difference (`{teamId}` or the
 * JSON-plain clear `{teamId: null}` — an `undefined` clear would vanish in
 * `JSON.stringify`). A failure is logged once and retried on the next structural
 * event (create/bind/close), or on a plain change after a short back-off.
 *
 * Isolation: every listener swallows its own failure; a throwing broadcast or
 * assign never reaches the mutation that triggered it. `dispose()` removes the
 * listeners (a plugin re-enable must not leave a second one behind).
 * See change: add-agent-teams-ui.
 */
import type { Clock } from "../shared/clock.js";
import { AGENT_TEAMS_PLUGIN_ID } from "../shared/plugin-id.js";
import type { Team } from "../shared/types.js";
import { AGENT_TEAMS_EVENT_CHANGED, type AgentTeamsChangedPayload, CHANGED_COALESCE_MS, LEAD_STAMP_KEY } from "../shared/ui-protocol.js";
import type { TeamStore } from "./store.js";
import type { Logger } from "./types.js";
import type { UiCounters } from "./ui-counters.js";

/** A stamp that failed is not retried on a plain `change` for this long (structural events always retry). */
export const STAMP_RETRY_MS = 2000;

/** The `ServerPluginContext` members the bridge drives. */
export interface UiBridgeHost {
  broadcastToSubscribers(msg: unknown): void;
  assignSessionRef(sessionId: string, ref: Record<string, unknown>, opts?: { persist?: boolean }): boolean;
}

export interface UiBridgeDeps {
  store: TeamStore;
  host: UiBridgeHost;
  epoch: string;
  clock: Clock;
  logger: Logger;
  counters?: Pick<UiCounters, "count">;
  windowMs?: number;
}

export interface UiBridge {
  /** Recompute and apply the stamp of one session. */
  reconcileStamp(sessionId: string): void;
  /** Teams with an open coalescing window (0 at rest). */
  size(): number;
  dispose(): void;
}

interface Window {
  timer: unknown;
  pending?: { rev: number; closed: boolean };
  /** A send already failed in this burst: logged once. */
  errored: boolean;
}

export function createUiBridge(deps: UiBridgeDeps): UiBridge {
  const { store, host, clock, logger, counters } = deps;
  const windowMs = deps.windowMs ?? CHANGED_COALESCE_MS;
  const windows = new Map<string, Window>();
  const stamped = new Map<string, string>();
  const failedAt = new Map<string, number>();
  let warnedStamp = false;

  // ── frames ──────────────────────────────────────────────────────────────────

  function send(teamId: string, leadSession: string, rev: number, closed: boolean, w: Window): void {
    const data: AgentTeamsChangedPayload = { teamId, epoch: deps.epoch, rev, ...(closed ? { closed: true as const } : {}) };
    try {
      host.broadcastToSubscribers({
        type: "plugin_event",
        pluginId: AGENT_TEAMS_PLUGIN_ID,
        sessionId: leadSession,
        event: { eventType: AGENT_TEAMS_EVENT_CHANGED, timestamp: clock.now(), data },
      });
      counters?.count("frames_sent");
    } catch (err) {
      if (!w.errored) logger.error(`agent-teams: changed frame failed team=${teamId}: ${(err as Error).message}`);
      w.errored = true;
    }
  }

  function onWindowEnd(teamId: string): void {
    const w = windows.get(teamId);
    if (!w) return;
    w.timer = undefined;
    const pending = w.pending;
    if (!pending) {
      windows.delete(teamId);
      return;
    }
    w.pending = undefined;
    const lead = store.get(teamId)?.leadSessionId;
    if (lead) send(teamId, lead, pending.rev, pending.closed, w);
    if (pending.closed || !lead) {
      windows.delete(teamId);
      return;
    }
    w.timer = clock.setTimeout(() => onWindowEnd(teamId), windowMs);
  }

  function queueFrame(team: Team, rev: number): void {
    const closed = team.status === "closed";
    const open = windows.get(team.id);
    if (open) {
      open.pending = { rev, closed: closed || open.pending?.closed === true };
      counters?.count("frames_coalesced");
      return;
    }
    if (!team.leadSessionId) return; // nothing to scope the frame to until a lead is bound
    const w: Window = { timer: undefined, errored: false };
    windows.set(team.id, w);
    send(team.id, team.leadSessionId, rev, closed, w);
    if (closed) {
      windows.delete(team.id); // the close frame is the last one
      return;
    }
    w.timer = clock.setTimeout(() => onWindowEnd(team.id), windowMs);
  }

  // ── lead stamp ──────────────────────────────────────────────────────────────

  /** The live team this session leads (most recently created, then smaller id), if any. */
  function liveTeamLedBy(sessionId: string): Team | undefined {
    let best: Team | undefined;
    for (const t of store.list()) {
      if (t.leadSessionId !== sessionId || t.status === "closed") continue;
      if (!best || t.createdAt > best.createdAt || (t.createdAt === best.createdAt && t.id < best.id)) best = t;
    }
    return best;
  }

  function reconcileStamp(sessionId: string): void {
    const desired = liveTeamLedBy(sessionId)?.id ?? null;
    const current = stamped.get(sessionId) ?? null;
    if (desired === current) return;
    let ok = false;
    try {
      ok = host.assignSessionRef(sessionId, { [LEAD_STAMP_KEY]: { teamId: desired } }, { persist: true });
    } catch {
      ok = false;
    }
    if (ok) {
      failedAt.delete(sessionId);
      if (desired === null) stamped.delete(sessionId);
      else stamped.set(sessionId, desired);
      return;
    }
    failedAt.set(sessionId, clock.now());
    if (!warnedStamp) {
      warnedStamp = true;
      logger.warn(`agent-teams: lead stamp failed session=${sessionId}${desired ? ` team=${desired}` : ""}`);
    }
  }

  function reconcileAll(structural: boolean): void {
    const sessions = new Set(stamped.keys());
    for (const t of store.list()) if (t.leadSessionId && t.status !== "closed") sessions.add(t.leadSessionId);
    for (const sid of sessions) {
      const failed = failedAt.get(sid);
      if (!structural && failed !== undefined && clock.now() - failed < STAMP_RETRY_MS) continue;
      reconcileStamp(sid);
    }
  }

  // ── listeners (each isolated) ───────────────────────────────────────────────

  const guard =
    <A extends unknown[]>(what: string, fn: (...a: A) => void) =>
    (...a: A): void => {
      try {
        fn(...a);
      } catch (err) {
        logger.error(`agent-teams: ui bridge ${what} failed: ${(err as Error).message}`);
      }
    };

  const frame = guard("frame", queueFrame);
  const restamp = guard("stamp", reconcileAll);
  const offs = [
    store.on("change", ({ team, rev }) => {
      frame(team, rev);
      restamp(false);
    }),
    store.on("team_created", () => restamp(true)),
    store.on("lead_bound", () => restamp(true)),
    store.on("team_closed", () => restamp(true)),
  ];

  // A restart hydrates live teams without events: stamp them now (idempotent at the host).
  restamp(true);

  return {
    reconcileStamp: guard("reconcileStamp", reconcileStamp),
    size: () => windows.size,
    dispose() {
      for (const off of offs) off();
      for (const w of windows.values()) if (w.timer !== undefined) clock.clearTimeout(w.timer);
      windows.clear();
      stamped.clear();
      failedAt.clear();
    },
  };
}
