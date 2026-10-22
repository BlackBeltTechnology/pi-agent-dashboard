/**
 * C1 — connect obtains a ticket and subscribes.
 * Exemplar: packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts
 * Triple: valid minted ticket · connect() opens WS · client subscribed, receives
 * sessions_snapshot (test-plan #C1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { type MockServer, makeSession, startMockServer } from "./support/mock-server.js";

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

describe("mintTicket carries the injected local proof (E23)", () => {
  it("sends the provider's X-Pi-Local-Proof for POST /api/ws-ticket, bound to that method + URL", async () => {
    server = await startMockServer({ sessions: [makeSession("s1", "idle")] });
    const calls: Array<[string, string]> = [];
    const seen: Array<Record<string, string>> = [];
    const client = new BusClient({
      host: "127.0.0.1",
      port: server.port,
      proofHeaders: (method, url) => {
        calls.push([method, url]);
        return { "X-Pi-Local-Proof": "v1.test-proof" };
      },
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return fetch(url, init);
      }) as unknown as typeof fetch,
    });
    const ticket = await client.mintTicket("browser");
    expect(ticket.value).toBeTruthy();
    expect(calls).toEqual([["POST", `http://127.0.0.1:${server.port}/api/ws-ticket`]]);
    expect(seen[0]?.["X-Pi-Local-Proof"]).toBe("v1.test-proof");
    client.close();
  });

  it("with no provider the request carries no proof header (unchanged behaviour)", async () => {
    server = await startMockServer({ sessions: [] });
    const seen: Array<Record<string, string>> = [];
    const client = new BusClient({
      host: "127.0.0.1",
      port: server.port,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return fetch(url, init);
      }) as unknown as typeof fetch,
    });
    await client.mintTicket("browser");
    expect(seen[0]?.["X-Pi-Local-Proof"]).toBeUndefined();
    client.close();
  });
});
