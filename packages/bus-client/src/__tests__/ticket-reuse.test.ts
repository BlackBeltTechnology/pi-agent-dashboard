/**
 * C3 — consumed single-use ticket reuse rejected.
 * Exemplar: packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts
 * Triple: already-consumed single-use ticket · second connect reuse ·
 * `ticket-consumed` error (test-plan #C3).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { TicketConsumedError } from "../errors.js";
import { startMockServer, type MockServer } from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("ticket reuse (C3)", () => {
  it("raises ticket-consumed on a second connect with the same ticket", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });

    const ticket = await client.mintTicket();
    await client.connectWithTicket(ticket); // first use succeeds + consumes
    client.close();

    await expect(client.connectWithTicket(ticket)).rejects.toBeInstanceOf(TicketConsumedError);
    await expect(client.connectWithTicket(ticket)).rejects.toMatchObject({
      code: "ticket-consumed",
    });
  });
});
