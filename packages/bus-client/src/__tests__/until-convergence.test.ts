/**
 * A2 — session-keyed structural wait.
 * Exemplar: packages/client/src/__tests__/use-message-handler-pending-prompt.test.ts
 * Triple: s1,s2 mid-turn · until(s1,idle) while s2 transitions · resolves on
 * s1→idle only (test-plan #A2).
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

describe("until convergence (A2)", () => {
  it("resolves only when the awaited session (s1) reaches idle, not on s2", async () => {
    server = await startMockServer({
      sessions: [makeSession("s1", "streaming"), makeSession("s2", "streaming")],
    });
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    let resolved = false;
    const pending = client.until("s1", "idle").then(() => {
      resolved = true;
    });

    // s2 transitions to idle — must NOT resolve the s1 wait.
    server.push({ type: "session_updated", sessionId: "s2", updates: { status: "idle" } });
    // s1 transitions to a non-target status — must NOT resolve either.
    server.push({ type: "session_updated", sessionId: "s1", updates: { status: "active" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved).toBe(false);

    // s1 → idle — resolves now.
    server.push({ type: "session_updated", sessionId: "s1", updates: { status: "idle" } });
    await pending;
    expect(resolved).toBe(true);
    client.close();
  });
});
