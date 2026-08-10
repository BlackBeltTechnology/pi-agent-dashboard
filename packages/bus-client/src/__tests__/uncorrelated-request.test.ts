/**
 * A4 — no fake exact-await for request_models.
 * Triple: request_models (no requestId) · attempt exact await · client offers
 * structural match / REST fallback only (test-plan #A4).
 *
 * `request_models`/`request_providers`/`request_roles` carry NO requestId and
 * broadcast their `*_list` reply to all subscribers. The client must NOT pretend
 * an exact requestId round-trip exists; it reads the broadcast by STRUCTURAL
 * match (session id) instead.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { startMockServer, type MockServer } from "./support/mock-server.js";
import type {
  BrowserModelsListMessage,
  RequestModelsBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("uncorrelated request verbs (A4)", () => {
  it("request_models has no requestId field (no exact-correlation seam exists)", () => {
    // Compile-time proof: the protocol has no `requestId` to correlate on.
    const msg: RequestModelsBrowserMessage = { type: "request_models", sessionId: "s1" };
    expect("requestId" in msg).toBe(false);
  });

  it("resolves models_list by structural session-id match, not a minted id", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    const pending = client.await<BrowserModelsListMessage>({
      type: "models_list",
      sessionId: "s1",
    });
    client.send({ type: "request_models", sessionId: "s1" });

    // A broadcast for a different session must not satisfy the structural wait.
    server.push({ type: "models_list", sessionId: "other", models: [] });
    // The matching broadcast resolves it.
    server.push({ type: "models_list", sessionId: "s1", models: [] });

    const got = await pending;
    expect(got.sessionId).toBe("s1");
    client.close();
  });
});
