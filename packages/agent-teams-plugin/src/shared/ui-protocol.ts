/**
 * UI wire contract (server ⇄ Team view): the snapshot additions, the content-free
 * `agent-teams:changed` frame, the two control responses and their error codes.
 * Core's `TeamSnapshot` is extended, never redefined; `rev` and `mailTotal` are core's.
 * See change: add-agent-teams-ui.
 */
import { AGENT_TEAMS_EVENT_CHANGED } from "./plugin-id.js";
import type { TeamSnapshot } from "./snapshot.js";

export { AGENT_TEAMS_EVENT_CHANGED };

/** Error codes this change adds; `not_found` is the one body shared by unknown, invisible and forged-control requests. */
export const UI_ERROR_CODES = ["not_busy", "not_connected", "team_closed", "bad_session_id"] as const;
export type UiErrorCode = (typeof UI_ERROR_CODES)[number];
export type UiErrorBody = { error: UiErrorCode | "not_found" | "rate_limited" | "bad_request" | "internal_error" };

/** `GET /teams?sessionId=` accepts at most this many characters. */
export const SESSION_ID_MAX_LENGTH = 128;
/** Per-team ceiling of `plugin_event` frames: one per window, leading and trailing. */
export const CHANGED_COALESCE_MS = 1000;
/** Lead stamp: top-level session-ref key written for the lead session (teammates use core's `agent-teams`). */
export const LEAD_STAMP_KEY = "agent-teams-lead";

/** The snapshot as served to the UI: core's view plus the server epoch and the viewer's control capability. */
export interface TeamUiSnapshot extends TeamSnapshot {
  /** Random id minted at server start; a changed epoch forces a refetch. */
  epoch: string;
  /** Owner rule only; does NOT reflect the credential tier (the host gate answers 403 there). */
  viewerCanControl: boolean;
}

/** `data` of the `agent-teams:changed` frame. Ids and counters only — never agent text. */
export interface AgentTeamsChangedPayload {
  teamId: string;
  epoch: string;
  rev: number;
  closed?: true;
}

/** `POST …/members/:name/stop` → 200. */
export interface StopMemberResponse {
  aborted: true;
}

/** `POST …/shutdown` → 202. */
export interface ShutdownTeamResponse {
  closing: true;
}

/**
 * Strong ETag of a snapshot: `"<epoch>:<rev>"` for a viewer who can control the team, `"<epoch>:<rev>:ro"`
 * for one who cannot (the body carries the per-viewer `viewerCanControl`, so the validator must too);
 * compared by exact string equality only.
 */
export function snapshotEtag(epoch: string, rev: number, viewerCanControl = true): string {
  return `"${epoch}:${rev}${viewerCanControl ? "" : ":ro"}"`;
}
