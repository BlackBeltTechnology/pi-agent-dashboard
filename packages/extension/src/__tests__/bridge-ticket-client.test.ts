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
