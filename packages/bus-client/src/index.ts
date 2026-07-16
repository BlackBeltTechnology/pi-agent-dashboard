/**
 * `@blackbelt-technology/pi-dashboard-bus-client` — a typed, ticket-authenticated
 * WebSocket bus client for the dashboard control plane.
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 */
export { BusClient, KNOWN_PLUGIN_HANDLERS } from "./client.js";
export type {
  BusClientOptions,
  SpawnOptions,
  ResumeOptions,
} from "./client.js";
export {
  BusError,
  BusTimeoutError,
  NoPluginHandlerError,
  OffBoxError,
  TicketConsumedError,
  TicketExpiredError,
} from "./errors.js";
export type { BusErrorCode } from "./errors.js";
export { TICKET_TTL_MS, isTicketExpired } from "./ticket.js";
export type { Ticket, WsTicketScope } from "./ticket.js";
export { CLIENT_INTERCEPTED_DENYLIST, isDenylisted } from "./denylist.js";
export { discoverHost, discoverPort } from "./port-discovery.js";
export { GENERATED_VERBS, VERB_INTERFACE } from "./generated/verbs.js";
export type { GeneratedVerb } from "./generated/verbs.js";

/**
 * Convenience factory: construct a client and fully connect it.
 * `const dash = await connect();`
 */
import { BusClient, type BusClientOptions } from "./client.js";
export async function connect(opts?: BusClientOptions): Promise<BusClient> {
  const client = new BusClient(opts);
  await client.connect();
  return client;
}
