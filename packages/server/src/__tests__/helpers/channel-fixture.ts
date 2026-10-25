/**
 * Test stand-ins for the listener edge when a scenario needs a request to look like it arrived on the
 * hub's own TLS socket: a header-triggered hook marks the underlying socket `encrypted` and removes the
 * trigger header before any other hook reads the request. Register it FIRST.
 *
 * See change: prove-vault-bridge-tls.
 */
import type { FastifyInstance } from "fastify";

/** Send this header to make the request look like it arrived on the hub's TLS socket. */
export const TEST_TLS_HEADER = "x-test-tls";

export function simulateTlsSocket(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    // Set per request: a keep-alive socket must not carry the previous request's channel.
    (request.raw.socket as unknown as { encrypted: boolean }).encrypted = request.headers[TEST_TLS_HEADER] !== undefined;
    delete request.raw.headers[TEST_TLS_HEADER];
  });
}
