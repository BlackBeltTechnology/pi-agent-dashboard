/**
 * "Is this browser on the dashboard host?" for a Fastify request: loopback peer AND no proxy forwarding
 * header (design D12a). Used for client choice, hub-local-only routes and the Picker token.
 * See change: add-google-connect.
 */
import type { FastifyRequest } from "fastify";
import { isGenuinelyLocal } from "../shared/local.js";

export function isLocal(request: Pick<FastifyRequest, "headers" | "socket">): boolean {
  return isGenuinelyLocal(request.headers as Record<string, unknown>, request.socket.remoteAddress);
}
