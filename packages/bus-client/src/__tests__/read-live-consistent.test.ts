/**
 * R1 — read reflects the stream (bus-consistent).
 * Exemplar: packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts
 * Triple: subscribed, session active→idle on stream · read.sessions() after delta
 * · row shows idle, no REST fetch (test-plan #R1).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("bus-consistent reads (R1)", () => {
  it("read.sessions() reflects a delta already seen on the stream, with no REST fetch", async () => {
    server = await startMockServer({ sessions: [makeSession("s1", "active")] });
    const fetchSpy = vi.fn(globalThis.fetch);
    const client = new BusClient({
      host: "127.0.0.1",
      port: server.port,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    await client.connect();
    const mintCalls = fetchSpy.mock.calls.length; // ticket mint only

    expect(client.read.session("s1")?.status).toBe("active");
    server.push({ type: "session_updated", sessionId: "s1", updates: { status: "idle" } });
    await new Promise((r) => setTimeout(r, 20));

    expect(client.read.session("s1")?.status).toBe("idle");
    // No extra fetch beyond the initial ticket mint — the read came off the bus.
    expect(fetchSpy.mock.calls.length).toBe(mintCalls);
    client.close();
  });
});
