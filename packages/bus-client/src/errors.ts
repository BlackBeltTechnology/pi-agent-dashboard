/**
 * Typed error classes for the bus client. Every error carries a stable `.code`
 * so callers (and tests) can branch on the failure kind without string-matching
 * a message. See OpenSpec change: add-dashboard-bus-client-scripting.
 */

export type BusErrorCode =
  | "ticket-expired"
  | "ticket-consumed"
  | "off-box"
  | "timeout"
  | "no-plugin-handler"
  | "connect-failed";

export class BusError extends Error {
  readonly code: BusErrorCode;
  constructor(code: BusErrorCode, message: string) {
    super(message);
    this.name = "BusError";
    this.code = code;
  }
}

/** A minted ticket presented after its TTL elapsed. Distinct from a socket close. */
export class TicketExpiredError extends BusError {
  constructor(message = "ws ticket expired before the socket opened") {
    super("ticket-expired", message);
    this.name = "TicketExpiredError";
  }
}

/** A single-use ticket presented a second time. */
export class TicketConsumedError extends BusError {
  constructor(message = "ws ticket already consumed (single-use)") {
    super("ticket-consumed", message);
    this.name = "TicketConsumedError";
  }
}

/**
 * Ticket mint denied because the caller is off-box / on an untrusted network.
 * The MVP is loopback-only; off-box scripting needs a paired-device bearer.
 */
export class OffBoxError extends BusError {
  constructor(
    message = "ticket mint denied: off-box / untrusted network needs device pairing (loopback-only MVP)",
  ) {
    super("off-box", message);
    this.name = "OffBoxError";
  }
}

/** An `await`/`until` whose matching event did not arrive within the timeout. */
export class BusTimeoutError extends BusError {
  constructor(message: string) {
    super("timeout", message);
    this.name = "BusTimeoutError";
  }
}

/** `plugin(pluginId, …)` for a pluginId with no working server-side handler. */
export class NoPluginHandlerError extends BusError {
  constructor(pluginId: string) {
    super("no-plugin-handler", `no handler for pluginId: ${pluginId}`);
    this.name = "NoPluginHandlerError";
  }
}
