/**
 * Machine error codes of `pi-obs` and the plugin bridge. Every failure is an
 * `ObsError` with a lowercase code; the CLI maps `usage` to exit 2 and every
 * other code to exit 1. Messages never carry a password or request bodies.
 * See change: add-obs-studio-plugin (design D2, D11, D13).
 */
export type ObsErrorCode =
  | "usage"
  | "unreachable"
  | "auth-failed"
  | "timeout"
  | "unsupported-request"
  | "denied"
  | "unresolved-target"
  | "output-active"
  | "not-found"
  | "insecure-remote"
  | "refused"
  | "failed";

export class ObsError extends Error {
  readonly code: ObsErrorCode;
  readonly detail?: Record<string, unknown>;
  constructor(code: ObsErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function isObsError(e: unknown): e is ObsError {
  return e instanceof ObsError;
}

/** Exit code for an error: usage → 2, anything else → 1. */
export function exitCodeOf(e: unknown): number {
  return isObsError(e) && e.code === "usage" ? 2 : 1;
}
