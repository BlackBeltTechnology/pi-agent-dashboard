/**
 * Client route and REST path table (eager; no React). The overlay-route claim
 * path in the manifest equals `TEAM_VIEW_ROUTE`; every concrete URL is built
 * here with `encodeURIComponent`, never by string-splicing an id elsewhere.
 * See change: add-agent-teams-ui (design D1, D2).
 */

/** `shell-overlay-route` claim path (wouter pattern); the manifest repeats it verbatim. */
export const TEAM_VIEW_ROUTE = "/session/:sessionId/team";
/** Back target of the overlay route (`parentPath`). */
export const TEAM_VIEW_PARENT_ROUTE = "/session/:sessionId";
/** REST prefix of this plugin (core's `API_PREFIX`). */
export const TEAMS_API = "/api/plugins/agent-teams";

/** Team view URL of a session (lead or teammate): `/session/<encoded id>/team`. */
export function teamViewPath(sessionId: string): string {
  return `/session/${encodeURIComponent(sessionId)}/team`;
}
