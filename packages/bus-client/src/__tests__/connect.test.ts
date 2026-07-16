/**
 * C1 — connect obtains a ticket and subscribes.
 * Exemplar: packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts
 * Triple: valid minted ticket · connect() opens WS · client subscribed, receives
 * sessions_snapshot (test-plan #C1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { makeSession, startMockServer, type MockServer } from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("connect (C1)", () => {
  it("mints a ticket, opens the WS, and resolves on the sessions_snapshot", async () => {
    server = await startMockServer({ sessions: [makeSession("s1", "idle")] });
    const client = new BusClient({ host: "127.0.0.1", port: server.port });

    await client.connect();

    // Subscribed: the on-connect snapshot populated the live read model.
    expect(client.read.sessions().map((s) => s.id)).toContain("s1");
    expect(client.read.session("s1")?.status).toBe("idle");
    client.close();
  });
});
