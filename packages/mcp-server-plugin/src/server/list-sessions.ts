/**
 * Bounded, filterable, cursor-paged session listing — the pure half of the
 * `list_sessions` tool (design.md D1–D5).
 *
 * `list_sessions` used to hand back `sessionManager.listAll()` verbatim: the
 * whole store in one response (measured 539 rows / 599 KB for a query whose
 * useful answer was the 10 non-ended rows). This module owns the bound, the
 * three filters and the keyset walk, leaving `index.ts` a one-liner and giving
 * the behaviour a direct, deterministic test surface.
 *
 * Ordering follows the repo's recency convention
 * (`endedAt ?? lastActivityAt ?? startedAt`, `id` ascending as tiebreak) — the
 * same key the UI and the snapshot window use — so the tool never disagrees
 * with the client about which session is "newest". Keyset (not offset) paging
 * is what makes a walk immune to inserts/removals between pages.
 */
import crypto from "node:crypto";
import { pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type {
  DashboardSession,
  SessionStatus,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Default page size when the caller passes no `limit` (design D1). */
export const DEFAULT_LIMIT = 25;

/** Hard maximum a caller cannot raise (design D1). */
export const MAX_LIMIT = 200;

/** The accepted `status` filter values — mirrors `SessionStatus`. */
export const SESSION_STATUSES: readonly SessionStatus[] = [
  "active",
  "idle",
  "streaming",
  "ended",
];

export interface ListSessionsArgs {
  limit?: number;
  status?: SessionStatus[];
  cwd?: string;
  since?: number;
  cursor?: string;
}

export interface ListSessionsPage {
  sessions: DashboardSession[];
  /** Post-filter match count (before the cursor), so callers can tell "3 of 539" from "3 of 3". */
  total: number;
  /** Absent — not `null` — on the final page, so "more exist" is one unambiguous check. */
  nextCursor?: string;
}

/** The recency sort key, matching the server snapshot and the client card badge. */
export function sessionSortKey(session: DashboardSession): number {
  return session.endedAt ?? session.lastActivityAt ?? session.startedAt;
}

interface SortPos {
  key: number;
  finite: boolean;
  id: string;
}

function sortPos(session: DashboardSession): SortPos {
  const key = sessionSortKey(session);
  return { key, finite: Number.isFinite(key), id: session.id };
}

/**
 * Total order: recency descending, `id` ascending as tiebreak. A non-finite key
 * (a corrupt timestamp from an unvalidated discovery header) sorts last under a
 * deterministic fallback rather than poisoning every comparison — `NaN` breaks
 * total ordering because every comparison against it is false.
 */
function comparePos(a: SortPos, b: SortPos): number {
  if (a.finite && b.finite) {
    if (a.key !== b.key) return b.key - a.key;
  } else if (a.finite !== b.finite) {
    return a.finite ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Normalized `cwd` used both for matching and for the cursor's filter digest. */
function normalizedCwd(cwd: string | undefined, platform: NodeJS.Platform): string | null {
  return cwd === undefined ? null : pathKey(cwd, platform);
}

/**
 * Digest binding a cursor to the filter arguments and limit that produced it
 * (design D3). A cursor presented with a different result-set shape is rejected
 * rather than silently walking a different query.
 */
function digestOf(args: ListSessionsArgs, platform: NodeJS.Platform): string {
  const canonical = JSON.stringify({
    limit: args.limit ?? DEFAULT_LIMIT,
    status: args.status ? [...args.status].sort() : null,
    cwd: normalizedCwd(args.cwd, platform),
    since: args.since ?? null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

interface CursorPayload {
  key: number | null;
  id: string;
  digest: string;
}

function encodeCursor(pos: SortPos, digest: string): string {
  const payload: CursorPayload = { key: pos.finite ? pos.key : null, id: pos.id, digest };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Decode an opaque cursor. Returns null for anything unparseable or misshapen. */
function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { key, id, digest } = parsed as Record<string, unknown>;
    if (key !== null && typeof key !== "number") return null;
    if (typeof id !== "string" || typeof digest !== "string") return null;
    return { key, id, digest };
  } catch {
    return null;
  }
}

function cursorPos(payload: CursorPayload): SortPos {
  return {
    key: payload.key ?? Number.NaN,
    finite: payload.key !== null,
    id: payload.id,
  };
}

/**
 * Tool-specific argument check beyond the JSON-Schema shapes (design D3/D4):
 * an undecodable cursor, or one whose filter/limit digest does not match the
 * current call, is invalid parameters — never a silent walk of a different
 * result set. Hooked onto the `list_sessions` tool def so `dispatch.ts` rejects
 * it before invoking the handler.
 */
export function validateListSessionsArgs(args: Record<string, unknown>): string | null {
  const cursor = args.cursor;
  if (cursor === undefined) return null;
  if (typeof cursor !== "string") return 'list_sessions "cursor" must be a string';
  const decoded = decodeCursor(cursor);
  if (!decoded) return "list_sessions was given a cursor that cannot be decoded";
  if (decoded.digest !== digestOf(args as ListSessionsArgs, process.platform)) {
    return "list_sessions cursor does not match the supplied filters or limit";
  }
  return null;
}

/**
 * Apply filters, keyset cursor and limit, and return the envelope.
 *
 * `rows` is read fresh per call (the handler passes `listAll()`), so a session
 * created/ended/removed between two pages is naturally modelled: the cursor
 * names a *position* in the ordering, not a row, and the walk resumes strictly
 * past it — no unrelated row is duplicated or skipped.
 */
export function listSessions(
  rows: readonly DashboardSession[],
  args: ListSessionsArgs = {},
  platform: NodeJS.Platform = process.platform,
): ListSessionsPage {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const digest = digestOf(args, platform);

  // Hidden worker sessions are excluded by default, matching the UI (D6).
  let filtered = rows.filter((s) => s.hidden !== true);

  if (args.status) {
    const wanted = new Set(args.status);
    filtered = filtered.filter((s) => wanted.has(s.status));
  }

  if (args.cwd !== undefined) {
    const key = pathKey(args.cwd, platform);
    filtered = filtered.filter((s) => pathKey(s.cwd, platform) === key);
  }

  if (args.since !== undefined) {
    const since = args.since;
    filtered = filtered.filter((s) => {
      const key = sessionSortKey(s);
      return Number.isFinite(key) && key >= since;
    });
  }

  // `total` is the post-filter count, before the cursor narrows to a page.
  const total = filtered.length;

  if (args.cursor !== undefined) {
    const decoded = decodeCursor(args.cursor);
    // The digest was validated upstream; a cursor that still fails to decode
    // here means the guard was bypassed, so treat it as no cursor rather than
    // throwing an internal error for caller input.
    if (decoded) {
      const cur = cursorPos(decoded);
      filtered = filtered.filter((s) => comparePos(sortPos(s), cur) > 0);
    }
  }

  const sorted = [...filtered].sort((a, b) => comparePos(sortPos(a), sortPos(b)));
  const page = sorted.slice(0, limit);
  // A caller that bypassed dispatch's range validation could pass limit <= 0;
  // keep the pure function total rather than indexing an empty page.
  const hasMore = page.length > 0 && sorted.length > limit;
  const nextCursor = hasMore ? encodeCursor(sortPos(page[page.length - 1]), digest) : undefined;

  return nextCursor === undefined
    ? { sessions: page, total }
    : { sessions: page, total, nextCursor };
}
