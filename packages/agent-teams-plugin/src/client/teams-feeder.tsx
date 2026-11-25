/**
 * TeamsFeeder — the render-less component mounted with the Team view (design D3;
 * task 7.2). `useSessionEvents` and `useShellConnectionStatus` are React hooks
 * while the cache is module-level, so this component bridges them:
 *
 * - watches the route session in the store (lookup, then the team snapshot, the
 *   60 s safety timer and the visibility listener live exactly as long as it is
 *   mounted; StrictMode's double effect still makes ONE initial request);
 * - pushes the NEWEST `agent-teams:changed` frame of the team into the store
 *   (the store decides whether it is news; replayed old frames are no-ops);
 * - signals a socket reconnect (a transition into `connected` after a drop);
 * - ignores an events-array reset: shorter array = "no information", the cached
 *   snapshot stays and the next trigger refreshes it.
 *
 * Frames are scoped to the LEAD session, so pass `leadSessionId` when the viewed
 * session is a teammate; without it the viewed session's own events are read
 * (correct for the lead's view). Core's snapshot does not expose the lead's
 * session id yet — until it does, a teammate's view converges by reconnect,
 * visibility and the 60 s timer only.
 * See change: add-agent-teams-ui.
 */
import { useSessionEvents, useShellConnectionStatus } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useEffect, useRef } from "react";
import { AGENT_TEAMS_EVENT_CHANGED } from "../shared/ui-protocol.js";
import { useSessionLookup } from "./teams-hooks.js";
import { type ChangedFrame, type TeamsStore, teamsStore } from "./teams-store.js";

export interface TeamsFeederProps {
  /** The session of the route (`/session/:sessionId/team`). */
  sessionId: string;
  /** The lead's session id when it differs from `sessionId`. */
  leadSessionId?: string;
  /** Test seam; defaults to the shared store. */
  store?: TeamsStore;
}

interface EventLike {
  eventType?: unknown;
  data?: unknown;
}

/** `agent-teams:changed` payload of `teamId`, or `undefined` for any other / malformed event. */
export function frameOf(event: EventLike, teamId: string): ChangedFrame | undefined {
  if (event.eventType !== AGENT_TEAMS_EVENT_CHANGED) return undefined;
  const d = event.data as { teamId?: unknown; epoch?: unknown; rev?: unknown; closed?: unknown } | null | undefined;
  if (!d || d.teamId !== teamId || typeof d.epoch !== "string" || typeof d.rev !== "number" || !Number.isFinite(d.rev)) return undefined;
  return d.closed === true ? { epoch: d.epoch, rev: d.rev, closed: true } : { epoch: d.epoch, rev: d.rev };
}

export function TeamsFeeder({ sessionId, leadSessionId, store = teamsStore }: TeamsFeederProps): null {
  const events = useSessionEvents(leadSessionId ?? sessionId);
  const connection = useShellConnectionStatus();
  const teamId = useSessionLookup(sessionId, store)?.teamId ?? null;

  useEffect(() => store.watchSession(sessionId), [store, sessionId]);

  // Frames: only the not-yet-seen tail, newest matching frame first.
  const seen = useRef({ teamId: null as string | null, length: 0 });
  useEffect(() => {
    if (!teamId) return;
    const cursor = seen.current;
    if (cursor.teamId !== teamId || events.length < cursor.length) {
      cursor.teamId = teamId; // a new team, or a reset of the array: rescan, never touch the cache
      cursor.length = 0;
    }
    for (let i = events.length - 1; i >= cursor.length; i--) {
      const frame = frameOf(events[i] as EventLike, teamId);
      if (frame) {
        store.ingestFrame(teamId, frame);
        break;
      }
    }
    cursor.length = events.length;
  }, [events, teamId, store]);

  // Reconnect: a transition into `connected` after the socket was down.
  const lastConnection = useRef(connection);
  const sawConnected = useRef(connection === "connected");
  useEffect(() => {
    const prev = lastConnection.current;
    lastConnection.current = connection;
    if (connection !== "connected") return;
    if (prev !== "connected" && (sawConnected.current || prev !== "connecting")) store.signalReconnect();
    sawConnected.current = true;
  }, [connection, store]);

  return null;
}
