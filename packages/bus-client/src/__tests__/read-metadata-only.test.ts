/**
 * R2 — reads are metadata-only.
 * Triple: session with chat history · read.session(id) · returns metadata+status,
 * no messages/lastResponse field (test-plan #R2).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import {
  makeSession,
  startMockServer,
  type MockServer,
} from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("metadata-only reads (R2)", () => {
  it("returns registry metadata + status, never chat history / last-response", async () => {
    server = await startMockServer({
      sessions: [makeSession("s1", "idle", { name: "worker", model: "anthropic/claude" })],
    });
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    const row = client.read.session("s1");
    expect(row).toBeDefined();
    // Metadata present.
    expect(row?.status).toBe("idle");
    expect(row?.name).toBe("worker");
    expect(row?.model).toBe("anthropic/claude");
    // Chat/last-response are explicitly out of scope — never faked into the read.
    expect(row).not.toHaveProperty("messages");
    expect(row).not.toHaveProperty("lastResponse");
    client.close();
  });
});
