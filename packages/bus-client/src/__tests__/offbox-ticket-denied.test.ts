/**
 * C4 (L1 companion to qa/tests/04-ws-ticket-auth.sh) — off-box mint denied.
 * Triple: mint denied (networkGuard 403) · connect() · client surfaces an
 * explicit off-box error and does NOT hang (test-plan #C4).
 *
 * The L2 shell smoke exercises the real server on the VM; this L1 test pins the
 * client-side contract in the harness: a denied mint becomes an `OffBoxError`
 * bounded in time, never an indefinite hang.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { BusError, OffBoxError } from "../errors.js";
import { type MockServer, startMockServer } from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("off-box ticket denied (C4)", () => {
  it("surfaces an explicit OffBoxError instead of hanging", async () => {
    server = await startMockServer({ denyMint: true });
    const client = new BusClient({ host: "127.0.0.1", port: server.port });

    // Must reject WITHIN a bounded deadline (the whole point is "does not hang"),
    // not merely eventually via vitest's global timeout.
    const t0 = Date.now();
    await expect(client.connect()).rejects.toBeInstanceOf(OffBoxError);
    expect(Date.now() - t0).toBeLessThan(3_000);
    await expect(client.mintTicket()).rejects.toMatchObject({ code: "off-box" });
  });
});

/**
 * Denial self-description (E1-E7, X1-X2). `fetchImpl` is stubbed so each case
 * controls status + raw body exactly. See OpenSpec change:
 * triage-browser-e2e-offbox-poison.
 */
const respond =
  (status: number, body: string): typeof fetch =>
  async () =>
    new Response(body, { status, headers: { "Content-Type": "application/json" } });

const mintError = async (impl: typeof fetch): Promise<OffBoxError> => {
  const client = new BusClient({ host: "127.0.0.1", port: 1, fetchImpl: impl });
  try {
    await client.connect();
  } catch (err) {
    return err as OffBoxError;
  }
  throw new Error("expected connect() to reject");
};

describe("denied mint is self-describing", () => {
  it("E1: carries status + error literal and renders status, literal, reason", async () => {
    const err = await mintError(
      respond(
        403,
        JSON.stringify({
          success: false,
          error: "network_not_allowed",
          reason: "Source IP not loopback, not in trustedNetworks",
          hint: "try host X",
        }),
      ),
    );
    expect(err).toBeInstanceOf(OffBoxError);
    expect(err.code).toBe("off-box");
    expect(err.status).toBe(403);
    expect(err.error).toBe("network_not_allowed");
    expect(err.message).toContain("403");
    expect(err.message).toContain("network_not_allowed");
    expect(err.message).toContain("Source IP not loopback, not in trustedNetworks");
  });

  it("E2: never copies hint or other body fields", async () => {
    const err = await mintError(
      respond(
        403,
        JSON.stringify({
          error: "network_not_allowed",
          reason: "r",
          hint: "host-secret.example",
          token: "abc",
        }),
      ),
    );
    expect(err.message).not.toContain("host-secret.example");
    expect(err.message).not.toContain("abc");
    expect(err).not.toHaveProperty("hint");
  });

  it("E3: 401 with empty body is distinguishable from a network denial", async () => {
    const err = await mintError(respond(401, ""));
    expect(err.status).toBe(401);
    expect(err.error).toBeUndefined();
    expect(err.message).toContain("401");
    expect(err.message).not.toContain("network_not_allowed");
    expect(err.message).not.toMatch(/reason/i);
  });

  it.each(["{}", '{"success":false}'])("E4: 403 body %s → status only, no reason clause", async (body) => {
    const err = await mintError(respond(403, body));
    expect(err.status).toBe(403);
    expect(err.error).toBeUndefined();
    expect(err.message).not.toMatch(/reason/i);
  });

  it("E5: a non-JSON denial body never becomes a SyntaxError", async () => {
    const err = await mintError(respond(403, "<html>Bad Gateway</html>"));
    expect(err).toBeInstanceOf(OffBoxError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err.status).toBe(403);
    expect(err.error).toBeUndefined();
  });

  it("E6: reason is prose — it is not exposed through a typed field", async () => {
    const err = await mintError(
      respond(403, JSON.stringify({ error: "network_not_allowed", reason: "local_proof_required" })),
    );
    expect(err.error).toBe("network_not_allowed");
    expect(err.status).toBe(403);
    expect(Object.values(err as unknown as Record<string, unknown>)).not.toContain("local_proof_required");
  });

  it("E7: a 200 without success/ticket keeps the existing rejection", async () => {
    const withReason = await mintError(respond(200, JSON.stringify({ success: false, reason: "x" })));
    expect(withReason).toBeInstanceOf(OffBoxError);
    expect(withReason.message).toContain("x");
    expect(withReason.status).toBeUndefined();
    const noTicket = await mintError(respond(200, JSON.stringify({ success: true })));
    expect(noTicket).toBeInstanceOf(OffBoxError);
    expect(noTicket.message).toContain("rejected");
  });

  it("X1: an unreachable endpoint names the base URL, carries no status, and reads unlike a denial", async () => {
    const err = await mintError(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1");
    });
    expect(err).toBeInstanceOf(OffBoxError);
    expect(err.status).toBeUndefined();
    expect(err.message).toContain("http://127.0.0.1:1");
    expect(err.message).not.toContain("network_not_allowed");
    expect(err.message).not.toMatch(/denied|refused by/i);
  });

  it("X2: a fetch that fails after a delay (transport timeout) keeps the unreachable shape", async () => {
    const err = await mintError(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new DOMException("The operation timed out", "TimeoutError")), 50);
        }),
    );
    expect(err).toBeInstanceOf(BusError);
    expect(err.status).toBeUndefined();
    expect(err.message).toContain("http://127.0.0.1:1");
  });
});
