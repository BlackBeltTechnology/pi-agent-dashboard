/**
 * agent-teams-plugin · CLIENT entry (eager).
 *
 * Exports ONLY what must run before any lazy chunk loads: the badge-label i18n
 * `catalog`, the `isTeamSession` predicate and the `TeamBadge` claim component.
 * Every other claim component (Team view, tool renderers, mail card) is a lazy
 * manifest `module` and MUST NOT be exported or imported from here.
 * See change: add-agent-teams-core, add-agent-teams-ui (design D9).
 */
export { catalog } from "../i18n.js";
export { TeamBadge } from "./TeamBadge.js";
export { isTeamSession } from "./team-refs.js";
