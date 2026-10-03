// Error codes surfaced to callers (HTTP body `code`, CLI stderr, tool result).
export type ErrorCode =
  | "EMPTY_ORDER"
  | "INVALID_QUANTITY"
  | "TOO_MANY_LINES"
  | "INVALID_TRANSITION"
  | "ORDER_NOT_FOUND";

export class OrderError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  EMPTY_ORDER: 400,
  INVALID_QUANTITY: 400,
  TOO_MANY_LINES: 400,
  INVALID_TRANSITION: 409,
  ORDER_NOT_FOUND: 404,
};
