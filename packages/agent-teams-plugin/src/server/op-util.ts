/**
 * Tiny helpers shared by the op modules (`ops.ts`, `tasks.ts`, `messaging.ts`,
 * `shutdown.ts`): the failure envelope and the "member is not released" test.
 * See change: add-agent-teams-core.
 */
import type { ErrorCode } from "../shared/protocol.js";
import { type Member, RELEASED_MEMBER_STATUSES } from "../shared/types.js";

export interface OpFailure {
  ok: false;
  error: ErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

export function fail(error: ErrorCode, message?: string, details?: Record<string, unknown>): OpFailure {
  return { ok: false, error, ...(message !== undefined ? { message } : {}), ...(details ? { details } : {}) };
}

/** A member that is not `gone`/`failed` (its name is not free). */
export const isLive = (m: Member): boolean => !RELEASED_MEMBER_STATUSES.includes(m.status);

/** Numeric order of per-team sequential string task ids (`"2" < "10"`). */
export const compareTaskIds = (a: string, b: string): number => Number(a) - Number(b);
