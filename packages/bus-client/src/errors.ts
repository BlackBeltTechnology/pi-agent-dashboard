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
 * Ticket mint denied (or the mint endpoint unreachable).
 *
 * Message contract: a policy denial renders `status` + the server's machine
 * readable `error` literal + its human `reason`, e.g.
 * `ticket mint denied: 403 network_not_allowed — <reason>`. An unreachable
 * endpoint carries NO `status` and names the base URL instead, so the two are
 * distinguishable from the typed fields and from the text alone. `hint` and any
 * other body field is never copied (it may name hosts or tokens).
 *
 * `status` / `error` are typed so callers branch on them rather than parsing the
 * message; `reason` is prose and is deliberately not a field.
 * See OpenSpec change: triage-browser-e2e-offbox-poison.
 */
export class OffBoxError extends BusError {
  /** HTTP status the mint endpoint returned; undefined when it was never reached. */
  readonly status?: number;
  /** Machine-readable `error` literal from the denial body; undefined when absent. */
  readonly error?: string;
  constructor(
    message = "ticket mint denied: off-box / untrusted network needs device pairing (loopback-only MVP)",
    details: { status?: number; error?: string } = {},
  ) {
    super("off-box", message);
    this.name = "OffBoxError";
    this.status = details.status;
    this.error = details.error;
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
