import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  DEVICE_TOKEN_ENV,
  mintBridgeTicket,
  readDeviceToken,
  withTicket,
} from "../bridge-ticket-client.js";

/**
 * §6 made bridge auth mandatory on the TCP listener while nothing on this side
 * could produce a credential — every external bridge was refused `no-ticket`
 * with no remedy, which broke the documented docker deployment. These cover the
 * key that was missing.
 */
describe("reading the durable bearer", () => {
  it("reads the bearer from the environment, treating blank as absent", () => {
    expect(readDeviceToken({ [DEVICE_TOKEN_ENV]: "dev-bearer" } as never)).toBe("dev-bearer");
    expect(readDeviceToken({ [DEVICE_TOKEN_ENV]: "  padded  " } as never)).toBe("padded");
    expect(readDeviceToken({ [DEVICE_TOKEN_ENV]: "   " } as never)).toBeUndefined();
    expect(readDeviceToken({} as never)).toBeUndefined();
  });
});

describe("minting a bridge ticket", () => {
  const okFetch = (captured: { req?: RequestInit; url?: string }) =>
    (async (url: string, req: RequestInit) => {
      captured.url = url;
      captured.req = req;
      return { ok: true, status: 200, json: async () => ({ success: true, data: { ticket: "tkt-1" } }) };
    }) as unknown as typeof fetch;

  it("exchanges the bearer for a single-use ticket", async () => {
    const captured: { req?: RequestInit; url?: string } = {};
    const result = await mintBridgeTicket({
      httpBase: "http://dash.example:8000",
      token: "dev-bearer",
      fetchImpl: okFetch(captured),
    });

    expect(result).toEqual({ ok: true, ticket: "tkt-1" });
    expect(captured.url).toBe("http://dash.example:8000/api/ws-ticket");
    // The DURABLE bearer authenticates the mint...
    expect((captured.req?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer dev-bearer");
    // ...and the ticket is bound to the bridge scope, so it cannot be replayed
    // against /ws or the terminal route.
    expect(JSON.parse(String(captured.req?.body))).toEqual({ scope: "bridge" });
  });

  it("refuses with a NAMED cause rather than dialling unauthenticated", async () => {
    const noToken = await mintBridgeTicket({ httpBase: "http://x", token: undefined });
    expect(noToken).toMatchObject({ ok: false, cause: "no-token" });
    expect(noToken.ok === false && noToken.reason).toContain(DEVICE_TOKEN_ENV);

    const unreachable = await mintBridgeTicket({
      httpBase: "http://x",
      token: "t",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(unreachable).toMatchObject({ ok: false, cause: "unreachable" });

    // A revoked or unpaired bearer is a 403 from the mint eligibility gate.
    const refused = await mintBridgeTicket({
      httpBase: "http://x",
      token: "revoked",
      fetchImpl: (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch,
    });
    expect(refused).toMatchObject({ ok: false, cause: "refused" });
    expect(refused.ok === false && refused.reason).toContain("403");

    const malformed = await mintBridgeTicket({
      httpBase: "http://x",
      token: "t",
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) })) as unknown as typeof fetch,
    });
    expect(malformed).toMatchObject({ ok: false, cause: "malformed" });
  });

  it("never sends the durable bearer to the gateway — only the ticket", async () => {
    const captured: { req?: RequestInit; url?: string } = {};
    const r = await mintBridgeTicket({ httpBase: "http://x", token: "secret-bearer", fetchImpl: okFetch(captured) });
    expect(r.ok).toBe(true);
    const upgrade = withTicket("ws://dash.example:9999", r.ok ? r.ticket : "");
    expect(upgrade).toBe("ws://dash.example:9999?ticket=tkt-1");
    expect(upgrade).not.toContain("secret-bearer");
  });

  it("appends the ticket without clobbering an existing query", () => {
    expect(withTicket("ws://h:1/?a=b", "t k")).toBe("ws://h:1/?a=b&ticket=t%20k");
  });
});

/**
 * A wrong HTTP origin (the pi gateway answering the mint) must read as a wrong
 * origin, not as a revoked credential.
 * See change: fix-remote-bridge-ticket-origin (D3).
 */
describe("mint failure taxonomy", () => {
  const statusFetch = (status: number) => (async () => ({ ok: false, status })) as unknown as typeof fetch;

  it("#X1 a gateway answering the mint is a wrong origin", async () => {
    const r = await mintBridgeTicket({
      httpBase: "http://dash.example:9999",
      token: "t",
      originSource: "endpoint-host+http-port",
      fetchImpl: statusFetch(426),
    });
    expect(r).toMatchObject({ ok: false, cause: "wrong-origin" });
    const reason = r.ok === false ? r.reason : "";
    expect(reason).toContain("http://dash.example:9999/api/ws-ticket");
    expect(reason).toContain("426");
    expect(reason).toContain("PI_DASHBOARD_HTTP_URL");
    expect(reason).toContain("endpoint-host+http-port");
    expect(reason).not.toContain("revoked");
  });

  it.each([
    [401, "refused"],
    [403, "refused"],
    [400, "wrong-origin"],
    [404, "wrong-origin"],
    [500, "wrong-origin"],
    [503, "wrong-origin"],
  ])("#X2 HTTP %i → %s", async (status, cause) => {
    const r = await mintBridgeTicket({ httpBase: "http://x", token: "t", fetchImpl: statusFetch(status) });
    expect(r).toMatchObject({ ok: false, cause });
  });

  it("#X3 a redirect is never followed with the bearer", async () => {
    const seen: Array<string | undefined> = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(307, { location: "/api/ws-ticket2" });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as AddressInfo).port;
      const r = await mintBridgeTicket({ httpBase: `http://127.0.0.1:${port}`, token: "t" });
      expect(r).toMatchObject({ ok: false, cause: "wrong-origin" });
      expect(seen).toHaveLength(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("#X4 a network error stays unreachable", async () => {
    const server = http.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));
    const r = await mintBridgeTicket({ httpBase: `http://127.0.0.1:${port}`, token: "t" });
    expect(r).toMatchObject({ ok: false, cause: "unreachable" });
  });
});
