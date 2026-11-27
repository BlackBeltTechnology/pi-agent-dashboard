/**
 * Agent-teams plugin identity constants shared by the server, bridge and tests.
 * `AGENT_TEAMS_PLUGIN_ID` MUST equal the manifest `pi-dashboard-plugin.id`
 * (enforced by `__tests__/manifest-contract.test.ts`).
 * See change: add-agent-teams-core.
 */
export const AGENT_TEAMS_PLUGIN_ID = "agent-teams";

/** Event types the server may emit into sessions; mirrors manifest `emits`. */
export const AGENT_TEAMS_EVENT_MAIL = "agent-teams:mail";
export const AGENT_TEAMS_EVENT_TEAM_CLOSED = "agent-teams:team_closed";
/** Server → lead-bridge command channel of the in-process mode (spawn/steer/interrupt/stop/snapshot). See change: add-agent-teams-in-process. */
export const AGENT_TEAMS_EVENT_INPROC = "agent-teams:inproc";
/** Coalesced content-free invalidation frame (`plugin_event`) for the Team view. See change: add-agent-teams-ui. */
export const AGENT_TEAMS_EVENT_CHANGED = "agent-teams:changed";
