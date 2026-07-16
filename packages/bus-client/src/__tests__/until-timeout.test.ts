/**
 * A3 — timeout boundary.
 * Triple: until(sid,idle,{timeout:100}), transition never arrives · 100 ms elapse
 * · rejects naming (sid,status) (test-plan #A3).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { BusTimeoutError } from "../errors.js";
import {
  makeSession,
  startMockServer,
  type MockServer,
} from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("until timeout (A3)", () => {
  it("rejects with a timeout error naming the awaited (sid, status)", async () => {
    server = await startMockServer({ sessions: [makeSession("sid-1", "active")] });
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    // The rejection must fire NEAR the 100 ms deadline, not merely eventually
    // (i.e. not via vitest's multi-second global timeout).
    const t0 = Date.now();
    const err = await client.until("sid-1", "idle", { timeout: 100 }).catch((e) => e);
    const elapsed = Date.now() - t0;
    expect(err).toBeInstanceOf(BusTimeoutError);
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(1_000);
    // …and it names the awaited (sid, status).
    expect((err as Error).message).toMatch(/sid-1/);
    expect((err as Error).message).toMatch(/idle/);
    client.close();
  });
});
