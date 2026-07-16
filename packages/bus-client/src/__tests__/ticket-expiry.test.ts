/**
 * C2 — expired ticket rejected with a DISTINCT error.
 * Exemplar: packages/server/src/__tests__/draining-ws.test.ts
 * Triple: ticket minted then 15001 ms elapse (TTL 15000) · connect presents the
 * expired ticket · `ticket-expired` error, not a generic close (test-plan #C2).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { TicketExpiredError } from "../errors.js";
import { startMockServer, type MockServer } from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("ticket expiry (C2)", () => {
  it("raises ticket-expired (not a generic socket close) past the 15s TTL", async () => {
    let now = 1_000;
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port, clock: () => now });

    const ticket = await client.mintTicket(); // mintedAt = 1000, ttl 15000
    now = 1_000 + 15_001; // one ms past expiry

    await expect(client.connectWithTicket(ticket)).rejects.toBeInstanceOf(TicketExpiredError);
    await expect(client.connectWithTicket(ticket)).rejects.toMatchObject({
      code: "ticket-expired",
    });
  });
});
