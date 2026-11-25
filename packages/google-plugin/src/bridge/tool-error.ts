/**
 * The one error type of every Google tool: `code` is the stable machine code (`product_disabled`,
 * `api_disabled`, `blocked`, `denied`, `calendar_error`, …); the message starts with `<code>: `.
 * `status` / `reason` carry the Google HTTP status and machine reason when the error came from an API reply
 * (product tools use them to re-map, e.g. a 400 `FAILED_PRECONDITION` → `revision_changed`).
 * See change: add-google-connect.
 */
export class GoogleToolError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly reason?: string;

  constructor(code: string, message: string, extra: { status?: number; reason?: string } = {}) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    this.code = code;
    this.name = "GoogleToolError";
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.reason !== undefined) this.reason = extra.reason;
  }
}

export const invalidParams = (what: string): GoogleToolError => new GoogleToolError("invalid_params", what);
