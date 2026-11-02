import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  DEVICE_TOKEN_ENV,
  mintBridgeTicket,
  readDeviceToken,
  withTicket,
} from "../bridge-ticket-client.js";
import { createRemoteUpgradePreparer } from "../remote-upgrade-preparer.js";

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

/**
 * Remote TLS credential calls: certificate validation is enforced at every call,
 * and a `pi_tls_` token never leaves for a non-https origin.
 * See change: prove-vault-bridge-tls (D7, D9; test-plan #E12, #X5, #X6).
 */
describe("TLS credential-call checks (prepareConnect)", () => {
  const VERIFY_OFF = "NODE_TLS_REJECT_UNAUTHORIZED";
  const TLS_TOKEN = "pi_tls_secret-bearer-xyz";

  function rig(env: Record<string, string | undefined>, fetchImpl?: typeof fetch) {
    const out: string[] = [];
    const fetchSpy = vi.fn(
      fetchImpl ??
        ((async () => ({ ok: true, status: 200, json: async () => ({ data: { ticket: "tkt" } }) })) as unknown as typeof fetch),
    );
    const prepare = createRemoteUpgradePreparer({
      env,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      log: { log: (...a: unknown[]) => out.push(a.join(" ")), error: (...a: unknown[]) => out.push(a.join(" ")) },
      record: () => {},
      isPinned: () => true,
    });
    return { prepare, out, fetchSpy };
  }

  it("#E12(a) an invalid PI_DASHBOARD_HTTP_URL is reported first, even with validation disabled", async () => {
    const { prepare, out, fetchSpy } = rig({
      PI_DASHBOARD_TOKEN: "t",
      PI_DASHBOARD_HTTP_URL: "not a url",
      [VERIFY_OFF]: "0",
    });
    await expect(prepare("wss://dash.example:8443")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.some((l) => l.includes("bad-http-url"))).toBe(true);
    expect(out.join("\n")).not.toContain("tls-verify-disabled");
  });

  it("#E12(b) a pi_tls_ token with a plaintext gateway is refused with tls-only-token", async () => {
    const { prepare, out, fetchSpy } = rig({ PI_DASHBOARD_TOKEN: TLS_TOKEN });
    await expect(prepare("ws://dash.example:9999")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    const line = out.find((l) => l.includes("tls-only-token")) ?? "";
    expect(line).toContain("wss://");
    expect(out.join("\n")).not.toContain(TLS_TOKEN);
  });

  it("#E12(c) a pi_tls_ token with a plaintext HTTP override is refused with tls-only-token", async () => {
    const { prepare, out, fetchSpy } = rig({
      PI_DASHBOARD_TOKEN: TLS_TOKEN,
      PI_DASHBOARD_HTTP_URL: "http://dash.example:8000",
    });
    await expect(prepare("wss://dash.example:8443")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.some((l) => l.includes("tls-only-token"))).toBe(true);
  });

  it("#E12(d) a pi_tls_ token mints from the https origin and dials the plain gateway", async () => {
    const { prepare, fetchSpy } = rig({
      PI_DASHBOARD_TOKEN: TLS_TOKEN,
      PI_DASHBOARD_URL: "ws://dash.example:9999",
      PI_DASHBOARD_HTTP_URL: "https://dash.example:8443",
    });
    const res = await prepare("ws://dash.example:9999");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://dash.example:8443/api/ws-ticket");
    expect(res).toEqual({ url: "ws://dash.example:9999?ticket=tkt" });
  });

  it("#E12(e) a wss endpoint with validation disabled is refused naming the variable", async () => {
    const { prepare, out, fetchSpy } = rig({ PI_DASHBOARD_TOKEN: "plain-token", [VERIFY_OFF]: "0" });
    await expect(prepare("wss://dash.example:8443")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    const line = out.find((l) => l.includes("tls-verify-disabled")) ?? "";
    expect(line).toContain(VERIFY_OFF);
  });

  it("#E12(f) a plain token over plain ws is unaffected by validation being disabled", async () => {
    const { prepare, fetchSpy } = rig({ PI_DASHBOARD_TOKEN: "plain-token", [VERIFY_OFF]: "0" });
    const res = await prepare("ws://dash.example:9999");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://dash.example:8000/api/ws-ticket");
    expect(res).toEqual({ url: "ws://dash.example:9999?ticket=tkt" });
  });

  it("#E12(g) a local socket is unaffected by validation being disabled", async () => {
    const { prepare, fetchSpy } = rig({ [VERIFY_OFF]: "0" });
    await expect(prepare("ws+unix:///tmp/gw.sock:/")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("#X5 flipping validation off at runtime refuses the next reconnect's mint", async () => {
    const env: Record<string, string | undefined> = { PI_DASHBOARD_TOKEN: "plain-token" };
    const { prepare, out, fetchSpy } = rig(env);
    await expect(prepare("wss://dash.example:8443")).resolves.toEqual({ url: "wss://dash.example:8443?ticket=tkt" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    env[VERIFY_OFF] = "0";
    await expect(prepare("wss://dash.example:8443")).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no second fetch, hence no dial
    expect(out.some((l) => l.includes("tls-verify-disabled"))).toBe(true);
  });

  it("the mint itself refuses a pi_tls_ token for a non-https origin and a disabled-validation https origin", async () => {
    const fetchImpl = vi.fn();
    const plain = await mintBridgeTicket({
      httpBase: "http://dash.example:8000",
      token: TLS_TOKEN,
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(plain).toMatchObject({ ok: false, cause: "tls-only-token" });
    const off = await mintBridgeTicket({
      httpBase: "https://dash.example:8443",
      token: TLS_TOKEN,
      env: { [VERIFY_OFF]: "0" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(off).toMatchObject({ ok: false, cause: "tls-verify-disabled" });
    expect(off.ok === false && off.reason).toContain(VERIFY_OFF);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("#X6 a relayed pi_tls_ token reads as tls-only-token-relayed, not unpaired or revoked", async () => {
    const relayed = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "tls_only_token_untrusted_channel" }),
    })) as unknown as typeof fetch;
    const { prepare, out } = rig({ PI_DASHBOARD_TOKEN: TLS_TOKEN }, relayed);
    await expect(prepare("wss://dash.example:8443")).rejects.toThrow();
    const lines = out.filter((l) => l.includes("bridge ticket"));
    expect(lines.some((l) => l.includes("tls-only-token-relayed"))).toBe(true);
    expect(out.join("\n")).not.toMatch(/unpaired|revoked/);
  });

  it("an ordinary 401 still reads as refused (unpaired or revoked)", async () => {
    const r = await mintBridgeTicket({
      httpBase: "https://dash.example:8443",
      token: "plain",
      env: {},
      fetchImpl: (async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) })) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false, cause: "refused" });
  });
});
