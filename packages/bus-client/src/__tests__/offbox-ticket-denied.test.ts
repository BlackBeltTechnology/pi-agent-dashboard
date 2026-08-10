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
import { OffBoxError } from "../errors.js";
import { startMockServer, type MockServer } from "./support/mock-server.js";

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
