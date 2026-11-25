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
