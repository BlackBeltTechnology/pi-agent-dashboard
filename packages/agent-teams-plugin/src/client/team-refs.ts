/**
 * Pure predicate over the TOP-LEVEL plugin-ref projection (what `session_updated`
 * actually broadcasts): a non-empty string `teamId` under `agent-teams` (teammate,
 * written by core's spawn) or `agent-teams-lead` (lead, stamped by `ui-bridge.ts`).
 * Both present ⇒ the lead variant wins; `{teamId: null}` is the clear sentinel.
 * Eager: runs before any badge renders, no React and no `@mdi` import.
 * See change: add-agent-teams-ui (design D6).
 */

export type TeamRole = { kind: "lead" } | { kind: "member"; name: string | undefined };

const LEAD_KEY = "agent-teams-lead";
const MEMBER_KEY = "agent-teams";

interface RefBag {
  teamId?: unknown;
  member?: unknown;
}

function refOf(session: unknown, key: string): RefBag | undefined {
  if (session === null || typeof session !== "object") return undefined;
  const value = (session as Record<string, unknown>)[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RefBag) : undefined;
}

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The role a session plays in a team, or `null` (plain session / cleared stamp). */
export function teamRoleOf(session: unknown): TeamRole | null {
  if (nonEmptyString(refOf(session, LEAD_KEY)?.teamId)) return { kind: "lead" };
  const mate = refOf(session, MEMBER_KEY);
  if (nonEmptyString(mate?.teamId)) return { kind: "member", name: nonEmptyString(mate.member) ? mate.member : undefined };
  return null;
}

/** `session-card-badge` claim predicate. */
export function isTeamSession(session: unknown): boolean {
  return teamRoleOf(session) !== null;
}
