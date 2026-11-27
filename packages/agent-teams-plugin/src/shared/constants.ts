/**
 * Shared constants and tiny helpers exported ONCE from `shared/` (task 2.11).
 * Later changes import these; the server enforces exactly these values, so a
 * copy anywhere else is a defect (test-plan S140).
 * See change: add-agent-teams-core.
 */

/** Persisted team file format version (`Team.schemaVersion`). */
export const SCHEMA_VERSION = 1;

/** Member-name grammar: lowercase start, then lowercase/digit/hyphen, 32 chars max. */
export const MEMBER_NAME_REGEXP = /^[a-z][a-z0-9-]{0,31}$/;
export const MEMBER_NAME_MAX_LENGTH = 32;

/** Address of the lead in `to` / `owner` / envelope sender position (never a member name). */
export const LEAD_ADDRESS = "lead";
/** Names a member can never take, so senders, recipients and owners are unambiguous. */
export const RESERVED_MEMBER_NAMES: readonly string[] = ["lead", "server", "system", "all", "user"];
/** Envelope senders the parser accepts besides member names. */
export const RESERVED_SENDERS: readonly string[] = ["lead", "server"];

/** Text caps (code points) enforced by the sanitiser. */
export const TEAM_NAME_MAX_CHARS = 40;
export const TASK_TITLE_MAX_CHARS = 200;
export const TASK_DESCRIPTION_MAX_CHARS = 2000;
export const TEAM_DESCRIPTION_MAX_CHARS = 2000;

/** Mail framing: the whole delivered block (envelope included) is at most this many lines. */
export const MAX_MAIL_LINES = 150;
/**
 * A coalesced steer batch is capped exactly like one mail block (no per-steer split in v1).
 * @alias
 */
export const STEER_BLOCK_MAX_LINES = MAX_MAIL_LINES;
/** A plan carried by one `plan_request` mail is at most this many lines (templates-hooks change). */
export const PLAN_MAX_LINES = 120;
/** Plans kept per team (oldest decided dropped first, a pending plan never dropped). */
export const MAX_STORED_PLANS = 20;

/** Final marker line of a line-capped block; counted INSIDE the cap. */
export function truncationMarkerLine(removedLines: number): string {
  return `[… ${removedLines} lines truncated]`;
}

/** Default cap for an idle report's `finalText` (config `maxFinalTextChars`). */
export const MAX_FINAL_TEXT_CHARS = 2000;
export const TRUNCATION_MARKER = " […truncated]";

/** Lead notices are buffered for this long from the first item (config `notifyCoalesceMs`). */
export const NOTIFY_COALESCE_MS = 2000;

/** REST rate limits per principal (client address when unauthenticated). */
export const REST_READ_RATE = { perSecond: 8, burst: 16 } as const;
export const REST_WRITE_RATE = { perSecond: 2, burst: 5 } as const;

/** REST snapshot bounds: the latest mail entries only, each `text` capped (code points) with a `truncated` flag. */
export const SNAPSHOT_MAIL_LIMIT = 100;
export const SNAPSHOT_MAIL_TEXT_MAX = 2000;
/** A route visibility hook that has not answered within this many ms fails closed. */
export const ROUTE_VISIBILITY_TIMEOUT_MS = 1000;

/** Mail-rate token bucket (task 2.11 / design B-rules): capacity 6, refill 1 per 10 s, broadcast costs 1. */
export const MAIL_BUCKET = { capacity: 6, refillMs: 10_000 } as const;

/** `parseEnvelope` bounds: the envelope is one short first line. */
export const ENVELOPE_LIMITS = { maxKindLength: 40, maxLineLength: 200 } as const;

/** `maxTeammates` is clamped into this inclusive range. */
export const MAX_TEAMMATES_RANGE = { min: 1, max: 10 } as const;

/** Mail ids are per-team integers; ascending numeric order is delivery order. */
export function compareMailIds(a: number, b: number): number {
  return a - b;
}
